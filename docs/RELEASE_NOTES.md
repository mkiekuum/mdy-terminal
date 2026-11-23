# MDY Terminal 5.0.0

浏览器扩展使用 `mdy-terminal-v5.0.0-chrome.zip`。本机 MCP 另选与操作系统和处理器匹配的便携包。Windows、macOS、Linux 各提供 x64 和 ARM64 版本。便携包内含经过固定 SHA-256 核对的 Node.js 22.23.5 运行时及许可文件。解压后运行 Windows 的 Start-MCP.cmd 或 macOS/Linux 的 Start-MCP.command。在 Linux/macOS 也可以从终端运行 `sh Start-MCP.command`。

首次启动时仅监听 127.0.0.1。默认端口被占用时，新配置会采用操作系统分配的端口。已配置的实例再次启动遭遇端口冲突时会保留原配置。要创建独立配对，在终端给启动器加 `--new-instance`。在浏览器扩展设置中选择「导入本机配对文件」，选启动器显示的 connection.json。该文件含本机私钥匙，仅保存在自己的设备。

客户端可将包内 runtime/node（Windows 为 runtime/node.exe）作为命令，传入 mcp/stdio.mjs 的绝对路径和 --paired。使用独立实例时给客户端设置 XUTU_PAIR_FILE 为该实例配对文件的绝对路径。每次调用都会读取该文件。HTTP 客户端使用本机配对中的 URL 加 /mcp 和 clientToken 认证。

5.0 支持以稳定 ID 读取分支、汇合、归属、任务节点和行级权限；各类日期保留网站来源。查询使用分页回执。创建、修改、关联等操作仍须预览及确认。浏览器扩展和本机中继都升级后再使用新契约。
