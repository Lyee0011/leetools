#!/bin/bash
ROOT="$(cd -- "$(dirname -- "$0")" && pwd -P)"
printf '%s\n' '小伊视频下载器 · macOS 预览版' '首次启动需要联网准备组件，请等待。'
if /bin/bash "$ROOT/scripts/install-macos.sh"; then
  printf '%s\n' '可以关闭此终端窗口；退出后台请双击「停止视频下载器-macOS.command」。'
else
  printf '\n%s\n' '启动未完成。请查看上方提示和 bin/setup-last.log。按回车关闭。'
  read -r _
  exit 1
fi
