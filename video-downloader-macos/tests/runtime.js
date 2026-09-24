'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const cp = require('child_process');
const { verifiedRuntime } = require('../scripts/runtime');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'downloader-runtime-test-'));
try {
  fs.mkdirSync(path.join(root, 'bin'));
  const file = path.join(root, 'bin', 'test.exe');
  const data = Buffer.from('owned test bytes, never executed');
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  assert.strictEqual(verifiedRuntime(root, 'test.exe', hash), null);
  fs.writeFileSync(file, data);
  assert.strictEqual(verifiedRuntime(root, 'test.exe', hash), file);
  fs.appendFileSync(file, 'modified');
  assert.strictEqual(verifiedRuntime(root, 'test.exe', hash), null);
  {
    const original = cp.spawnSync;
    let probes = 0;
    cp.spawnSync = () => { probes++; throw new Error('Import must not execute a PATH/runtime probe'); };
    try { assert.ok(require('../server').BUILD_ID); assert.strictEqual(probes, 0); } finally { cp.spawnSync = original; }
  }
  console.log('Runtime integrity tests passed: altered/missing bytes rejected; Import runs no PATH probes.');
} finally {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('downloader-runtime-test-')) throw new Error('Unsafe test cleanup');
  fs.rmSync(root, { recursive: true, force: true });
}
