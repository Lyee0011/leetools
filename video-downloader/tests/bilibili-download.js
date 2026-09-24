'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const { verifiedRuntime } = require('../scripts/runtime');
const bili = require('../scripts/bilibili-download');
const root = path.resolve(__dirname, '..');
const deps = require('../dependencies.windows.json');

assert(bili.isBilibiliUrl('https://www.bilibili.com/video/BVtest/?p=2'));
assert(bili.isBilibiliUrl('https://b23.tv/example'));
assert(!bili.isBilibiliUrl('https://evilbilibili.com/video/example'));
assert(!bili.isBilibiliUrl('https://example.com/?next=bilibili.com'));
assert(!bili.isBilibiliUrl('https://www.youtube.com/watch?v=example'));
const first = bili.attemptArgs(root, 'http://127.0.0.1:7897', 1);
const second = bili.attemptArgs(root, 'http://127.0.0.1:7897', 2);
assert.equal(first.at(-1), 'http://127.0.0.1:7897');
assert.equal(second.at(-1), '');
assert(first.includes('--check-formats'));
assert(!first.includes('--cookies-from-browser'));
assert(bili.isConnectionFailure('Unable to download JSON metadata: read timeout'));
assert(bili.describeFailure('video.cdn.bilivideo.cn Connection timed out').includes('下载节点'));
assert(bili.describeFailure('api.bilibili.com Connection timed out').includes('接口'));
assert.equal(bili.describeFailure('Video is private'), '');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leetools-bili-test-'));
const requests = [];
const server = http.createServer((req, res) => {
  requests.push(req.url);
  if (req.url === '/bad.mp4') { res.writeHead(503); res.end(); }
  else { res.writeHead(200, { 'Content-Type': 'video/mp4' }); res.end(Buffer.alloc(16384)); }
});
(async () => {
  const pluginRoot = path.join(temp, 'plugins');
  const fixtureDir = path.join(pluginRoot, 'fixture', 'yt_dlp_plugins', 'extractor');
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'bilibili-plugin-test.py'), path.join(fixtureDir, 'leetools_fixture.py'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const exe = verifiedRuntime(root, 'yt-dlp.exe', deps.ytDlp.sha256);
  assert(exe, 'Verified yt-dlp runtime is required');
  const args = ['--ignore-config', '--encoding', 'utf-8', ...second,
    '--plugin-dirs', pluginRoot, '--retries', '0', '--simulate', '--print', '%(format_id)s',
    '--', 'leetools-bilibili-test:' + server.address().port];
  const child = spawn(exe, args, { windowsHide: true, timeout: 30000 });
  let output = '', error = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { error += d; });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(error)));
  });
  assert.equal(output.trim(), 'backup');
  assert(requests.includes('/bad.mp4') && requests.includes('/good.mp4'));
  console.log('Bilibili passed: backup URLs, signed query, audio, host validation, route switch and real yt-dlp failure fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  server.closeAllConnections(); server.close();
  if (path.dirname(temp) !== path.resolve(os.tmpdir()) || !path.basename(temp).startsWith('leetools-bili-test-')) throw new Error('Unsafe cleanup');
  fs.rmSync(temp, { recursive: true, force: true });
});
