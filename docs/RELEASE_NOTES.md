# 序图终端 v4.0.0

- 打开目标计划即可操作。有多个候选页面时，切到要处理的序图页再试。
- 设置中可保存序图账号。会话过期时，扩展和 MCP 可用该账号登录，并向网站核实登录结果。
- 首页适配窄窗口和深色模式。历史记录、页面复制和设置按需展开，兼容性报告可在设置中查看。
- 本机 MCP 提供六个工具，支持检查连接、登录、读取、预览、执行和查询结果。确认执行时会核对预览对应的页面、账号及计划版本，重复确认只返回原请求结果。

## 下载与升级

| 文件 | 用途 |
| --- | --- |
| [Chrome 扩展](https://github.com/mkiekuum/xutu-control-terminal/releases/download/v4.0.0/xutu-control-terminal-v4.0.0-chrome.zip) | 解压后在扩展管理页加载 |
| [源码及本机 MCP](https://github.com/mkiekuum/xutu-control-terminal/releases/download/v4.0.0/xutu-control-terminal-v4.0.0-source.zip) | 含 MCP 服务、安装说明和测试 |
| [SHA256SUMS](https://github.com/mkiekuum/xutu-control-terminal/releases/download/v4.0.0/SHA256SUMS) | 校验两个 ZIP 文件 |

首次安装请解压扩展包，在 Chrome 的扩展管理页开启开发者模式，选择含 `manifest.json` 的目录。升级时，等当前请求结束，再将扩展包解压到原目录并重新加载。

使用本机 MCP 的用户还需将服务端升级至同版源码，沿用现有连接配置。重新加载扩展后，可通过 `xutu_status` 核对两端版本及当前页面。安装步骤见源码包中的 `mcp/README.md`。

## 发布验证

Windows 回归测试 185 项通过，跳过 1 项 macOS 目录别名测试。隔离的无头 Chrome 使用测试账号和模拟计划验证了六个 MCP 工具，包括自动选页、登录、切换页面后拒绝执行旧预览，以及重复确认只写入一次。
