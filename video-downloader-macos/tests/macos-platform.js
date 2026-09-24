'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { chooseFolder, reveal, openBrowser, nativeCommand } = require('../scripts/macos-platform');
const { runtimeFor } = require('../scripts/runtime');
const { canShutdown } = require('../server');

(async () => {
  assert.strictEqual(await chooseFolder(async () => ({ code: 0, output: '/Users/test/视频 [素材]/\n' })), '/Users/test/视频 [素材]');
  assert.strictEqual(await chooseFolder(async () => ({ code: 0, output: '/\n' })), '/');
  assert.strictEqual(await chooseFolder(async () => ({ code: 1, error: 'User canceled. (-128)' })), null);
  await assert.rejects(chooseFolder(async () => ({ code: 1, error: 'permission denied' })), /权限/);
  await assert.rejects(chooseFolder(async () => ({ code: 0, output: '../escape' })), /有效路径/);
  const file = '/Users/test/视频 $(touch bad); [a].mp4';
  let call;
  const capture = async (...args) => { call = args; return { code: 0 }; };
  await reveal(file, false, capture);
  assert.deepStrictEqual(call.slice(0, 2), ['/usr/bin/open', ['-R', file]], 'File names are single argv values, never shell code');
  await reveal('/Users/test/视频', true, capture);
  assert.deepStrictEqual(call[1], ['/Users/test/视频']);
  await openBrowser('http://127.0.0.1:3211/', capture);
  await assert.rejects(openBrowser('https://attacker.example', capture), /Invalid/);
  const spawned = new EventEmitter(); spawned.stdout = new PassThrough(); spawned.stderr = new PassThrough();
  const operation = nativeCommand('missing', [], {}, () => spawned);
  spawned.emit('error', new Error('missing osascript'));
  spawned.emit('close', -1);
  await assert.rejects(operation, /missing osascript/);
  assert.strictEqual(canShutdown([{ status: 'running' }, { status: 'done' }]), false);
  assert.strictEqual(canShutdown([{ status: 'error' }, { status: 'done' }]), true);
  assert.strictEqual(canShutdown([]), true);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-runtime-test-'));
  try {
    fs.mkdirSync(path.join(root, 'bin'));
    const bytes = Buffer.from('fixture bytes; this file must never execute');
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    const manifest = { architectures: { arm64: { node: { executableSha256: sha }, ffmpeg: { sha256: sha } }, x64: { node: { executableSha256: '0'.repeat(64) }, ffmpeg: { sha256: '0'.repeat(64) } } }, ytDlp: { sha256: sha } };
    fs.writeFileSync(path.join(root, 'dependencies.macos.json'), JSON.stringify(manifest));
    const node = path.join(root, 'bin', 'node');
    fs.writeFileSync(node, bytes, { mode: 0o755 });
    assert.strictEqual(runtimeFor(root, 'node', 'darwin', 'arm64'), node);
    assert.strictEqual(runtimeFor(root, 'node', 'darwin', 'x64'), null, 'Wrong-architecture bytes must not run');
    assert.strictEqual(runtimeFor(root, 'node', 'win32', 'x64'), null);
    assert.strictEqual(runtimeFor(root, 'node', 'darwin', 'ia32'), null);
    fs.appendFileSync(node, 'tampered');
    assert.strictEqual(runtimeFor(root, 'node', 'darwin', 'arm64'), null);
  } finally {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('mac-runtime-test-')) throw new Error('Unsafe cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('macOS adapter tests passed: folders, cancel/error, argv safety, wrong arch, tampering, shutdown preflight. Native UI still needs a Mac.');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
