# macOS 预览版安装与验收

范围：macOS 13+，Apple Silicon arm64 / Intel x64。当前状态：实现完成后进行预览测试，尚无 Mac 实机通过记录。先读 AGENTS.md。不要改动相邻的 Windows 项目或原发布链接。

## 安装

选择用户可写目录，完整解压源码。无需 sudo、npm install、Homebrew 或全局环境修改。保留该目录自己的 LICENSE 和第三方声明。

```bash
cd "/实际路径/video-downloader-macos"
/bin/bash scripts/install-macos.sh --json
```

`--no-open` 用于不自动打开浏览器；仅准备组件用 `--no-start`，此时 `started:false` 不代表已启动。下载/校验进度写 stderr 和 `bin/setup-last.log`；成功 JSON 写 stdout。准备阶段失败会返回非零退出码和文本错误，不保证有 JSON；Agent 必须同时检查退出码。

初次联网下载，后续先校验文件再运行。Apple Silicon 若终端在 Rosetta 下运行，也会优先安装原生 arm64 组件。架构不支持、校验失败、下载失败时必须停止；不得关闭系统保护、使用未经校验的 PATH 程序或跳过错误继续报告成功。

## 验收

只有退出码为 0，返回 `ok:true`、`started:true` 才进入下面检查：

1. GET 返回 `url` 下的 `/api/config`，核对 `app` 为 `shinewood-video-downloader-macos`，`build`、`instance`、`pid` 与安装器一致。
2. 确认 `platform:"darwin"`，`arch` 与芯片一致；`ytdlp`、`ffmpeg`、`jsRuntime` 均为 true。
3. GET 页面正常；再次执行安装入口应返回相同 PID、构建和实例，不得另起一份后台。
4. 明确提醒这是预览版，未做真实下载不能声称“所有网站可用”。用户授权安装不代表授权读取账号或下载任意私人视频。
5. Mac 上运行 `/bin/bash tests/smoke-macos.sh`，再让用户确认文件夹选择、Finder 定位和有权限的视频下载。

服务只在 `127.0.0.1` 的 3210–3219 中选择可用端口。不得用固定 3210、已有的其他目录服务或 Windows 页面冒充验收。

安装器严格拒绝系统/架构错误、组件未校验、旧构建及正在停止的服务。新建进程若提前退出或未就绪，会报告失败；启动超时会尝试关闭这次持有的 ChildProcess，不按其他服务返回的 PID 杀进程。安装、启动和停止入口均不继承 NODE_OPTIONS / NODE_PATH，不修改用户的全局配置。

本机端口上已有服务但查询超时、连接异常或状态不可解析时，报告「服务状态未确认」，不把它等同于没运行，也不会因此另启后台或宣称停止成功；稍后再试。

## 停止和升级

```bash
/bin/bash scripts/stop-macos.sh --json
```

停止器校验本地 Node，只向同一安装实例发送带会话令牌的停止请求；服务端再次验证实例、构建及是否仍有任务。旧版本同目录服务需先停止再启动新版本。不要执行 `killall node`、清空所有浏览器进程或停止其他安装。

源代码包双击受系统限制时，可以用 `/bin/bash` 加拖入 `.command` 文件的方式调用；系统继续拦截时保留提示，不得移除全局隔离属性或关闭 Gatekeeper。

## 故障

- 下载失败：查看 `bin/setup-last.log`，确认可以访问清单中的地址。macOS 的“系统代理”不一定被 curl 继承；确有本机代理时，可只为本次终端设置用户提供的 `HTTPS_PROXY`。不得硬编码作者的代理地址。
- 安装中断留下锁：先确认另一个安装窗口没有运行，再删除本目录的空文件夹 `bin/.setup-lock`，然后重试。不要删除整个 bin 或其他目录。
- 组件哈希不符：拒绝执行；不要更新本地清单去迎合未知下载文件。向维护者反馈组件名即可。
- 打不开网页：查 `bin/server.log`。如 URL 已返回但浏览器启动失败，手动打开那个 URL。
- 网站失败：预览版仅公开下载，小红书不读取登录状态；游客浏览器补充解析需要 Chrome/Edge。

## 打包

源码提交后执行 `node scripts/package-source.js`（仅打包，需要 Git）。脚本从干净 Git 提交导出本目录，排除运行组件和个人数据，生成 `dist/video-downloader-macos-preview.zip` 及 SHA-256。不自动上传、不修改 Windows Release。发布时必须标记预览版，不能替换原稳定版下载资产或把它设为 Windows 的最新版。
