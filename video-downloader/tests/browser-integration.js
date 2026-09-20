'use strict';

// Optional local integration test: installed Chrome/Edge + verified bundled FFmpeg/yt-dlp.
// Generated media and a dynamic page stay inside one temporary directory; no external video/account.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { resolvePage } = require('../scripts/browser-resolver');
const { finishVideoJob, inspectMedia } = require('../server');
const root = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'video-discovery-test-'));
const bin = name => path.join(root, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));

function run(exe, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Test command timed out')); }, 45000);
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
}

(async () => {
  const source = path.join(work, 'source.mp4');
  const generated = await run(bin('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', source]);
  assert.strictEqual(generated.code, 0, generated.output);
  let origin, mediaRequests = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/watch') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end('<title>Dynamic test 100% 视频</title><video style="width:320px;height:180px" controls></video><script src="/player.js"></script>');
    }
    if (req.url === '/player.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(`setTimeout(()=>{document.querySelector('video').src=atob('${Buffer.from('/asset?id=public-test').toString('base64')}')},300)`);
    }
    if (req.url.startsWith('/asset?')) {
      mediaRequests++;
      if (req.headers.referer !== origin + '/watch' || !/Chrome/.test(req.headers['user-agent'] || '')) { res.writeHead(403); return res.end(); }
      const size = fs.statSync(source).size;
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
      return fs.createReadStream(source, { start, end }).pipe(res);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/protected') return res.end('<video style="width:320px"></video><script>Object.defineProperty(document.querySelector("video"),"mediaKeys",{value:{}})</script>');
    return res.end('<title>No video here</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  const before = new Set(fs.readdirSync(os.tmpdir()).filter(x => x.startsWith('video-discovery-')));
  try {
    const unsupported = await run(bin('yt-dlp'), ['--no-config', '--simulate', '--proxy', '', '--retries', '0', '--', origin + '/watch']);
    assert.notStrictEqual(unsupported.code, 0);
    assert.match(unsupported.output, /Unsupported URL/);
    // Match the server's separate worker + stdout + IPC lifecycle, including normal completion.
    const resolverPath = path.join(root, 'scripts', 'browser-resolver.js');
    const normalCode = `require(${JSON.stringify(resolverPath)}).resolvePage(${JSON.stringify(origin + '/watch')}, '', {allowTestOrigin:${JSON.stringify(origin)}}).then(x=>process.stdout.write(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>{if(process.connected)process.disconnect()})`;
    const info = await new Promise((resolve, reject) => {
      const worker = spawn(process.execPath, ['-e', normalCode], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { worker.kill(); reject(new Error('Normal resolver worker timed out')); }, 30000);
      worker.stdout.setEncoding('utf8'); worker.stderr.setEncoding('utf8');
      worker.stdout.on('data', text => { stdout += text; });
      worker.stderr.on('data', text => { stderr += text; });
      worker.on('error', error => { clearTimeout(timer); reject(error); });
      worker.on('close', code => {
        clearTimeout(timer);
        try { assert.strictEqual(code, 0, stderr); resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
      });
    });
    assert.strictEqual(info.url, origin + '/asset?id=public-test');
    assert.strictEqual(info.referer, origin + '/watch');
    assert.strictEqual(info.kind, 'file');
    assert.strictEqual(info.title, 'Dynamic test 100% 视频');
    assert.ok(mediaRequests > 0);
    const destination = path.join(work, 'downloaded.%(ext)s');
    const download = await run(bin('yt-dlp'), ['--no-config', '--proxy', '', '--referer', info.referer, '--user-agent', info.userAgent,
      '--ffmpeg-location', path.join(root, 'bin'), '-o', destination, '--', info.url]);
    assert.strictEqual(download.code, 0, download.output);
    const downloaded = path.join(work, 'downloaded.mp4');
    assert.deepStrictEqual(fs.readFileSync(downloaded), fs.readFileSync(source));
    const probe = await run(bin('ffmpeg'), ['-hide_banner', '-i', downloaded]);
    assert.match(probe.output, /Stream #.*Video:/);
    assert.match(probe.output, /Stream #.*Audio:/);
    const disguised = path.join(work, 'transport-stream.mp4');
    const ts = await run(bin('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-i', source, '-c', 'copy', '-f', 'mpegts', disguised]);
    assert.strictEqual(ts.code, 0, ts.output);
    assert.strictEqual(inspectMedia(disguised).container, 'mpegts');
    const job = { file: disguised, status: 'running' };
    await finishVideoJob(job);
    assert.strictEqual(job.status, 'done');
    assert.match(inspectMedia(disguised).container, /mp4/);
    const silent = path.join(work, 'silent.mp4');
    assert.strictEqual((await run(bin('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-i', source, '-an', '-c:v', 'copy', silent])).code, 0);
    await assert.rejects(finishVideoJob({ file: silent, status: 'running' }), /缺少画面或声音/);
    await assert.rejects(resolvePage(origin + '/protected', '', { allowTestOrigin: origin }), /受保护/);
    await assert.rejects(resolvePage(origin + '/empty', '', { allowTestOrigin: origin, timeoutMs: 1800 }), /没有识别到/);
    // Losing the owning server must close the helper's private browser too.
    const workerCode = `require(${JSON.stringify(resolverPath)}).resolvePage(${JSON.stringify(origin + '/empty')}, '', {allowTestOrigin:${JSON.stringify(origin)}}).catch(()=>{}).finally(()=>{if(process.connected)process.disconnect()})`;
    const worker = spawn(process.execPath, ['-e', workerCode], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { worker.kill(); reject(new Error('Owner disconnect cleanup timed out')); }, 20000);
      worker.on('message', message => { if (message.type === 'browser-started') worker.disconnect(); });
      worker.on('error', reject);
      worker.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Owner disconnect helper failed')); });
    });
    const leftovers = fs.readdirSync(os.tmpdir()).filter(x => x.startsWith('video-discovery-') && !before.has(x));
    assert.deepStrictEqual(leftovers, [], 'Temporary browser profiles were not cleaned up');
    console.log('Browser integration passed: unsupported dynamic page → public MP4 → identical audio/video; TS remux; silent/protected/empty videos fail; profiles cleaned.');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(() => {
  if (!path.resolve(work).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(work).startsWith('video-discovery-test-')) throw new Error('Unsafe test directory');
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});
