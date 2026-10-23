# NEC 中台租户迁移 PRD — 从常州工 NEC 飞书企业并入天合同创企业 V1.0

> 版本：V1.0
> 日期：2026-10-23
> 状态：草稿，待队长与天合侧接口人评审后排期
> 前置文档：《README.md》（绑定资源总表）、《PRD_审批与通知中心_V1.1.md》、《新增机图纸评审流程_设计文档.md》、《协议签署OA_飞书后台配置手册.md》、《飞书邮箱通道_配置手册.md》、《飞书定制工作台配置手册.md》、《飞书免登接入_MES.md》、《lark-cli能力边界验证报告.md》
> 方法论来源：本地 Skill《feishu-multi-tenant》（SolarGlyph 项目实测通过的飞书多企业接入流程，含天合 TrinaCLI `cli_aaf3` 实测经验）

---

## 0. 可行性结论（2026-10-23 全仓库盘点）

> 图例：✅ 无障碍 ｜ 🔄 有标准解法 ｜ ⚠️ 有坑需预案 ｜ ❌ 阻塞

**一句话结论：技术上高度可行，代码几乎零改动；工作量集中在飞书侧重建（自建应用 + 约 19 张多维表格 + 6 组群机器人）与 open_id 失效后的用户态重建。唯一非技术阻塞点是天合企业内的开发者权限与版本发布审批。**

| 层 | 难度 | 结论 |
|---|---|---|
| 代码 | ✅ 几乎零改动 | 真实 app_id / open_id / chat_id / app_token 全部走 secrets 与 KV 配置，代码内只有占位符；前端 OAuth redirect_uri 用 `location.origin` 动态拼接（`web/src/shared/auth.ts:139`），app_id 由 `/api/config` 下发（`src/index.ts:157-160`） |
| Cloudflare 资源 | ✅ 无需动 | KV `REGISTRY`、R2 `nec-hub-apps`、D1 `nec-hub-erp`、域名 `hub.newenergycoder.club` + 泛域名（`wrangler.jsonc:14-47`）与飞书租户完全解耦，沿用现有 CF 账户 |
| 飞书自建应用 | 🔄 标准重建 | 铁律：自建应用不能跨企业授权，必须在天合企业下新建（或复用已有 TrinaCLI 应用追加 scope） |
| 数据资产 | 🔄 主要工作量 | 约 19 张底表在原租户：看板 5 + 审批 4 + 图纸评审 10；`setup_bitable` 可一键重建标准 4 表，图纸评审 10 表 schema 在设计文档中齐全 |
| 用户态（open_id） | ⚠️ 全量失效 | open_id 按「租户 + 应用」变化，KV 用户态键、D1 payees、domains owner、CLA 绑定全部失效；**不建议做映射迁移**，全员重登录成本最低 |
| 域名体系 | ✅ 保留 | `newenergycoder.club` 域名归团队 CF 账户所有，与飞书租户无关；若天合要求换域名为可选项（约 315 处引用需批量替换，见 §7.2） |

## 1. 背景与问题

NEC 中台（`hub.newenergycoder.club`，Cloudflare Workers 单体）当前深度绑定常州工学院 NEC 团队的飞书企业租户：OAuth 登录、角色权限（队员名单表）、数据看板、四条审批流、图纸评审、合同审批、群机器人通知、邮件通道，全部建立在原租户的自建应用与多维表格之上。

并入天合同创企业后，若中台继续在原租户运行，将面临：原企业组织架构变动导致队员名单表维护断档、新成员（天合侧）无法登录授权、通知群与审批人脱离实际组织。因此需要把飞书侧依赖整体迁移到天合企业租户，Cloudflare 计算与存储资源保持不变。

**为什么现在写 PRD**：迁移涉及 5 类配置面（secrets / KV / 多维表格 / 群机器人 / 飞书后台）与 19 张底表的数据搬运，任何一环遗漏都会表现为生产故障；且存在不可逆步骤（open_id 全量失效），必须先有清单化方案与回滚预案。

## 2. 目标与成功指标

**产品目标**：中台全部功能（登录 / 看板 / 审批 / 图纸评审 / 通知 / 邮件 / MCP 工具）在天合租户下端到端可用；原租户数据以历史留痕方式保留可查，不做在线双写。

| 指标 | 定义 | 目标值 | 测量方式 |
|---|---|---|---|
| 功能恢复率 | §8 验收用例通过数 / 总用例数 | 100%（阻断级用例） | 验收走查表 |
| 数据迁移完整率 | 新底表记录数 / 旧底表有效记录数（分表） | ≥ 99%，差异逐条可解释 | 迁移对账脚本（行数 + 关键字段抽查） |
| 核心链路时延 | 提交审批 → 群通知送达 | P95 ≤ 2 分钟 | 与原有一致 |
| 用户重登成本 | 队员从收到通知到恢复使用的中位耗时 | ≤ 5 分钟（仅扫码登录 + 邮箱重授权） | 迁移日后台 session 建立日志 |
| 代码改动量 | 迁移所需代码 commit | 0 个功能改动（仅配置/文档；校验放宽除外，见 §5.4） | git log |
| 回滚可用性 | 任一阶段失败可回到上一稳定状态 | 每个阶段有回滚动作且演练过 | §9 回滚方案 |

## 3. 角色与职责

| 角色 | 承担方 | 职责 |
|---|---|---|
| 迁移负责人 | 队长 / 中台维护人 | 总排期、secrets 换值、KV 重灌、部署与验收 |
| 天合侧应用管理员 | 天合企业内有开发者权限的账号 | 建/改自建应用、开通 bot scope、提交版本发布 |
| 天合企业管理员 | 天合 IT | 审批应用版本发布、审批 scope（如审批 API、邮箱） |
| 数据迁移执行 | 中台开发 | 旧表导出 → 新表建表 → 灌入 → 对账 |
| 接口人 | 天合侧 | 拉 6 个通知群、配置群机器人、确认审批人名单 |
| 全体队员 | 两租户成员 | 迁移日后重新登录、重新授权邮箱 |

## 4. 迁移范围

### 4.1 范围内（必须迁移）

| 类别 | 内容 | 当前引用位置 |
|---|---|---|
| 应用凭证 | `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | `src/index.ts:58-60`；消费方 `src/auth/feishu-auth.ts:65,187`、`src/feishu/bitable.ts:19` |
| 群机器人 | 主群 + 按流程分流（PRD/REIMBURSE/DRAWING/HARDWARE/COMPLIANCE/DOMAINS/WEEKLY_REPORT）共 6+ 组 `FEISHU_*_WEBHOOK[_SECRET]` | `src/index.ts:72-94`、`src/feishu/bot.ts:64-71` |
| 看板底表 5 张 | members / tasks / inventory / finance / goals | `src/dashboard/index.ts:26-36`（KV `dashboard:config`） |
| 审批底表 4 张 | reimburse / drawing / hardware / compliance | KV `flows:config`（`src/approvals/flows.ts:16-117`） |
| 图纸评审 10 张 | reviews / minutes / rectifications / bom / assessments / inventory / delivery / schedule / inquiries / events | `src/drawing-review/`（KV `drawing-review:config`） |
| 硬件评审 / 合同审批底表 | 各域 config | `src/hardware-review/config.ts`、`src/contract-approval/` |
| 飞书后台配置 | 重定向 URL（`hub.newenergycoder.club` 及泛域名各应用域）、安全域、scope（bitable / 审批 / 任务 / 日历 / 邮箱）、（可选）审批事件订阅回调 `/api/approvals/events` | 各配置手册（见前置文档） |
| 队员名单表 | 新租户全员 open_id / 姓名 / 角色 / 组别（**权限唯一事实源**，`src/auth/role.ts:64-118`） | dashboard members 表 |

### 4.2 范围内（作废旧数据，重新生成）

- KV 用户态：`session:*`、`feishu:user_token:<open_id>`、`role:<open_id>`、`home:<open_id>`、`my-tasks:<open_id>`、`todos:<open_id>`、`oauth:state:*`、`cla:oid:<open_id>`、`user-prefs:hw:*` — 全部以旧 open_id 为键，换租户后自然失效，**无需清理**（键永不再被命中，随 TTL 过期）
- D1 `payees` 表（`src/erp/reimburse.ts:183`）：按新 open_id 重建收款账户映射；历史单据快照 `reimburse_docs` 只读保留
- `domains:index` / `domains:rec:*` 的 owner open_id：接受历史留痕，新申请记录用新 open_id

### 4.3 范围外（不动）

- Cloudflare：KV / R2 / D1 / 域名路由 / Workers subdomain 全部不变；R2 内 `apps/`、`skills/`、`receipts/` 附件原样可用
- 单号计数器（KV `BX/MECH/HW/CP` 序列、`contract-no:<year>`）：为保持单号延续性**迁入时手工置数**，不重置
- 纯缓存键（`dashboard:cache:*`、`feishu:tenant_access_token` 等）：自动重建
- 域名 `newenergycoder.club`：不换（除非天合要求，见 §7.2 可选项）

## 5. 详细迁移方案

### 5.1 阶段一：飞书侧应用与权限（阻塞项，最先启动）

1. **决策：新建 vs 复用**。优先评估复用天合已有自建应用（TrinaCLI `cli_aaf3`）追加 scope——省一轮管理员审批；若该应用用途不宜混用，则新建「NEC 中台」自建应用。
2. 开通 scope 清单（bot/tenant 身份，⚠️ user 授权 ≠ bot 授权）：
   - 多维表格：`bitable:app`、`base:record:read`、`base:record:write`、`base:field:read`
   - 审批待办：`/approval/v4/instances/search` 所需审批 scope（`src/todos.ts:216`）
   - 日历 v4（`src/meeting/index.ts`）、任务 v2（`src/my-tasks/`）、邮箱（N-02 邮件通道，`mail:user_mailbox.message:send` 等）
3. 配置重定向 URL 与安全域：`https://hub.newenergycoder.club` + `*.newenergycoder.club`。
4. （可选）审批事件订阅回调：`https://hub.newenergycoder.club/api/approvals/events`。
5. **加 scope 后必须重新发布版本并等企业管理员审批**（已知坑：不发布不生效）。

### 5.2 阶段二：数据资产迁移

1. **建表**：新租户新建空白多维表格 Base → 用 MCP `setup_bitable` 一键建标准 4 表（members/tasks/inventory/finance）→ goals 表按 `docs/团队AI中台PRD_V2.1.md:154` schema 补建 → 图纸评审 10 表按《新增机图纸评审流程_设计文档.md》§表结构逐张建 → 审批 4 底表按 `flows:config` 字段清单建。
2. **导出**：lark-cli / bitable API 从旧租户 19 张表全量导出（JSON/CSV）。
3. **灌入**：lark-cli `base +record-list` / 批量写入脚本灌入新表（`docs/lark-cli能力边界验证报告.md` 已验证 lark-cli 可自动化建 Base/建表/灌数据）。
4. **open_id 字段处理**：历史记录中的申请人/审批人 open_id 指向旧租户，无法在新租户解析——**接受为历史留痕**；members 表全员 open_id 必须替换为新租户值（队员各自登录一次即可自助补全，或由管理员按姓名批量回填）。
5. **对账**：分表行数比对 + 关键字段抽查（单号、金额、状态），差异清单逐条销号。

### 5.3 阶段三：配置切换（切换窗口内完成）

1. `wrangler secret put` 更新：`FEISHU_APP_ID` / `FEISHU_APP_SECRET` / 6+ 组 webhook 及加签 secret。
2. 用现有 MCP 工具重灌 KV 配置（零脚本）：`config_dashboard` → 新 5 表；`config_flows` → 新 4 底表；`config_drawing_review` / `config_hardware_review` / `config_contract_approval` → 各域新表。
3. 单号计数器手工置数为旧租户当前值（保证单号连续）。
4. 重新部署（`scripts/deploy-hub.sh`），灰度验证（见 §8）。

### 5.4 代码侧预案（唯一可能需要的代码改动）

- `src/shared/module-config.ts:61` 的 app_token 校验正则是 `basc[a-z0-9]+`，而新版 Base ID（如旧图纸评审 Base `OFZqbJHteaYRpssam7Nc4fTYnLc`）不以 `basc` 开头。若新租户建表产出新版 ID，需把校验放宽为通用 token 格式。**迁移前先在测试配置中验证，命中则提一个放宽校验的小 commit**。

### 5.5 用户侧切换（迁移日）

1. 全员收到迁移通知（原租户群 + 天合群双发）。
2. 打开 `hub.newenergycoder.club` → 扫码登录（新租户 OAuth）→ 自动建立新 session。
3. 需要邮件通道的账号重新授权邮箱 scope；MCP 管理端（队长/财务）重新绑定。
4. 首页布局、个人偏好等按新 open_id 重建（默认布局兜底，无感）。

## 6. 通知群与机器人重建清单

| 群 | 用途 | 环境变量 |
|---|---|---|
| 主群「NEC 中台通知」 | 校验摘要 + 兜底通知 | `FEISHU_WEBHOOK_URL/SECRET` |
| 报销群 | 报销四类通知 | `FEISHU_BOT_WEBHOOK_REIMBURSE[_SECRET]` |
| 图纸评审群 | 评审/告警 | `FEISHU_BOT_WEBHOOK_DRAWING[_SECRET]` |
| 硬件群 | 硬件评审通知 | `FEISHU_BOT_WEBHOOK_HARDWARE[_SECRET]` |
| 合规群 | 合规审批通知 | `FEISHU_BOT_WEBHOOK_COMPLIANCE[_SECRET]` |
| 域名/PRD/周报群 | 分流通知 | `FEISHU_BOT_WEBHOOK_{DOMAINS,PRD,WEEKLY_REPORT}[_SECRET]` |

每组机器人在天合侧新建后记录 webhook + 加签 secret（加签算法 string_to_sign 作 HMAC 密钥，见 V1.1 §0 N-01 修复记录）。

## 7. 风险与预案

| 风险 | 等级 | 预案 |
|---|---|---|
| 拿不到天合开发者权限 / 版本发布审批慢 | 🔴 阻塞 | 项目启动前先确认接口人；这是唯一非技术前置，未确认不排期 |
| scope 加完未发布版本导致 99991672 | 🟡 高概率 | 已知坑，流程内置「发布版本」检查点；报错体会带直达申请链接，按 feishu-multi-tenant Skill §4 处理 |
| app_token 新版格式被 `basc` 校验拦截 | 🟡 已识别 | §5.4 预案，前置验证 |
| 数据导出遗漏（19 张表 + 附件引用） | 🟡 | 按 §5.2 清单逐项打勾 + 对账脚本；R2 附件不动所以无附件迁移问题 |
| 历史 open_id 留痕导致旧单据无法按人筛选 | 🟢 接受 | 文档明示；members 表新 open_id 补全后仅影响历史数据展示 |
| 切换窗口内用户提交的单据落旧表 | 🟡 | 切换前公告冻结期（建议非工作日 2 小时窗口）；切换后旧表设只读 |
| 天合要求换域名 | 🟢 可选 | 见 §7.2；不换则零影响 |

### 7.2 可选项：域名更换（仅当天合要求时）

约 315 处 `newenergycoder.club` 引用，其中硬编码需改的：CORS 白名单（`src/auth/feishu-auth.ts:13-26`）、通知链接（`src/reports/weekly.ts:392` 等 6 处）、`src/domains/service.ts:20` 根域默认、前端 3 处展示文案、`integrations/mes/feishu-sso.js:9`。其余为文档。工作量约半天，**建议本期不做**。

## 8. 验收用例（阻断级）

| # | 用例 | 通过标准 |
|---|---|---|
| AC-1 | 新租户扫码登录 | 队员扫码 → session 建立 → 角色正确识别（members 表命中） |
| AC-2 | 看板数据 | 门户看板 4 表数据与新底表一致 |
| AC-3 | 报销全链路 | 提交 → 校验 → 写新表 → 单号延续 → 群通知送达 → 审批 → 状态回写 |
| AC-4 | 图纸评审全链路 | 提交 → 组长评审 → 整改 → 群通知 |
| AC-5 | 通知分流通达 | 6 个群各自收到对应流程测试消息，`notify:failed` 无新增 |
| AC-6 | MCP 管理端 | `whoami` / `config_dashboard` / `submit_approval` 管理端鉴权正常 |
| AC-7 | 邮件通道 | 已授权账号 `send_mail` 实测送达（scope 99991679 不再出现） |
| AC-8 | 旧租户只读 | 旧 Base 全部表只读，历史数据可查 |
| AC-9 | vitest 全绿 | 迁移相关 commit（如有）不破坏现有测试 |
| AC-10 | 回滚演练 | 阶段三切换后 30 分钟内可按 §9 回滚且功能恢复 |

## 9. 回滚方案

按阶段独立回滚，原则：**旧租户配置在验收通过前不删不动**。

| 阶段 | 回滚动作 |
|---|---|
| 阶段一/二 | 无副作用（新租户内操作），直接废弃新建内容 |
| 阶段三 | secrets 改回旧值 + KV 配置改回旧 table_id + 重新部署 → 恢复旧租户服务（配置切换幂等，30 分钟内完成） |
| 阶段五（用户切换后） | 新产生的单据在新表，回滚需补导增量 → 因此验收通过前旧表保持可写、新表增量每日对账，验收通过后旧表只读 |

## 10. 排期与工时估算

| 阶段 | 内容 | 预估工时 | 依赖 |
|---|---|---|---|
| 0 | 确认天合侧开发者权限与接口人 | —（组织流程） | 无，**启动前提** |
| 1 | 自建应用 + scope + 版本发布 | 0.5 天 + 等审批（1–3 天） | 阶段 0 |
| 2 | 建表 + 导出 + 灌入 + 对账 | 1 天 | 阶段 1 |
| 3 | secrets / KV 切换 + 部署灰度 | 0.5 天（含公告冻结窗口） | 阶段 2 |
| 4 | 验收用例走查 + 用户切换 | 0.5 天 | 阶段 3 |

**合计：开发侧约 2.5 个工作日，日历周期约 1 周（含管理员审批等待）。**

## 11. 交付物清单

- [ ] 天合租户自建应用（app_id/secret + 全 scope + 已发布版本）
- [ ] 新 Base 19 张底表（含数据与对账报告）
- [ ] 6+ 组群机器人 webhook/secret 已配置生产
- [ ] KV 配置重灌记录（4 组 config + 单号计数器）
- [ ] 验收走查表（§8 全部通过）
- [ ] 迁移公告文案（冻结通知 / 重登录指引）
- [ ] 本文档 §0 状态刷新为「已迁移」并归档旧租户资源清单
