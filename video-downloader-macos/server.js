#!/usr/bin/env node
/*
 * 视频下载器 · 单文件本地小工具
 * 贴链接(B站/YouTube/凡 yt-dlp 支持的站) → 选保存位置 → 下载,带实时进度。
 * macOS 启动脚本自动下载并校验 Node.js、yt-dlp 和 FFmpeg。
 * 只监听 127.0.0.1。分享源码启动包，不复制个人配置或运行目录(见 README)。
 */
'use strict';
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { once } = require('events');
const { finished } = require('stream/promises');
const { StringDecoder } = require('string_decoder');
const { runtimeFor } = require('./scripts/runtime');
const macOS = require('./scripts/macos-platform');
const yangshipin = require('./scripts/yangshipin');
const { describeDownloadError } = require('./scripts/download-errors');
const browserDiscovery = require('./scripts/browser-resolver');

const CONF_PATH = path.join(__dirname, 'config.json');
const DEFAULT_DIR = path.join(os.homedir(), 'Downloads', '视频素材');
const APP_ID = 'shinewood-video-downloader-macos';
const INSTANCE_ID = crypto.createHash('sha256').update(fs.realpathSync(__dirname)).digest('hex').slice(0, 12);
const BUILD_ID = crypto.createHash('sha256').update([
  'server.js', 'scripts/yangshipin.js', 'scripts/download-errors.js', 'scripts/douyin-anonymous-resolver.js', 'scripts/browser-resolver.js', 'scripts/runtime.js', 'scripts/macos-platform.js', 'dependencies.macos.json',
].map(file => file + '\0' + fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\0')).digest('hex').slice(0, 12);
const API_TOKEN = crypto.randomBytes(32).toString('base64url');
const PAGE_NONCE = crypto.randomBytes(18).toString('base64url');
const MAX_JSON_BODY = 64 * 1024;
const DOUYIN_ANONYMOUS_RESOLVER = path.join(__dirname, 'scripts', 'douyin-anonymous-resolver.js');

// ── 环境探测 ──
const FFMPEG = runtimeFor(__dirname, 'ffmpeg');
const JS_NODE = runtimeFor(__dirname, 'node');

function extractUrl(value) {
  const m = String(value || '').match(/https?:\/\/[^\s<>"'，。！？；、）)\]】}>》」』]+/i);
  return m ? m[0].replace(/[，。！？；、,)\]}>]+$/g, '') : '';
}

function inspectMedia(file) {
  if (!FFMPEG || !file || !fs.existsSync(file)) return { video: false, audio: false };
  const r = spawnSync(FFMPEG, ['-hide_banner', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm,mpegts,avi,flv,ogg', '-i', file,
    '-map', '0:v:0', '-map', '0:a:0', '-t', '0', '-f', 'null', '-'], { encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  const text = String(r.stderr || '') + String(r.stdout || '');
  return { video: r.status === 0 && !r.error, audio: r.status === 0 && !r.error, container: text.match(/Input #0, (.+?), from /)?.[1] || '' };
}

async function finishVideoJob(job) {
  if (job.dir && job.file && fs.existsSync(job.file)) {
    const relative = path.relative(fs.realpathSync(job.dir), fs.realpathSync(job.file));
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) throw new Error('最终文件不在指定保存目录内');
  }
  let streams = inspectMedia(job.file);
  if (!streams.video || !streams.audio) throw new Error(!fs.existsSync(job.file) ? '下载结束但没有找到最终视频' : '最终文件缺少画面或声音');
  // Without a bundled ffprobe, yt-dlp may leave HLS transport streams named .mp4.
  // Remux only that case, preserving the original until the replacement is verified.
  if (streams.container === 'mpegts' && path.extname(job.file).toLowerCase() === '.mp4') {
    job.phase = '整理 MP4 格式';
    const temp = job.file + '.' + crypto.randomBytes(6).toString('hex') + '.remux.mp4';
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-n', '-i', job.file,
          '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', temp],
        { windowsHide: true, stdio: 'ignore', timeout: 180000 });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error('整理 MP4 失败，原下载文件已保留')));
      });
      streams = inspectMedia(temp);
      if (!streams.video || !streams.audio || !streams.container.includes('mp4')) throw new Error('整理后的 MP4 校验失败，原下载文件已保留');
      fs.renameSync(temp, job.file);
    } finally {
      try { fs.unlinkSync(temp); } catch {}
    }
  }
  job.status = 'done'; job.pct = 100; job.merging = false; job.phase = '完成';
}

// Only use the pinned standalone macOS executable; no system Python/Homebrew probes.
const ytdlp = runtimeFor(__dirname, 'yt-dlp');
const YTDLP_CMD = ytdlp ? [ytdlp] : null;

let ACTIVE_PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
const PROXY_CANDIDATES = [
  { port: 7897, scheme: 'http' }, // Clash Verge 常用 mixed-port
  { port: 7890, scheme: 'http' },
  { port: 10809, scheme: 'http' },
  { port: 7891, scheme: 'socks5' },
  { port: 10808, scheme: 'socks5' },
  { port: 1080, scheme: 'socks5' },
];
function detectProxy(cb) {
  if (ACTIVE_PROXY) return cb(ACTIVE_PROXY);
  const net = require('net');
  let index = 0;
  const tryNext = () => {
    if (index >= PROXY_CANDIDATES.length) return cb('');
    const candidate = PROXY_CANDIDATES[index++];
    let settled = false;
    const finish = (found) => {
      if (settled) return;
      settled = true;
      if (found) cb(`${candidate.scheme}://127.0.0.1:${candidate.port}`);
      else tryNext();
    };
    const s = net.connect({ host: '127.0.0.1', port: candidate.port, timeout: 500 });
    s.on('connect', () => { s.destroy(); finish(true); });
    s.on('error', () => finish(false));
    s.on('timeout', () => { s.destroy(); finish(false); });
  };
  tryNext();
}

// ── 配置 ──
function loadConf() { try { const value = JSON.parse(fs.readFileSync(CONF_PATH, 'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } }
function saveConf(c) {
  const temp = CONF_PATH + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  try { fs.writeFileSync(temp, JSON.stringify(c, null, 2), { flag: 'wx' }); fs.renameSync(temp, CONF_PATH); }
  finally { try { fs.unlinkSync(temp); } catch {} }
}
let conf = loadConf();
if (typeof conf.dir !== 'string' || !path.isAbsolute(conf.dir)) conf.dir = DEFAULT_DIR;

// ── 下载任务 ──
const jobs = new Map(); // id -> {id,url,name,pct,speed,eta,status,err,file,dir}
const DOUYIN_MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36';

function isDouyinUrl(value) {
  try {
    return /(^|\.)douyin\.com$|(^|\.)iesdouyin\.com$/i.test(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isDouyinMediaUrl(value) {
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

function isYouTubeUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');
  } catch {
    return false;
  }
}

function isXiaohongshuUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'xhslink.com' || host.endsWith('.xhslink.com')
      || host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com');
  } catch {
    return false;
  }
}

function safeFileName(value) {
  const cleaned = String(value || '抖音视频')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  return (cleaned || '抖音视频').slice(0, 80);
}

function findDouyinItem(value, id) {
  if (!value || typeof value !== 'object') return null;
  if (String(value.aweme_id || '') === String(id) && value.video) return value;
  for (const child of Object.values(value)) {
    const found = findDouyinItem(child, id);
    if (found) return found;
  }
  return null;
}

async function fetchText(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': DOUYIN_MOBILE_UA,
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    if (!response.ok) throw new Error(`页面请求失败（HTTP ${response.status}）`);
    return { url: response.url, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveXiaohongshuUrl(value) {
  if (!isXiaohongshuUrl(value)) return value;
  let host = '';
  try { host = new URL(value).hostname.toLowerCase(); } catch { return value; }
  if (host !== 'xhslink.com' && !host.endsWith('.xhslink.com')) return value;
  const resolved = await fetchText(value, 20000);
  return isXiaohongshuUrl(resolved.url) ? resolved.url : value;
}

function extractDouyinVideoId(value) {
  const text = String(value || '');
  const pathId = text.match(/\/(?:video|note)\/(\d{15,25})(?:[/?#]|$)/i)?.[1];
  if (pathId) return pathId;
  try {
    const parsed = new URL(text);
    for (const key of ['modal_id', 'aweme_id', 'item_id', 'item_ids']) {
      const candidate = String(parsed.searchParams.get(key) || '').match(/^\d{15,25}$/)?.[0];
      if (candidate) return candidate;
    }
  } catch {}
  return '';
}

async function getDouyinVideoInfo(originalUrl) {
  let id = extractDouyinVideoId(originalUrl);
  if (!id) {
    const resolved = await fetchText(originalUrl);
    id = extractDouyinVideoId(resolved.url)
      || resolved.text.match(/"(?:aweme_id|itemId)"\s*:\s*"(\d{15,25})"/i)?.[1]
      || '';
  }
  if (!id) throw new Error('没有从抖音链接中识别出视频编号');
  try {
    const share = await fetchText(`https://www.iesdouyin.com/share/video/${id}/`);
    const routerJson = share.text.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\})\s*<\/script>/)?.[1];
    if (!routerJson) throw new Error('抖音游客页面没有返回视频数据');
    let data;
    try { data = JSON.parse(routerJson); } catch { throw new Error('抖音游客页面数据解析失败'); }
    const item = findDouyinItem(data, id);
    const videoId = item?.video?.play_addr?.uri;
    if (!item || !videoId) throw new Error('抖音游客页面暂未提供这个视频的播放地址');

    return {
      id,
      title: safeFileName(item.desc),
      url: `https://aweme.snssdk.com/aweme/v1/play/?video_id=${encodeURIComponent(videoId)}&ratio=1080p&line=0`,
      userAgent: DOUYIN_MOBILE_UA,
      referer: 'https://www.iesdouyin.com/',
    };
  } catch (error) {
    error.douyinVideoId = id;
    throw error;
  }
}

function cancelResolver(child) {
  if (child.connected) { try { child.send('cancel', () => {}); } catch {} }
  else { try { child.kill(); } catch {} }
  const kill = setTimeout(() => { if (child.exitCode === null) { try { child.kill(); } catch {} } }, 15000);
  kill.unref();
}

function getDouyinAnonymousVideoInfo(id) {
  return new Promise((resolve, reject) => {
    if (!JS_NODE || !fs.existsSync(DOUYIN_ANONYMOUS_RESOLVER)) {
      return reject(new Error('匿名临时会话组件不可用'));
    }
    const args = [DOUYIN_ANONYMOUS_RESOLVER, String(id)];
    if (ACTIVE_PROXY) args.push(ACTIVE_PROXY);
    const child = spawn(JS_NODE, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, NO_COLOR: '1' } });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      cancelResolver(child);
      finish(new Error('匿名临时会话解析超时'));
    }, 45000);
    child.stdout.on('data', (data) => {
      stdout += data.toString('utf8');
      if (stdout.length > 1024 * 1024) {
        cancelResolver(child);
        finish(new Error('匿名临时会话返回数据异常'));
      }
    });
    child.stderr.on('data', (data) => { stderr = (stderr + data.toString('utf8')).slice(-600); });
    child.on('error', (error) => finish(new Error(`匿名临时会话启动失败：${error.message}`)));
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) return finish(new Error(stderr.trim() || '匿名临时会话没有取得播放地址'));
      try {
        const data = JSON.parse(stdout);
        if (String(data.id) !== String(id) || !isDouyinMediaUrl(data.url)) throw new Error('返回的视频信息不匹配');
        finish(null, {
          id: String(id),
          title: safeFileName(data.title),
          url: data.url,
          userAgent: String(data.userAgent || DOUYIN_MOBILE_UA),
          referer: String(data.referer || 'https://www.douyin.com/'),
        });
      } catch (error) {
        finish(new Error(`匿名临时会话数据无效：${error.message}`));
      }
    });
  });
}

function formatSpeed(bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '';
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / 1024 / 1024).toFixed(1)}MiB/s`;
  return `${Math.round(bytesPerSecond / 1024)}KiB/s`;
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const rounded = Math.ceil(seconds);
  const minutes = Math.floor(rounded / 60);
  return `${String(minutes).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
}

async function saveDouyinVideo(job, videoUrl, partFile, requestHeaders = {}) {
  if (!isDouyinMediaUrl(videoUrl)) throw new Error('抖音播放地址未通过安全检查');
  const controller = new AbortController();
  let idleTimer;
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), 30000);
  };
  resetIdleTimer();
  let response;
  try {
    response = await fetch(videoUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': requestHeaders.userAgent || DOUYIN_MOBILE_UA,
        Referer: requestHeaders.referer || 'https://www.iesdouyin.com/',
      },
    });
    if (!response.ok) throw new Error(`视频请求失败（HTTP ${response.status}）`);
    if (!/^video\//i.test(response.headers.get('content-type') || '')) throw new Error('抖音返回的内容不是视频');
    if (!response.body) throw new Error('抖音没有返回视频数据');

    const total = Number(response.headers.get('content-length')) || 0;
    const output = fs.createWriteStream(partFile, { flags: 'wx' });
    const outputFinished = finished(output);
    let received = 0;
    let sampleBytes = 0;
    let sampleTime = Date.now();
    try {
      for await (const chunk of response.body) {
        resetIdleTimer();
        received += chunk.length;
        if (!output.write(chunk)) await Promise.race([once(output, 'drain'), outputFinished]);
        const now = Date.now();
        if (now - sampleTime >= 500) {
          const speed = (received - sampleBytes) * 1000 / (now - sampleTime);
          job.speed = formatSpeed(speed);
          job.pct = total ? Math.min(99.5, received * 100 / total) : 0;
          job.eta = total && speed > 0 ? formatEta((total - received) / speed) : '';
          sampleBytes = received;
          sampleTime = now;
        }
      }
      output.end();
      await outputFinished;
    } catch (error) {
      output.destroy();
      try { await outputFinished; } catch {}
      throw error;
    }
    if (!received || (total && received !== total)) throw new Error('视频文件接收不完整');
  } finally {
    clearTimeout(idleTimer);
  }
}

async function runDouyinJob(job) {
  const tempDir = path.join(job.dir, '.视频下载器临时');
  let partFile = '';
  try {
    job.phase = '获取抖音游客视频信息';
    let info;
    try {
      info = await getDouyinVideoInfo(job.url);
    } catch (visitorError) {
      const id = visitorError.douyinVideoId || extractDouyinVideoId(job.url);
      if (!id) throw visitorError;
      job.phase = '建立隔离匿名临时会话';
      try {
        info = await getDouyinAnonymousVideoInfo(id);
        job.note = '游客页受限，已自动使用隔离匿名临时会话';
      } catch (anonymousError) {
        throw new Error(`${visitorError.message}；${anonymousError.message}`);
      }
    }
    job.name = `${info.title} [${info.id}].mp4`;
    job.file = path.join(job.dir, job.name);
    if (fs.existsSync(job.file)) {
      const streams = inspectMedia(job.file);
      if (streams.video && streams.audio) {
        job.status = 'done'; job.phase = '完成'; job.pct = 100; job.note = '此前已下载过';
        return;
      }
      job.file = path.join(job.dir, `${info.title} [${info.id}-${job.id.slice(0, 4)}].mp4`);
      job.name = path.basename(job.file);
    }

    fs.mkdirSync(tempDir, { recursive: true });
    partFile = path.join(tempDir, `${info.id}-${job.id}.mp4.part`);
    for (let attempt = 1; attempt <= 2; attempt++) {
      job.attempt = attempt;
      job.phase = attempt === 1 ? '下载抖音视频（游客模式）' : '抖音下载自动重试';
      try {
        await saveDouyinVideo(job, info.url, partFile, info);
        break;
      } catch (error) {
        try { fs.unlinkSync(partFile); } catch {}
        if (attempt === 2) throw error;
        job.pct = 0; job.speed = ''; job.eta = '';
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }
    fs.renameSync(partFile, job.file);
    partFile = '';
    job.phase = '校验音视频';
    const streams = inspectMedia(job.file);
    if (!streams.video || !streams.audio) throw new Error('下载文件缺少画面或声音');
    job.status = 'done'; job.phase = '完成'; job.pct = 100; job.speed = ''; job.eta = '';
  } catch (error) {
    if (partFile) { try { fs.unlinkSync(partFile); } catch {} }
    job.status = 'error';
    job.err = error.name === 'AbortError' ? '抖音请求超时，请重试' : (error.message || '抖音下载失败');
  }
}

async function runYangshipinJob(job) {
  const tempDir = path.join(job.dir, '.视频下载器临时');
  let partFile = '';
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      job.attempt = attempt;
      job.phase = attempt === 1 ? '获取央视频公开播放信息' : '重新获取央视频播放地址';
      try {
        const info = await yangshipin.resolve(job.url);
        const title = safeFileName(info.title);
        const preferred = path.join(job.dir, `${title} [${info.id}].mp4`);
        job.name = path.basename(preferred);
        job.note = `央视频 · ${info.height}p`;
        if (await yangshipin.verifyFile(preferred, info)) {
          const streams = inspectMedia(preferred);
          if (streams.video && streams.audio) {
            job.file = preferred;
            job.note += ' · 此前已下载过';
            job.status = 'done'; job.phase = '完成'; job.pct = 100;
            return;
          }
        }
        fs.mkdirSync(tempDir, { recursive: true });
        partFile = path.join(tempDir, `yangshipin-${info.id}-${job.id}-${attempt}.mp4.part`);
        job.phase = `下载央视频 ${info.height}p 视频`;
        let sampleBytes = 0, sampleTime = Date.now();
        await yangshipin.download(info, partFile, (received, total) => {
          const now = Date.now();
          job.pct = Math.min(99.5, received * 100 / total);
          if (now - sampleTime >= 500) {
            const speed = (received - sampleBytes) * 1000 / (now - sampleTime);
            job.speed = formatSpeed(speed); job.eta = formatEta((total - received) / speed);
            sampleBytes = received; sampleTime = now;
          }
        });
        job.phase = '校验音视频';
        const streams = inspectMedia(partFile);
        if (!streams.video || !streams.audio) throw new Error('下载文件缺少画面或声音');
        // Hard-link only after validation: atomic publication without overwriting any existing file.
        let destination = preferred;
        try { fs.linkSync(partFile, destination); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          destination = path.join(job.dir, `${title} [${info.id}-${job.id}].mp4`);
          fs.linkSync(partFile, destination);
        }
        fs.unlinkSync(partFile); partFile = '';
        job.file = destination; job.name = path.basename(destination);
        job.status = 'done'; job.phase = '完成'; job.pct = 100; job.speed = ''; job.eta = '';
        return;
      } catch (error) {
        if (partFile) { try { fs.unlinkSync(partFile); } catch {} partFile = ''; }
        const transient = error.retryable || /AbortError|TimeoutError|TypeError/.test(error.name);
        if (attempt === 2 || !transient) throw error;
        job.pct = 0; job.speed = ''; job.eta = '';
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }
  } catch (error) {
    job.status = 'error'; job.phase = '失败'; job.speed = ''; job.eta = '';
    job.err = /AbortError|TimeoutError/.test(error.name) ? '央视频连接超时，请重试'
      : error.name === 'TypeError' ? '连接央视频失败，请检查网络后重试' : error.message;
  }
}

let browserQueue = Promise.resolve();
let browserPending = 0;
async function discoverPageVideo(job) {
  if (browserPending >= 3) throw new Error('正在识别其他网页，请稍后点击重试');
  browserPending++;
  const previous = browserQueue;
  let release;
  browserQueue = new Promise(resolve => { release = resolve; });
  job.phase = '等待识别网页视频';
  await previous;
  try {
    job.phase = '识别网页视频（临时浏览器）';
    return await new Promise((resolve, reject) => {
      const args = [path.join(__dirname, 'scripts', 'browser-resolver.js'), job.url, ACTIVE_PROXY || ''];
      const child = spawn(JS_NODE || process.execPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env } });
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      let stdout = '', stderr = '', settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => { cancelResolver(child); finish(new Error('网页识别超时，请稍后重试')); }, 55000);
      child.stdout.on('data', chunk => {
        stdout += chunk.toString('utf8');
        if (stdout.length > 65536) { cancelResolver(child); finish(new Error('网页返回的播放信息过大')); }
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-600); });
      child.on('error', () => finish(new Error('临时浏览器识别组件启动失败')));
      child.on('close', code => {
        if (settled) return;
        if (code !== 0) return finish(new Error(stderr || '网页未提供可公开下载的视频'));
        try {
          const info = JSON.parse(stdout);
          if (!browserDiscovery.publicUrl(info.url) || !browserDiscovery.publicUrl(info.referer)
              || typeof info.userAgent !== 'string' || /[\r\n]/.test(info.userAgent)) throw new Error('地址无效');
          finish(null, { mediaUrl: info.url, referer: info.referer, userAgent: info.userAgent.slice(0, 300), title: safeFileName(info.title), fromBrowser: true });
        } catch { finish(new Error('网页返回了无效的播放信息')); }
      });
    });
  } finally { browserPending--; release(); }
}

function newJob(url, dir) {
  if ([...jobs.values()].filter(j => j.status === 'running').length >= 3) throw httpError(429, '最多同时下载三个视频，请等待一个任务结束后重试');
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, '.write-test-' + crypto.randomBytes(6).toString('hex'));
  try { fs.writeFileSync(probe, '', { flag: 'wx' }); } catch { throw httpError(400, '保存目录无法写入，请更换保存位置'); }
  finally { try { fs.unlinkSync(probe); } catch {} }
  // 防内存泄漏:任务 Map 只增不减,超 60 条时清掉最老的已结束任务(running 的不动),保留最近 40
  if (jobs.size > 60) { [...jobs.values()].sort((a, b) => a.t - b.t).slice(0, jobs.size - 40).forEach((j) => { if (j.status !== 'running') jobs.delete(j.id); }); }
  const id = crypto.randomBytes(5).toString('hex');
  const job = { id, url, name: url, pct: 0, speed: '', eta: '', status: 'running', err: '', file: '', dir, merging: false, phase: '准备下载', attempt: 1, t: Date.now() };
  jobs.set(id, job);
  if (yangshipin.isYangshipinUrl(url)) {
    runYangshipinJob(job);
    return job;
  }
  if (isDouyinUrl(url)) {
    runDouyinJob(job);
    return job;
  }

  runYtdlpJob(job);
  return job;
}

function runYtdlpJob(job, options = {}) {
  const { url, dir } = job;
  const downloadUrl = options.mediaUrl || url;
  const isXhs = isXiaohongshuUrl(url);
  const tempDir = path.join(dir, '.视频下载器临时', job.id);
  const args = ['--no-config', '--encoding', 'utf-8', '--newline', '--progress', '--no-playlist', '--no-overwrites', '--abort-on-unavailable-fragments', '-P', dir, '-P', `temp:${tempDir}`, '-o', '%(title).80s [%(id)s].%(ext)s',
    '--print', 'after_move:__FINAL_FILE__%(filepath)s',
    '--socket-timeout', '20',                       // 20秒握手/读取超时:网络抖一下就快速失败重来,不再卡 0.0% 干等
    '--retries', '10', '--fragment-retries', '10',  // 偶发失败自动重试10次:治 B站 TLS 握手偶发超时导致的硬失败
    '--concurrent-fragments', '8'];                 // 8线程并发下载:突破 YouTube 单连接限速(实测 82→870KiB/s,快10倍)
  // 新版 YouTube 需要外部 JavaScript 运行时来处理网页挑战。项目已自带 Node。
  if (JS_NODE) args.push('--js-runtimes', `node:${JS_NODE}`);
  // 优先 m4a(AAC) 音轨:opus 塞进 mp4 后 QuickTime 播放无声;B站本就是 AAC 不受影响
  if (FFMPEG) { args.push('-f', 'bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b', '--merge-output-format', 'mp4', '--ffmpeg-location', FFMPEG); }
  else { args.push('-f', 'b'); }
  // B站补齐 Referer；Clash 开启时统一交给其规则选择直连或代理线路。
  if (/bilibili\.com|b23\.tv/.test(url)) args.push('--add-header', 'Referer:https://www.bilibili.com/');
  if (ACTIVE_PROXY) args.push('--proxy', ACTIVE_PROXY);
  if (options.fromBrowser) {
    args.push('--referer', options.referer, '--user-agent', options.userAgent);
    const videoId = crypto.createHash('sha256').update(url).digest('hex').slice(0, 10);
    args.push('-o', `${options.title.replace(/%/g, '%%')} [${videoId}].%(ext)s`);
    job.note = '已自动识别网页播放资源';
  }

  const startAttempt = (attempt) => {
    job.attempt = attempt;
    job.status = 'running';
    job.phase = (attempt > 1 ? '自动重试' : options.fromBrowser ? '下载网页视频' : '准备下载');
    job.err = '';
    job.pct = 0;
    job.speed = '';
    job.eta = '';
    const childEnv = {
      ...process.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
    };
    const runArgs = args.slice();
    runArgs.push('--', downloadUrl);   // 原链接和识别后的地址都通过独立参数传递。
    const child = spawn(YTDLP_CMD[0], YTDLP_CMD.slice(1).concat(runArgs), { env: childEnv, windowsHide: true });
    let buf = '';
    let errTail = '';
    const onLine = (line) => {
      let m;
      if ((m = line.match(/^__FINAL_FILE__(.+)$/))) {
        job.file = m[1].trim(); job.name = path.basename(job.file); job.phase = '校验音视频';
      }
      if ((m = line.match(/\[download\]\s+Destination:\s+(.+)$/))) {
        job.file = m[1].trim(); job.name = path.basename(job.file); job.merging = false;
        job.pct = 0; job.speed = ''; job.eta = '';
        job.phase = /\.f\d+\.(m4a|aac|opus|webm)$/i.test(job.file) ? '下载音频轨' : '下载视频轨';
      }
      if ((m = line.match(/\[Merger\].*?"(.+?)"/))) {
        job.file = m[1]; job.name = path.basename(job.file); job.merging = true; job.phase = '合并音视频';
      }
      if ((m = line.match(/\[download\]\s+([\d.]+)%(?:.*?at\s+([^\s]+))?(?:.*?ETA\s+([^\s]+))?/))) {
        job.pct = Math.min(100, parseFloat(m[1]) || 0);
        if (m[2]) job.speed = m[2];
        if (m[3]) job.eta = m[3];
      }
      if (/has already been downloaded/.test(line)) { job.pct = 100; job.note = '此前已下载过'; }
    };
    const eat = (d) => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } if (buf.length > 65536) buf = buf.slice(-65536); };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', eat);
    child.stderr.on('data', (d) => { const s = d.toString('utf8'); errTail = (errTail + s).slice(-2400); eat(d); });
    child.on('error', (e) => { job.status = 'error'; job.err = 'yt-dlp 启动失败: ' + e.message; });
    child.on('close', async (code) => {
      if (job.status === 'error') return;
      if (buf) onLine(buf);
      // A failed transfer may leave playable but incomplete tracks. Never turn a nonzero exit into success.
      if (code === 0) {
        job.phase = '校验音视频';
        try { await finishVideoJob(job); }
        catch (error) { job.status = 'error'; job.phase = '失败'; job.err = error.message; }
        return;
      }
      const known = errTail.match(/ERROR:\s*([^\n]+)/);
      const message = known ? known[1].slice(0, 240) : ('退出码 ' + code);
      const youtubeIpChallenge = isYouTubeUrl(url)
        && /Sign in to confirm you(?:'|’)?re not a bot|confirm your age|not a bot/i.test(errTail);
      const xhsNeedsLogin = isXhs
        && /No video formats found|login|log in|cookie|captcha|forbidden|HTTP Error 403|initial state/i.test(errTail);
      const xhsCookieReadFailed = isXhs
        && /Could not copy .*cookie database|Failed to decrypt|cookie.*(?:locked|permission denied)|CookieLoadError/i.test(errTail);
      if (!options.fromBrowser && browserDiscovery.eligible(url, errTail)) {
        job.pct = 0; job.speed = ''; job.eta = ''; job.merging = false;
        discoverPageVideo(job).then(info => runYtdlpJob(job, info)).catch(error => {
          job.status = 'error'; job.phase = '失败'; job.err = error.message;
        });
        return;
      }
      if (attempt < 2 && (/No such file|timed out|timeout|handshake|TLS|SSL|EOF|ConnectionReset|10054|reset by peer|远程主机|temporar|HTTP Error (?:4(?:12|29)|5)/i.test(errTail) || youtubeIpChallenge)) {
        job.phase = '自动重试'; job.err = '第一次下载异常，正在自动重试'; job.pct = 0; job.merging = false;
        return setTimeout(() => startAttempt(attempt + 1), youtubeIpChallenge ? 1800 : 600);
      }
      job.status = 'error';
      if (youtubeIpChallenge) {
        job.err = 'YouTube 当前代理节点触发了临时风控（不是本工具要求 Cookie）。请在 Clash 切换节点后重新下载。';
      } else if (isXhs && xhsCookieReadFailed) {
        job.err = '此 Mac 预览版仅下载可公开访问的小红书内容，不读取浏览器登录状态。';
      } else if (isXhs && xhsNeedsLogin) {
        job.err = '小红书页面需要登录或验证。此 Mac 预览版仅处理公开内容，不读取个人浏览器账号。';
      } else {
        job.err = describeDownloadError(message);
        if (isYouTubeUrl(url) && !ACTIVE_PROXY) job.err += '（YouTube 需先启动 Clash，再重启工具）';
      }
    });
  };
  startAttempt(1);
  return job;
}

// ── HTML 界面(内嵌单页) ──
const PAGE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>小伊工具箱 · 视频下载器 · Mac 预览版</title>
<style>
:root{color-scheme:light;--bg:#f5f5f7;--surface:rgba(255,255,255,.78);--surface-solid:#fff;--field:#f5f5f7;--line:rgba(0,0,0,.08);--line-strong:rgba(0,0,0,.13);--tx:#1d1d1f;--tx2:#6e6e73;--tx3:#98989d;--blue:#0071e3;--blue-hover:#0077ed;--red:#d70015;--green:#168c4b;--shadow:0 22px 70px rgba(0,0,0,.10)}
*{box-sizing:border-box;margin:0;padding:0}
html{min-height:100%;background:var(--bg)}
body{background:radial-gradient(circle at 50% -15%,rgba(0,113,227,.13),transparent 38%),var(--bg);color:var(--tx);font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','PingFang SC','Microsoft YaHei',sans-serif;min-height:100vh;display:flex;justify-content:center;padding:68px 24px 44px;-webkit-font-smoothing:antialiased}
.wrap{width:100%;max-width:760px}
.hero{text-align:center;margin-bottom:34px}
.appicon{width:48px;height:48px;margin:0 auto 18px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(155deg,#2997ff,#0066cc);box-shadow:0 10px 30px rgba(0,113,227,.28);color:#fff;font-size:25px;font-weight:500;line-height:1}
h1{font-size:34px;line-height:1.15;font-weight:680;letter-spacing:-1.2px}
.sub{color:var(--tx2);font-size:14px;margin-top:10px;letter-spacing:.1px}
.platforms{display:flex;justify-content:center;gap:7px;flex-wrap:wrap;margin-top:18px}
.platforms span{padding:5px 10px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.42);color:var(--tx2);font-size:11px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:24px;padding:26px;box-shadow:var(--shadow);backdrop-filter:blur(28px) saturate(145%);-webkit-backdrop-filter:blur(28px) saturate(145%)}
.label{display:block;color:var(--tx2);font-size:12px;font-weight:600;margin:0 0 9px 2px}
.row{display:flex;gap:10px}
input[type=text]{flex:1;min-width:0;height:56px;background:var(--field);border:1px solid transparent;border-radius:14px;padding:0 17px;color:var(--tx);font:inherit;font-size:15px;outline:none;box-shadow:inset 0 0 0 1px var(--line);transition:border-color .18s,box-shadow .18s,background .18s}
input[type=text]::placeholder{color:var(--tx3)}
input[type=text]:focus{background:var(--surface-solid);border-color:var(--blue);box-shadow:0 0 0 4px rgba(0,113,227,.14)}
button{border:1px solid var(--line);background:var(--surface-solid);color:var(--tx);border-radius:12px;padding:10px 16px;font:inherit;font-size:13px;font-weight:560;cursor:pointer;white-space:nowrap;transition:transform .15s,background .15s,border-color .15s,opacity .15s}
button:hover{background:var(--field);border-color:var(--line-strong)}
button:active{transform:scale(.98)}
button.primary{height:56px;min-width:112px;background:var(--blue);border-color:var(--blue);color:#fff;font-size:15px;font-weight:650}
button.primary:hover{background:var(--blue-hover);border-color:var(--blue-hover)}
button:disabled{opacity:.45;cursor:default;transform:none}
.formerr{display:none;color:var(--red);font-size:12px;margin:10px 2px 0;line-height:1.55}
.formerr.show{display:block}
.dirrow{display:flex;align-items:center;gap:14px;margin-top:22px;padding-top:20px;border-top:1px solid var(--line)}
.location{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.location .eyebrow{color:var(--tx3);font-size:11px}
.dirrow .path{color:var(--tx2);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.actions{display:flex;gap:8px}
#jobs{margin-top:14px;display:flex;flex-direction:column;gap:10px}
.jobs-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:18px 2px 0;color:var(--tx3);font-size:11px}
.jobs-head button{padding:6px 9px;color:var(--tx2);font-size:11px}
.jobs-head button:hover:not(:disabled){color:var(--red);border-color:rgba(255,69,58,.35);background:rgba(255,69,58,.06)}
.job{background:var(--surface);border:1px solid var(--line);border-radius:17px;padding:17px 18px;box-shadow:0 8px 30px rgba(0,0,0,.05);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px)}
.job .name{font-size:13px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:12px}
.bar{height:5px;background:var(--field);border-radius:999px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--blue);border-radius:999px;transition:width .4s ease}
.job.done .bar i{background:var(--green)}
.meta{display:flex;justify-content:space-between;gap:12px;margin-top:9px;font-size:11px;color:var(--tx2)}
.meta .st-done{color:var(--green)} .meta .st-err{color:var(--red)}
.meta a{color:var(--blue);text-decoration:none;cursor:pointer}
.meta a:hover{text-decoration:underline}
.err{color:var(--red);font-size:11px;margin-top:8px;line-height:1.55;word-break:break-all}
.empty{padding:20px 12px;text-align:center;color:var(--tx3);font-size:12px}
.foot{margin:18px auto 0;padding:12px 16px;max-width:680px;text-align:center;font-size:10.5px;color:var(--tx3);line-height:2;background:rgba(255,255,255,.34);border:1px solid var(--line);border-radius:14px;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
.badge{display:inline-block;padding:0 7px;border:1px solid var(--line);border-radius:999px;margin:0 2px;background:rgba(255,255,255,.3)}
.badge.on{color:var(--green);border-color:rgba(22,140,75,.22)}
.badge.off{color:var(--tx3)}
.foot a{color:var(--tx2);text-decoration:none}.foot a:hover{text-decoration:underline}
.status{margin-top:3px}.status summary{cursor:pointer;color:var(--tx2);list-style:none}.status summary::-webkit-details-marker{display:none}.status summary::before{content:'＋';margin-right:4px}.status[open] summary::before{content:'－'}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#050507;--surface:rgba(28,28,30,.72);--surface-solid:#1c1c1e;--field:#242426;--line:rgba(255,255,255,.09);--line-strong:rgba(255,255,255,.17);--tx:#f5f5f7;--tx2:#a1a1a6;--tx3:#6e6e73;--blue:#0a84ff;--blue-hover:#2490ff;--red:#ff453a;--green:#30d158;--shadow:0 28px 80px rgba(0,0,0,.42)}body{background:radial-gradient(circle at 50% -18%,rgba(10,132,255,.18),transparent 40%),var(--bg)}.platforms span,.badge,.foot{background:rgba(28,28,30,.42)}}
@media(max-width:620px){body{padding:38px 14px 28px}.hero{margin-bottom:25px}.appicon{width:44px;height:44px;border-radius:13px;margin-bottom:15px}h1{font-size:29px}.card{padding:17px;border-radius:19px}.row{flex-direction:column}.row .primary{width:100%}.dirrow{align-items:flex-end}.actions{flex-shrink:0}.dirrow button{padding:9px 11px}.foot{font-size:10px}}
</style></head><body><div class="wrap">
<header class="hero">
  <div class="appicon" aria-hidden="true">↓</div>
  <h1>小伊工具箱 · 视频下载器</h1>
  <p class="sub">macOS 预览版 · 等你一起实测</p>
  <div class="sub">把不好用的地方改一改，再分享给你。</div>
  <div class="platforms"><span>抖音</span><span>小红书</span><span>B 站</span><span>YouTube</span><span>更多网站与视频直链</span></div>
</header>
<main class="card">
  <label class="label" for="url">把视频链接贴在这里</label>
  <div class="row">
    <input id="url" type="text" placeholder="粘贴抖音、小红书、B站、YouTube 等视频链接" autocomplete="off" autofocus>
    <button id="go" class="primary">开始下载</button>
  </div>
  <div class="formerr" id="formErr"></div>
  <p style="color:var(--tx3);font-size:11px;line-height:1.6;margin-top:12px">文件只保存在你的电脑里，不会上传到我的服务器。不同网站能下载的内容和清晰度可能不同。</p>
  <div class="dirrow">
    <div class="location"><span class="eyebrow">文件保存到</span><span class="path" id="dir">…</span></div>
    <div class="actions"><button id="pick">更改</button><button id="openDir">打开文件夹</button></div>
  </div>
</main>
<div class="jobs-head"><span>下载记录</span><button id="clearHistory" type="button">清空记录（不会删视频）</button></div>
<div id="jobs"></div>
<div class="foot" id="foot"></div>
<script nonce="${PAGE_NONCE}">
const $=s=>document.querySelector(s);
const API_TOKEN=${JSON.stringify(API_TOKEN)};
async function api(p,body){const r=await fetch(p,body?{method:'POST',headers:{'Content-Type':'application/json','X-Video-Downloader-Token':API_TOKEN},body:JSON.stringify(body)}:undefined);const data=await r.json();if(!r.ok)throw new Error(data.err||('HTTP '+r.status));return data;}
async function refreshConf(){const c=await api('/api/config');$('#dir').textContent=c.dir;
  $('#foot').innerHTML='小伊做的小工具 · <a href="https://github.com/Lyee0011/leetools">开源于 GitHub</a><br>本地运行，文件不上传；请只下载你有权保存的内容。<details class="status"><summary>查看运行状态</summary>引擎 yt-dlp <span class="badge '+(c.ytdlp?'on">✓':'off">缺失')+'</span> 高清合并 <span class="badge '+(c.ffmpeg?'on">✓':'off">无ffmpeg')+'</span> YouTube 运行时 <span class="badge '+(c.jsRuntime?'on">✓':'off">缺失')+'</span> 代理 <span class="badge '+(c.proxy?'on">已连 '+esc(c.proxyPort||''):'off">未开')+'</span><br>抖音使用隔离游客通道；此 Mac 预览版仅处理公开内容，不读取浏览器登录状态。</details>';}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function render(list){$('#clearHistory').disabled=!list.some(j=>j.status!=='running');$('#jobs').innerHTML=list.length?list.map(j=>{
  const running=(j.phase?esc(j.phase)+' · ':'')+j.pct.toFixed(1)+'% '+(j.speed?'· '+esc(j.speed):'')+' '+(j.eta&&j.eta!=='Unknown'?'ETA '+esc(j.eta):'');
  const st=j.status==='done'?'<span class="st-done">下载好了'+(j.note?' · '+esc(j.note):'')+'</span>':j.status==='error'?'<span class="st-err">下载失败</span>':running;
  return '<div class="job '+esc(j.status)+'"><div class="name">'+esc(j.name)+'</div><div class="bar"><i style="width:'+j.pct+'%"></i></div><div class="meta"><span>'+st+'</span>'+(j.status==='done'?'<a href="#" data-reveal-job="'+esc(j.id)+'">打开文件所在位置</a>':j.status==='error'?'<a href="#" data-retry-job="'+esc(j.id)+'">再试一次</a>':'')+'</div>'+(j.err?'<div class="err">'+esc(j.err)+'</div>':'')+'</div>';
}).join(''):'<div class="empty">还没有下载记录，贴一个链接试试。</div>';$('#jobs').querySelectorAll('[data-reveal-job]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();api('/api/reveal',{id:a.dataset.revealJob});}));
$('#jobs').querySelectorAll('[data-retry-job]').forEach(a=>a.addEventListener('click',async e=>{e.preventDefault();if(a.dataset.busy)return;a.dataset.busy='1';a.textContent='正在重试…';try{await api('/api/retry',{id:a.dataset.retryJob});tick();}catch(error){const field=$('#formErr');field.textContent=error.message;field.classList.add('show');a.textContent='重试';delete a.dataset.busy;}}));}
$('#clearHistory').onclick=async()=>{const btn=$('#clearHistory');if(btn.disabled)return;btn.disabled=true;btn.textContent='正在清空…';try{await api('/api/clear-history',{});await tick();}catch(error){const field=$('#formErr');field.textContent=error.message||'清空记录失败';field.classList.add('show');}finally{btn.textContent='清空记录（不会删视频）';}};
async function tick(){const l=await api('/api/jobs');render(l);if(l.some(j=>j.status==='running'))setTimeout(tick,800);else setTimeout(tick,3000);}
$('#go').onclick=async()=>{const input=$('#url'),btn=$('#go'),err=$('#formErr'),u=input.value.trim();if(!u)return;err.classList.remove('show');err.textContent='';btn.disabled=true;btn.textContent='正在添加…';try{await api('/api/download',{url:u});input.value='';tick();}catch(e){err.textContent=e.message||'下载任务创建失败';err.classList.add('show');}finally{btn.disabled=false;btn.textContent='开始下载';}};
$('#url').addEventListener('keydown',e=>{if(e.key==='Enter')$('#go').click();});
$('#pick').onclick=async()=>{const r=await api('/api/pick-dir',{});if(r.dir)$('#dir').textContent=r.dir;};
$('#openDir').onclick=()=>api('/api/reveal',{dir:1});
refreshConf();tick();
</script></div></body></html>`;

// ── HTTP 服务 ──
let PROXY_ON = !!ACTIVE_PROXY;
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};
const PAGE_CSP = `default-src 'none'; base-uri 'none'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; script-src 'nonce-${PAGE_NONCE}'; style-src 'unsafe-inline'`;

function isAllowedHost(value) {
  if (typeof value !== 'string' || !/^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/i.test(value)) return false;
  try {
    const hostname = new URL(`http://${value}`).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function isAllowedOrigin(value) {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' && parsed.origin === value && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

function tokenMatches(value) {
  const received = Buffer.from(String(value || ''), 'utf8');
  const expected = Buffer.from(API_TOKEN, 'utf8');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function publicJob(job) {
  const { id, name, pct, speed, eta, status, err, merging, phase, attempt, note, t } = job;
  return { id, name, pct, speed, eta, status, err, merging, phase, attempt, note, t };
}

function responseHeaders(contentType, extra = {}) {
  return { ...SECURITY_HEADERS, 'Content-Type': contentType, ...extra };
}

function json(res, obj, code = 200) {
  if (res.destroyed || res.writableEnded || res.headersSent) return;
  res.writeHead(code, responseHeaders('application/json; charset=utf-8'));
  res.end(JSON.stringify(obj));
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function body(req) {
  return new Promise((resolve, reject) => {
    const declared = req.headers['content-length'];
    if (declared !== undefined) {
      const length = Number(declared);
      if (!Number.isSafeInteger(length) || length < 0) {
        req.resume();
        return reject(httpError(400, '无效的 Content-Length'));
      }
      if (length > MAX_JSON_BODY) {
        req.resume();
        return reject(httpError(413, '请求内容过大'));
      }
    }
    let data = '';
    const decoder = new StringDecoder('utf8');
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_JSON_BODY) return fail(httpError(413, '请求内容过大'));
      data += decoder.write(chunk);
    });
    req.on('aborted', () => fail(httpError(408, '请求已中断')));
    req.on('error', () => fail(httpError(400, '请求读取失败')));
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const value = JSON.parse(data + decoder.end() || '{}');
        if (!value || typeof value !== 'object' || Array.isArray(value)) return reject(httpError(400, '请求内容必须是 JSON 对象'));
        resolve(value);
      }
      catch { reject(httpError(400, 'JSON 格式无效')); }
    });
  });
}

let shuttingDown = false;
function canShutdown(entries) { return ![...entries].some(job => job.status === 'running'); }

const server = http.createServer(async (req, res) => {
  try {
  if (!isAllowedHost(req.headers.host)) return json(res, { err: 'forbidden host' }, 403);
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    res.writeHead(200, responseHeaders('text/html; charset=utf-8', { 'Content-Security-Policy': PAGE_CSP }));
    return res.end(PAGE);
  }
  if (req.url.startsWith('/favicon')) { res.writeHead(204, SECURITY_HEADERS); return res.end(); }
  if (req.method === 'GET' && req.url === '/api/config') return json(res, {
    app: APP_ID,
    build: BUILD_ID,
    instance: INSTANCE_ID,
    pid: process.pid,
    platform: process.platform,
    arch: process.arch,
    preview: true,
    dir: conf.dir,
    ytdlp: !!YTDLP_CMD,
    ffmpeg: !!FFMPEG,
    jsRuntime: !!JS_NODE,
    proxy: PROXY_ON,
    proxyPort: ACTIVE_PROXY ? (ACTIVE_PROXY.match(/:(\d+)\/?$/) || [])[1] || '' : '',
    xiaohongshu: true,
    yangshipin: true,
  });
  if (req.method === 'GET' && req.url === '/api/jobs') return json(res, [...jobs.values()].sort((a, b) => b.t - a.t).slice(0, 30).map(publicJob));
  if (req.method !== 'POST') return json(res, { err: 'bad' }, 404);
  if (!isAllowedOrigin(req.headers.origin)
      || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')
      || !tokenMatches(req.headers['x-video-downloader-token'])) {
    req.resume();
    return json(res, { err: 'forbidden request' }, 403);
  }
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
    req.resume();
    return json(res, { err: 'Content-Type 必须是 application/json' }, 415);
  }
  let b;
  try { b = await body(req); }
  catch (error) { return json(res, { err: error.message || '请求无效' }, error.statusCode || 400); }
  if (shuttingDown) return json(res, { err: '服务正在停止' }, 503);
  if (req.url === '/api/shutdown') {
    if (b.instance !== INSTANCE_ID || b.build !== BUILD_ID) return json(res, { err: '安装实例或版本不匹配' }, 409);
    if (!canShutdown(jobs.values())) return json(res, { err: '仍有下载进行中，请等任务结束后再停止' }, 409);
    shuttingDown = true;
    res.once('finish', () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    });
    return json(res, { ok: true });
  }
  if (req.url === '/api/retry') {
    const previous = typeof b.id === 'string' ? jobs.get(b.id) : null;
    if (!previous || previous.status !== 'error') return json(res, { err: '没有找到可重试的失败任务' }, 400);
    for (const j of jobs.values()) if (j.url === previous.url && j.status === 'running') return json(res, { id: j.id, note: '已在下载中' });
    return json(res, { id: newJob(previous.url, previous.dir).id });
  }
  if (req.url === '/api/clear-history') {
    let cleared = 0;
    for (const [id, job] of jobs) {
      if (job.status !== 'running') {
        jobs.delete(id);
        cleared++;
      }
    }
    return json(res, { ok: true, cleared });
  }
  if (req.url === '/api/download') {
    if (typeof b.url !== 'string' || b.url.length > 16384) return json(res, { err: '请提供有效长度的视频链接文本' }, 400);
    let url = extractUrl(b.url);
    if (!url) return json(res, { err: '没有识别到 http/https 视频链接' }, 400);
    try { const u = new URL(url); if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error(); }
    catch { return json(res, { err: '视频链接格式无效或包含账号密码' }, 400); }
    if (yangshipin.isYangshipinUrl(url)) {
      try { url = yangshipin.normalizeUrl(url).href; }
      catch (error) { return json(res, { err: error.message }, 400); }
      if (!FFMPEG) return json(res, { err: '缺少音视频校验组件，请重新启动工具准备运行环境' }, 400);
    } else if (!YTDLP_CMD) return json(res, { err: '未找到可用的 yt-dlp 引擎' }, 400);
    if (!FFMPEG) return json(res, { err: '缺少通过校验的 FFmpeg，请重新运行安装入口' }, 503);
    if (isXiaohongshuUrl(url)) {
      try { url = await resolveXiaohongshuUrl(url); } catch {}
    }
    for (const j of jobs.values()) if (j.url === url && j.status === 'running') return json(res, { id: j.id, note: '已在下载中' });  // 去重:同链接正在下就不重复起
    return json(res, { id: newJob(url, conf.dir).id });
  }
  if (req.url === '/api/pick-dir') {
    const dir = await macOS.chooseFolder();
    if (dir) {
      if (shuttingDown) return json(res, { err: '服务正在停止' }, 503);
      try { const updated = { ...conf, dir }; saveConf(updated); conf = updated; }
      catch { return json(res, { err: '无法保存目录设置，请确认程序目录可写' }, 500); }
    }
    return json(res, { dir });
  }
  if (req.url === '/api/reveal') {
    let target;
    let showDir = false;
    if (b.dir) {
      target = conf.dir;
      showDir = true;
    } else {
      const job = jobs.get(String(b.id || ''));
      if (!job || job.status !== 'done') return json(res, { err: '没有找到已完成的下载任务' }, 404);
      target = job.file || job.dir;
    }
    if (!target) return json(res, { err: '没有可打开的路径' }, 404);
    if (!fs.existsSync(target)) { target = conf.dir; showDir = true; }
    if (!fs.existsSync(target) && showDir) fs.mkdirSync(target, { recursive: true });
    await macOS.reveal(target, showDir);
    return json(res, { ok: 1 });
  }
  json(res, { err: 'bad' }, 404);
  } catch (error) { json(res, { err: error.statusCode ? error.message : '操作失败，请检查保存目录或重新启动工具' }, error.statusCode || 500); }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;

// 端口 3210 起顺延；重复启动复用相同版本，源码更新后避开尚未退出的旧实例。
function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  macOS.openBrowser(url).catch(error => console.error(error.message));
}

function probeExisting(port, cb) {
  let settled = false;
  const finish = (value) => { if (!settled) { settled = true; cb(value); } };
  const req = http.get({ host: '127.0.0.1', port, path: '/api/config', timeout: 1000 }, (res) => {
    let data = '';
    res.on('data', (d) => (data += d));
    res.on('end', () => {
      try {
        const existing = JSON.parse(data);
        finish(existing.app === APP_ID && existing.build === BUILD_ID && existing.instance === INSTANCE_ID);
      } catch { finish(false); }
    });
  });
  req.on('timeout', () => { req.destroy(); finish(false); });
  req.on('error', () => finish(false));
}

function listen(port, tries) {
  server.once('error', (e) => {
    server.removeListener('listening', onListening);
    if (!['EADDRINUSE', 'EACCES'].includes(e.code)) { console.error('启动失败:', e.message); process.exit(1); }
    probeExisting(port, (sameApp) => {
      if (sameApp) {
        const url = `http://localhost:${port}`;
        console.log(`视频下载器已在运行 → ${url}`);
        openBrowser(url);
        process.exit(0);
      }
      if (tries > 0) listen(port + 1, tries - 1);
      else { console.error('启动失败:没有可用端口'); process.exit(1); }
    });
  });
  function onListening() {
    const url = `http://localhost:${port}`;
    detectProxy((proxyUrl) => {
      ACTIVE_PROXY = proxyUrl;
      PROXY_ON = !!proxyUrl;
      if (proxyUrl) {
        process.env.HTTPS_PROXY = proxyUrl;
        process.env.HTTP_PROXY = proxyUrl;
      }
      console.log(`\n  🎬 视频下载器 → ${url}`);
      console.log(`  引擎: ${YTDLP_CMD ? 'macOS 独立版' : '❌ 无'}  ffmpeg: ${FFMPEG ? '✓' : '无'}  Node: ${JS_NODE ? '✓' : '无'}  代理: ${ACTIVE_PROXY || '未开(YouTube不可用)'}\n`);
      openBrowser(url);
    });
  }
  server.listen(port, '127.0.0.1', onListening);
}
if (require.main === module) {
  const configuredPort = Number(process.env.PORT);
  const hasConfiguredPort = Number.isInteger(configuredPort) && configuredPort >= 1024 && configuredPort <= 65535;
  listen(hasConfiguredPort ? configuredPort : 3210, hasConfiguredPort ? 0 : 9);
}

module.exports = {
  inspectMedia, isXiaohongshuUrl, resolveXiaohongshuUrl,
  extractDouyinVideoId, getDouyinVideoInfo, isDouyinMediaUrl, newJob, isAllowedHost, isAllowedOrigin,
  publicJob, MAX_JSON_BODY, BUILD_ID, INSTANCE_ID, finishVideoJob, canShutdown,
};
