"""Loaded only by tests/bilibili-download.js, inside the pinned yt-dlp runtime."""
from copy import deepcopy
from yt_dlp.extractor.common import InfoExtractor
from yt_dlp_plugins.extractor.leetools_bilibili import expand_backups, _safe_backup


class LeeToolsBilibiliFixtureIE(InfoExtractor):
    _VALID_URL = r'leetools-bilibili-test:(?P<id>\d+)'

    def _real_extract(self, url):
        primary = 'https://sample.mcdn.bilivideo.cn:8082/video.m4s?key=keep'
        backup = 'https://cdn.bilivideo.com/video.m4s?key=keep'
        audio = 'https://sample.mcdn.bilivideo.cn:8082/audio.m4s'
        audio_backup = 'https://cdn.bilivideo.com/audio.m4s'
        formats = [
            {'url': primary, 'format_id': '80', 'height': 1080, 'vcodec': 'avc1', 'acodec': 'none'},
            {'url': audio, 'format_id': '30280', 'vcodec': 'none', 'acodec': 'mp4a'},
        ]
        play_info = {'dash': {
            'video': [{'baseUrl': primary, 'backupUrl': [backup, backup, 'file:///secret']}],
            'audio': [{'base_url': audio, 'backup_url': audio_backup}],
        }}
        original = deepcopy((formats, play_info))
        expanded = expand_backups(formats, play_info)
        assert len(expanded) == 4
        assert expanded[0]['url'] == primary
        assert expanded[1]['url'] == backup  # Preserve the entire signed URL.
        assert expanded[1]['height'] == 1080
        assert expanded[1]['source_preference'] > expanded[0]['source_preference']
        assert expanded[3]['url'] == audio_backup
        assert len({f['format_id'] for f in expanded}) == 4
        assert (formats, play_info) == original
        assert len(expand_backups(formats, {})) == 2
        for bad in ('https://localhost/a', 'https://127.0.0.1/a', 'file:///a',
                    'https://bilivideo.com.evil.test/a', 'https://bilivideo.com@evil.test/a',
                    'https://user@cdn.bilivideo.com/a', 'https://cdn.bilivideo.com:8082/a',
                    'https://cdn.bilivideo.com:bad/a', None):
            assert not _safe_backup(bad), bad
        # Return two same-quality formats. The first selected URL is deliberately
        # unavailable: --check-formats must fall back instead of failing the job.
        origin = 'http://127.0.0.1:' + self._match_id(url)
        return {
            'id': 'fixture', 'title': 'bilibili-backup-test',
            'formats': [
                {'url': origin + '/good.mp4', 'format_id': 'backup', 'ext': 'mp4', 'source_preference': 0},
                {'url': origin + '/bad.mp4', 'format_id': 'primary', 'ext': 'mp4', 'source_preference': 10},
            ],
        }
