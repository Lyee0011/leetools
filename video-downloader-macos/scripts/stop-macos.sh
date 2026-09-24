#!/bin/bash
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
unset NODE_OPTIONS NODE_PATH
ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
[ "$(uname -s)" = Darwin ] || { printf '%s\n' '此入口仅用于 macOS' >&2; exit 1; }
[ ! -L "$ROOT/bin" ] || { printf '%s\n' 'bin 不能是符号链接。' >&2; exit 1; }
ARCH="$(uname -m)"
if [ "$(/usr/sbin/sysctl -in sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then ARCH=arm64; fi
case "$ARCH" in arm64) ;; x86_64) ARCH=x64 ;; *) exit 1 ;; esac
EXPECTED="$(/usr/bin/plutil -extract "architectures.$ARCH.node.executableSha256" raw -o - "$ROOT/dependencies.macos.json")"
[ -f "$ROOT/bin/node" ] && [ ! -L "$ROOT/bin/node" ] || { printf '%s\n' '缺少已安装的 Node，请先运行启动器。' >&2; exit 1; }
ACTUAL="$(/usr/bin/shasum -a 256 "$ROOT/bin/node" | /usr/bin/awk '{print $1}')"
[ "$ACTUAL" = "$EXPECTED" ] || { printf '%s\n' 'Node 校验失败，请重新运行启动器后再停止。' >&2; exit 1; }
exec "$ROOT/bin/node" "$ROOT/scripts/service-macos.js" --stop "$@"
