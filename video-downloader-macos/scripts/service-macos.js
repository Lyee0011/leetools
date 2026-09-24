#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { openBrowser } = require('./macos-platform');
const root = path.resolve(__dirname, '..');
const { BUILD_ID, INSTANCE_ID } = require('../server');
const APP_ID = 'shinewood-video-downloader-macos';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function probe(port) {
  try {
    const url = `http://127.0.0.1:${port}`;
    const response = await fetch(url + '/api/config', { signal: AbortSignal.timeout(700), redirect: 'error' });
    if (!response.ok) return null;
    const c = await response.json();
    if (c.app !== APP_ID || c.instance !== INSTANCE_ID || !Number.isSafeInteger(c.pid) || c.pid <= 0) return null;
    return { ...c, url };
  } catch { return null; }
}
async function services() {
  return (await Promise.all(Array.from({ length: 10 }, (_, i) => probe(3210 + i)))).filter(Boolean);
}
function result(c) {
  return { ok: true, started: true, url: c.url + '/', pid: c.pid, build: c.build,
    instance: c.instance, root, log: path.join(root, 'bin', 'server.log'), platform: c.platform, arch: c.arch };
}
async function ready(c) {
  if (c.build !== BUILD_ID) throw new Error('此目录有旧版服务运行，请先停止旧服务，再重新启动');
  if (!c.ytdlp || !c.ffmpeg || !c.jsRuntime) throw new Error('服务的运行组件未通过校验，请停止后重新运行安装入口');
  return result(c);
}
async function start() {
  const existing = await services();
  if (existing.length) return ready(existing[0]);
  const log = fs.openSync(path.join(root, 'bin', 'server.log'), 'a', 0o600);
  let child;
  try {
    child = spawn(process.execPath, [path.join(root, 'server.js')], {
      cwd: root, detached: true, stdio: ['ignore', log, log],
      env: { ...process.env, NO_OPEN: '1', PORT: '' },
    });
  } finally { fs.closeSync(log); }
  let spawnError;
  child.once('error', error => { spawnError = error; });
  child.unref();
  for (let i = 0; i < 30; i++) {
    if (spawnError) throw spawnError;
    const found = await services();
    if (found.length) return ready(found[0]);
    await delay(250);
  }
  throw new Error('后台服务未就绪，请查看 bin/server.log；启动器不会关闭其他安装的进程');
}
async function stop() {
  const found = await services();
  if (!found.length) return { ok: true, started: false, stopped: 0, root };
  // Preflight all instances; the authenticated endpoint checks again to close races.
  for (const c of found) {
    const response = await fetch(c.url + '/api/jobs', { signal: AbortSignal.timeout(2000), redirect: 'error' });
    const jobs = await response.json();
    if (jobs.some(job => job.status === 'running')) throw new Error('仍有下载进行中，请等任务结束后再停止');
  }
  for (const c of found) {
    const page = await (await fetch(c.url + '/', { signal: AbortSignal.timeout(2000), redirect: 'error' })).text();
    const token = page.match(/const API_TOKEN="([A-Za-z0-9_-]+)";/)?.[1];
    if (!token) throw new Error('无法验证本目录服务，不会终止进程');
    const response = await fetch(c.url + '/api/shutdown', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Video-Downloader-Token': token, Origin: c.url },
      body: JSON.stringify({ instance: INSTANCE_ID, build: c.build }),
      signal: AbortSignal.timeout(3000), redirect: 'error',
    });
    if (!response.ok) throw new Error((await response.json()).err || '服务拒绝停止');
  }
  for (let i = 0; i < 30; i++) {
    if (!(await services()).length) return { ok: true, started: false, stopped: found.length, root };
    await delay(100);
  }
  throw new Error('停止请求已发送，但服务尚未退出，请检查 bin/server.log');
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('此入口仅用于 macOS');
  const options = new Set(process.argv.slice(2));
  for (const value of options) if (!['--json', '--no-open', '--stop', '--no-start'].includes(value)) throw new Error('未知选项：' + value);
  const answer = options.has('--stop') ? await stop() : options.has('--no-start')
    ? { ok: true, started: false, root, build: BUILD_ID, instance: INSTANCE_ID } : await start();
  if (answer.started && !options.has('--no-open')) {
    try { await openBrowser(answer.url); } catch (error) { answer.warning = error.message; }
  }
  if (options.has('--json')) console.log(JSON.stringify(answer));
  else {
    console.log(answer.started ? `视频下载器已就绪：${answer.url}` : options.has('--stop') ? '本目录的视频下载器已停止。' : '运行组件已准备好。');
    if (answer.warning) console.error(answer.warning);
  }
}
if (require.main === module) main().catch(error => {
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, started: false, error: error.message, root }));
  else console.error(error.message);
  process.exitCode = 1;
});
