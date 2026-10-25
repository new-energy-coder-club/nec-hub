# IDE 接入指南（NEC-MCP）

在 Kimi Code、Claude Code、Cursor 等桌面 IDE 里，把 NEC 中台作为 MCP 服务器接入后，Agent 可以直接查多维表格、改 PRD 看板、发资料、部署应用、发起审批等。

- 端点：`https://hub.newenergycoder.club/mcp`（streamable HTTP / JSON-RPC）
- 鉴权：`Authorization: Bearer <MCP_TOKEN>`（管理端 token，生成方式见下节）
- 未配置 token 的本地环境自动降级为只读模式（仅 `whoami` / `query_bitable` / `list_todos`）

## 生产 token：生成方式与地址

- **接入地址**：`https://hub.newenergycoder.club/mcp`（门户自定义域名）；泛域名入口 `*.newenergycoder.club` 同样路由到本 Worker。
- **生成 token**（仓库根目录）：

```bash
npm run mcp:token                 # 生成 48 位随机 token 写入 .mcp-token（已 gitignore）
npx wrangler secret put MCP_TOKEN # 粘贴 .mcp-token 内容，写入生产 Worker
npm run mcp:setup                 # 验证并生成 IDE 配置（远程生产）
```

- **本地 dev 的 token**在 `.dev.vars` 的 `MCP_TOKEN`，与生产相互独立；建议与 `.mcp-token` 保持一致，脚本会检测不一致并提示。
- **轮换**：重新 `npm run mcp:token -- --force` → `wrangler secret put MCP_TOKEN`。生产 token 即全权限，轮换会使所有持有旧 token 的客户端（IDE / openClaw / 其它 Agent）立即失效，需逐一重新配置。
- 当前 token 持有者可通过 `whoami` 工具自检：返回「管理端身份」即有效。

## 一键配置（推荐）

在仓库根目录执行：

```bash
npm run mcp:setup              # 远程生产（默认）
npm run mcp:setup -- --local   # 本地开发（先 npm run dev）
```

脚本会做的事：

1. 读取 token（优先级：`NEC_MCP_TOKEN` 环境变量 > `--token` 参数 > `.mcp-token` 文件）。
2. **先调 `initialize` 验证连接与 token**，401 或连不上会直接报错，不写坏配置。
3. 生成 `.kimi-code/mcp.json`（Kimi Code）与 `.mcp.json`（Claude Code），旧文件备份为 `*.bak`。

然后在 IDE 里重连 MCP（Kimi Code 重开会话）即可。

## 两种模式对比

| | 远程生产（默认） | 本地开发 |
|---|---|---|
| URL | `https://hub.newenergycoder.club/mcp` | `http://localhost:8787/mcp` |
| 数据 | **线上真实数据**（写操作直接生效） | 本地 KV，与生产互不相通 |
| token | 生产 `MCP_TOKEN`（找维护者） | 本地 `.dev.vars` 的 `MCP_TOKEN` |
| 用途 | 日常查询、看板维护、资料发布 | 开发调试、验证新工具 |

> 注意：本地 dev 与生产是**两套独立 KV**。在本地调 `update_prd` / `publish_doc` 不会影响线上；之前出现过"以为更新了看板、实际写在本地"的情况，操作前确认当前接的是哪个端点。

## 手动配置（其它 IDE）

所有支持 streamable HTTP MCP 的客户端配置同构，把下面片段放进对应文件：

```json
{
  "mcpServers": {
    "nec-hub": {
      "url": "https://hub.newenergycoder.club/mcp",
      "headers": { "Authorization": "Bearer <你的MCP_TOKEN>" }
    }
  }
}
```

| IDE | 配置位置 |
|---|---|
| Kimi Code | 项目 `.kimi-code/mcp.json`（或全局 MCP 设置） |
| Claude Code | 项目 `.mcp.json` |
| Cursor | 项目 `.cursor/mcp.json` 或全局 `~/.cursor/mcp.json` |
| 其它 | 按各自 MCP 文档添加 streamable HTTP 服务器 |

含 token 的配置文件不要提交：本仓库 `.gitignore` 已覆盖 `.kimi-code/`、`.mcp.json`、`.mcp-token`、`*.bak`。

## 常用工具速查

| 场景 | 工具 |
|---|---|
| 我是谁 / 权限自检 | `whoami` |
| 查多维表格（队员/任务/物资/财务） | `query_bitable`（只读） |
| 我的待办聚合 | `list_todos`（只读） |
| 更新 PRD 看板 | `update_prd`（FE-01~18，FE-17/18 为子项） |
| 回写赛季目标进度 | `update_progress` |
| 发布资料页条目 | `publish_doc` |
| 部署/登记应用 | `deploy_app` / `register_app` |
| 物资调账 | `update_inventory` |
| 发起审批 | `submit_approval` |
| 拉会 / 通知 / 邮件 | `schedule_meeting` / `send_notice` / `send_mail` |
| 配置各流程底表 | `config_dashboard` / `config_flows` / `config_drawing_review` 等 |

完整工具清单与 schema 以 `tools/list` 为准。

## 排障

- **401 unauthorized**：token 与目标环境不符。本地 token 通常不能用于生产，反之亦然；用 `npm run mcp:setup` 会自动预检并提示。
- **ECONNREFUSED（本地）**：dev 没启动，先 `npm run dev`；端口默认 8787。
- **写工具提示"未配置 MCP_TOKEN 时仅放行只读工具"**：当前 Worker 未配置 token，处于只读降级模式。
- **调了 `update_prd` 但线上看板没变**：多半接的是本地 dev 端点（写进了本地 KV）。切到生产端点后重试。
- **财务表查询被拒**：`query_bitable table=finance` 需管理端 token 或队长/财务的 user_token。

## 安全边界

- 目前 MCP 为**管理端单 token** 模式，token 即全权限；不要贴进群聊、文档或提交进仓库。
- 生产模式下 `deploy_app`、`submit_approval`、`update_inventory` 等写操作直接作用于线上，Agent 调用前请确认。
