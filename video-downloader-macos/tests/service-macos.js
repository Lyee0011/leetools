'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { EventEmitter } = require('events');
const { createServiceManager } = require('../scripts/service-macos');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-service-test-'));
  fs.mkdirSync(path.join(root, 'bin'));
  const originalOptions = process.env.NODE_OPTIONS, originalPath = process.env.NODE_PATH;
  const good = { app: 'shinewood-video-downloader-macos', instance: 'this-install', build: 'this-build',
    platform: 'darwin', arch: 'arm64', pid: 12345, ytdlp: true, ffmpeg: true, jsRuntime: true };
  let config = { ...good }, jobs = [], jobsCode = 200, stopCode = 200, posts = 0, enabled = true, starts = 0, childKills = 0, hangProbe = false;
  const fixture = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (!enabled) { res.writeHead(404); return res.end('{}'); }
    if (req.url === '/api/config') { if (hangProbe) return; return res.end(JSON.stringify(config)); }
    if (req.url === '/api/jobs') { res.statusCode = jobsCode; return res.end(JSON.stringify(jobs)); }
    if (req.url === '/') return res.end('const API_TOKEN="test-token";');
    if (req.url === '/api/shutdown') {
      posts++;
      let data = ''; for await (const chunk of req) data += chunk;
      const body = JSON.parse(data);
      if (body.instance !== good.instance || body.build !== config.build || req.headers['x-video-downloader-token'] !== 'test-token') {
        res.statusCode = 403; return res.end('{}');
      }
      res.statusCode = stopCode;
      if (stopCode !== 200) return res.end(JSON.stringify({ err: '任务刚开始，拒绝停止' }));
      enabled = false;
      return res.end('{"ok":true}');
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  let simulatedExit = null, simulatedSpawnError = false;
  const manager = createServiceManager({ installRoot: root, build: good.build, instance: good.instance, arch: 'arm64',
    ports: [fixture.address().port], attempts: 2, probeTimeout: 100, wait: async () => {},
    spawnProcess: (exe, args, options) => {
      starts++;
      assert.strictEqual(Object.hasOwn(options.env, 'NODE_OPTIONS'), false);
      assert.strictEqual(Object.hasOwn(options.env, 'NODE_PATH'), false);
      assert.strictEqual(options.cwd, root);
      assert.deepStrictEqual(args, [path.join(root, 'server.js')]);
      const child = new EventEmitter();
      child.exitCode = simulatedExit; child.killed = false; child.unref = () => {};
      child.kill = () => { child.killed = true; childKills++; };
      if (simulatedSpawnError) queueMicrotask(() => child.emit('error', new Error('simulated spawn failure')));
      return child;
    },
  });
  try {
    const first = await manager.start(), second = await manager.start();
    assert.strictEqual(first.pid, second.pid); assert.strictEqual(starts, 0, 'Reuse must not spawn another server');
    hangProbe = true;
    await assert.rejects(manager.start(), /服务状态未确认/);
    await assert.rejects(manager.stop(), /服务状态未确认/);
    assert.strictEqual(starts, 0); assert.strictEqual(posts, 0, 'Timeout cannot mean stopped or trigger a duplicate');
    hangProbe = false;
    for (const [patch, error] of [
      [{ build: 'old-build' }, /旧版/], [{ arch: 'x64' }, /架构/], [{ platform: 'win32' }, /架构/],
      [{ ffmpeg: false }, /校验/], [{ ytdlp: 'true' }, /校验/], [{ shuttingDown: true }, /正在停止/],
    ]) {
      config = { ...good, ...patch }; await assert.rejects(manager.start(), error);
    }
    assert.strictEqual(starts, 0, 'An invalid existing service must not cause a second spawn');
    config = { ...good, instance: 'another-install' };
    assert.strictEqual((await manager.stop()).stopped, 0); assert.strictEqual(posts, 0);
    config = { ...good, app: 'shinewood-video-downloader' };
    assert.strictEqual((await manager.stop()).stopped, 0); assert.strictEqual(posts, 0, 'Windows service is never stopped');
    config = { ...good }; jobs = [{ status: 'running' }];
    await assert.rejects(manager.stop(), /下载进行中/); assert.strictEqual(posts, 0);
    jobs = {}; await assert.rejects(manager.stop(), /任务状态无效/); assert.strictEqual(posts, 0);
    jobs = []; jobsCode = 503;
    await assert.rejects(manager.stop(), /无法确认任务/); assert.strictEqual(posts, 0);
    jobsCode = 200; stopCode = 409;
    await assert.rejects(manager.stop(), /任务刚开始/); assert.strictEqual(posts, 1);
    stopCode = 200; config = { ...good, build: 'old-build' };
    assert.strictEqual((await manager.stop()).stopped, 1, 'Same-directory older build can be stopped with its own identity');
    assert.strictEqual(posts, 2);

    // Failed startup cleans only its own ChildProcess; unrelated endpoints never produce a PID kill.
    process.env.NODE_OPTIONS = '--inspect=0.0.0.0:9229'; process.env.NODE_PATH = '/test/not-used';
    await assert.rejects(manager.start(), /未就绪/);
    assert.strictEqual(childKills, 1); assert.strictEqual(starts, 1);
    simulatedExit = 23;
    await assert.rejects(manager.start(), /提前退出/);
    assert.strictEqual(childKills, 1, 'Already-exited child must not be killed by stale PID');
    simulatedExit = null; simulatedSpawnError = true;
    await assert.rejects(manager.start(), /simulated spawn failure/);
    assert.strictEqual(childKills, 2);
    console.log('Service fault tests passed: reuse, unresponsive-service refusal, stale/wrong architecture, missing component, Windows/other-install isolation, busy stop, stop race, startup failure cleanup, Node environment isolation.');
  } finally {
    if (originalOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = originalOptions;
    if (originalPath === undefined) delete process.env.NODE_PATH; else process.env.NODE_PATH = originalPath;
    fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('mac-service-test-')) throw new Error('Unsafe cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
