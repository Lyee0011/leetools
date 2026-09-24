'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const app = require('../server.js');
const douyinAnonymous = require('../scripts/douyin-anonymous-resolver.js');

assert.strictEqual(app.isXiaohongshuUrl('https://www.xiaohongshu.com/explore/abc123'), true);
assert.strictEqual(app.isXiaohongshuUrl('https://xhslink.com/a/example'), true);
assert.strictEqual(app.isXiaohongshuUrl('https://evilxiaohongshu.com/explore/abc123'), false);
assert.strictEqual(
  app.extractDouyinVideoId('https://www.douyin.com/jingxuan?modal_id=7640065320148929844'),
  '7640065320148929844',
);
assert.strictEqual(
  app.extractDouyinVideoId('https://www.douyin.com/video/1234567890123456789'),
  '1234567890123456789',
);
assert.strictEqual(app.isDouyinMediaUrl('https://v26-web.douyinvod.com/video/example'), true);
assert.strictEqual(app.isDouyinMediaUrl('https://attacker.example/video/example'), false);
assert.strictEqual(douyinAnonymous.chooseVideo({ video: { bit_rate: [
  { bit_rate: 900, format: 'mp4', is_h265: 1, play_addr: { url_list: ['https://v26-web.douyinvod.com/h265'] } },
  { bit_rate: 1200, format: 'mp4', is_h265: 0, play_addr: { url_list: ['https://v26-web.douyinvod.com/h264-high'] } },
  { bit_rate: 600, format: 'mp4', is_h265: 0, play_addr: { url_list: ['https://v26-web.douyinvod.com/h264-low'] } },
] } }), 'https://v26-web.douyinvod.com/h264-high');
assert.strictEqual(douyinAnonymous.isAllowedMediaUrl('https://evil.example/video'), false);

assert.strictEqual(app.isAllowedHost('localhost:3210'), true);
assert.strictEqual(app.isAllowedHost('127.0.0.1:3210'), true);
assert.strictEqual(app.isAllowedHost('attacker.example'), false);
assert.strictEqual(app.isAllowedHost('localhost.attacker.example:3210'), false);
assert.strictEqual(app.isAllowedOrigin('http://localhost:3210'), true);
assert.strictEqual(app.isAllowedOrigin('https://attacker.example'), false);

const projected = app.publicJob({
  id: 'abc', name: 'safe', pct: 0, speed: '', eta: '', status: 'running', err: '',
  merging: false, phase: 'test', attempt: 1, note: '', t: 1,
  url: 'https://secret.example/video', file: 'C:\\secret\\video.mp4', dir: 'C:\\secret',
});
assert.strictEqual(projected.id, 'abc');
assert.strictEqual(Object.hasOwn(projected, 'url'), false);
assert.strictEqual(Object.hasOwn(projected, 'file'), false);
assert.strictEqual(Object.hasOwn(projected, 'dir'), false);

const root = path.resolve(__dirname, '..');
const dependencies = JSON.parse(fs.readFileSync(path.join(root, 'dependencies.macos.json'), 'utf8'));
const dependencyText = JSON.stringify(dependencies);
for (const arch of ['arm64', 'x64']) { assert.match(dependencies.architectures[arch].node.executableSha256, /^[0-9a-f]{64}$/); assert.match(dependencies.architectures[arch].ffmpeg.sha256, /^[0-9a-f]{64}$/); }
assert.match(dependencies.ytDlp.version, /^\d{4}\.\d{2}\.\d{2}\.\d{6}$/);
assert.match(dependencies.ytDlp.sha256, /^[0-9a-f]{64}$/);
assert.strictEqual(dependencyText.includes('/releases/latest/'), false);

const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
assert.strictEqual(serverSource.includes('<a onclick='), false);
assert.strictEqual(serverSource.includes('X-Video-Downloader-Token'), true);
assert.strictEqual(serverSource.includes("frame-ancestors 'none'"), true);
assert.strictEqual(serverSource.includes("/api/clear-history"), true);
assert.match(serverSource, /job\.status !== 'running'/);
assert.strictEqual(serverSource.includes('<span>央视频</span>'), false);
assert.strictEqual(serverSource.includes('--cookies-from-browser'), false, 'Mac preview must not read personal browser login state');

if (process.platform === 'darwin') {
  const { spawnSync } = require('child_process');
  const bootstrap = fs.readFileSync(path.join(root, 'scripts/bootstrap-macos.sh'), 'utf8');
  const progressLines = bootstrap.split('\n').filter(line => line.includes("printf '%s\\n'") && /准备|运行组件已校验/.test(line));
  const progress = spawnSync('/bin/bash', ['-c', 'set -eu\nNAME=ffmpeg\nSTEP=2\nARCH=arm64\n' + progressLines.join('\n')], {
    encoding: 'utf8', env: { ...process.env, LC_ALL: 'en_US.UTF-8' },
  });
  assert.strictEqual(progress.status, 0, progress.stderr);
  assert.match(progress.stderr, /2\/3 准备 ffmpeg…/);
  assert.match(progress.stderr, /运行组件已校验（arm64）。/);
  const exitTrap = bootstrap.split('\n').find(line => /^trap .* EXIT$/.test(line));
  for (const [ending, expected] of [
    ['unset BOOTSTRAP_MISSING_TEST; printf "%s" "$BOOTSTRAP_MISSING_TEST"', 1],
    ['exit 7', 7],
    ['BOOTSTRAP_COMPLETE=1', 0],
  ]) {
    const cleanupExit = spawnSync('/bin/bash', ['-c', 'set -eu\nBOOTSTRAP_COMPLETE=0\ncleanup() { :; }\n' + exitTrap + '\n' + ending], { encoding: 'utf8' });
    assert.strictEqual(cleanupExit.status, expected, 'Bootstrap cleanup must preserve failure: ' + cleanupExit.stderr);
  }
}

console.log('Source smoke tests passed.');
