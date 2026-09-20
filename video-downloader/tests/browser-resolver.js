'use strict';

const assert = require('assert');
const { publicAddress, publicUrl, mediaKind, eligible, chooseCandidate } = require('../scripts/browser-resolver');

for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1']) {
  assert.strictEqual(publicAddress(address), false, address);
}
for (const address of ['8.8.8.8', '1.1.1.1', '192.0.78.24', '203.0.112.1', '2606:4700:4700::1111']) assert.strictEqual(publicAddress(address), true);
for (const url of ['file:///C:/test.mp4', 'http://localhost/a', 'http://127.1/a', 'http://2130706433/a', 'http://[::1]/a', 'https://router.local/a', 'https://user:pass@example.com/a', 'https://example.com:8080/a', 'http://[']) {
  assert.strictEqual(publicUrl(url), false, url);
}
assert.strictEqual(publicUrl('https://video.example.com/watch?id=12'), true);
assert.strictEqual(mediaKind('https://example.com/asset?id=12', 'video/mp4'), 'file');
assert.strictEqual(mediaKind('https://example.com/asset?id=12', 'application/vnd.apple.mpegurl'), 'hls');
assert.strictEqual(mediaKind('https://example.com/manifest.mpd?token=example'), 'dash');
assert.strictEqual(mediaKind('https://example.com/segment.ts'), '');
assert.strictEqual(mediaKind('https://example.com/segment.m4s', 'video/mp4'), '');
assert.strictEqual(mediaKind('https://example.com/bbb_30fps_12000k_0.m4v', 'video/mp4'), '');
assert.strictEqual(mediaKind('blob:https://example.com/a'), '');
assert.strictEqual(mediaKind('http://['), '');
assert.strictEqual(eligible('https://example.com/watch', 'ERROR: Unsupported URL'), true);
assert.strictEqual(eligible('https://example.com/watch', 'ERROR: HTTP Error 403'), true);
for (const message of ['DRM protected content', 'Sign in required', 'CAPTCHA', 'private video', 'HTTP Error 429', 'HTTP Error 404']) {
  assert.strictEqual(eligible('https://example.com/watch', message), false, message);
}
for (const url of ['https://youtu.be/abc', 'https://www.bilibili.com/video/abc', 'https://www.douyin.com/video/abc', 'https://xhslink.com/a/abc', 'https://w.yangshipin.cn/video?cid=abc', 'https://example.com/video.mp4', 'http://127.0.0.1/watch']) {
  assert.strictEqual(eligible(url, 'Unsupported URL'), false, url);
}
const master = { url: 'https://example.com/master.m3u8', kind: 'hls', master: true };
const video = { url: 'https://example.com/video.m3u8', kind: 'hls' };
const audio = { url: 'https://example.com/audio.m3u8', kind: 'hls' };
master.children = [video.url, audio.url];
const map = (...values) => new Map(values.map(v => [v.url, v]));
assert.strictEqual(chooseCandidate(map(master, video, audio), { hasVideo: true, src: 'blob:example' }), master);
assert.strictEqual(chooseCandidate(map(video, audio), { hasVideo: true, src: 'blob:example' }), null);
assert.strictEqual(chooseCandidate(map(master), { hasVideo: false }), null);
assert.strictEqual(chooseCandidate(map(master, { url: 'https://ads.example/video.mp4', kind: 'file' }), { hasVideo: true }), null);
assert.strictEqual(chooseCandidate(map(master), { hasVideo: true, videoCount: 2, src: master.url }), null);
assert.strictEqual(chooseCandidate(map({ ...master, checked: false }), { hasVideo: true, src: master.url }), null);
assert.strictEqual(chooseCandidate(map(video, audio), { hasVideo: true, src: video.url }), video);
assert.strictEqual(chooseCandidate(map({ ...master, protected: true }), { hasVideo: true }), null);
assert.throws(() => chooseCandidate(map(master), { protected: true }), /受保护/);
console.log('Browser discovery policy and media selection tests passed.');
