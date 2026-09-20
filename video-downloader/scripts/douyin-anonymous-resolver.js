#!/usr/bin/env node
'use strict';

// Resolve a public Douyin video through a brand-new anonymous browser session.
// The session never reads the user's Chrome/Edge profile and never exports cookies.
// Its temporary profile is removed as soon as resolution finishes.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function findBrowser() {
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]
    : [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/usr/bin/google-chrome',
        '/usr/bin/microsoft-edge',
      ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

function isAllowedMediaUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'www.douyin.com'
      || host === 'aweme.snssdk.com'
      || host.endsWith('.douyinvod.com')
      || host.endsWith('.byteimg.com')
      || host.endsWith('.douyin.com');
  } catch {
    return false;
  }
}

function addressUrls(address) {
  const list = address?.url_list || address?.urlList || [];
  return list.filter((url) => isAllowedMediaUrl(url));
}

function chooseVideo(item) {
  const rates = item?.video?.bit_rate || item?.video?.bitRate || [];
  const compatible = rates
    .map((rate) => ({
      bitrate: Number(rate.bit_rate || rate.bitRate) || 0,
      format: String(rate.format || '').toLowerCase(),
      h265: Number(rate.is_h265 ?? rate.isH265 ?? 0) !== 0,
      bytevc1: Number(rate.is_bytevc1 ?? rate.isBytevc1 ?? 0) !== 0,
      urls: addressUrls(rate.play_addr || rate.playAddr),
    }))
    .filter((rate) => rate.urls.length && rate.format === 'mp4' && !rate.h265 && !rate.bytevc1)
    .sort((a, b) => b.bitrate - a.bitrate);
  if (compatible.length) return compatible[0].urls[0];

  const progressive = addressUrls(item?.video?.play_addr || item?.video?.playAddr);
  if (progressive.length) return progressive[0];
  return '';
}

function findItem(value, videoId) {
  if (!value || typeof value !== 'object') return null;
  const candidateId = value.aweme_id || value.awemeId || value.itemId || value.item_id || '';
  if (String(candidateId) === String(videoId) && value.video) return value;
  for (const child of Object.values(value)) {
    const found = findItem(child, videoId);
    if (found) return found;
  }
  return null;
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.sequence = 0;
    this.pending = new Map();
    this.handlers = [];
  }

  async open() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.socket.close(); reject(new Error('浏览器连接超时')); }, 5000);
      this.socket.onopen = () => { clearTimeout(timer); resolve(); };
      this.socket.onerror = () => { clearTimeout(timer); reject(new Error('浏览器连接失败')); };
    });
    this.socket.onclose = () => { for (const request of this.pending.values()) request.reject(new Error('临时浏览器已关闭')); this.pending.clear(); };
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      if (!message.method) return;
      for (const handler of this.handlers) Promise.resolve(handler(message)).catch(() => {});
    };
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('浏览器操作超时')); }, 5000);
      const finish = callback => value => { clearTimeout(timer); this.pending.delete(id); callback(value); };
      this.pending.set(id, { resolve: finish(resolve), reject: finish(reject) });
      try { this.socket.send(JSON.stringify({ id, method, params })); } catch (error) { this.pending.get(id).reject(error); }
    });
  }

  on(handler) { this.handlers.push(handler); }
  close() { try { this.socket.close(); } catch {} }
}

async function waitForDevTools(profileDir, child) {
  const marker = path.join(profileDir, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child && (child.killed || child.exitCode !== null)) throw new Error('临时浏览器已退出');
    if (fs.existsSync(marker)) {
      const port = fs.readFileSync(marker, 'utf8').split(/\r?\n/)[0];
      if (/^\d+$/.test(port)) return port;
    }
    await sleep(100);
  }
  throw new Error('匿名浏览器启动超时');
}

async function findPageTarget(port) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) })).json();
      const page = targets.find((target) => target.type === 'page' && target.url === 'about:blank')
        || targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await sleep(100);
  }
  throw new Error('匿名浏览器页面未就绪');
}

function stopBrowser(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    try { spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 }); } catch {}
  }
  try { child.kill(); } catch {}
}

function watchBrowserOwner(child, timeoutMs) {
  const stop = () => stopBrowser(child);
  const cancel = message => { if (message === 'cancel') stop(); };
  const timer = setTimeout(stop, timeoutMs);
  process.once('disconnect', stop);
  process.on('message', cancel);
  if (process.connected) process.send({ type: 'browser-started', pid: child.pid });
  return () => { clearTimeout(timer); process.removeListener('disconnect', stop); process.removeListener('message', cancel); };
}

async function resolveAnonymous(videoId, proxy = '') {
  if (!/^\d{15,25}$/.test(String(videoId || ''))) throw new Error('抖音视频编号无效');
  const browser = findBrowser();
  if (!browser) throw new Error('需要安装 Chrome 或 Edge 才能建立匿名临时会话');

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shinewood-douyin-'));
  const args = [
    '--headless=new', '--incognito', '--mute-audio', '--disable-gpu', '--disable-extensions',
    '--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, 'about:blank',
  ];
  if (proxy) args.splice(args.length - 1, 0, `--proxy-server=${proxy}`);
  const child = spawn(browser, args, { windowsHide: true, stdio: 'ignore' });
  child.on('error', () => {});
  const releaseOwnerWatch = watchBrowserOwner(child, 40000);
  let cdp;
  try {
    const port = await waitForDevTools(profileDir, child);
    const target = await findPageTarget(port);
    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Network.enable');
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.setUserAgentOverride', {
      userAgent: DESKTOP_UA,
      acceptLanguage: 'zh-CN,zh;q=0.9',
      platform: 'Windows',
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})",
    });

    let finish;
    let settled = false;
    const found = new Promise((resolve) => { finish = resolve; });
    const candidates = new Set();
    cdp.on(async (message) => {
      if (settled) return;
      if (message.method === 'Network.responseReceived') {
        const { requestId, response, type } = message.params;
        const isJson = /(?:json|javascript)/i.test(response.mimeType || '');
        if (isJson && (type === 'XHR' || type === 'Fetch' || /aweme|detail|feed/i.test(response.url))) {
          candidates.add(requestId);
        }
        return;
      }
      if (message.method !== 'Network.loadingFinished' || !candidates.has(message.params.requestId)) return;
      candidates.delete(message.params.requestId);
      try {
        const body = await cdp.send('Network.getResponseBody', { requestId: message.params.requestId });
        const text = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body;
        if (text.length > 8 * 1024 * 1024 || !text.includes(String(videoId))) return;
        const item = findItem(JSON.parse(text), videoId);
        const url = chooseVideo(item);
        if (!item || !url) return;
        settled = true;
        finish({
          id: String(videoId),
          title: String(item.desc || '抖音视频').slice(0, 200),
          duration: Number(item.video?.duration || item.duration) || 0,
          url,
          userAgent: DESKTOP_UA,
          referer: 'https://www.douyin.com/',
        });
      } catch {}
    });

    await cdp.send('Page.navigate', { url: `https://www.douyin.com/video/${videoId}` });
    const result = await Promise.race([found, sleep(30000).then(() => null)]);
    if (!result) throw new Error('匿名临时会话没有取得视频播放地址');
    return result;
  } finally {
    releaseOwnerWatch();
    cdp?.close();
    stopBrowser(child);
    await sleep(300);
    if (!path.resolve(profileDir).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(profileDir).startsWith('shinewood-douyin-')) throw new Error('临时目录检查失败');
    try { fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); } catch {}
  }
}

async function main() {
  const result = await resolveAnonymous(process.argv[2], process.argv[3] || '');
  process.stdout.write(JSON.stringify(result));
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(String(error.message || '匿名临时会话解析失败'));
    process.exitCode = 1;
  }).finally(() => { if (process.connected) process.disconnect(); });
}

module.exports = { chooseVideo, findItem, isAllowedMediaUrl, resolveAnonymous,
  findBrowser, CdpClient, waitForDevTools, findPageTarget, stopBrowser, watchBrowserOwner };
