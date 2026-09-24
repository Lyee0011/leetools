# 第三方组件与分发

本项目自己的界面、控制程序和脚本沿用原作者 [MIT License](LICENSE)。通过独立进程调用第三方工具，不把它们的许可改为 MIT。

GitHub 上的 Mac 预览目录及其源码归档只分发自有源码、启动脚本及说明，不含 Node.js、FFmpeg、yt-dlp 二进制。首次启动按 [固定清单](dependencies.macos.json) 获取组件并校验归档与可执行文件。清单的 SHA-256 是信任依据，镜像不能在安装时提供新的“可信哈希”。

| 组件 | 固定版本/构建 | 许可与来源 |
|---|---|---|
| Node.js | v22.14.0，darwin-arm64 / darwin-x64 | MIT 和捆绑依赖许可；[完整 LICENSE](https://github.com/nodejs/node/blob/v22.14.0/LICENSE)、[源码](https://github.com/nodejs/node/tree/v22.14.0) |
| yt-dlp | nightly 2026.08.04.234419，yt-dlp_macos 通用独立版 | 自有源码 Unlicense；PyInstaller 组合可执行产物按 GPLv3+；[固定发布](https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/tag/2026.08.04.234419)、[许可说明](https://github.com/yt-dlp/yt-dlp#licensing) |
| FFmpeg | 9.0.2，Martin Riedl 的固定 arm64 / amd64 构建 | 本次构建启用 GPL 与 version3，未启用 nonfree；按 GPLv3+ 及所带库声明处理；[arm64 构建配置](https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/versions.txt)、[Intel 构建配置](https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/versions.txt) |

Node 解压包的完整 LICENSE 会保存在本机 `bin/Node-LICENSE.txt`，包括 V8 等依赖，不应只复制 MIT 第一段。FFmpeg 的 [官方许可说明](https://ffmpeg.org/legal.html)、[构建脚本](https://git.martin-riedl.de/ffmpeg/build-script) 和 [GNU GPLv3 正文](https://www.gnu.org/licenses/gpl-3.0.html) 可用于进一步核对。FFmpeg 全部准确对应的源码不能只用主项目首页代替。

## 自行修改和再分发

- 本项目自有代码可按 MIT 修改、分享、商用，保留版权和完整许可文本。
- “本项目 MIT”不覆盖上述第三方组件；yt-dlp 源码许可与其含依赖的打包产物不同，不能任选。
- 把安装后生成的 `bin/` 放进网盘包、应用或 Release，就涉及第三方二进制再分发。需保留许可、第三方声明，并按适用许可提供准确对应的完整源码、依赖和必要构建脚本。仅附本项目源码或几个上游链接不能自动满足这些义务。
- 若以后复制 GPL 代码、链接 GPL 库或改变为其他集成方式，需重新判断组合后的许可。
- 许可证不授予视频版权或网站访问权限。仅下载有权保存的内容。

本次没有把第三方二进制加入 Git 或预览 ZIP。感谢 yt-dlp、youtube-dl、FFmpeg、Node.js、Martin Riedl 及相关依赖的维护者。

2026-09-24 Apple Silicon 实机安装沿用上述固定版本、来源与 SHA-256，未修改依赖清单。Bash 3.2 修复仅涉及本项目安装脚本及回归测试；组件仍在执行前校验，二进制与本机验收日志保留在被 Git 忽略的 `bin/` 中。
