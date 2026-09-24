'use strict';

function describeDownloadError(message) {
  if (/DRM|protected content|encrypted with/i.test(message)) return '这个视频使用了受保护的播放格式，工具无法下载。';
  if (/Unsupported URL|No suitable extractor|no video could be found|no video found/i.test(message)) {
    return '暂时无法解析这个网页。请复制具体视频的分享链接；也可以直接粘贴 MP4、M3U8 或 MPD 播放地址。';
  }
  if (/geo.?restrict|not available in your (?:country|region)|not available from your location/i.test(message)) {
    return '这个视频有地区访问限制，请确认当前网络可以在网站上播放完整视频。';
  }
  if (/login required|log in|sign in|members.only|premium|private video|authentication required/i.test(message)) {
    return '网站要求登录或相应的访问权限，请确认这是一条可公开播放的完整视频链接。';
  }
  if (/HTTP Error 403|403.*Forbidden/i.test(message)) {
    return '网站拒绝了视频请求（403）。开着代理也可能遇到地址过期或平台风控，请重新复制分享链接后重试。';
  }
  if (/HTTP Error 404|video unavailable|has been removed|does not exist/i.test(message)) {
    return '视频不存在、已下架或链接已失效，请检查分享链接。';
  }
  if (/HTTP Error 429|too many requests/i.test(message)) return '网站暂时限制了请求频率，请稍后重试。';
  if (/timed out|timeout|handshake|TLS|SSL|ConnectionReset|10054|reset by peer|Unable to download webpage/i.test(message)) {
    return '连接网站失败，请检查网络或代理后重试。';
  }
  return message;
}

module.exports = { describeDownloadError };
