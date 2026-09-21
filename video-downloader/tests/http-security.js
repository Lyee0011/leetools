'use strict';

const assert = require('assert');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function request(port, { method = 'GET', host = `localhost:${port}`, path: requestPath = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method, path: requestPath,
      headers: { Host: host, Connection: 'close', ...headers },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.once('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

async function waitForPage(port) {
  let lastError;
  for (let i = 0; i < 40; i++) {
    try {
      const response = await request(port);
      if (response.status === 200) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error('Local service did not start');
}

(async () => {
  const port = await reservePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, NO_OPEN: '1', PORT: String(port), HTTP_PROXY: '', HTTPS_PROXY: '' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childOutput = '';
  child.stdout.on('data', (chunk) => { childOutput += chunk; });
  child.stderr.on('data', (chunk) => { childOutput += chunk; });

  try {
    const page = await waitForPage(port);
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.strictEqual(page.headers['cache-control'], 'no-store');
    assert.strictEqual(page.body.includes('<a onclick='), false);
    const token = page.body.match(/const API_TOKEN="([A-Za-z0-9_-]+)";/)?.[1];
    assert.ok(token, 'Page-bound API token was not found');

    const hostileHost = await request(port, { host: 'attacker.example', path: '/api/config' });
    assert.strictEqual(hostileHost.status, 403);
    for (const host of ['attacker@localhost:3210', 'localhost/attacker', 'localhost:99999']) {
      assert.strictEqual((await request(port, { host, path: '/api/config' })).status, 403);
    }

    const simpleCrossSite = await request(port, {
      method: 'POST', path: '/api/download',
      headers: { Origin: 'https://attacker.example', 'Content-Type': 'text/plain' },
      body: JSON.stringify({ url: 'http://[' }),
    });
    assert.strictEqual(simpleCrossSite.status, 403);

    const crossSiteWithToken = await request(port, {
      method: 'POST', path: '/api/download',
      headers: {
        Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'application/json', 'X-Video-Downloader-Token': token,
      },
      body: '{}',
    });
    assert.strictEqual(crossSiteWithToken.status, 403);

    const wrongType = await request(port, {
      method: 'POST', path: '/api/download',
      headers: { 'Content-Type': 'text/plain', 'X-Video-Downloader-Token': token },
      body: '{}',
    });
    assert.strictEqual(wrongType.status, 415);

    const malformed = await request(port, {
      method: 'POST', path: '/api/download',
      headers: { 'Content-Type': 'application/json', 'X-Video-Downloader-Token': token },
      body: '{',
    });
    assert.strictEqual(malformed.status, 400);
    for (const invalid of ['null', '[]', 'true', '1', '"text"', '{"url":{}}', '{"url":["https://example.com"]}']) {
      const result = await request(port, { method: 'POST', path: '/api/download',
        headers: { 'Content-Type': 'application/json', 'X-Video-Downloader-Token': token }, body: invalid });
      assert.strictEqual(result.status, 400, invalid);
      assert.strictEqual((await request(port, { path: '/api/config' })).status, 200, 'Service must survive malformed input');
    }
    assert.strictEqual((await request(port, { method: 'POST', path: '/api/retry',
      headers: { 'Content-Type': 'application/json', 'X-Video-Downloader-Token': token }, body: 'null' })).status, 400);
    assert.strictEqual((await request(port, { method: 'POST', path: '/api/config', body: '{}' })).status, 403);

    const oversized = await request(port, {
      method: 'POST', path: '/api/download',
      headers: { 'Content-Type': 'application/json', 'X-Video-Downloader-Token': token },
      body: Buffer.alloc(64 * 1024 + 1, 0x20),
    });
    assert.strictEqual(oversized.status, 413);

    const legitimate = await request(port, {
      method: 'POST', path: '/api/download',
      headers: { 'Content-Type': 'application/json', 'X-Video-Downloader-Token': token },
      body: '{}',
    });
    assert.strictEqual(legitimate.status, 400);

    const retryWithoutToken = await request(port, {
      method: 'POST', path: '/api/retry', headers: { 'Content-Type': 'application/json' }, body: '{"id":"forged"}',
    });
    assert.strictEqual(retryWithoutToken.status, 403);
    const retryForgedId = await request(port, {
      method: 'POST', path: '/api/retry',
      headers: { 'Content-Type': 'application/json', 'X-Video-Downloader-Token': token },
      body: '{"id":"forged","url":"https://example.com/ignored"}',
    });
    assert.strictEqual(retryForgedId.status, 400);

    const clearWithoutToken = await request(port, {
      method: 'POST', path: '/api/clear-history', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.strictEqual(clearWithoutToken.status, 403);
    const clearHistory = await request(port, {
      method: 'POST', path: '/api/clear-history',
      headers: { 'Content-Type': 'application/json', 'X-Video-Downloader-Token': token }, body: '{}',
    });
    assert.strictEqual(clearHistory.status, 200);
    assert.strictEqual(JSON.parse(clearHistory.body).cleared, 0);

    const invalidYangshipin = await request(port, {
      method: 'POST', path: '/api/download',
      headers: { 'Content-Type': 'application/json', 'X-Video-Downloader-Token': token },
      body: '{"url":"https://w.yangshipin.cn/video?vid=../../invalid&type=0"}',
    });
    assert.strictEqual(invalidYangshipin.status, 400);

    console.log('HTTP security tests passed.');
  } finally {
    if (!child.killed) child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
