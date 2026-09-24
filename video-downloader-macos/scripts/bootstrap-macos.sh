#!/bin/bash
# macOS ships Bash 3.2. Keep this script compatible; no Homebrew or Python needed.
set -euo pipefail
umask 077
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
unset NODE_OPTIONS NODE_PATH
ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
BIN="$ROOT/bin"
MANIFEST="$ROOT/dependencies.macos.json"
die() { printf '%s\n' "$*" >&2; exit 1; }
[ "$(uname -s)" = Darwin ] || die '此安装入口仅用于 macOS；Windows 请使用原 video-downloader 目录。'
MAJOR="$(sw_vers -productVersion | cut -d. -f1)"
[ "$MAJOR" -ge 13 ] || die '此预览版要求 macOS 13 或更新版本。'
ARCH="$(uname -m)"
# Terminal may be running under Rosetta. Prefer native Apple Silicon binaries.
if [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then ARCH=arm64; fi
case "$ARCH" in arm64) ;; x86_64) ARCH=x64 ;; *) die "尚不支持此芯片：$ARCH" ;; esac
mkdir -p "$BIN"
[ ! -L "$BIN" ] || die 'bin 不能是符号链接，请使用独立的可写文件夹。'
LOCK="$BIN/.setup-lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  die '另一个安装可能正在进行。如果已中断，请先确认没有安装窗口运行，再删除 bin/.setup-lock 后重试。'
fi
STAGE=''
BOOTSTRAP_COMPLETE=0
cleanup() {
  if [ -n "$STAGE" ]; then
    case "$STAGE" in "$BIN"/.setup.*) rm -rf -- "$STAGE" ;; esac
  fi
  rmdir "$LOCK" 2>/dev/null || true
}
# Bash 3.2 can report nounset failures as zero inside EXIT; require full completion.
trap 'result=$?; cleanup; if [ "$BOOTSTRAP_COMPLETE" != 1 ] && [ "$result" = 0 ]; then result=1; fi; exit "$result"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
STAGE="$(mktemp -d "$BIN/.setup.XXXXXX")"
value() { plutil -extract "$1" raw -o - "$MANIFEST"; }
hash_ok() {
  [ -f "$1" ] && [ ! -L "$1" ] || return 1
  [ "$(shasum -a 256 "$1" | awk '{print $1}')" = "$2" ]
}
download() {
  local key="$1" expected="$2" output="$3" i url
  for i in 0 1; do
    url="$(value "$key.urls.$i" 2>/dev/null)" || continue
    case "$url" in https://*) ;; *) die '依赖清单必须使用 HTTPS' ;; esac
    if curl --fail --location --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 600 --retry 2 --progress-bar "$url" -o "$output"; then
      if hash_ok "$output" "$expected"; then return 0; fi
      printf '%s\n' '文件校验不符，拒绝执行，尝试下一个下载源。' >&2
    fi
  done
  die '组件下载失败。检查网络或代理后重新启动；已校验的组件会保留。'
}
NODE_KEY="architectures.$ARCH.node"
NODE_HASH="$(value "$NODE_KEY.executableSha256")"
if ! hash_ok "$BIN/node" "$NODE_HASH"; then
  printf '%s\n' '1/3 准备 Node.js…' >&2
  download "$NODE_KEY" "$(value "$NODE_KEY.sha256")" "$STAGE/node.tar.gz"
  PREFIX="$(value "$NODE_KEY.prefix")"
  case "$PREFIX" in node-v*-darwin-arm64|node-v*-darwin-x64) ;; *) die 'Node 归档名称无效' ;; esac
  tar -xzf "$STAGE/node.tar.gz" -C "$STAGE" "$PREFIX/bin/node" "$PREFIX/LICENSE"
  hash_ok "$STAGE/$PREFIX/bin/node" "$NODE_HASH" || die 'Node 可执行文件校验失败'
  chmod 755 "$STAGE/$PREFIX/bin/node"
  mv -f "$STAGE/$PREFIX/bin/node" "$BIN/node"
  cp "$STAGE/$PREFIX/LICENSE" "$BIN/Node-LICENSE.txt"
fi
for COMPONENT in ffmpeg ytDlp; do
  if [ "$COMPONENT" = ffmpeg ]; then KEY="architectures.$ARCH.ffmpeg"; NAME=ffmpeg; STEP=2; else KEY=ytDlp; NAME=yt-dlp; STEP=3; fi
  HASH="$(value "$KEY.sha256")"
  if ! hash_ok "$BIN/$NAME" "$HASH"; then
    printf '%s\n' "$STEP/3 准备 ${NAME}…" >&2
    if [ "$COMPONENT" = ffmpeg ]; then
      download "$KEY" "$(value "$KEY.archiveSha256")" "$STAGE/ffmpeg.zip"
      unzip -p "$STAGE/ffmpeg.zip" ffmpeg > "$STAGE/ffmpeg"
      hash_ok "$STAGE/ffmpeg" "$HASH" || die 'FFmpeg 可执行文件校验失败'
    else
      download "$KEY" "$HASH" "$STAGE/$NAME"
    fi
    chmod 755 "$STAGE/$NAME"
    mv -f "$STAGE/$NAME" "$BIN/$NAME"
  fi
done
# Validate bytes before even running a version command. Existing runtimes count too.
hash_ok "$BIN/node" "$NODE_HASH" || die 'Node 校验失败'
hash_ok "$BIN/ffmpeg" "$(value "architectures.$ARCH.ffmpeg.sha256")" || die 'FFmpeg 校验失败'
hash_ok "$BIN/yt-dlp" "$(value ytDlp.sha256)" || die 'yt-dlp 校验失败'
chmod 755 "$BIN/node" "$BIN/ffmpeg" "$BIN/yt-dlp"
"$BIN/node" --version >&2
"$BIN/ffmpeg" -version > "$STAGE/ffmpeg-version.txt"
head -n 1 "$STAGE/ffmpeg-version.txt" >&2
"$BIN/yt-dlp" --ignore-config --version >&2
printf '%s\n' "运行组件已校验（${ARCH}）。" >&2
BOOTSTRAP_COMPLETE=1
