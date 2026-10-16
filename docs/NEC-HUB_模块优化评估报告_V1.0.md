# NEC-HUB 全模块优化评估报告 V1.1（已落地）

> 评估日期：2026-10-16
> 落地日期：2026-10-16（三期路线图全部实施完毕，验证：tsc 通过 / vitest 36 文件 442 用例全绿 / web 构建通过 / validate-docs 16/16）
> 评估范围：`src/` 全部 16 个模块 + 8 个顶层散文件 + `web/` 前端工程 + `public/` 静态产物 + `integrations/`、`migrations/`
> 评估方式：逐模块静态评审（结构、问题分级、优化建议、目标结构）

---

## 一、总览

| 模块 | 职责 | 健康度 | 最高优先级问题 |
|---|---|---|---|
| approvals + contract-approval | 通用审批引擎 / 合同会签 | 🟡 | 两套平行状态机；单号"记录数+1"并发撞号 |
| auth / shared / validation | 飞书免登 / 共享件 / 数据校验 | 🟢 | `applyRenewedSession` 死代码 64 处空转；角色正则散落 |
| cla | CLA 签署 | 🟡 | 签署接口无登录/限流，荣誉榜可被伪造污染 |
| domains | 成员自助域名分发 | 🟢 | 泛域名热路径无缓存，每请求 2 次 KV 读 |
| drawing-review | 图纸评审全流程 | 🟡 | adapter 全表扫描 N+1；报价接口无权限 |
| erp / integrations/mes / migrations | 报销 ERP 化 / MES 免登 / D1 迁移 | 🟡 | D1 单据状态永不回写，台账状态失真 |
| feishu | 飞书集成共享层 | 🟡 | **bot.ts 与 notify.ts 整文件重复且双轨在用** |
| hardware-review | 硬件评审状态机 | 🔴 | 附件强制必填却不落库（数据丢失）；config 接口免登录可写 |
| home / my-tasks / season-goals | 门户首页 / 任务绑定 / 赛季目标 | 🟡 | season-goals 采纳/拒绝接口无角色门禁 |
| mcp / meeting | MCP 服务端（30 工具）/ 拉会 | 🔴 | 未配 `MCP_TOKEN` 时全部写操作对全网开放 |
| 顶层散文件（index/dashboard/notify/prd/reimburse/repos/todos/hosting） | 路由入口与聚合 API | 🟡 | reimburse 与 approvals 双引擎；字段嗅探正则三处拷贝 |
| web/ 前端（portal + 12 子应用） | Vue3 MPA 前端 | 🟡 | 门户 Tab 与子应用双轨重复（hardware-review/contract/dr） |
| public/ 静态产物 | Worker 静态资产 | 🟡 | 构建产物入库 + `emptyOutDir:false`，hash 垃圾堆积 |

健康度：🟢 良好（小修即可）/ 🟡 中等（有明确技术债）/ 🔴 存在数据或安全缺陷

---

## 二、跨模块共性问题（按优先级）

### P0 — 安全与数据正确性

| # | 问题 | 位置 | 建议 | 工作量 |
|---|---|---|---|---|
| 1 | **MCP 未配 token 时写操作全网开放**（含 `deploy_app`、`update_progress`） | `src/mcp/handler.ts:59-68` | 未配置时仅放行只读工具 + 告警日志 | S |
| 2 | **module-gateway 的 `POST /config` 免登录可写**，任何人可重定向 base/tables 指向（hardware-review / season-goals / drawing-review 共性） | `src/shared/module-gateway.ts:50-53` | 配置写操作加管理员角色校验 | S |
| 3 | **hardware-review 附件强制必填但不落库**，读回恒为 `[]`，提交资料实际丢失 | `src/hardware-review/adapter.ts:72`、`flow.service.ts:166` | 补附件字段映射（drawing-review 同病：`adapter.ts:146`） | S |
| 4 | **单号并发撞号**：审批 `nextAppId` 与报销均用"记录数+1" | `approvals/flows.ts:154`、`reimburse.ts:140-144` | 改 KV 原子计数器（复用 `consumeNextContractNumber` 模式） | S |
| 5 | **CLA 签署无防滥用**：不登录、不限流，可无限伪造签署污染公开荣誉榜 | `src/cla/index.ts:88-126` | 要求登录会话或加 Turnstile/限流 | M |
| 6 | **season-goals 采纳/拒绝无角色门禁**，任何登录成员可审批并写目标表 | `src/season-goals/index.ts:63-72` | 网关加 `roles: /队长\|组长/` | S |
| 7 | **drawing-review 报价接口任何登录用户可模拟供应商改价**；compare 角色不匹配时降级为仅登录 | `drawing-review/index.ts:84-98` | 供应商白名单/token；取消降级 | S |
| 8 | **ERP 报销 D1 状态永不回写**，台账 status 永远是提交时刻值 | `src/erp/reimburse.ts:217`（仅有 INSERT） | 审批流转挂钩 UPDATE 或 cron 对齐 | M |
| 9 | **OAuth state 只生成不校验**（my-tasks 绑定、MES 免登），CSRF 隐患 | `my-tasks/index.ts:21-29`、`integrations/mes/feishu-sso.js:64,91-98` | state 存 KV/sessionStorage 并回调比对 | S |

### P1 — 架构收敛（消除双轨/重复）

| # | 问题 | 位置 | 建议 | 工作量 |
|---|---|---|---|---|
| 10 | **飞书通知双实现双轨在用**：`feishu/bot.ts` 与 `feishu/notify.ts` 几乎逐字重复，8 处调用混用 | `feishu/bot.ts` vs `feishu/notify.ts` | 删 notify.ts 保留 bot.ts 为唯一实现，统一全仓导入 | S |
| 11 | **报销双引擎**：`reimburse.ts` 自带状态机，与 `approvals/` 通用引擎并行 | `reimburse.ts:146-229` | 迁移至 approvals 引擎，旧文件下线或瘦身为兼容壳 | M |
| 12 | **审批双状态机**：approvals `ACTION_TARGET` 与 contract-approval `TRANSITIONS` 平行 | `approvals/engine.ts:149`、`contract-approval/flow.service.ts:18` | 抽象统一状态机核心，合同会签作为特化注册 | L |
| 13 | **门户 Tab 与子应用双轨**：HardwareReviewTab / ContractApprovalTab / dr 组件重写了 apps 已有逻辑 | `web/src/portal/` | 统一改为嵌入 `@apps/*`（复刻 ReimburseTab 模式） | L |
| 14 | **构建产物入库 + 不清理**：`emptyOutDir:false`，60+ 旧 hash 文件靠人工删 | `web/vite.config.ts:39`、`public/portal-assets/` | 产物入 `.gitignore`；deploy 脚本先 `vite build` 再 deploy | S |
| 15 | **字段嗅探正则三处拷贝**（金额/申请人/日期等），表头一改要改 N 处 | `dashboard.ts:276-502`、`todos.ts:140-143`、`reimburse.ts:88-102` | 抽 `shared/bitable-fields.ts` 注册表 | M |
| 16 | **角色正则散落各处**（`/队长/`、`/财务|队长/` 等 5+ 处，口径不一） | `auth/role.ts:24`、`approvals/engine.ts:195` 等 | `auth/role.ts` 导出统一 ROLES 常量与判断函数 | M |
| 17 | **全表扫描 N+1**：approvals / drawing-review / hardware-review / season-goals / erp 的 adapter 均全量拉取后内存过滤 | 各 `adapter.ts` | bitable filter 下推 + 按主键 KV 索引/缓存 | M |
| 18 | **`applyRenewedSession` 死代码**：`renewed` 恒为 undefined，11 文件 64 处空调用 | `shared/session.ts:48-85` | 删除字段与函数，调用点直接返回 | M |

### P2 — 工程质量

| # | 问题 | 建议 | 工作量 |
|---|---|---|---|
| 19 | `mcp/implementations.ts` 957 行上帝文件，schema/实现/switch 三处手工同步 | 按域拆分 + 工具注册表合并定义 | M |
| 20 | `dashboard.ts` `buildDashboard` 约 220 行超长函数；SEED_DOCS 混入看板 | 按表拆聚合函数；docs 逻辑独立成 `docs.ts` | M |
| 21 | 前端超长 store（hardware-review 602 行、reimburse 518 行）；草稿防抖三份复制 | 抽 `useDraft`/`useStatusMeta` composable；store 按域拆分 | M |
| 22 | 原生 alert/confirm 27 处，嵌入门户体验割裂 | 收敛到 `shared/ui` 内联提示 | S |
| 23 | CORS 反射任意 Origin；`request.json()` 多处无 try/catch 返回 500 | Origin 白名单；统一 400/`-32700` 错误 | S |
| 24 | `FEISHU_API` 常量散落 7 处；token 缓存模式两处同构；`envSecret` 小工具重复 | 收敛 `feishu/client.ts` + `cachedToken` 泛型 | S |
| 25 | 死代码清理：`domains/cloudflare.ts findDnsRecord`、`feishu/notify.ts`、`getDrawingReviewConfigWithDefaults`、meeting provider 占位分支等 | 逐个删除或接上实际用途 | S |
| 26 | 隐私：`domains` 把成员 open_id 写进 CF DNS 记录 comment | comment 只留 name | S |

---

## 三、各模块目标结构

### 1. approvals（审批引擎）

```
src/approvals/
├── index.ts            # 路由
├── core/
│   ├── state-machine.ts    # 统一状态机（合并 TRANSITIONS/ACTION_TARGET）
│   ├── notify.ts           # 通知/邮件双通道
│   └── serial.ts           # 单号 KV 原子计数
├── flows.ts / engine.ts / sla.ts / inventory.ts
├── mcp-tools.ts        # 4 个 MCP 工具从 handlers.ts 迁出
└── flows/contract/     # contract-approval 作为特化流程
```

### 2. auth / shared / validation

```
src/auth/
  feishu-auth.ts        # 拆出 token-exchange 纯函数便于测试
  handlers.ts
  role.ts               # 唯一角色权威：ROLES 常量 + hasRole()
src/shared/
  session.ts            # 移除 renewed 死代码
  http.ts               # + corsHeaders(白名单)
  bitable-fields.ts     # 新增：字段嗅探正则注册表
  module-gateway.ts     # config 写操作加管理员校验
src/validation/
  handlers.ts           # 抽公共 guard，消除 run/query 重复
```

### 3. cla

```
src/cla/
  index.ts      # 路由
  storage.ts    # KV 每签署一 key + list 聚合 + 分页
  validate.ts   # 表单校验 + 防滥用（登录/限流）
  types.ts
```

### 4. domains

```
src/domains/
├── index.ts        # 路由（retry 补飞书通知）
├── service.ts      # 校验 + 申请/释放
├── kv.ts           # 新增：KV 存取 + 缓存封装
├── cloudflare.ts   # findDnsRecord 接入 retry 路径；comment 去 open_id
├── wildcard.ts     # 泛域名直达 + 短 TTL 缓存
└── types.ts
```

### 5. drawing-review

```
src/drawing-review/
├── index.ts            # 仅路由
├── config.ts / types.ts / notify.ts
├── adapter.ts          # 加查询索引，附件字段落实
├── services/           # flow / inquiry / bom / inventory / suggestion / board
├── shared/             # event-log.ts、parse-time.ts（或上提 src/shared）
└── __tests__/
```

### 6. erp / integrations

```
src/erp/
├── index.ts            # 路由
└── reimburse/
    ├── validate.ts     # 纯函数校验/组装
    ├── store.ts        # D1 读写 + syncStatus() 状态回写
    └── handlers.ts
migrations/erp/0002_*.sql   # 冗余摘要列 + client_nonce 唯一索引
integrations/mes/feishu-sso.js  # 补 state 校验
```

### 7. feishu

```
src/feishu/
├── client.ts           # FEISHU_API 常量 + 通用 fetch + cachedToken
├── token.ts            # tenant/user token 管理合并
├── bitable.ts          # 仅 CRUD 与字段工具
├── notify.ts           # 群机器人唯一实现（吸收 bot.ts）
├── mail.ts             # 单一 buildEml
├── task.ts / member-directory.ts
```

### 8. hardware-review

```
src/hardware-review/
├── index.ts            # 仅路由表
├── flow.service.ts     # 继承 shared/review-flow-base（与 drawing-review 共提）
├── adapter.ts          # 补附件映射 + filter 查询
├── report.service.ts / types.ts / config.ts（删未用导出）
```

### 9. home / my-tasks / season-goals

```
src/home/               # 维持现状（分层最合理，可作范本）
src/my-tasks/index.ts   # 维持单文件；补 OAuth state 校验
src/season-goals/
  index.ts              # 网关补 roles 门禁
  adapter.ts            # 字段映射缓存化 + 单条记录 API
  plan.service.ts       # KR_LIMIT/默认天数入 config
```

### 10. mcp / meeting

```
src/mcp/
  handler.ts            # 入口 + 鉴权（无 token 仅只读）+ 统一 JSON-RPC 错误
  registry.ts           # 工具注册表（schema/impl/auth 同处定义）
  tools/                # apps / domains / bitable / docs / skills / mail / module-config
  lib/feishu-api.ts     # 统一飞书 fetch 封装
src/meeting/
  index.ts / parse-time.ts（含测试）
```

### 11. 顶层散文件

```
src/
├── index.ts            # 仅路由表 + cron
├── dashboard/
│   ├── index.ts        # buildDashboard 装配
│   └── aggregates.ts   # 5 表聚合函数
├── docs.ts             # SEED_DOCS + buildDocs（自 dashboard 拆出）
├── hosting.ts / notify.ts / prd.ts / repos.ts / todos.ts
└── reimburse.ts        # 下线或瘦身为 approvals 适配层
```

### 12. web/ 前端

```
web/src/
├── shared/     api/ auth/ ui/ composables/(useDraft, useStatusMeta, useRole)
├── portal/     App.vue + 薄壳 tabs/（全部 ≤50 行，import XxxApp from '@apps/xxx'）
└── apps/<name>/  main.ts App.vue store/(index, draft, …) components/
```

### 13. public/ 产物

```
public/
├── brand/ docs/ assets/    # 手写静态资源（保留入库）
├── index.html apps/ portal-assets/   # 构建产物 → .gitignore，CI 生成
scripts/deploy-hub.sh       # 改为 build → deploy 一体化
```

---

## 四、优化路线图

**第一期（P0，安全与数据正确性，约 1 周）**
1. MCP 默认只读（#1）
2. module-gateway config 写鉴权（#2）
3. hardware-review / drawing-review 附件落库（#3）
4. 单号 KV 计数器（#4）
5. season-goals / drawing-review 报价权限补齐（#6、#7）
6. ERP 状态回写（#8）
7. OAuth state 校验（#9）
8. CLA 防滥用（#5）

**第二期（P1，架构收敛，约 2-3 周）**
9. 飞书通知单实现（#10）→ 顺势收敛 FEISHU_API / token 缓存（#24）
10. 报销迁移至 approvals 引擎（#11）→ 统一审批状态机（#12）
11. 门户 Tab 统一嵌入 apps（#13）
12. 构建产物移出 git + deploy 一体化（#14）
13. 字段嗅探注册表 + 角色常量统一（#15、#16）
14. adapter filter 下推（#17）
15. renewed 死代码清理（#18）

**第三期（P2，工程质量，持续）**
16. MCP 注册表化（#19）、dashboard 拆分（#20）
17. 前端 store 拆分与 composable 抽取（#21、#22）
18. 错误处理/CORS 加固与死代码清扫（#23、#25、#26）

---

## 五、最终产物清单

| 产物 | 路径 | 说明 |
|---|---|---|
| 本评估报告 | `docs/NEC-HUB_模块优化评估报告_V1.0.md` | 全模块评估 + 路线图 |
| 统一通知层 | `src/feishu/notify.ts`（吸收 bot.ts） | 全仓唯一 `notifyFeishu` |
| 统一状态机 | `src/approvals/core/state-machine.ts` | approvals / contract-approval / reimburse 共用 |
| 单号服务 | `src/approvals/core/serial.ts` | KV 原子计数，消灭撞号 |
| 角色权威 | `src/auth/role.ts` 扩展 | ROLES 常量 + hasRole |
| 字段注册表 | `src/shared/bitable-fields.ts` | 嗅探正则集中维护 |
| 前端 composables | `web/src/shared/composables/` | useDraft / useStatusMeta / useRole |
| 构建部署一体 | `scripts/deploy-hub.sh` 更新 + `.gitignore` 更新 | 产物不再入库 |
| ERP 迁移 0002 | `migrations/erp/0002_*.sql` | 摘要列 + nonce 唯一索引 |

> 注：本报告为评估产物，不含代码改动。各优化项落地时建议按路线图分期提交，每期完成后运行 `npx vitest run` 与 `scripts/validate-docs.js` 验证。

---

## 六、落地记录（V1.1）

### 第一期 P0（安全与数据正确性）— 已完成

| # | 落地内容 | 关键改动 |
|---|---|---|
| 1 | MCP 未配 token 默认只读 | `mcp/handler.ts`：未配 `MCP_TOKEN` 仅放行只读工具（后由 P2 改为注册表 `readOnly` 标记派生）；非法 JSON 返回 `-32700` |
| 2 | config 写鉴权 | `module-gateway.ts` 新增 `configRoles`，hardware-review / season-goals / drawing-review / contract-approval 四处启用（后收敛为 `ROLES.CONFIG_ADMIN`） |
| 3 | 评审附件落库 | 两模块 Base 表实测无附件列，按降级方案序列化存入新增文本列「图纸文件」/「硬件资料」（Base 侧已建列），读取兼容原生附件数组 |
| 4 | 单号 KV 计数器 | 新增 `approvals/core/serial.ts`，`nextAppId`/报销单号切换，格式不变 |
| 5/7 | 权限补齐 | season-goals approve/reject/plan 加队长/组长门禁；drawing-review quote/select 去掉降级，须匹配管理角色 |
| 6 | ERP 状态回写 | `engine.ts` 新增通用 `onStatusChange` 钩子，`erp/reimburse.ts` 实现 `syncReimburseDocStatus` 回写 D1，失败不阻断审批 |
| 8 | OAuth state 校验 | my-tasks state 存 KV（TTL 600s）回调一次性消费；`feishu-sso.js` 存 sessionStorage 比对 |
| 9 | CLA 防滥用 | IP 滑动窗口限流 10 次/小时（429）、email/org 校验收紧、签署记录改 per-key 存储 + list 聚合、名单限最近 100 条 |

### 第二期 P1（架构收敛）— 已完成

| # | 落地内容 | 关键改动 |
|---|---|---|
| 10 | 通知单实现 + 常量收敛 | 删除 `feishu/notify.ts`，bot.ts 为唯一实现；新增 `feishu/client.ts`（唯一 `FEISHU_API`、泛型 `cachedToken`、`envSecret`/`envVar`） |
| 11/12 | 报销迁移 + 统一状态机 | 新增 `approvals/core/state-machine.ts`（规则表 + guard 钩子），approvals 与 contract-approval 双引擎收敛；`reimburse.ts` 262→175 行瘦身为引擎兼容壳，旧 API 形状不变 |
| 13 | 门户 Tab 嵌入 apps | Hardware/Contract/DrawingReview 三个 Tab 各瘦身为 ~24 行薄壳；`portal/components/dr/` 整目录删除，门户独有看板/甘特/联想能力并入 `apps/drawing-review` |
| 14 | 产物移出 git | `.gitignore` 新增 4 条规则，85 个产物文件 `git rm --cached`；vite 插件构建前清 `portal-assets/`；`deploy-hub.sh` 插入 `npm run build` 步骤 |
| 15/16 | 字段注册表 + 角色常量 | 新增 `shared/bitable-fields.ts`（dashboard/todos/reimburse/season-goals 全部改用）；`auth/role.ts` 导出 `ROLES` 注册表 + `hasRole`，后端 11 处、前端 2 处引用统一 |
| 17 | filter 下推 | `feishu/bitable.ts` 新增 `searchBitableRecords`/`getBitableRecord`/`queryBitableRecords`（下推 + 失败自动回退全扫）；approvals/contract-approval/drawing-review/hardware-review/season-goals 查单条全部下推；erp manage 改 SQL 层 WHERE/LIMIT/OFFSET；board/sla 等真聚合场景保留全扫 |
| 18 | renewed 死代码 | `session.ts` 删 `renewed`/`applyRenewedSession`，12 个文件 54 处调用点清理 |

### 第三期 P2（工程质量）— 已完成

| # | 落地内容 | 关键改动 |
|---|---|---|
| 19 | MCP 注册表化 | `mcp/registry.ts` + `tools/` 14 个域文件（schema/impl/readOnly 同处定义）；`implementations.ts`/`tools.ts` 删除；instructions 逐字节一致；tools/list 与旧版 JSON 完全一致 |
| 20 | dashboard 拆分 | `src/dashboard/{index,aggregates}.ts` + `src/docs.ts`；旧 `dashboard.ts` 删除（bundler 目录解析，12 处 import 零改动） |
| 21/22 | 前端 store 拆分 + 提示收敛 | hardware-review/reimburse store 拆为目录；新增 `shared/composables/{useDraft,useStatusMeta}.ts`；33 处原生 alert/confirm 收敛为 `shared/ui/feedback.ts` 的 toast/confirmDialog |
| 23 | CORS + JSON 容错 | CORS 白名单（`*.newenergycoder.club` + localhost）；`shared/http.ts` 新增 `readJson`，全模块非法 JSON 统一 400 |
| 25 | 死代码清扫 | `findDnsRecord` 接入 retry 自愈路径；删除 drawing-review/config 三个未用导出、meeting provider 死分支、mail 薄包装、mcp 死代码 `toolSendNotice` |
| 26 | 隐私与配置 | CF DNS comment 去除 open_id；retry 补飞书公示；`GITEE_USER` 挪入 wrangler vars |

### 遗留事项（部署前确认）

- **CLA 旧数据迁移**：旧 key `cla:signatures` 无自动迁移，若线上已有签署数据需一次性迁移到 `cla:sig:*`。
- **reimburse 底表字段**：引擎写固定字段名「发票照片」，生产底表若无此列需先建列。
- **管理操作依赖 members 表**：season-goals / drawing-review 管理端点为硬门禁，生产需先配置看板 members 表并正确填写「权限角色」列。
- **config 接口行为变化**：四个模块 `POST /api/*/config` 现要求管理员会话，若有免登录初始化脚本需改造。
- **产物删除待提交生效**：85 个产物文件的删除在 git 索引中（staged），随下次 commit 生效。
- `web/` 目录 `npx tsc --noEmit` 存在 13 条既有 TS2307（缺 .vue shim），先于本次优化存在；`apps/compliance` 仍用原生 `prompt()` 收集输入，如需收敛另行立项。
