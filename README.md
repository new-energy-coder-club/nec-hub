# nec-hub — NEC 团队 AI 中台（MVP）

单体 Cloudflare Worker：门户 + API + MCP 端点 + 应用托管（R2）+ 注册表（KV）。

## 本地开发

```bash
cd nec-hub
wrangler dev --port 8787
```

打开 http://localhost:8787 即为门户。本地模式下 KV/R2 走 Miniflare 本地模拟，无需 Cloudflare 账号。

## 部署

```bash
# 1. 创建真实 KV / R2，把返回的 id 填回 wrangler.jsonc
wrangler kv namespace create nec-hub-registry
wrangler r2 bucket create nec-hub-apps

# 2. （可选）MCP 写操作鉴权 token
wrangler secret put MCP_TOKEN

# 3. 部署并绑定域名 hub.newenergycoder.club
wrangler deploy
```

## 路由

| 路径 | 说明 |
|---|---|
| `GET /` | 门户（四个 Tab：应用广场 / Skill 中心 / 数据看板 / 我的 Agent） |
| `POST /mcp` | MCP streamable HTTP 端点（JSON-RPC） |
| `GET /api/apps` · `/api/skills` | 注册表 |
| `GET /apps/<name>/` | 队员应用（R2） |
| `GET /skills/<name>/SKILL.md` | Skill 原文 |

## MCP 工具

- `deploy_app(name, title, author, files[])` — 上传静态文件到 R2 并注册到应用广场
- `register_app(name, title, url)` — 外部已部署应用（如 Vercel 项目）链接登记
- `sync_vercel(confirm, exclude, team)` — 自动发现 Vercel 团队项目并批量登记（默认 dry-run 预览，`confirm=true` 写入；需配置 `VERCEL_TOKEN` secret）
- `publish_skill(name, description, content)` — 上架 SKILL.md 到 Skill 中心
- `query_bitable(table, filter)` — 飞书多维表格查询（占位）

## 已配置的生产资源

- 自定义域名：`hub.newenergycoder.club`（custom domain，自动签发证书）
- Secrets：`FEISHU_APP_ID` / `FEISHU_APP_SECRET`（免登后端）· `VERCEL_TOKEN`（sync_vercel）
- 待办：`MCP_TOKEN`（应用广场写保护，建议尽早配置）

## 待办（第二/三阶段）

- [ ] 飞书 OAuth 登录 + 权限角色（当前 MVP 无登录态，仅内网/小队使用）
- [ ] `query_bitable` 接入飞书多维表格 API
- [ ] 飞书工作台入口配置（管理后台将工作台指向本域名）
- [ ] `wrangler types` 生成权威 Env 类型（当前为手写最小接口）
- [ ] Skill GitHub 仓库 + CI 校验 frontmatter
