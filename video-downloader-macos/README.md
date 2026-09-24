# 小伊视频下载器 · macOS 预览版

粘贴链接、选择保存位置，下载视频并查看进度。本机浏览器界面，使用 yt-dlp、FFmpeg 和 Node.js。

**这是独立的 Mac 预览版，目前尚未完成 Mac 实机验收。** 安装脚本和两种芯片的依赖已准备；请先试用，再向其他人推荐。Windows 用户继续使用原来的 [video-downloader](../video-downloader)，其目录、发布包和下载地址不变。

## 系统要求

- macOS 13 Ventura 或更新版本，Apple Silicon（M 系列）或 Intel 64 位。优先验证苹果芯片。
- 首次运行联网下载约 120–140 MB 组件，自动识别芯片；运行组件会占用更多磁盘空间。无需先安装 Homebrew、Node.js、Python、FFmpeg，也不需要管理员权限。
- 首次下载需要能访问 Node.js、GitHub 和 Martin Riedl 的 FFmpeg 构建站；部分组件有清单里列明的备用镜像。
- 公开网页的浏览器备用解析需要已安装 Chrome 或 Edge。只有 Safari 时，常规 yt-dlp 下载仍可用，但不能使用该备用流程。

## 开始使用

源码入口：**[video-downloader-macos](https://github.com/Lyee0011/leetools/tree/main/video-downloader-macos)**。可以直接把这个链接交给 Mac 上的 Agent，按下方「给 Agent 安装」操作，无需另找启动包。

1. 从 GitHub 获取本仓库到自己的可写文件夹，例如「下载」，完整保留 `video-downloader-macos` 目录。使用源码压缩包时先完整解压；不要放进系统目录。
2. 打开 `video-downloader-macos` 文件夹，双击 **`视频下载器-macOS.command`**。
3. 首次运行会显示组件准备进度，完成后自动打开浏览器。粘贴链接开始下载；默认保存到 `~/Downloads/视频素材`，可点「更改」。
4. 下载完成后点「在文件夹中显示」，会在 Finder 中定位。清理历史只清界面记录，保留磁盘文件和正在下载的任务。
5. 不再使用时，双击 **`停止视频下载器-macOS.command`**。关闭浏览器或终端不会自动关闭后台；正在下载时会拒绝停止。

重复启动会复用本目录、同一版本的就绪服务。端口会在 `3210–3219` 中选择，不要固定打开某一个旧地址。

启动失败时会尝试关闭本次新建的服务进程，不停止其他安装。启动器不继承 `NODE_OPTIONS` / `NODE_PATH`，避免电脑已有的 Node 调试或加载设置改变本工具的运行方式。

### 第一次打不开

这是源码脚本包，不是经过 Apple 公证的 `.app`。系统可能提示未知开发者或缺少执行权限；出现「已损坏」「包含恶意软件」等提示时不要强行绕过，应先核对来源并反馈。不要关闭 Gatekeeper，也不要运行网上的批量移除隔离属性命令。

若是单纯 `.command` 不能双击，可在「终端」输入 `/bin/bash `（末尾有一个空格），把 **`视频下载器-macOS.command`** 文件拖入终端，再按回车。这样会正确带入中文、空格路径，不需要安装任何命令行开发工具。如果 macOS 仍阻止执行，请保留完整错误提示。

首次下载失败可重试，已校验的组件会保留。查看 `bin/setup-last.log`；网页服务错误看 `bin/server.log`。日志可能含视频网址或个人路径，反馈前自行遮盖。

## 已做的适配与限制

| 项目 | 此预览版的处理 |
|---|---|
| Apple Silicon / Intel | 自动选择本架构的 Node、FFmpeg；yt-dlp 是通用 Mac 独立版 |
| 保存位置 | 原生 Mac 文件夹选择器，默认「下载 / 视频素材」 |
| 文件定位 | Finder 打开目录或选中下载文件 |
| Windows 版 | 独立目录、独立服务标识和配置，不修改 Windows 安装及发布包 |
| 小红书 | 仅处理公开内容，不读取浏览器登录状态或钥匙串；需要登录时可能失败 |
| 抖音 | 保留游客通道；备用解析使用新的临时 Chrome/Edge 资料，不接管日常浏览器 |
| B站 / YouTube / 通用链接 | 沿用 yt-dlp 路径；受网络、站点变化、登录和地区条件影响 |
| 动态网页 | 普通解析失败后尝试匿名 Chrome/Edge；Safari 不作为备用引擎 |
| 下载完成 | 检查视频流和音频流；不把缺段或仅有画面的文件显示为成功 |

上述是实现范围，**不代表这些网站已经在 Mac 上逐一实测成功**。不保证所有网站或每条链接可用，不绕过会员、付费、私密内容、人工验证或 DRM。只下载自己拥有权限或已获授权使用的内容。

## 给 Agent 安装

把下面这段话交给 Mac 上的 Agent：

> 请读取 https://github.com/Lyee0011/leetools/tree/main/video-downloader-macos 中的 AGENTS.md、README.md 和 INSTALL.md，将 Mac 预览版源码保存到这台 Mac 的独立可写目录，运行 /bin/bash scripts/install-macos.sh --json 和 /bin/bash tests/smoke-macos.sh，核验芯片架构、组件、服务及重复启动，检查空闲停止后能否重新启动。遇到问题只修复 Mac 目录并复测，不动 Windows 项目，不读取个人 Cookie，不关闭系统安全保护。完成后打开界面让我试视频链接，说明哪些检查已通过、哪些仍需手动确认。

[INSTALL.md](INSTALL.md) 提供统一安装、验证、停止和错误处理方法。

## 隐私与许可

- 仅监听 `127.0.0.1`，不向作者上传网址、视频或账号状态。安装时访问清单中的组件来源，下载时连接视频网站。
- 不读取个人浏览器登录状态，不导出 Cookie。备用浏览器用一次性资料目录，完成后关闭并清理。
- 自有源码采用 [MIT License](LICENSE)。Node.js、yt-dlp 和 FFmpeg 保留各自许可，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- GitHub 上仅分享源码、脚本和说明，不包含第三方可执行文件、账号信息和个人配置。请勿把安装后生成的 `bin/` 直接打包转发。
- `config.json` 只保存本机设置；升级时先停止旧服务，将新版本解压到新文件夹，再选择保存目录。
- 卸载时先停止本目录服务，删除解压文件夹即可；另存的视频不会被自动删除。

## 验证

开发主机上的代码、安全、下载完整性测试与真正的 Mac 验收分开记录，见 [测试记录](tests/VALIDATION.md)。Mac 上可执行：

```bash
/bin/bash tests/smoke-macos.sh
```

基础测试使用临时生成的短视频，不下载外部视频，不读取账号。已有 Chrome/Edge 时可追加 `--browser` 做本地动态网页解析测试。之后仍需要手动确认系统弹窗、Finder、实际授权视频下载和停止服务。

本预览版从 Windows 项目 `bac9ed1` 独立复制。后续 Windows 的更新不会自动进入 Mac 版，需逐项合并、重新验证。
