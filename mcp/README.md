# 本机 MCP 服务

这是MDY Terminal的可选连接组件，不是旧版业务 CLI 或 Native Messaging。无需公网域名和公网部署。普通 JSON 和隐藏旧计划栏不需要启动此服务。

## 便携版（推荐）

从同版本 Release 下载匹配 Windows 架构的便携包，核对 SHA256SUMS，解压后运行根目录 `Start-MCP.cmd`。保留整个目录。源码使用 Node 22+ 运行 `node mcp/start-local.mjs`。

## 首次连接或配对恢复

1. 同版服务启动后，扩展中选择「MCP修改计划」。出现浏览器权限提示时由本人允许。已有配对正常时，两端升级后可直接重连，无需重复配对。
2. 若浏览器复制了一次性编号，把编号交给可信**本机** Agent。Agent 使用包内运行时执行 `mcp/pair-local.mjs --offer <编号>`，读取当前实例本机配置并核准；不读取全局剪贴板，不输出密钥。浏览器随即验证请求并领取桥凭据；编号两分钟有效。浏览器和 Agent 的本机配置都不需由用户打开、导入或发送。
3. 用 `xutu_status` 查两端版本和网站会话，再读一份获准读取的计划。不支持本机 MCP 的 AI 使用普通 JSON。首次配置客户端指向下节的 stdio 入口，必要时由用户重载客户端。

服务仅监听 `127.0.0.1`，首次普通实例在 62924–62934 取空闲端口；已配置实例遇到端口占用不会改动配置。使用 `--new-instance` 时启动器选独立端口。首次发现多个服务或使用非默认范围的端口时，在设置展开「指定实例」，输入启动器显示的端口；已有其他配对时不会覆盖它。独立实例的本机 Agent/stdio 可由维护者设置 `XUTU_PAIR_FILE` 定位该实例的配置，无需让用户选择或发送文件。不要停止无关进程。服务重启不恢复旧队列；原写入未知时先查网站和扩展的原 `requestId`。

## 支持标准 Streamable HTTP 的客户端

地址：`http://127.0.0.1:62924/mcp`。Authorization 为 `Bearer <clientToken>`。客户端设置中通常称 HTTP/Streamable HTTP MCP，字段名可能不同，以该客户端官方说明为准。

Codex 可使用：

```powershell
# 从本机私有配置读取，不在命令历史粘贴密钥正文
$connection = Get-Content "$env:USERPROFILE\.xutu-mcp\connection.json" -Raw | ConvertFrom-Json
[Environment]::SetEnvironmentVariable('XUTU_MCP_TOKEN', $connection.clientToken, 'User')
$env:XUTU_MCP_TOKEN = $connection.clientToken
codex mcp add xutu-terminal --url http://127.0.0.1:62924/mcp --bearer-token-env-var XUTU_MCP_TOKEN
```

已打开的客户端可能需要退出并重新启动才能继承环境变量。不要覆盖已存在且指向其他服务的同名配置。

## 聊天中提示 fetch failed

先从当前聊天调用 xutu_status；5.4 起，首次状态响应附 clientVersion。按 jobId 取回执核对中继及扩展版本。若同一配对的便携客户端能读、旧聊天仍失败，核对宿主的 stdio 路径和配对绑定并重载 MCP 配置。回到原聊天再查状态并只读回读。请在后续升级沿用相同安装目录。RELAY_OFFLINE 指当前实例没有监听，CREDENTIAL_MISMATCH 指中继拒绝当前凭据，VERSION_MISMATCH 指版本不一致。结果未知时先查询原回执。

## 只支持 stdio 的客户端

使用便携包内 `runtime/node.exe`或本机 Node 22+，运行 `mcp/stdio.mjs --paired`。适配器读取本机实例配置，转发标准 JSON-RPC，不在 stdout 输出日志或凭据。

```json
{
  "mcpServers": {
    "xutu-terminal": {
      "command": "便携目录/runtime/node",
      "args": ["便携目录/mcp/stdio.mjs", "--paired"]
    }
  }
}
```

这是一种常见配置形状，不代表每个 AI 客户端都使用同一配置文件。不支持 MCP 的 AI 使用“普通 AI”提示词和 JSON；浏览器内的云端聊天产品通常不能直接访问本机地址，本版不保证其支持。

## 换电脑与私有跨电脑访问

默认推荐在新电脑独立启动服务、安装插件并登录自己的网站账号。新电脑不要重放旧电脑结果未知的指令。

若 AI 在电脑 B、登录网站的浏览器在电脑 A，可使用已经获授权且可达的私有 SSH 连接：在 B 执行 `ssh -N -L 62924:127.0.0.1:62924 用户@电脑A的私有地址`，B 的 AI 仍连本机 `/mcp`，使用 A 的 clientToken；A 的插件连 A 本机服务。不要将服务绑定 0.0.0.0 或在路由器开放端口。未配置 SSH/私有网络时不能宣称跨电脑连接已完成。本版不自动安装 SSH、开放防火墙或部署公网服务。

每个实例只绑定一个活动浏览器桥，另一浏览器会被拒绝，旧桥停止约90秒后才可接管。多位用户用独立实例/密钥，不共用同一个队列。服务不替用户持有网站 Cookie，网站操作由选定浏览器的真实会话完成。

## 协议与执行边界

- `xutu_status`：无参数。检查服务与浏览器桥；在线时按 jobId 获取两端版本、自动选页、会话和自动登录状态。
- `xutu_login`：无参数。使用扩展内已保存的资料尝试登录，按 jobId 读取结果。只以 session 为 `already_logged_in` 判定登录成功。没有网页或目标不唯一时请打开或切到要操作的MDY 计划站页。
- `xutu_read` 支持完整 command，4.6.1 服务也可无参读取当前计划摘要，或仅传 tabId。摘要包含目标、版本、节点和连线数量、完整性及警告。从原回执读取节点时，可给 xutu_result 传 path 数组 ["steps","0","data","plan","current","nodes"] 和 limit。按 nextOffset 继续，拼接所有 jsonText 后解析 JSON。
- `xutu_preview`：一次操作或一个 plan.batch 的预览，保存短期执行依据。
- `xutu_execute`：绑定成功 previewJobId 与使用者本次明确同意原文 approval。预览有效期5分钟，不能更换命令；账号、目标页、版本或审核状态变化会停止。重新读取和预览后须再次由使用者确认；不会重复使用原确认。恢复通过既有 history.preview 的 reviewToken 核对。
- 独立建图：在已登录的首页点「MCP新建计划」。`plan.create` 不需要旧计划目标。预览展示参数、结构校验及网站只读检查；编号检查只覆盖当前可见计划。一次明确同意后提交并独立回读，不自动送审。未知时先查原回执及预览的 plannedTargetId。
- `xutu_result`：查询原任务；dispatched 表示尚未确认完成，不是成功，也不能自动重发。

AI 必须先展示预览摘要并等用户同意。approval 由客户端引用，服务无法独立证明这是人类输入，不能将此说成独立人工认证；不要编造同意。脚本执行及带可执行内容的原始页面导出仍只在本机插件的原有入口处理。其他现有业务/审核操作遵循正式参数契约及服务器权限，不代表每项均通过真实网站测试。

4.6.1 的浏览器桥在空闲时每 3 秒取件，有积压时连续取件。工作线程被挂起或连接失败后由 Chrome 的 30 秒闹钟唤醒。浏览器休眠或关闭会延迟或停止取件。预览在扩展本机短期保存，浏览器工作线程重启可继续核对；服务重启不重放任务。断开不会撤销已经提交的操作。日志/任务仅在本机，服务最多保留 1000 个任务，满时优先回收超过 5 分钟的已完成读取或会话查询。执行回执和未确认任务保留。

实现依据：[MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)、[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp)。协议握手版本 2025-06-18，提供 JSON 响应；GET SSE 未实现，返回405。不是对所有 AI 产品的兼容保证。


在「设置 → MDY 计划站自动登录 → 设置」可保存账号，平时表单收起。密码只存在本浏览器扩展存储，不会回显；点「清除」可停用。

## 5.0 计划关系查询

向 xutu_read 传入 planId（网站稳定 ID，可从 records.planPage 取得）和可选 tabId。使用 xutu_result 查询原 jobId；大图按 path 读取 steps、0、data 下的字段。普通 JSON 使用 graph.relations 和 target.id。

返回项目主图、任务自有图、任务所属项目图、绑定节点和所属组。日期沿用网站字段，包括任务图日期、项目节点日期、采用的日期来源、整图预测与设置截止。graph 给出每个节点的直接入线和出线、分支、汇合以及尚未登记完成的前置线。workTasks 只展示网站返回且属于本图的工作行。记录版本过期时不提供可执行的行级授权。查询反映当前可见数据；关联和写入需以重新预览时的服务器权限为准。
