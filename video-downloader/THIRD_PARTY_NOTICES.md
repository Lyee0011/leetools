# 第三方组件、许可与分发

本项目自有界面、控制程序及脚本采用 [MIT License](LICENSE)。它通过独立命令行进程调用以下组件，不把这些组件的源码改为 MIT，也不声称底层下载能力由本项目原创。

## 本次提供的下载包

GitHub 源码和 `video-downloader-windows-x64.zip` 只包含本项目源码、启动脚本和说明，**不包含 Node.js、yt-dlp、FFmpeg 可执行文件**。第一次启动时，用户电脑根据 [固定清单](dependencies.windows.json) 从列明的上游地址下载组件，并验证 SHA-256。无需单独安装 npm 包。

| 组件 | 本项目固定版本 | 适用许可 | 用途 |
| --- | --- | --- | --- |
| [Node.js](https://nodejs.org/) | v22.14.0 Windows x64 | MIT 及其捆绑依赖的许可 | 运行本地 HTTP 服务与 JavaScript |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | nightly 2026.08.04.234419，`yt-dlp.exe` | 上游自有源码为 Unlicense；这里的 PyInstaller Windows 组合作品为 **GPLv3 或更高版本** | 视频解析与下载 |
| [FFmpeg](https://ffmpeg.org/) | 6.1.1 static，来自 eugeneware/ffmpeg-static 的 b6.1.1 发布 | 本清单选定的构建报告 **GPLv3 或更高版本** | 合并、检查和整理音视频 |

这不是让用户在 Unlicense 和 GPL 之间任选。yt-dlp 的源码与包含其他依赖的 Windows 可执行版，是不同的分发产物。

## 上游许可和源码入口

- Node.js：[固定版本完整 LICENSE](https://github.com/nodejs/node/blob/v22.14.0/LICENSE)、[v22.14.0 源码](https://github.com/nodejs/node/tree/v22.14.0)。完整 LICENSE 包括 V8 等捆绑依赖说明，不能只保留 MIT 开头部分。
- yt-dlp：[官方许可说明](https://github.com/yt-dlp/yt-dlp#licensing)、[固定 nightly 发布与源码入口](https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/tag/2026.08.04.234419)、[Unlicense 正文](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE)。Windows 组合产物还应遵守其中依赖的声明和源码提供要求。
- FFmpeg：[官方许可说明](https://ffmpeg.org/legal.html)、[本次二进制来源](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1)、[FFmpeg n6.1.1 源码](https://github.com/FFmpeg/FFmpeg/tree/n6.1.1)。仅 FFmpeg 主项目源码不一定涵盖该静态构建的全部库及构建脚本。
- [GNU GPLv3 正文](https://www.gnu.org/licenses/gpl-3.0.html)。

## 修改、商用和再次打包

- 对本项目的 MIT 自有代码，可以使用、修改、商业使用和分发；分发副本或实质部分时保留版权声明与完整 MIT 文本。MIT 不要求公开自己的修改。
- 第三方组件仍按各自许可使用。本项目的 MIT 不覆盖它们，也不免除分发它们时的义务。
- 如果你把本机已经下载的 `bin/` 目录再装进自己的安装包、网盘包或 Release，就在分发第三方二进制了：须保留相应许可、版权与第三方声明，并按适用 GPL 方式提供**与该二进制准确对应的完整源码**，包括涉及的修改、依赖和必要构建脚本。一个上游首页链接，或只有本项目的源码，不能直接当作已完成这些要求。
- 本项目当前通过进程调用独立工具。若改成复制 GPL 代码、链接 GPL 库或构成一个受 GPL 约束的组合作品，需要重新判断整体许可，不能套用现有 MIT 声明。
- 软件许可证不授予所下载视频的版权，也不代替网站的访问与使用条件。

感谢 yt-dlp、youtube-dl、FFmpeg、Node.js 及其依赖的作者和贡献者。
## Bilibili 下载适配

`scripts/yt-dlp-plugins/leetools/yt_dlp_plugins/extractor/leetools_bilibili.py` 是本项目编写的 MIT 插件，通过 yt-dlp 的插件接口扩展 Bilibili 提取器，只补充原站返回的备用 URL。插件随源码提供；yt-dlp 程序本身的许可与获取方式仍以本文原有说明为准。
