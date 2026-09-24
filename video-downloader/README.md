# 视频下载器

一个只在本机运行的 Windows 视频下载工具。粘贴链接、选好保存位置，就可以查看进度并下载视频。底层使用 yt-dlp、FFmpeg 和 Node.js。

**[下载 Windows 启动包](https://github.com/Lyee0011/leetools/releases/download/video-downloader-v1.0.3/video-downloader-windows-x64.zip)** · [发布记录](https://github.com/Lyee0011/leetools/releases) · [反馈问题](https://github.com/Lyee0011/leetools/issues)

支持范围包括抖音、小红书、B站、YouTube、央视频、yt-dlp 可解析的网站和 MP4 / M3U8 / MPD 地址。**不保证每个链接都成功，也不保证所有网站都免登录。**

## 功能

- 浏览器极简界面，服务只监听 `127.0.0.1`。
- 自选保存目录，默认使用 `%USERPROFILE%\Downloads\视频素材`。
- 自动下载、合并并检查视频流与音频流，最终优先输出 MP4。
- HLS 成品若实际是 TS 格式，会无重编码整理为真正的 MP4，便于后续剪辑。
- 下载结束后可在资源管理器中定位文件并把窗口带到前面。
- 可一键清理界面里的历史下载记录；不会删除已经下载到磁盘的视频，正在进行的任务也会保留。
- 单个视频模式，不会因为误贴播放列表而批量下载。
- B站会检测原站返回的音视频备用地址，优先同等清晰度下可连接的标准 CDN；代理连接失败时自动尝试直连。不读取 B站登录状态。
- 抖音支持普通视频、精选页 `modal_id` 和常见分享链接；游客页受限时自动建立一次性匿名会话。
- 小红书支持网页链接和 `xhslink.com` 分享短链。
- 央视频支持 `w.yangshipin.cn/video`、`m.yangshipin.cn/video` 的 `cid` / `vid` 点播分享链接，优先请求公开 1080p，实际清晰度以网站返回为准。
- 央视频使用原站播放地址，下载后核对文件大小、MD5 和音画；临时连接失败时重新获取地址并重试一次。
- 失败任务可直接点“重试”；解析不支持、地区限制、登录限制、403 和网络错误分别提示。
- 更多动态网页：常规解析失败后，自动尝试识别网页正在播放的公开 MP4 / HLS / DASH 资源，再下载并检查音画。无需选择下载引擎。

## 系统要求

- Windows 10 或 Windows 11，64 位。
- 首次启动需要联网下载约 135 MB 运行组件。
- 在中国大陆下载 YouTube 通常需要可用的网络代理；程序会检测常见 Clash 端口及 `HTTP_PROXY` / `HTTPS_PROXY`。

无需安装 Node.js、FFmpeg、Python 或 npm 包。

## 快速开始

1. 下载上面的启动包，右键「全部解压」。不要直接在压缩包里运行。
2. 打开解压后的 `video-downloader` 文件夹，双击 **`视频下载器-Windows.bat`**。
3. 首次启动会联网准备约 135 MB 组件并校验文件，随后自动打开浏览器。请等待窗口显示的准备步骤完成。
4. 粘贴视频链接，按回车或点击「开始下载」。点「更改」选择保存文件夹。
5. 不再使用时，双击 **`停止视频下载器-Windows.bat`**。关闭浏览器标签页不会停止后台服务；正在下载时停止脚本会提示先等待任务结束。

只支持 Windows 10/11 **x64**；macOS、Linux、Windows ARM64 暂无可直接使用的发布包。建议解压到你有写权限的短路径，例如 `D:\Tools\video-downloader`，不要放在需要管理员权限的系统目录。

下载包包含可直接运行的源码和启动脚本，**不包含离线运行组件**。首次启动需要访问上游下载地址；以后组件齐全时不会重新下载，但下载视频仍需要联网。支持方括号、中文和空格路径。

若使用绿色 Code → Download ZIP 下载整个 `leetools` 仓库，请再进入其中的 `video-downloader` 子目录，启动文件不在仓库根目录。

**给 AI / Agent 安装：把仓库地址与 [INSTALL.md](INSTALL.md) 一起交给它。** 在下载器目录运行统一入口：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -Json
```

本工具不需要管理员权限。安装失败时查看 `bin/setup-last.log`，不要关闭安全保护或修改全局执行策略。

尚未购买 Windows 代码签名证书，系统或安全软件可能提示未知发布者。请先核对是否从本仓库下载及 SHA-256 校验值；不要为了运行而关闭安全软件。受企业策略限制的电脑可能无法运行脚本。

本次修复、验证证据及未覆盖环境见 [对抗式审查记录](AUDIT.md)。

## 各网站的工作方式

| 网站 | 默认方式 | 可能需要的外部条件 |
|---|---|---|
| 抖音 | 隔离游客通道；受限时启动一次性匿名 Chrome/Edge 会话 | 视频必须公开；备用流程需要本机有 Chrome 或 Edge |
| 小红书 | 公开页面优先 | 受限时自动只读本机浏览器登录状态 |
| B站 | yt-dlp 公开下载 | 会员、付费或登录内容不会被绕过 |
| YouTube | yt-dlp + Node 挑战运行时 | 网络、代理节点及平台临时风控 |
| 央视频 | 本地解析官方点播分享页及公开播放接口 | 仅支持完整公开的 MP4 点播；直播、试看或受保护格式不支持 |
| 其他视频网页 | yt-dlp 优先；解析失败时用临时 Chrome/Edge 补充识别 | 页面必须可匿名播放；备用流程需要电脑已有 Chrome 或 Edge |
| MP4 / M3U8 / MPD 直链 | yt-dlp 下载，FFmpeg 合并并检查音画 | 地址未过期，且站点允许下载请求 |

“支持更多网站”不等于“任意链接都能下载”。通用解析覆盖现有 yt-dlp 站点；浏览器补充流程扩展部分动态网页，自动带上该网页的来源地址和浏览器标识。登录、人工验证、付费、DRM、复杂嵌入播放器或多个无法区分的视频仍可能失败。网址以 `blob:` 开头的是浏览器内的临时引用，应粘贴它所在的视频网页地址。

补充识别按需调用电脑已有的浏览器，不增加 npm 包，不另行安装浏览器。一次只识别一个网页，最多排队三个任务；页面识别约 22 秒内结束，启动和清理另有超时限制。识别使用全新的临时目录，用完关闭并清理，不读取日常浏览器资料、不继承账号、不导出 Cookie。常规下载成功时不会启动浏览器。

补充流程只访问公网 http/https 页面和资源，拒绝本机、局域网地址及非标准网页端口。它不会接管已打开的网页、点击登录或处理验证码。某些代理的本地 Fake-IP DNS 模式可能使公开域名被判为非公网，此时会提示无法解析。

央视频适配器使用 Node 内置加密库实现公开播放器请求格式，不下载或执行远程 JavaScript，不读取浏览器账号。该国内站点的页面及视频请求直接连接原站；其他网站保留现有代理行为。

小红书 Cookie 只在下载进程内使用，不导出为文件、不上传、不修改账号。Windows 若提示 Cookie 无法读取，可完全退出 Chrome/Edge 后重试。

抖音匿名备用流程使用全新的临时浏览器目录，不读取现有 Chrome/Edge 资料，也不登录账号；只在内存中取得当前公开视频地址，任务结束后立即关闭浏览器并清理临时目录。

运行组件使用仓库内固定的版本号和 SHA-256。备用镜像只负责传输文件，不能动态提供“可信校验值”；现有 `bin` 文件也会先校验再执行。

Windows 始终使用上述校验过的 `bin/yt-dlp.exe`，不会因电脑装有 Python 而改用文件夹里残留的旧版 `yt-dlp.pyz`。

## 隐私与安全

- 工具不提供公网服务，不向作者的服务器发送链接、账号状态或下载文件。下载时会连接原视频网站；首次安装会连接清单中的上游地址，必要时使用已列出的镜像。
- **小红书注意**：公开下载失败时，会尝试通过 yt-dlp 读取本机已有浏览器的登录状态。账号信息在下载进程内处理，不导出持久 Cookie 文件；如不希望工具使用浏览器登录状态，请勿用当前版本下载小红书受限内容。其他站点不会使用这一流程。
- 本地网页使用随机会话令牌、Host/来源校验和请求大小限制；其他网页不能调用下载、选目录或资源管理器接口。
- 页面启用内容安全策略，不允许第三方脚本、框架嵌入或跨来源资源。
- `config.json` 只保存本机下载目录，并已被 Git 忽略。
- 请只下载自己拥有权限或已获授权使用的内容。
- 工具不会绕过付费、会员、私密内容或版权限制。

## 验证安装

在项目目录打开 PowerShell，执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\smoke-windows.ps1
```

若运行组件尚未准备，可追加 `-Bootstrap`：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\smoke-windows.ps1 -Bootstrap
```

基础测试只传输本机临时生成的短音视频，检查缺失分段、同名文件和并发上限，不下载外部视频。涉及网站适配的修改，还应使用自己有权访问的当前公开视频做一次真实测试，并确认成品同时有画面和声音。

如电脑已有 Chrome/Edge，可额外运行本地浏览器集成测试：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\smoke-windows.ps1 -BrowserIntegration
```

该测试临时生成三秒的音视频，验证动态网页识别、来源请求头、下载完整性、失败处理和临时浏览器清理，不读取账号或外部视频。实际网站测试记录见 [兼容性验证](tests/COMPATIBILITY.md)。

`tests/install-entrypoint.ps1` 可额外检查安装后首次启动和重复启动是否返回同一个就绪服务；它会保留测试前已经运行的实例。

测试同时覆盖恶意 Host、跨站 POST、错误 Content-Type、畸形 JSON、超大请求体以及页面安全响应头。

## 给本地 Agent

让 Agent 先读取 `video-downloader` 目录中的 `AGENTS.md` 和 `INSTALL.md`，再按安装、隐私约束和验收步骤执行。不要复制别人的配置、Cookie、浏览器资料或运行目录。安装入口返回真实端口、构建、进程号与目录，避免把打开一个旧页面误认为安装成功。

## 项目结构

`leetools` 首页只列各个小工具的文件夹。本工具的说明、许可、配置和源码都放在 `video-downloader/` 里，未来新增工具与它并列。

当前保留本地测试脚本；首次发布的云端测试结果见 [验证记录](https://github.com/Lyee0011/leetools/actions/runs/35500647857)。为保持仓库根目录只有工具文件夹，GitHub 自动工作流与 Issue 模板已移入本工具的 `.github/` 作为参考，**当前不会自动运行或应用**。仍可正常提交普通 Issue。

```text
server.js                       本地服务、网页和下载逻辑
scripts/yangshipin.js            央视频公开点播解析、下载与完整性校验
scripts/browser-resolver.js      按需调用现有浏览器，识别公开动态视频
scripts/download-errors.js       通用下载失败原因提示
视频下载器-Windows.bat          用户启动入口
停止视频下载器-Windows.bat      停止本目录的空闲后台服务
scripts/bootstrap-windows.ps1   Windows 运行环境重建
scripts/install-windows.ps1     人与 Agent 共用的安装、启动和就绪检查
scripts/package-source.ps1      从干净 Git 提交生成源码包
dependencies.windows.json       依赖版本、下载源和校验信息
focus-explorer.cs               资源管理器置顶助手源码
tests/                          源码与本地服务检查
.github/                        首次发布的 GitHub 配置参考（未启用）
AGENTS.md                       Agent 操作契约
THIRD_PARTY_NOTICES.md          第三方组件说明
```

## 分发方式

源码仓库不提交 `bin/` 和 `config.json`，克隆后由启动脚本自动重建运行环境。若要提供完全离线、双击即用的版本，请把运行组件放进单独的 GitHub Release ZIP，而不是提交到 Git 历史。

默认推荐分享源码包：提交通过检查的代码后，运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-source.ps1`，把 `dist/` 生成的 ZIP 与 SHA-256 文件一起提供。打包不会自动公开上传。

## 故障排查

- **页面打不开**：重新双击启动文件；程序会在 `3210–3219` 中选择可用端口。
- **首次准备失败**：确认网络可访问 GitHub，必要时先启动代理后重试。
- **窗口一直在准备组件**：首次要下载约 135 MB；查看当前下载步骤。失败后可以直接重新双击，已经通过校验的组件会保留。
- **YouTube 风控**：更换代理节点后重新下载，不要把个人 Cookie 写入仓库。
- **抖音游客页受限**：工具会自动尝试匿名临时会话；若仍失败，请确认视频公开，并安装 Chrome 或 Edge。
- **小红书 Cookie 无法读取**：完全退出 Chrome/Edge 后重试，或使用公开分享链接。
- **央视频失败**：复制具体点播视频的官方分享链接；已过期的播放地址会自动重新获取一次。接口结构变化需更新适配器。
- **更多网站失败**：先确认是具体视频页，而非网站首页；工具会自动尝试浏览器补充识别。需要登录、验证码或手动操作的网页可能仍失败；已取得公开 MP4 / M3U8 / MPD 地址时也可直接粘贴。没有 Chrome/Edge 时原有下载路径仍可用。
- **下载结果无法导入剪辑软件**：用 FFmpeg 或播放器确认视频编码；MP4 只是封装格式，不代表一定是 H.264。

## 许可

本项目源码采用 [MIT License](LICENSE)。Node.js、yt-dlp、FFmpeg 等第三方组件遵循各自许可，详情见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

MIT 允许你修改、分享和商用本项目自有源码，但要保留版权和许可文本。本次启动包不包含第三方二进制；若将已经下载的 `bin/` 一并转发，需要另行履行对应组件的许可及源码提供义务。特别是 Windows yt-dlp 和本次 FFmpeg 构建不能只按 MIT 分发。

## 更新与卸载

- 更新：先等待任务结束并停止旧服务，再把新启动包解压到新文件夹。旧版配置不会自动迁移，可在新界面重新选择保存位置。
- 下载引擎和运行环境按固定版本校验；不要单独替换 `bin/` 内文件或手动运行 yt-dlp 自更新，否则启动时会恢复清单里的版本。依赖升级通过本项目新版本发布。
- 卸载：停止本目录服务后删除解压文件夹即可。你另选目录保存的视频不会随工具删除。
- 本轮发布验证和历史站点样本分别见 [CHANGELOG.md](CHANGELOG.md)、[兼容性记录](tests/COMPATIBILITY.md)。历史样本成功不代表今天全部平台可用。
