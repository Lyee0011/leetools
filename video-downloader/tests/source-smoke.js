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
const dependencies = JSON.parse(fs.readFileSync(path.join(root, 'dependencies.windows.json'), 'utf8'));
const dependencyText = JSON.stringify(dependencies);
assert.match(dependencies.node.executableSha256, /^[0-9a-f]{64}$/);
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

console.log('Source smoke tests passed.');
