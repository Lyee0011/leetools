'use strict';

// Optional, short-lived public-page discovery. No extra browser installation or personal profile.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const dns = require('dns').promises;
const { spawn } = require('child_process');
const { findBrowser, CdpClient, waitForDevTools, findPageTarget, stopBrowser, watchBrowserOwner } = require('./douyin-anonymous-resolver');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function publicAddress(value) {
  if (net.isIP(value) === 4) {
    const [a, b, c] = value.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && [0, 2].includes(c))))
      || (a === 100 && b >= 64 && b <= 127) || (a === 198 && ([18, 19].includes(b) || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  // Accept globally routable IPv6 only; rejects loopback, mapped IPv4 and local/multicast addresses.
  return net.isIP(value) === 6 && /^[23]/i.test(value) && !/^2001:(?:0:|db8:)/i.test(value);
}

function publicUrl(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.href.length > 16384
        || (u.port && !['80', '443'].includes(u.port))) return false;
    if (net.isIP(host)) return publicAddress(host);
    return host.includes('.') && !/(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host);
  } catch { return false; }
}

function mediaKind(url, mime = '') {
  if (!/^https?:/i.test(url)) return '';
  let pathname;
  try { pathname = new URL(url).pathname; } catch { return ''; }
  if (/\.(m4s|m4v|m4f|cmfv|cmfa|ts|m4a|aac|mp3|vtt)$/i.test(pathname)) return '';
  if (/mpegurl/i.test(mime) || /\.m3u8$/i.test(pathname)) return 'hls';
  if (/dash\+xml/i.test(mime) || /\.mpd$/i.test(pathname)) return 'dash';
  if (/^video\/(mp4|webm|quicktime)/i.test(mime) || /\.(mp4|webm|mov)$/i.test(pathname)) return 'file';
  return '';
}

function eligible(url, error) {
  if (!publicUrl(url) || mediaKind(url)) return false;
  const host = new URL(url).hostname;
  if (/(^|\.)(youtube\.com|youtu\.be|bilibili\.com|b23\.tv|douyin\.com|iesdouyin\.com|xiaohongshu\.com|xhslink\.com|yangshipin\.cn)$/.test(host)) return false;
  if (/DRM|protected content|captcha|not a bot|sign in|log in|login|private|premium|members.only|geo.?restrict|not available in your/i.test(error)) return false;
  return /Unsupported URL|No video formats found|Unable to extract|no video could be found|no video found|HTTP Error 403/i.test(error);
}

function chooseCandidate(candidates, view) {
  if (view?.protected) throw new Error('网页播放器使用受保护的内容，无法下载');
  if ((view?.videoCount || 0) > 1) return null;
  const list = [...candidates.values()].filter(c => !c.protected && c.checked !== false);
  const current = view?.src;
  const exact = current && list.find(c => c.url === current);
  if (exact) return exact;
  const master = list.filter(c => c.master || c.kind === 'dash');
  if (master.length === 1 && view?.hasVideo && list.every(c => c === master[0] || master[0].children?.includes(c.url))) return master[0];
  // Multiple unrelated videos/ad streams are ambiguous: never silently download one of them.
  if (list.length === 1 && view?.hasVideo) return list[0];
  return null;
}

async function bounded(promise, ms, message = '浏览器识别超时') {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { clearTimeout(timer); }
}

async function resolvePage(pageUrl, proxy = '', { timeoutMs = 22000, allowTestOrigin = '' } = {}) {
  // allowTestOrigin is an injected test-only option, never accepted by the CLI or HTTP API.
  const testOrigin = allowTestOrigin && new URL(allowTestOrigin).origin;
  const allowedShape = url => {
    if (publicUrl(url)) return true;
    try { return !!(testOrigin && new URL(url).origin === testOrigin); } catch { return false; }
  };
  if (!allowedShape(pageUrl)) throw new Error('浏览器补充解析只接受公开的 http/https 视频页面');
  const lookups = new Map();
  const allowed = async url => {
    if (!allowedShape(url)) return false;
    const u = new URL(url);
    if (testOrigin && u.origin === testOrigin) return true;
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host)) return publicAddress(host);
    if (!lookups.has(host)) lookups.set(host, bounded(dns.lookup(host, { all: true }), 3000)
      .then(addresses => addresses.length > 0 && addresses.every(a => publicAddress(a.address))).catch(() => false));
    return lookups.get(host);
  };
  if (!await allowed(pageUrl)) throw new Error('该网页无法解析为公网地址');
  const browser = findBrowser();
  if (!browser) throw new Error('本机没有 Chrome 或 Edge，暂时无法补充识别此网页');
  const tempRoot = os.tmpdir();
  const profile = fs.mkdtempSync(path.join(tempRoot, 'video-discovery-'));
  const args = ['--headless=new', '--incognito', '--mute-audio', '--disable-extensions', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync',
    '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'];
  if (proxy) args.splice(args.length - 1, 0, `--proxy-server=${proxy}`);
  const child = spawn(browser, args, { windowsHide: true, stdio: 'ignore' });
  child.on('error', () => {});
  let cdp, closed = false;
  const releaseOwnerWatch = watchBrowserOwner(child, timeoutMs + 18000);
  try {
    const port = await waitForDevTools(profile, child);
    cdp = new CdpClient((await findPageTarget(port)).webSocketDebuggerUrl);
    await bounded(cdp.open(), 4000);
    const send = (method, params) => bounded(cdp.send(method, params), 4000);
    const candidates = new Map(), pending = new Map();
    let view = null, protectedSeen = false;
    cdp.on(async event => {
      if (closed) return;
      const p = event.params || {};
      if (event.method === 'Fetch.requestPaused') {
        const ok = !['Image', 'Font'].includes(p.resourceType) && await allowed(p.request.url);
        return send(ok ? 'Fetch.continueRequest' : 'Fetch.failRequest', ok ? { requestId: p.requestId } : { requestId: p.requestId, errorReason: 'BlockedByClient' });
      }
      if (event.method === 'Page.javascriptDialogOpening') return send('Page.handleJavaScriptDialog', { accept: false });
      if (event.method === 'Network.loadingFailed') pending.delete(p.requestId);
      if (event.method === 'Network.responseReceived') {
        const r = p.response;
        const kind = mediaKind(r.url, r.mimeType);
        if (!kind || r.status >= 400 || candidates.size >= 24 || !await allowed(r.url)) return;
        const candidate = { url: r.url, kind, master: false, protected: false, checked: kind === 'file' };
        candidates.set(r.url, candidate);
        if (kind !== 'file' && pending.size < 12) pending.set(p.requestId, candidate);
      }
      if (event.method === 'Network.loadingFinished' && pending.has(p.requestId)) {
        const candidate = pending.get(p.requestId);
        try {
          const result = await send('Network.getResponseBody', { requestId: p.requestId });
          if (result.body.length > 512 * 1024) return;
          const text = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body;
          candidate.master = /#EXT-X-STREAM-INF/.test(text);
          candidate.protected = /<(?:\w+:)?ContentProtection\b|METHOD=SAMPLE-AES|KEYFORMAT="(?!identity)/i.test(text);
          candidate.checked = /#EXTM3U|<(?:\w+:)?MPD[\s>]/.test(text);
          candidate.children = candidate.kind === 'hls' ? [...text.matchAll(/(?:^([^#\s][^\r\n]*)|URI="([^"]+)")/gm)]
            .map(m => { try { return new URL((m[1] || m[2]).trim(), candidate.url).href; } catch { return ''; } }) : [];
          protectedSeen ||= candidate.protected;
        } finally { pending.delete(p.requestId); }
      }
    });
    await send('Network.enable', { maxTotalBufferSize: 2 * 1024 * 1024, maxResourceBufferSize: 512 * 1024 });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await send('Page.navigate', { url: pageUrl });
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await delay(700);
      if (closed || child.exitCode !== null) throw new Error('临时浏览器已退出');
      const result = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
        const videos = [...document.querySelectorAll('video')].filter(v => v.getBoundingClientRect().width > 0).sort((a,b) => b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight);
        const v = videos[0];
        if (v && !v.mediaKeys && v.paused) { v.muted = true; v.play().catch(() => {}); }
        return {title:document.title.slice(0,200),page:location.href,ua:navigator.userAgent,hasVideo:!!v,videoCount:videos.length,src:(v?.currentSrc||v?.src||'').slice(0,16384),protected:!!v?.mediaKeys,
          challenge:!!document.querySelector('iframe[src*="captcha"],.g-recaptcha,.cf-turnstile')};
      })()` });
      view = result.result?.value;
      if (view?.challenge) throw new Error('网页需要人工验证，请先在网站完成正常访问');
      if (protectedSeen || view?.protected) throw new Error('网页播放器使用受保护的内容，无法下载');
      if (view?.src && mediaKind(view.src) && await allowed(view.src) && !candidates.has(view.src)) {
        const kind = mediaKind(view.src);
        if (kind === 'file') candidates.set(view.src, { url: view.src, kind });
      }
      const chosen = chooseCandidate(candidates, view);
      if (chosen && Date.now() - started >= 4000 && pending.size === 0) {
        if (!await allowed(view.page)) throw new Error('网页跳转地址不可用');
        return { url: chosen.url, title: view.title, referer: view.page, userAgent: view.ua, kind: chosen.kind };
      }
    }
    if (candidates.size > 1) throw new Error('页面包含多个播放资源，请打开具体视频页后重试');
    throw new Error('没有识别到可公开下载的视频；网页可能要求登录、手动播放或尚未适配');
  } finally {
    closed = true; releaseOwnerWatch();
    if (cdp) { try { await bounded(cdp.send('Browser.close'), 1500); } catch {} cdp.close(); }
    stopBrowser(child);
    await delay(300);
    if (!path.resolve(profile).startsWith(path.resolve(tempRoot) + path.sep) || !path.basename(profile).startsWith('video-discovery-')) throw new Error('临时目录检查失败');
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {}
  }
}

if (require.main === module) resolvePage(process.argv[2], process.argv[3] || '')
  .then(result => process.stdout.write(JSON.stringify(result)))
  .catch(error => { process.stderr.write(error.message); process.exitCode = 1; })
  .finally(() => { if (process.connected) process.disconnect(); });

module.exports = { publicAddress, publicUrl, mediaKind, eligible, chooseCandidate, resolvePage };
