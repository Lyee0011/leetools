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

// Dependencies are injectable for local fault tests; the CLI always uses these defaults.
function createServiceManager({ installRoot = root, build = BUILD_ID, instance = INSTANCE_ID,
  arch = process.arch, ports = Array.from({ length: 10 }, (_, i) => 3210 + i),
  spawnProcess = spawn, wait = delay, attempts = 30, probeTimeout = 1500 } = {}) {
async function probe(port) {
  try {
    const url = `http://127.0.0.1:${port}`;
    const response = await fetch(url + '/api/config', { signal: AbortSignal.timeout(probeTimeout), redirect: 'error' });
    if (response.status >= 500) throw new Error('Local service returned a server error');
    if (!response.ok) return null;
    const c = await response.json();
    if (c.app !== APP_ID || c.instance !== instance || !Number.isSafeInteger(c.pid) || c.pid <= 0) return null;
    return { ...c, url };
  } catch (error) {
    const code = error.cause?.code || error.code;
    if (code === 'ECONNREFUSED') return null;
    // A busy server is not an absent server. Never start duplicates or claim a stop
    // succeeded merely because the original process could not answer in time.
    throw new Error(`本机端口 ${port} 的服务状态未确认，请稍后重试；不会另启后台或把它报告为已停止`, { cause: error });
  }
}
async function services() {
  return (await Promise.all(ports.map(probe))).filter(Boolean);
}
function result(c) {
  return { ok: true, started: true, url: c.url + '/', pid: c.pid, build: c.build,
    instance: c.instance, root: installRoot, log: path.join(installRoot, 'bin', 'server.log'), platform: c.platform, arch: c.arch };
}
async function ready(c) {
  if (c.build !== build) throw new Error('此目录有旧版服务运行，请先停止旧服务，再重新启动');
  if (c.platform !== 'darwin' || c.arch !== arch) throw new Error('服务的系统或芯片架构不匹配，请停止旧服务后重新启动');
  if (c.shuttingDown) throw new Error('服务正在停止，请稍后重新启动');
  if (c.ytdlp !== true || c.ffmpeg !== true || c.jsRuntime !== true) throw new Error('服务的运行组件未通过校验，请停止后重新运行安装入口');
  return result(c);
}
async function start() {
  const existing = await services();
  if (existing.length) return ready(existing[0]);
  const log = fs.openSync(path.join(installRoot, 'bin', 'server.log'), 'a', 0o600);
  let child;
  const childEnv = { ...process.env, NO_OPEN: '1', PORT: '' };
  delete childEnv.NODE_OPTIONS;
  delete childEnv.NODE_PATH;
  try {
    child = spawnProcess(process.execPath, [path.join(installRoot, 'server.js')], {
      cwd: installRoot, detached: true, stdio: ['ignore', log, log],
      env: childEnv,
    });
  } finally { fs.closeSync(log); }
  let spawnError;
  child.once('error', error => { spawnError = error; });
  child.unref();
  try {
    for (let i = 0; i < attempts; i++) {
      if (spawnError) throw spawnError;
      const found = await services();
      if (found.length) return await ready(found[0]);
      if (child.exitCode !== null && child.exitCode !== 0) throw new Error('后台服务提前退出，请查看 bin/server.log');
      await wait(250);
    }
    throw new Error('后台服务未就绪，请查看 bin/server.log');
  } catch (error) {
    // Only the exact ChildProcess created by this attempt, never a probed PID or another install.
    if (child.exitCode === null && !child.killed) { try { child.kill(); } catch {} }
    throw error;
  }
}
async function stop() {
  const found = await services();
  if (!found.length) return { ok: true, started: false, stopped: 0, root: installRoot };
  // Preflight all instances; the authenticated endpoint checks again to close races.
  for (const c of found) {
    const response = await fetch(c.url + '/api/jobs', { signal: AbortSignal.timeout(2000), redirect: 'error' });
    if (!response.ok) throw new Error('无法确认任务状态，不会停止服务');
    const jobs = await response.json();
    if (!Array.isArray(jobs)) throw new Error('任务状态无效，不会停止服务');
    if (jobs.some(job => job.status === 'running')) throw new Error('仍有下载进行中，请等任务结束后再停止');
  }
  for (const c of found) {
    const page = await (await fetch(c.url + '/', { signal: AbortSignal.timeout(2000), redirect: 'error' })).text();
    const token = page.match(/const API_TOKEN="([A-Za-z0-9_-]+)";/)?.[1];
    if (!token) throw new Error('无法验证本目录服务，不会终止进程');
    const response = await fetch(c.url + '/api/shutdown', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Video-Downloader-Token': token, Origin: c.url },
      body: JSON.stringify({ instance, build: c.build }),
      signal: AbortSignal.timeout(3000), redirect: 'error',
    });
    if (!response.ok) throw new Error((await response.json()).err || '服务拒绝停止');
  }
  for (let i = 0; i < attempts; i++) {
    if (!(await services()).length) return { ok: true, started: false, stopped: found.length, root: installRoot };
    await wait(100);
  }
  throw new Error('停止请求已发送，但服务尚未退出，请检查 bin/server.log');
}
return { probe, services, start, stop };
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('此入口仅用于 macOS');
  const options = new Set(process.argv.slice(2));
  for (const value of options) if (!['--json', '--no-open', '--stop', '--no-start'].includes(value)) throw new Error('未知选项：' + value);
  const service = createServiceManager();
  const answer = options.has('--stop') ? await service.stop() : options.has('--no-start')
    ? { ok: true, started: false, root, build: BUILD_ID, instance: INSTANCE_ID } : await service.start();
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
module.exports = { createServiceManager };
