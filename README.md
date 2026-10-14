# nec-hub — NEC 团队 AI 中台

单体 Cloudflare Worker：门户 + 飞书 OAuth 登录 + API + MCP 端点 + 应用托管（R2）+ 注册表（KV）。

- 生产门户：<https://hub.newenergycoder.club>
- MCP 端点（Agent 接入）：`https://hub.newenergycoder.club/mcp`（streamable HTTP / JSON-RPC，写操作需 `Authorization: Bearer <MCP_TOKEN>`）
- 源码：GitHub [new-energy-coder-club/nec-hub](https://github.com/new-energy-coder-club/nec-hub) · Gitee 镜像 [darrenpig/nec-hub](https://gitee.com/darrenpig/nec-hub)

## 线上内容（截至 2026-10-14）

门户共 8 个 Tab：我的首页 / 图纸评审（配置后显示）/ 应用广场 / Skill 中心 / 资料页 / 开源仓库 / 数据看板 / NEC-MCP。

应用广场 12 个应用（实时列表见 [`GET /api/apps`](https://hub.newenergycoder.club/api/apps)）：

| 应用 | 说明 | 链接 |
|---|---|---|
| 擎天塔重建 // NEON PROTOCOL | 战队年度项目门户 | <https://tower.newenergycoder.club> |
| NEC 仓库作业台 | MES 仓储系统（电控组，飞书免登） | <https://mes.newenergycoder.club> |
| 物资盘点助手 | R2 自托管小工具 | [/apps/inventory-check/](https://hub.newenergycoder.club/apps/inventory-check/) |
| KV Assets | 主视觉资产库（KV 画廊 + 飞书宣传栏 + PNG 物料） | [/apps/kv-assets/](https://hub.newenergycoder.club/apps/kv-assets/) |
| 常州工NEC · 新人招募海报 | 招募静态页 | [/apps/recruit-poster/](https://hub.newenergycoder.club/apps/recruit-poster/) |
| solarglyph26.07 / newenergycoder-club / gexo-website / public-beta-calculator / r2-web / fluid-workstation-ui / fibersteelstudio | Vercel 项目，`sync_vercel` 自动登记 | 见 `/api/apps` |

Skill 中心 21 个（实时列表见 [`GET /api/skills`](https://hub.newenergycoder.club/api/skills)）：

- 中台自托管 4 个：nec-tech-report（技术方案报告）· [nec-kv-design](https://hub.newenergycoder.club/skills/nec-kv-design/SKILL.md)（主视觉设计系统）· nec-vi（VI 规范）· nec-ppt（PPT 模板）
- Gitee 同步 17 个：**仅 NEC 原创**（白名单 [`scripts/nec-skills-allowlist.txt`](scripts/nec-skills-allowlist.txt)，第三方/镜像一律不导入），源仓库 [darrenpig/new_energy_coder_club](https://gitee.com/darrenpig/new_energy_coder_club) `SKill` 分支，经 `scripts/sync-gitee-skills.py` 登记（`source: "gitee"`，门户显示 ⤤ 外链）

## 代码结构

`src/index.ts` 为纯路由表（~160 行），业务按域拆分，公共层沉淀在 `src/shared/`（session、http、feishu-table-adapter、module-config、module-gateway、meeting.service）：

```
src/
├── index.ts            # 纯路由表 + scheduled() Cron 分发
├── auth/               # 飞书 OAuth、会话、角色解析
├── home/               # FE-06/07 个人首页布局（个人 > 组 > 默认三级覆盖）
├── todos.ts            # FE-09 审批/待办聚合
├── validation/         # FE-05 数据校验（声明式规则 + 每周一群机器人摘要推送）
├── dashboard.ts        # 数据看板聚合（KV 5 分钟缓存）
├── repos.ts            # GitHub + Gitee 开源仓库合并（KV 1 小时缓存）
├── reimburse.ts        # 报销提交（发票号 + OCR 识别）
├── hosting.ts          # /apps/ /skills/ 静态托管（R2 + Cache API 边缘缓存）
├── drawing-review/     # 图纸评审：flow/board/bom/inquiry/suggestion(联想) 服务
├── hardware-review/    # 硬件评审流程
├── contract-approval/  # 合同审批流程
├── feishu/             # 飞书多维表格客户端（token 实例缓存 + in-flight 去重）
├── mcp/                # MCP 端点：handler / tools / implementations / module-config-tools
└── __tests__/          # vitest 测试（各域另有就近 __tests__）
```

性能：飞书 token 实例内存缓存 + in-flight 去重；R2 托管应用/SKILL.md 接 Cache API 边缘缓存，部署/上架时按 URL 主动失效；看板/仓库/角色/会话的 KV 写全部走 `ctx.waitUntil` 不阻塞响应；角色解析复用看板 members 表缓存，消除重复飞书拉取。

## 功能模块

- **登录与权限**：飞书 OAuth 登录（`/auth/feishu` → 签发 HttpOnly 会话 Cookie），角色由队员名单表解析（队长/财务可见财务明细，队员见汇总，未登录隐藏）；MES 免登复用同一兑换端点。
- **个人首页（FE-06/07）**：`/api/home` 千人千面布局（个人 > 组 > 全员默认三级回退），白名单组件（我的应用/我的任务/我的报销/常用资料/赛季目标/物资查询），MCP `set_home_layout` 可让 Agent 按自然语言配置；`/api/todos` 聚合审批与待办（FE-09）。
- **数据看板**：`/api/dashboard` 聚合飞书多维表格（队员/任务/物资/财务），KV 5 分钟缓存，财务区按登录角色脱敏；配置手册见 `docs/数据看板配置手册.md`。
- **目标回写（FE-04）**：MCP `update_progress` 回写赛季目标表完成度/状态，写后自动清看板缓存。
- **数据校验（FE-05）**：`/api/validate*` + MCP `validate_bitable` / `config_validate_rules`，校验看板 4 张底表脏数据（声明式 JSON 规则存 KV，新增规则无需改代码），每周一 08:00 cron 自动全量校验并推送群机器人摘要。
- **报销提交**：`POST /api/reimburse`（multipart/form-data，需登录），门户数据看板内直接提交报销单；支持发票号字段与发票 OCR 识别（含 PDF）。
- **图纸评审**：`src/drawing-review/` 模块 + 门户「图纸评审」Tab + 静态页 `public/apps/drawing-review/`，对接飞书多维表格（评审单/纪要/整改项/BOM/事件日志）；含列表/看板双视图（`/api/drawing-review/board`）与联想功能（`/api/drawing-review/suggestions`）；PRD 与设计文档见 `docs/新增机图纸评审流程_*.md`，联想功能全套文档见 `docs/文档目录索引.md`。
- **硬件评审**：`src/hardware-review/` + `/api/hardware-review/*`（提交/列表/发起），MCP `config_hardware_review` 配置底表。
- **合同审批**：`src/contract-approval/` + `/api/contract-approval/*`（提交/列表/发起），MCP `config_contract_approval` 配置底表。
- **资料页**：品牌规范 / 文档模板 / 制度 SOP / 培训材料的登记与展示（`GET /api/docs` + `publish_doc` 工具）。
- **开源仓库**：`/api/repos` 合并 GitHub org `new-energy-coder-club` 与 Gitee `darrenpig`，含 Star/Fork/Commit，KV 1 小时缓存（可选 `GITHUB_TOKEN` / `GITEE_TOKEN` 提额）。

## 相关仓库与文档

- Skill 源仓库（Gitee）：<https://gitee.com/darrenpig/new_energy_coder_club>（`SKill` 分支，`skills/*/SKILL.md`）
- 开源组织（GitHub）：<https://github.com/new-energy-coder-club>
- 需求与规划：[`docs/团队AI中台PRD_V2.0.md`](docs/团队AI中台PRD_V2.0.md) · [`docs/团队AI中台搭建方案_V1.0.md`](docs/团队AI中台搭建方案_V1.0.md)
- 图纸评审：[`docs/新增机图纸评审流程_PRD.md`](docs/新增机图纸评审流程_PRD.md) · [`docs/新增机图纸评审流程_设计文档.md`](docs/新增机图纸评审流程_设计文档.md) · [`docs/新增机图纸评审流程_方案C混合架构设计.md`](docs/新增机图纸评审流程_方案C混合架构设计.md) · [`docs/图纸评审流程对比分析.md`](docs/图纸评审流程对比分析.md)
- 联想功能文档体系：[`docs/文档目录索引.md`](docs/文档目录索引.md)（README/快速开始/架构/API 参考/部署/运维/FAQ/用户手册共 13 篇，`node scripts/validate-docs.js` 质检）
- 飞书接入：[`docs/飞书免登接入_MES.md`](docs/飞书免登接入_MES.md) · 接入包 [`integrations/mes/feishu-sso.js`](integrations/mes/feishu-sso.js) · [`docs/飞书工作台上架手册_NEC仓库作业台.md`](docs/飞书工作台上架手册_NEC仓库作业台.md) · [`docs/飞书定制工作台配置手册.md`](docs/飞书定制工作台配置手册.md)

## 本地开发

```bash
npm install
npm run dev        # wrangler dev --local --port 8787
npm run check      # tsc --noEmit 类型检查
npm run types      # wrangler types 重新生成 worker-configuration.d.ts
npm test           # vitest 单元/集成测试（test:coverage 出覆盖率）
```

打开 http://localhost:8787 即为门户。本地模式下 KV/R2 走 Miniflare 本地模拟，无需 Cloudflare 账号。

## 部署

CI/CD（`.github/workflows/ci-cd.yml`）：PR 跑类型检查；push 到 `main` 自动 `wrangler deploy`（需仓库 secret `CLOUDFLARE_API_TOKEN`）。也可手动一键部署：

```bash
./scripts/deploy-hub.sh   # 创建 KV/R2 → 回填 wrangler.jsonc → wrangler deploy → 健康检查
```

Cron（`wrangler.jsonc` triggers，3 条）：`*/4 * * * *` 预热看板缓存 · `23 * * * *` 每小时预热开源仓库缓存 · `0 0 * * 1`（周一 08:00 UTC+8）数据校验周报 + 群机器人推送。

## 路由

| 路径 | 说明 |
|---|---|
| `GET /` | 门户（8 个 Tab：我的首页 / 图纸评审 / 应用广场 / Skill 中心 / 资料页 / 开源仓库 / 数据看板 / NEC-MCP） |
| `POST /mcp` | MCP streamable HTTP 端点（JSON-RPC；写操作需 `MCP_TOKEN`） |
| `POST /auth/feishu` · `POST /auth/logout` · `GET /api/whoami` | 飞书 OAuth 登录 / 登出 / 当前用户与角色 |
| `GET /api/config` | 公开配置（飞书 App ID、登录是否启用） |
| `GET /api/health` | 健康检查 |
| `GET /api/apps` · `/api/skills` · `/api/docs` | 应用 / Skill / 资料页注册表 |
| `GET /api/repos` | NEC 开源仓库列表（GitHub + Gitee 合并，KV 1 小时缓存） |
| `GET /api/dashboard` | 数据看板聚合（KV 5 分钟缓存；财务区按登录角色脱敏） |
| `GET/POST /api/home` · `POST /api/home/reset` | 个人首页布局（需登录；个人 > 组 > 默认三级覆盖） |
| `GET /api/todos` | 审批/待办聚合（需登录） |
| `GET /api/validate` · `/api/validate/report` · `POST /api/validate/run` | 数据校验查询 / 最新报告 / 手动触发（FE-05） |
| `POST /api/reimburse` | 报销提交（multipart/form-data，需登录；发票号 + OCR） |
| `/api/drawing-review/*` | 图纸评审（`config` 无需登录；列表/提交/看板/联想需登录） |
| `/api/hardware-review/*` | 硬件评审流程（提交/列表/发起，需登录） |
| `/api/contract-approval/*` | 合同审批流程（提交/列表/发起，需登录） |
| `GET /apps/<name>/` | 队员应用（R2，Cache API 边缘缓存） |
| `GET /skills/<name>/SKILL.md` | Skill 原文 |

## MCP 工具（16 个）

| 工具 | 说明 |
|---|---|
| `deploy_app` | 上传静态文件到 R2 并注册到应用广场（`/apps/<name>/`） |
| `register_app` | 外部已部署应用（如 Vercel 项目）链接登记 |
| `sync_vercel` | 自动发现 Vercel 团队项目并批量登记（默认 dry-run，`confirm=true` 写入；需 `VERCEL_TOKEN`） |
| `publish_skill` | 上架 SKILL.md 到 Skill 中心（中台自托管，`source: "hub"`） |
| `import_skills` | 批量登记外部 Skill（只存名称/描述/链接）；不覆盖中台自托管的 Skill |
| `remove_skills` | 按名称批量下架 Skill（安全约束：只能删外部登记来源，自托管不受影响） |
| `query_bitable` | 只读查询飞书多维表格；finance 表需管理端（MCP_TOKEN）或有效 user_token（角色为队长/财务） |
| `config_dashboard` | 配置/查看数据看板对接的多维表格（app_token + 各表 table_id） |
| `config_drawing_review` | 配置/查看图纸评审流程对接的多维表格（reviews/minutes/rectifications/bom/events 等 10 张表） |
| `config_hardware_review` | 配置/查看硬件评审流程对接的多维表格（reviews/minutes/rectifications/reports/events） |
| `config_contract_approval` | 配置/查看合同审批流程对接的多维表格（approvals/comments/events） |
| `update_progress` | 回写赛季目标表完成度%/状态/备注（FE-04；唯一匹配才写入，写后自动清看板缓存） |
| `validate_bitable` | 校验看板 4 张底表脏数据，输出按类型分组的异常清单（FE-05；scope=mine/all） |
| `config_validate_rules` | 查看/整体替换/恢复数据校验规则集（声明式 JSON 存 KV，新增规则无需改代码） |
| `set_home_layout` | 配置个人首页布局（FE-06/07；scope=user 本人 / scope=group 组别默认，需组长/队长） |
| `publish_doc` | 发布/更新资料页条目（brand / template / sop / training 四类） |

## Skill 同步脚本

`scripts/sync-gitee-skills.py` — 从 Gitee 仓库的 `skills/*/SKILL.md` 批量解析 frontmatter 描述，按白名单 `scripts/nec-skills-allowlist.txt` 过滤后通过 `import_skills` 登记到 Skill 中心（默认来源标识 `gitee`，门户中显示 ⤤ 外链）。

```bash
python scripts/sync-gitee-skills.py                 # 预览（不写 hub）
python scripts/sync-gitee-skills.py --confirm       # 实际导入
python scripts/sync-gitee-skills.py --repo owner/name --branch SKill --dir skills --hub https://hub.newenergycoder.club
```

## 已配置的生产资源

- 自定义域名：`hub.newenergycoder.club`（custom domain，自动签发证书）
- Secrets：`FEISHU_APP_ID` / `FEISHU_APP_SECRET`（OAuth 登录 + MES 免登）· `MCP_TOKEN`（MCP 写保护，已启用）· `VERCEL_TOKEN`（sync_vercel）
- 可选：`GITHUB_TOKEN` / `GITEE_TOKEN`（`/api/repos` 提额）

## 待办（第二/三阶段）

> 完整需求、优先级与验收标准见 `docs/团队AI中台PRD_V2.0.md`（M1 地基 → M2 资产与智能 → M3 个性化与自动化）。

- [x] 飞书 OAuth 登录 + 权限角色（FE-01：会话 Cookie + 队员名单表角色解析，财务区按角色脱敏）
- [x] `query_bitable` 接入飞书多维表格 API（含 `config_dashboard` 配置工具与 `/api/dashboard` 聚合接口）
- [x] `wrangler types` 生成权威 Env 类型（`worker-configuration.d.ts`，`npm run types` 重新生成）
- [x] `serveApp` 中文路径修复部署（`4be5456`）；遗留：清理 R2 孤儿对象 `apps/kv-assets/assets/` 下 6 个中文名 PNG
- [x] Skill 中心治理：仅保留 NEC 原创（白名单 + `remove_skills`）
- [x] 单体按域拆分重构（`1df02d8`：index.ts 2161 行 → ~160 行纯路由表，公共层沉淀 `src/shared/`）
- [x] FE-04 赛季目标回写（`update_progress`）· FE-05 数据校验（声明式规则 + 每周一群推送）· FE-06/07 个人首页布局 · FE-09 审批/待办聚合
- [x] 边缘缓存/Cron 预热性能优化（Cache API + `ctx.waitUntil` + token in-flight 去重）
- [x] 图纸评审联想功能 + 全套文档体系（`docs/文档目录索引.md`，`dd12d14`）
- [ ] 图纸评审流程完整闭环（当前为基础接入：配置 + 提交 + 列表 + 看板 + 联想；评审流/整改/BOM/会议纪要服务已就位待联调）
- [ ] 硬件评审 / 合同审批流程与前端页面联调（后端服务与配置工具已就位）
- [ ] 飞书工作台入口配置（管理后台将工作台指向本域名）
- [ ] Skill 仓库 CI 校验 frontmatter（Gitee 同步脚本已就位，见 `scripts/sync-gitee-skills.py`）
