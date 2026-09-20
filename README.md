# leetools · 小伊的工具箱

把自己用着不顺手的地方改一改，再把工具分享出来。

| 工具 | 做什么 | 平台 | 下载 |
| --- | --- | --- | --- |
| [视频下载器](video-downloader/) | 粘贴视频链接，选保存位置，查看下载进度 | Windows 10/11 x64 | [下载启动包](https://github.com/Lyee0011/leetools/releases/download/video-downloader-v1.0.0/video-downloader-windows-x64.zip) |

## 第一次使用

1. 点击上面的「下载启动包」，把 ZIP **完整解压**到一个有写权限的位置。
2. 打开 `video-downloader` 文件夹，双击 **`视频下载器-Windows.bat`**。
3. 首次运行需要联网下载约 135 MB 组件，会显示当前步骤；准备好后自动打开浏览器。
4. 粘贴视频链接，点击「开始下载」。不需要自己安装 Node.js、Python 或 FFmpeg。

这不是离线安装包。首次准备需要能访问 Node.js 和 GitHub 的下载地址；网络受限时可能失败。网站支持范围、登录状态使用和故障处理见 [下载器说明](video-downloader/README.md)。

想看源码或让 AI 帮你修改，可以直接读取 [video-downloader](video-downloader/) 和 [安装说明](video-downloader/INSTALL.md)。整个仓库也可以通过绿色 **Code → Download ZIP** 下载。

## 许可与致谢

本仓库自有源码采用 [MIT License](LICENSE)：允许使用、修改、分享和商业使用，分发时须保留版权声明及许可文本。各工具另有许可说明时，以对应文件为准。

视频下载器通过独立命令行进程调用 **yt-dlp、FFmpeg、Node.js**。这些项目的作者和贡献者完成了底层解析、下载、音视频处理和运行环境的大量工作；本项目增加本地界面、安装流程及部分站点适配。

第三方组件保留各自许可，**不因本仓库采用 MIT 而变成 MIT**。特别是实际使用的 Windows yt-dlp 可执行版和 FFmpeg 构建涉及 GPLv3+，详见 [第三方组件与分发说明](video-downloader/THIRD_PARTY_NOTICES.md)。

## 反馈

遇到问题，请在 [Issues](https://github.com/Lyee0011/leetools/issues) 说明工具名称、Windows 版本和错误提示。不要上传 Cookie、账号令牌、个人路径或私密链接。安全问题请使用 [私密漏洞报告](https://github.com/Lyee0011/leetools/security/advisories/new)。

工具按现状提供；网站更新、地区限制或风控都可能影响使用。请仅下载自己拥有权利或已获授权的内容。
