#!/bin/bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
[ "$(uname -s)" = Darwin ] || { printf '%s\n' '此测试需要真正的 Mac' >&2; exit 1; }
cd -- "$ROOT"
/bin/bash scripts/bootstrap-macos.sh
NODE="$ROOT/bin/node"
"$NODE" --check server.js
for TEST in source-smoke runtime macos-platform yangshipin browser-resolver http-security download-integrity; do
  "$NODE" "tests/$TEST.js"
done
if [ "${1:-}" = --browser ]; then "$NODE" tests/browser-integration.js; fi
# This check opens no external video and preserves any existing matching service.
FIRST="$(/bin/bash scripts/install-macos.sh --json --no-open)"
SECOND="$(/bin/bash scripts/install-macos.sh --json --no-open)"
"$NODE" -e 'const a=JSON.parse(process.argv[1]),b=JSON.parse(process.argv[2]);if(!a.ok||!a.started||!b.ok||a.pid!==b.pid||a.build!==b.build||a.instance!==b.instance)process.exit(1);console.log("重复启动复用通过："+a.url)' "$FIRST" "$SECOND"
printf '%s\n' '自动检查通过。请手动确认：更改保存位置、下载有权使用的视频、Finder 定位、清理历史、停止服务。'
