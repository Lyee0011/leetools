'use strict';
// Development-host regression only. This does NOT validate Mac binaries or UI.
// Usage: node tests/host-download-integration.js /absolute/path/to/installed/Windows/tool
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const runtime = require('../scripts/runtime');
assert.strictEqual(process.platform, 'win32', 'This harness uses verified Windows runtimes only');
assert.ok(process.argv[2] && path.isAbsolute(process.argv[2]), 'Pass the existing Windows tool path');
const windowsRoot = path.resolve(process.argv[2]);
const manifest = JSON.parse(fs.readFileSync(path.join(windowsRoot, 'dependencies.windows.json'), 'utf8'));
const expected = { node: manifest.node.executableSha256, ffmpeg: manifest.ffmpeg.sha256, 'yt-dlp': manifest.ytDlp.sha256 };
const paths = {};
for (const [name, sha] of Object.entries(expected)) {
  paths[name] = runtime.verifiedRuntime(windowsRoot, name + '.exe', sha);
  assert.ok(paths[name], 'Windows fixture runtime must pass its own existing manifest: ' + name);
}
// An in-process test seam only; production never accepts unpinned paths/environment overrides.
runtime.runtimeFor = (_root, name) => paths[name] || null;
const cp = require('child_process');
const original = cp.spawnSync;
cp.spawnSync = (file, args, options) => file === path.join(__dirname, '..', 'bin', 'ffmpeg.exe')
  ? original(paths.ffmpeg, args, options) : original(file, args, options);
console.log('Host-only download regression against the Mac source; no files/processes in the Windows install are changed.');
require('./download-integrity');
