# MDY Terminal 5.1.1

新建计划图不必先打开旧计划，也不必重复配对。在扩展首页点「MCP新建计划」，把需求交给已连接的本机 Agent，核对标题、编号、负责人、日期、节点、连线、工期，再确认本次创建。扩展只保存并回读，不自动送审。已保存、待审核、审核通过是不同的网站状态。

已有配对在两端升级后可复用；首次配对或遇到凭据不一致时用「MCP修改计划」。在浏览器本人许可后，把复制的一次性编号交给可信本机 Agent。不需要查找、选择、导入或发送 `connection.json`，提示词也不包含连接密钥。端口占用、其他浏览器桥在线、多个服务实例与版本不一致分别报告；程序不接管另一活动实例。

既有计划修改使用稳定 ID。失效标签只在目标计划和账号可核对时定位替代页；重新读取、重新预览、重新确认。账号、目标、版本、审核状态或有效期变化会使旧同意失效。结果未知时先查原 `jobId`、`requestId` 和计划回读，不重发写入。模板连线预览列出直连增删保留及执行人、工期、完成日的保留情况。

任务关联支持多节点及关键节点。任务负责人直接保存，代设申请待负责人审核，批准前保留原关联。首页顶部显示 MCP 状态和复制 DOM，设置仅保留界面及记住密码。

## 下载

| 用途 | 文件 |
|---|---|
| 浏览器扩展 | [chrome.zip](https://github.com/mkiekuum/mdy-terminal/releases/download/v5.1.1/mdy-terminal-v5.1.1-chrome.zip) |
| Windows MCP | [x64](https://github.com/mkiekuum/mdy-terminal/releases/download/v5.1.1/mdy-terminal-v5.1.1-win-x64.zip) · [ARM64](https://github.com/mkiekuum/mdy-terminal/releases/download/v5.1.1/mdy-terminal-v5.1.1-win-arm64.zip) |
| macOS MCP | [Intel](https://github.com/mkiekuum/mdy-terminal/releases/download/v5.1.1/mdy-terminal-v5.1.1-darwin-x64.zip) · [Apple 芯片](https://github.com/mkiekuum/mdy-terminal/releases/download/v5.1.1/mdy-terminal-v5.1.1-darwin-arm64.zip) |
| Linux MCP | [x64](https://github.com/mkiekuum/mdy-terminal/releases/download/v5.1.1/mdy-terminal-v5.1.1-linux-x64.zip) · [ARM64](https://github.com/mkiekuum/mdy-terminal/releases/download/v5.1.1/mdy-terminal-v5.1.1-linux-arm64.zip) |
| 源码及校验 | [source.zip](https://github.com/mkiekuum/mdy-terminal/releases/download/v5.1.1/mdy-terminal-v5.1.1-source.zip) · [SHA256SUMS](https://github.com/mkiekuum/mdy-terminal/releases/download/v5.1.1/SHA256SUMS) |

**只用扩展：**解压 chrome.zip，在 `chrome://extensions` 打开开发者模式，选择「加载已解压的扩展程序」，指向直接含 `manifest.json` 的目录。登录计划站即可用普通 AI 提示词和 JSON，不需要 Node.js、旧业务 CLI 或 Native Messaging。

**用 MCP：**另解压匹配系统和处理器的包，运行 Windows 的 `Start-MCP.cmd` 或 macOS/Linux 的 `Start-MCP.command`（也可用 `sh Start-MCP.command`）。包内含固定校验的 Node.js 22.23.5 和许可证。首次或恢复配对按前述步骤；详见 [MCP 手册](https://github.com/mkiekuum/mdy-terminal/blob/v5.1.1/mcp/README.md)。

**升级：**先确认没有未知或在途写入，校验新 ZIP，备份后更新原扩展目录的受管理文件，在扩展管理页重新加载。停止旧中继前先确认它是当前实例，然后从新便携包启动，保留本机原配对配置。如果两端版本不一致，先核对实际运行版本。如果状态已连接，无需再点配对；让 Agent 用 `xutu_status` 后执行一次只读回读。

**测试范围**：候选版在 Codex 浏览器完成实际配对、登录状态核对，以及恢复既有合成草稿后的独立回读。最终界面的两个 MCP 按钮通过模拟浏览器自动化测试。任务负责人审核使用合成数据核验。各平台便携包使用 GitHub 原生运行器测试。
