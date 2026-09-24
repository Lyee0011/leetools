#!/bin/bash
ROOT="$(cd -- "$(dirname -- "$0")" && pwd -P)"
if ! /bin/bash "$ROOT/scripts/stop-macos.sh"; then
  printf '%s\n' '停止未完成，请查看上方提示。按回车关闭。'
  read -r _
  exit 1
fi
