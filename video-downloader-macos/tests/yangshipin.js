'use strict';
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ysp = require('../scripts/yangshipin');
const { describeDownloadError } = require('../scripts/download-errors');

const pageUrl = 'https://w.yangshipin.cn/video?cid=ul76ho8iwbd9j0j&type=0';
const id = 'v0000993smh';
const bytes = Buffer.from('fixture video transfer');
const md5 = crypto.createHash('md5').update(bytes).digest('hex');
const state = { payloads: { sharevideo: { vid: id, title: '测试视频', checkup_time: '2026/04/10', ShowVideo: true,
  shareLongVideoRec: { watchingfocus: { videoList: [{ vid: 'x000089gew4', title: '分段视频' }] } } } } };
const html = '<script>window.__STATE_video__=' + JSON.stringify(state) + '</script>';
function playback() {
  return { dltype: 1, preview: 999999, fl: { fi: [{ sl: 1, lmt: 0, name: 'fhd' }] },
    vl: { vi: [{ vid: id, fn: id + '.fhd.mp4', cl: { fc: 0 }, fvkey: 'public-fixture-key', td: '1355.96',
      fs: bytes.length, fmd5: md5, vw: 1920, vh: 1080, ul: { ui: [{ url: 'https://mp4playcnc-cdn.ysp.cctv.cn/' }] } }] } };
}
const meta = ysp.parsePage(html);
const parse = data => ysp.parsePlayback('(' + JSON.stringify(data) + ')', meta, pageUrl, 'fixture-guid');

async function main() {
  assert.equal(ysp.normalizeUrl('https://m.yangshipin.cn/video?utm_source=test&type=0&cid=ul76ho8iwbd9j0j').href, pageUrl);
  assert.equal(ysp.isYangshipinUrl('https://yangshipin.cn.evil.example/video'), false);
  assert.throws(() => ysp.normalizeUrl('https://user:secret@w.yangshipin.cn/video?vid=v0000993smh'));
  assert.throws(() => ysp.normalizeUrl('https://w.yangshipin.cn:8080/video?vid=v0000993smh'));
  assert.throws(() => ysp.normalizeUrl('https://w.yangshipin.cn/video?vid=../../a'));
  assert.throws(() => ysp.normalizeUrl('https://w.yangshipin.cn/video?vid=v0000993smh&type=1'));
  assert.equal(ysp.parsePage(html, 'x000089gew4').title, '分段视频');
  assert.throws(() => ysp.parsePage(html, 'missingvideo'));
  assert.throws(() => ysp.parsePage('<script>window.__STATE_video__={};process.exit()</script>'));

  // Frozen output from the public player bundle; guards against signing-format regressions.
  assert.equal(ysp.makeCKey(id, '1788778256', 'test-guid-123456', pageUrl),
    '--01A3EC31B15789C3700142122BF5543305D9B43CF0161D2CB80F39212DEB5B7AB1DFB1F52594B5012D2CAF7036DE953AE9C8B7FB590868A8B7443BAD90584329FFFCA75531CC7B72532D63FA555DE2B5D434F82EBAF4E9FEF55930EB59ADEC8321F2B6286CDCB9D7A25D3DD6F337E8B85062214DF8145DED66C4BEDCB956BD17AB88509CA6B2AA5D058E49046EF4099E45125F6BA6FC0F5F1C0E1FA968CC7AD45C');
  const info = parse(playback());
  assert.equal(info.height, 1080);
  assert.equal(info.md5, md5);
  assert.equal(new URL(info.url).searchParams.get('vkey'), 'public-fixture-key');
  for (const invalid of ['http://mp4playcnc-cdn.ysp.cctv.cn/a', 'https://a.ysp.cctv.cn.evil.example/a', 'https://127.0.0.1/a', 'https://user:pass@a.ysp.cctv.cn/a']) {
    assert.equal(ysp.isMediaUrl(invalid), false);
  }
  let data = playback(); data.vl.vi[0].vid = 'otherVideo01'; assert.throws(() => parse(data));
  data = playback(); data.vl.vi[0].fn = '../escape.mp4'; assert.throws(() => parse(data));
  data = playback(); data.preview = 60; assert.throws(() => parse(data), /试看/);
  data = playback(); data.fl.fi[0].lmt = 1; assert.throws(() => parse(data), /受保护/);
  data = playback(); data.vl.vi[0].drm = 1; assert.throws(() => parse(data), /受保护/);
  data = playback(); data.vl.vi[0].ul.ui[0].url = 'https://evil.example/'; assert.throws(() => parse(data));
  data = playback(); data.vl.vi[0].fs = 0; assert.throws(() => parse(data));
  data = playback(); data.vl.vi[0].fmd5 = ''; assert.throws(() => parse(data));

  const requests = [];
  const resolved = await ysp.resolve(pageUrl, { fetchImpl: async (url, options) => {
    requests.push(String(url));
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Cookie, undefined);
    if (requests.length === 1) return new Response(html);
    const u = new URL(url);
    assert.equal(u.hostname, 'playvv.yangshipin.cn');
    assert.equal(u.searchParams.get('vid'), id);
    assert.equal(u.searchParams.get('charge'), '0');
    return new Response('(' + JSON.stringify(playback()) + ')');
  } });
  assert.equal(resolved.id, id);
  assert.equal(requests.length, 2);
  let redirectCalls = 0;
  await assert.rejects(ysp.resolve(pageUrl, { fetchImpl: async () => {
    redirectCalls++;
    return new Response(null, { status: 302, headers: { location: 'https://evil.example/' } });
  } }), /非官方/);
  assert.equal(redirectCalls, 1);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ysp-test-'));
  const output = path.join(temp, 'media.part');
  const response = body => new Response(body, { headers: { 'content-type': 'video/mp4' } });
  try {
    let progress = 0;
    await ysp.download(info, output, received => { progress = received; }, { fetchImpl: async () => response(bytes) });
    assert.equal(progress, bytes.length);
    assert.equal(await ysp.verifyFile(output, info), true);
    await assert.rejects(ysp.download(info, output, null, { fetchImpl: async () => response(bytes) }), /EEXIST/);
    assert.deepEqual(fs.readFileSync(output), bytes);
    await assert.rejects(ysp.download(info, path.join(temp, 'short.part'), null, { fetchImpl: async () => response(bytes.subarray(1)) }), /完整性/);
    await assert.rejects(ysp.download(info, path.join(temp, 'corrupt.part'), null, { fetchImpl: async () => response(Buffer.alloc(bytes.length)) }), /完整性/);
    await assert.rejects(ysp.download(info, path.join(temp, 'large.part'), null, { fetchImpl: async () => response(Buffer.alloc(bytes.length + 1)) }), /超过预期/);
    await assert.rejects(ysp.download(info, path.join(temp, 'html.part'), null, { fetchImpl: async () => new Response('<html>error</html>') }), /不是视频/);
    await assert.rejects(ysp.download(info, path.join(temp, 'redirect.part'), null, { fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }) }), /非官方/);
  } finally {
    if (!path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test cleanup');
    fs.rmSync(temp, { recursive: true, force: true });
  }
  assert.match(describeDownloadError('Unsupported URL: https://example.com/'), /暂时无法解析/);
  assert.match(describeDownloadError('HTTP Error 403: Forbidden'), /开着代理/);
  assert.match(describeDownloadError('This video is DRM protected'), /受保护/);
  assert.match(describeDownloadError('not available in your country'), /地区/);
  assert.match(describeDownloadError('login required'), /登录/);
  assert.equal(describeDownloadError('disk full'), 'disk full');
  console.log('Yangshipin protocol, URL boundaries, transport integrity, and error tests passed.');
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
