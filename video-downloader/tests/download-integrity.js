'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawnSync } = require('child_process');
const app = require('../server');
const root = path.resolve(__dirname, '..');
const ffmpeg = path.join(root, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'downloader-integrity-test-'));
const out = path.join(temp, 'downloads');
fs.mkdirSync(out);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function done(job) {
  for (let i = 0; i < 900 && job.status === 'running'; i++) await delay(100);
  assert.notStrictEqual(job.status, 'running', 'Download test timed out');
  return job;
}
function generate(args) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.strictEqual(result.status, 0, result.stderr);
}

(async () => {
  const sample = path.join(temp, 'sample.mp4');
  const segment = path.join(temp, 'sample.ts');
  generate(['-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', sample]);
  generate(['-i', sample, '-c', 'copy', '-f', 'mpegts', segment]);
  let released = false, snoopRequests = 0;
  const held = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/snoop') { snoopRequests++; res.writeHead(404); return res.end(); }
    if (req.url.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.end('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:3\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:3,\n/segment.ts\n'
        + (req.url === '/broken.m3u8' ? '#EXTINF:3,\n/missing.ts\n' : '') + '#EXT-X-ENDLIST\n');
    }
    const file = req.url === '/segment.ts' ? segment : /\.mp4$/.test(req.url) ? sample : null;
    if (!file) { res.writeHead(404); return res.end(); }
    const bytes = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': file === segment ? 'video/mp2t' : 'video/mp4', 'Content-Length': bytes.length });
    if (req.method === 'HEAD') return res.end();
    if (req.url.startsWith('/slow') && !released) held.push(() => res.end(bytes));
    else res.end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const broken = await done(app.newJob(origin + '/broken.m3u8', out));
    assert.strictEqual(broken.status, 'error', 'A playlist with a missing segment must never be marked complete');
    const good = await done(app.newJob(origin + '/good.m3u8', out));
    assert.strictEqual(good.status, 'done', good.err);
    assert.match(app.inspectMedia(good.file).container, /mp4/);
    const existing = path.join(out, 'source [source].mp4');
    const sentinel = Buffer.from('existing user file must remain untouched');
    fs.writeFileSync(existing, sentinel);
    const duplicate = await done(app.newJob(origin + '/source.mp4', out));
    assert.strictEqual(duplicate.status, 'error');
    assert.deepStrictEqual(fs.readFileSync(existing), sentinel);
    const remotePlaylist = path.join(temp, 'disguised.mp4');
    fs.writeFileSync(remotePlaylist, '#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:3,\n' + origin + '/snoop\n#EXT-X-ENDLIST\n');
    assert.strictEqual(app.inspectMedia(remotePlaylist).video, false);
    await delay(100);
    assert.strictEqual(snoopRequests, 0, 'Local file inspection must not open network playlists');
    const active = [1, 2, 3].map(i => app.newJob(origin + '/slow' + i + '.mp4', out));
    assert.throws(() => app.newJob(origin + '/fourth.mp4', out), error => error.statusCode === 429);
    released = true; held.splice(0).forEach(send => send());
    await Promise.all(active.map(done));
    assert.ok(active.every(j => j.status === 'done'), JSON.stringify(active.map(j => j.err)));
    console.log('Download integrity passed: missing HLS segment rejected; intact HLS becomes real MP4; existing file preserved; inspection cannot fetch URLs; three-job limit enforced.');
  } finally {
    released = true; held.splice(0).forEach(send => send());
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(() => {
  if (!path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(temp).startsWith('downloader-integrity-test-')) throw new Error('Unsafe test cleanup');
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});
