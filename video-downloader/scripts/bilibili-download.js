'use strict';

const path = require('path');

function isBilibiliUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'bilibili.com' || host.endsWith('.bilibili.com') || host === 'b23.tv';
  } catch { return false; }
}

function attemptArgs(root, proxy, attempt) {
  return [
    '--add-header', 'Referer:https://www.bilibili.com/',
    '--no-plugin-dirs', '--plugin-dirs', path.join(root, 'scripts', 'yt-dlp-plugins'),
    '--check-formats', '--socket-timeout', '12', '--retries', '1', '--extractor-retries', '1',
    // An explicit empty proxy also overrides inherited HTTP(S)_PROXY on retry.
    '--proxy', attempt > 1 ? '' : proxy,
  ];
}

function isConnectionFailure(message) {
  return /timed out|timeout|handshake|TLS|SSL|EOF|ConnectionReset|10054|reset by peer|Unable to download (?:webpage|JSON|video data)|HTTP Error (?:403|412|429|5\d\d)/i.test(message);
}

function describeFailure(message) {
  if (!isConnectionFailure(message)) return '';
  if (/bilivideo\.(?:com|cn|net)|Unable to download video data/i.test(message)) {
    return 'B站视频下载节点连接失败，已尝试备用地址。请稍后重试，或检查当前网络及代理规则。';
  }
  return '连接B站接口失败，已重试连接。请确认当前网络能正常打开该视频后再试。';
}

module.exports = { isBilibiliUrl, attemptArgs, isConnectionFailure, describeFailure };
