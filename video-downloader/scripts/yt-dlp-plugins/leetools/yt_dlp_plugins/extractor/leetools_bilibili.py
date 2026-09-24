"""Expose Bilibili's DASH backup URLs to yt-dlp's format checks.

No extra API calls, account access, URL rewriting or other extractor changes.
"""

from urllib.parse import urlsplit
from yt_dlp.extractor.bilibili import BiliBiliIE

__all__ = []  # Replace the built-in extractor, not a second URL handler.


def _backup_urls(play_info):
    dash = play_info.get('dash') or {}
    tracks = list(dash.get('video') or []) + list(dash.get('audio') or [])
    tracks += (dash.get('dolby') or {}).get('audio') or []
    flac = (dash.get('flac') or {}).get('audio')
    if isinstance(flac, dict):
        tracks.append(flac)
    result = {}
    for track in tracks:
        primary = track.get('baseUrl') or track.get('base_url') or track.get('url')
        backups = track.get('backupUrl') or track.get('backup_url') or []
        if isinstance(backups, str):
            backups = [backups]
        result[primary] = backups[:4]
    return result


def _safe_backup(value):
    if not isinstance(value, str):
        return False
    try:
        u = urlsplit(value)
        host = (u.hostname or '').lower()
        return (u.scheme in ('http', 'https') and not u.username and not u.password
                and u.port in (None, 80, 443)
                and any(host == domain or host.endswith('.' + domain)
                        for domain in ('bilivideo.com', 'bilivideo.cn', 'bilivideo.net', 'akamaized.net')))
    except ValueError:
        return False


def expand_backups(formats, play_info):
    backups = _backup_urls(play_info)
    expanded = []
    for fmt in formats:
        primary = fmt.get('url')
        urls = [primary]
        for candidate in backups.get(primary, []):
            if _safe_backup(candidate) and candidate not in urls:
                urls.append(candidate)
        for index, url in enumerate(urls):
            item = dict(fmt, url=url)
            # Same quality/codec first; then prefer standard CDN ports to MCDN.
            item['source_preference'] = 10 if _safe_backup(url) else 0
            if index:
                item['format_id'] = '{}-cdn{}'.format(fmt.get('format_id', 'dash'), index)
            expanded.append(item)
    return expanded


class _LeeToolsBiliBiliIE(BiliBiliIE, plugin_name='leetools_backups'):
    def extract_formats(self, play_info):
        return expand_backups(super().extract_formats(play_info), play_info)
