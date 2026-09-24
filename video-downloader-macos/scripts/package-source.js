#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const repository = path.dirname(root);
function git(args) { return execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim(); }
if (git(['status', '--porcelain'])) throw new Error('Commit/review source before packaging; Git worktree must be clean');
const files = git(['ls-tree', '-r', '--name-only', 'HEAD', '--', 'video-downloader-macos']).split('\n');
if (!files.includes('video-downloader-macos/server.js') || !files.includes('video-downloader-macos/LICENSE')) throw new Error('Mac source is not committed');
for (const f of files) {
  if (/(?:^|\/)(?:bin|dist|node_modules|profiles?)(?:\/|$)|(?:^|\/)config\.json$|\.(?:exe|dll|zip|mp4|mov|sqlite|log)$|(?:^|\/)\.env(?:\.|$)/i.test(f)) throw new Error('Private/runtime asset in source tree: ' + f);
}
const output = path.join(root, 'dist', 'video-downloader-macos-preview.zip');
fs.mkdirSync(path.dirname(output), { recursive: true });
git(['archive', '--format=zip', '--prefix=video-downloader-macos/', '--output=' + output, 'HEAD:video-downloader-macos']);
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
fs.writeFileSync(output + '.sha256', sha256 + '  ' + path.basename(output) + '\n');
console.log(JSON.stringify({ file: output, sha256, bytes: fs.statSync(output).size, commit: git(['rev-parse', 'HEAD']), preview: true }));
