'use strict';
const path = require('path');
const { spawn } = require('child_process');

function nativeCommand(command, args, options = {}, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let output = '', error = '', settled = false;
    const stop = () => { try { child.kill(); } catch {} };
    process.once('exit', stop);
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      process.removeListener('exit', stop);
      err ? reject(err) : resolve(value);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { error += data; });
    child.once('error', err => finish(err));
    child.once('close', code => finish(null, { code, output, error }));
  });
}

async function chooseFolder(run = nativeCommand) {
  const result = await run('/usr/bin/osascript', ['-e',
    'POSIX path of (choose folder with prompt "选择视频保存位置")']);
  // User cancellation is not a failure. Other errors must not appear as success.
  if (result.code !== 0) {
    if (/\(-128\)/.test(result.error)) return null;
    throw new Error('无法打开文件夹选择器，请检查 macOS 的权限提示后重试');
  }
  const value = result.output.replace(/\r?\n$/, '');
  if (!path.posix.isAbsolute(value)) throw new Error('文件夹选择器没有返回有效路径');
  return path.posix.normalize(value).replace(/\/$/, '') || '/';
}

async function reveal(target, directory, run = nativeCommand) {
  const result = await run('/usr/bin/open', directory ? [target] : ['-R', target], { timeout: 10000 });
  if (result.code !== 0) throw new Error('无法在 Finder 中打开该位置');
}

async function openBrowser(url, run = nativeCommand) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new Error('Invalid local URL');
  const result = await run('/usr/bin/open', [url], { timeout: 10000 });
  if (result.code !== 0) throw new Error('浏览器未自动打开，请手动打开显示的本机地址');
}

module.exports = { nativeCommand, chooseFolder, reveal, openBrowser };
