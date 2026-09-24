#!/bin/bash
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
unset NODE_OPTIONS NODE_PATH
ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
case "$(uname -s)" in Darwin) ;; *) printf '%s\n' '此入口仅用于 macOS' >&2; exit 1 ;; esac
for ARG in "$@"; do
  case "$ARG" in --json|--no-open|--no-start) ;; *) printf '未知选项：%s\n' "$ARG" >&2; exit 1 ;; esac
done
mkdir -p "$ROOT/bin"
[ ! -L "$ROOT/bin" ] || { printf '%s\n' 'bin 不能是符号链接。' >&2; exit 1; }
# Preserve the actual bootstrap status; tee must not hide a failed download.
/bin/bash "$ROOT/scripts/bootstrap-macos.sh" 2>&1 | /usr/bin/tee "$ROOT/bin/setup-last.log" >&2
exec "$ROOT/bin/node" "$ROOT/scripts/service-macos.js" "$@"
