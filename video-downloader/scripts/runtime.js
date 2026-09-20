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

module.exports = { verifiedRuntime };
