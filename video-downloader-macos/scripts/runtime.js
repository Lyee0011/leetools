'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function verifiedRuntime(root, filename, sha256) {
  const file = path.join(root, 'bin', filename);
  try {
    if (!/^[a-f0-9]{64}$/i.test(sha256) || !fs.statSync(file).isFile()) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === sha256.toLowerCase() ? file : null;
  } catch { return null; }
}

function runtimeFor(root, name, platform = process.platform, arch = process.arch) {
  if (platform !== 'darwin' || !['arm64', 'x64'].includes(arch)) return null;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dependencies.macos.json'), 'utf8'));
  const target = manifest.architectures[arch];
  const hash = name === 'node' ? target.node.executableSha256
    : name === 'ffmpeg' ? target.ffmpeg.sha256 : name === 'yt-dlp' ? manifest.ytDlp.sha256 : '';
  const file = verifiedRuntime(root, name, hash);
  if (!file || fs.lstatSync(file).isSymbolicLink()) return null;
  try { fs.accessSync(file, fs.constants.X_OK); return file; } catch { return null; }
}
module.exports = { verifiedRuntime, runtimeFor };
