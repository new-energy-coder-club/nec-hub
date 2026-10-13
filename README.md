# nec-hub — NEC 团队 AI 中台（MVP）

单体 Cloudflare Worker：门户 + API + MCP 端点 + 应用托管（R2）+ 注册表（KV）。

- 生产门户：<https://hub.newenergycoder.club>
- MCP 端点（Agent 接入）：`https://hub.newenergycoder.club/mcp`（streamable HTTP / JSON-RPC）
- 源码：GitHub [new-energy-coder-club/nec-hub](https://github.com/new-energy-coder-club/nec-hub) · Gitee 镜像 [darrenpig/nec-hub](https://gitee.com/darrenpig/nec-hub)

## 线上内容（截至 2026-10-12）

应用广场 12 个应用（实时列表见 [`GET /api/apps`](https://hub.newenergycoder.club/api/apps)）：

| 应用 | 说明 | 链接 |
|---|---|---|
| 擎天塔重建 // NEON PROTOCOL | 战队年度项目门户 | <https://tower.newenergycoder.club> |
| NEC 仓库作业台 | MES 仓储系统（电控组） | <https://mes.newenergycoder.club> |
| 物资盘点助手 | R2 自托管小工具 | [/apps/inventory-check/](https://hub.newenergycoder.club/apps/inventory-check/) |
| NEC 主视觉资产库 | KV 画廊 + 飞书宣传栏 + PNG 物料 | [/apps/kv-assets/](https://hub.newenergycoder.club/apps/kv-assets/) |
| 常州工NEC · 新人招募海报 | 招募静态页 | [/apps/recruit-poster/](https://hub.newenergycoder.club/apps/recruit-poster/) |
| club 官网 / solarglyph / gexo / public-beta / r2-web 等 7 个 | Vercel 项目，`sync_vercel` 自动登记 | 见 `/api/apps` |

Skill 中心 19 个（实时列表见 [`GET /api/skills`](https://hub.newenergycoder.club/api/skills)）：

- 中台自托管：[nec-kv-design](https://hub.newenergycoder.club/skills/nec-kv-design/SKILL.md)（主视觉设计系统）· nec-tech-report（技术方案报告）
- Gitee 同步 17 个：源仓库 [darrenpig/new_energy_coder_club](https://gitee.com/darrenpig/new_energy_coder_club) `SKill` 分支，经 `scripts/sync-gitee-skills.py` 登记（`source: "gitee"`，门户显示 ⤤ 外链）

## 相关仓库与文档

- Skill 源仓库（Gitee）：<https://gitee.com/darrenpig/new_energy_coder_club>（`SKill` 分支，`skills/*/SKILL.md`）
- 开源组织（GitHub）：<https://github.com/new-energy-coder-club>
- 搭建方案：[`docs/团队AI中台搭建方案_V1.0.md`](docs/团队AI中台搭建方案_V1.0.md)
- 飞书工作台上架手册：[`docs/飞书工作台上架手册_NEC仓库作业台.md`](docs/飞书工作台上架手册_NEC仓库作业台.md) · [`docs/飞书定制工作台配置手册.md`](docs/飞书定制工作台配置手册.md)
- 飞书免登接入：[`docs/飞书免登接入_MES.md`](docs/飞书免登接入_MES.md) · 接入包 [`integrations/mes/feishu-sso.js`](integrations/mes/feishu-sso.js)

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
| `GET /` | 门户（五个 Tab：应用广场 / Skill 中心 / 开源仓库 / 数据看板 / 我的 Agent） |
| `POST /mcp` | MCP streamable HTTP 端点（JSON-RPC） |
| `GET /api/apps` · `/api/skills` | 注册表 |
| `GET /api/repos` | NEC 开源仓库列表（GitHub org `new-energy-coder-club` + Gitee `darrenpig` 合并，含 Star/Fork/Commit，KV 1 小时缓存；可选 `GITHUB_TOKEN` / `GITEE_TOKEN`） |
| `GET /api/dashboard` | 数据看板聚合（飞书多维表格 + KV 5 分钟缓存；财务区按登录角色脱敏） |
| `GET /api/whoami` | 当前登录用户与角色（`nec_session` Cookie；未登录返回 `authenticated:false`） |
| `GET /api/config` | 公开配置（`feishuAppId` / `loginEnabled`，供门户"飞书登录"跳转用） |
| `POST /auth/feishu` | 飞书 code 兑换用户信息 + 签发中台会话（与 MES 免登共用端点；同源调用才会种下会话 Cookie） |
| `POST /auth/logout` | 登出（销毁会话并清除 Cookie） |
| `GET /api/docs` | 资料页索引（KV，含分类/维护人/可见范围） |
| `GET /api/validate` | 最近一次数据健康校验报告（由 `validate_bitable` 详细模式写入） |
| `GET /api/prd` | 动态 PRD 看板（M1/M2/M3 需求状态 + 总进度 + 最近 git 提交；状态经 MCP `update_prd` 维护） |
| `POST /api/hooks/github` | GitHub push webhook（验签 → 记录最近提交 → 推飞书群机器人） |
| `GET /apps/<name>/` | 队员应用（R2） |
| `GET /skills/<name>/SKILL.md` | Skill 原文 |

## MCP 工具

- `deploy_app(name, title, author, files[])` — 上传静态文件到 R2 并注册到应用广场
- `register_app(name, title, url)` — 外部已部署应用（如 Vercel 项目）链接登记
- `sync_vercel(confirm, exclude, team)` — 自动发现 Vercel 团队项目并批量登记（默认 dry-run 预览，`confirm=true` 写入；需配置 `VERCEL_TOKEN` secret）
- `publish_skill(name, description, content)` — 上架 SKILL.md 到 Skill 中心（中台自托管）
- `import_skills(skills[], source)` — 批量登记外部 Skill（只存名称/描述/链接，不托管文件）；不覆盖中台自托管（`source: "hub"`）的 Skill
- `query_bitable(table, filter?, limit?, app_token?, table_id?, user_token?)` — 只读查询飞书多维表格；finance 表需管理端（MCP_TOKEN）或有效 user_token（角色为队长/财务/指导）。**MCP_TOKEN 未配置时 finance 门禁依然生效**（无 user_token 一律拒），生产环境务必配置 MCP_TOKEN
- `config_dashboard(action, base?, tables?)` — 配置/查看数据看板对接的多维表格（app_token + 各表 table_id），配置手册见 `docs/数据看板配置手册.md`
- `whoami(user_token?)` — 验证调用者身份：MCP_TOKEN 持有者 → 管理端；否则校验 user_token 并返回名单表角色
- `remove_skills(names[])` — 从 Skill 中心移除指定 Skill（不删 R2 文件）
- `publish_doc(name, title, category, url, maintainer?, visibility?)` — 上架资料页条目（分类：品牌规范/文档模板/制度SOP/培训材料）
- `remove_docs(names[])` — 从资料页移除条目（只删索引）
- `validate_bitable(scope?, user_token?)` — 数据健康校验：12 条内置声明式规则扫 4 张表，输出异常清单（记录直链飞书 + 修复建议）；明细仅管理端/队长/组长，无身份只返回计数；详细报告写入 `/api/validate` 供门户「数据健康」展示。规则可用 KV `validate:rules` 覆盖
- `setup_bitable(base, tables?, force?)` — 数据基建一键建表：按标准 schema 在指定 base 创建四张逻辑表并写入看板配置（仅管理端）
- `add_records(table, records[])` — 往飞书多维表格追加记录（字段名预检，人话报错；仅管理端）。典型用法：报销回写财务表、任务批量导入、名单录入
- `update_prd(id, status, note?)` — 更新 PRD 看板需求状态（done/partial/pending/todo），看板实时同步、状态变化推群（仅管理端）

## PRD 看板与提交推送（2026-10-12）

- 门户第 8 个 Tab「PRD 看板」：`GET /api/prd` 输出 M1/M2/M3 三列卡片、总进度条、最近 git 提交；初始状态为 PRD V2.0 盘点基线（`src/index.ts` 内 `DEFAULT_PRD_ITEMS`），之后由 Agent 调 `update_prd` 维护（覆盖存 KV `prd:status`）。
- 提交推送：`POST /api/hooks/github` 接收 GitHub push webhook（HMAC-SHA256 验签），记录最近提交到看板并推送飞书群（复用通知中心 `notifyFeishu`，可用 `FEISHU_BOT_WEBHOOK_PRD` 分流）。
- 待配置两步：
  1. **GitHub 侧**：仓库 Settings → Webhooks → Add webhook → `https://hub.newenergycoder.club/api/hooks/github`，Content type 选 `application/json`，secret 用 `GITHUB_WEBHOOK_SECRET` 的值（已写入 CF secret）。
  2. **飞书群机器人**：战队群 → 群设置 → 群机器人 → 添加「自定义机器人」→ 把 webhook 地址写入 `FEISHU_BOT_WEBHOOK` secret（加签 secret 写 `FEISHU_BOT_WEBHOOK_SECRET`）。未配置时推送静默跳过，失败留痕 `notify:failed`。

## 登录态与角色（FE-01）

- 门户"飞书登录"走标准 OAuth：跳飞书授权 → 回调 `/?code=...` → `/auth/feishu` 兑换并种下 `nec_session`（HttpOnly，7 天，剩余不足一半时原地滑动续期）。
- 角色取自多维表格"队员名单"表（`config_dashboard` 配置的 members 表）：按 open_id / 姓名匹配，读"角色/组别"字段；未匹配到 → `external`（仅公开区）；表不可用时兜底为"队员"。角色解析结果 KV 缓存 60 秒（负结果不缓存，移除队员后下一次请求即失效）。
- **手动配置一步**：飞书开放平台 → 自建应用 → 安全设置 → 重定向 URL，需加入 `https://hub.newenergycoder.club/`（门户登录回调用，与 MES 的 `mes.newenergycoder.club` 并列），否则登录跳转后回调报错。

## Skill 同步脚本

`scripts/sync-gitee-skills.py` — 从 Gitee 仓库的 `skills/*/SKILL.md` 批量解析 frontmatter 描述，通过 `import_skills` 登记到 Skill 中心（默认来源标识 `gitee`，门户中显示 ⤤ 外链）。

```bash
python scripts/sync-gitee-skills.py                 # 预览（不写 hub）
python scripts/sync-gitee-skills.py --confirm       # 实际导入
python scripts/sync-gitee-skills.py --repo owner/name --branch SKill --dir skills --hub https://hub.newenergycoder.club
```

## 已配置的生产资源

- 自定义域名：`hub.newenergycoder.club`（custom domain，自动签发证书）
- Secrets：`FEISHU_APP_ID` / `FEISHU_APP_SECRET`（免登后端）· `VERCEL_TOKEN`（sync_vercel）· `MCP_TOKEN`（MCP 写保护 + finance 门禁，2026-10-12 生产实测已生效）

## 待办（第二/三阶段）

> 完整需求、优先级与验收标准见 `docs/团队AI中台PRD_V2.0.md`（M1 地基 → M2 资产与智能 → M3 个性化与自动化）。

- [x] 飞书 OAuth 登录 + 权限角色（FE-01：会话 Cookie 滑动续期、`/api/whoami`、`/api/apps` 按角色过滤、看板与 `query_bitable` 财务区按角色脱敏；已部署生产，真实登录待名单表录入后验证）
- [x] `query_bitable` 接入飞书多维表格 API（含 `config_dashboard` 配置工具与 `/api/dashboard` 聚合接口，财务区按角色脱敏）
- [x] **FE-02 数据基建落地（2026-10-12）**：base `PsXnbEG2naCGdCsMuhDcQu3bn7d`（飞书云文档「NEC 战队数据中台」），4 张标准表已由 `setup_bitable` 建成——members `tblVBn3EE4RyfWHi` / tasks `tblXQgCriKe3KW22` / inventory `tblsfQanKxg6F740` / finance `tblaP0OEzTCSatxh`。应用权限：`bitable:app` + `bitable:app:readonly`（已开通）；重定向 URL 含 `https://hub.newenergycoder.club/`。看板/查询/校验已读真实数据。待团队录入数据：base 里默认的「数据表1」可删；队员名单需填 姓名/飞书ID/组别/权限角色 后登录角色判定才生效
- [x] FE-03 资料页（第六 Tab + `publish_doc` / `remove_docs` MCP 工具 + `/api/docs`；内容填充为团队任务，每类 ≥3 条）
- [x] FE-05 数据校验 Agent（`validate_bitable` 规则引擎 + `/api/validate` + 门户「数据健康」卡片；规则可 KV 覆盖，周一自动推送待配 `FEISHU_WEBHOOK` 后启用）
- [ ] 飞书工作台入口配置（管理后台将工作台指向本域名）
- [ ] `wrangler types` 生成权威 Env 类型（当前为手写最小接口）
- [ ] 部署 `serveApp` 中文路径修复（`4be5456` 已提交未部署；部署后清理 R2 孤儿对象 `apps/kv-assets/assets/` 下 6 个中文名 PNG）
- [ ] Skill 仓库 CI 校验 frontmatter（Gitee 同步脚本已就位，见 `scripts/sync-gitee-skills.py`）
