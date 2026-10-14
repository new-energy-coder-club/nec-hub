# NEC 团队 AI 中台 — 审批与通知中心 PRD V1.2（缺口补齐版）

> 版本：V1.2（缺口补齐：台账联动 / 合规申请页 / 审批时效治理 / 待办 T-1 标红 / 邮件通道选型）
> 日期：2026-10-14
> 状态：G-01 ✅ 已交付（已随 `956d710` 提交）｜ G-02 代码已交付待验收（已随 `956d710` 提交）｜ G-03 代码已交付待实测（未提交）｜ G-04 代码已交付待实测（未提交）｜ G-05 代码已交付待验收（未提交；队长决定提前开发，选型改为飞书邮箱优先，见 §7）（2026-10-15 核实）
> 前置文档：《PRD_审批与通知中心_V1.1.md》（本 PRD 只补其"实施状态总览"中的剩余缺口，不重复已上线内容）、《团队AI中台PRD_V2.0.md》
> 现状核实方式：2026-10-14 对照 `src/` 代码与 git 提交记录逐项盘点（非 V1.1 文档中的 10-12 快照）；G-01/G-02 交付记录见 §3.0 / §4.0

---

## 0. 缺口清单与现状核实（2026-10-14 代码盘点）

> 图例：P0 阻断业务闭环 ｜ P1 影响体验/风控 ｜ P2 可选增强

| 编号 | 缺口 | 对应 V1.1 条目 | 现状证据 | 优先级 |
|---|---|---|---|---|
| G-01 | ~~`update_inventory` MCP 工具缺失；硬件审批通过后**不触台账**~~ ✅ 已交付（2026-10-14）：`src/approvals/inventory.ts` 新增 `applyInventoryDelta`，`engine.ts` arrive/issue 挂钩联动 + KV 幂等 +「台账联动」留痕，`update_inventory` 工具已注册（工具总数 26），单测 `src/__tests__/inventory-link.test.ts`；交付记录见 §3.0 | F-02 / M-01 | ~~`src/mcp/tools.ts` 25 个工具中无 update_inventory；`src/approvals/engine.ts` 的 arrive/issue 动作只改状态发通知~~ | ~~P0~~ 完成 |
| G-02 | ~~合规审批无申请页；驳回原因为自由文本~~ ✅ 代码已交付（2026-10-14）：`public/apps/compliance/index.html` 申请页已建，reject 支持 `reason` 写「驳回原因」，mine 接口已泛化；**待验收**：底表「驳回原因」单选字段手工配置 + 端到端实测，见 §4.0 | F-03 | ~~`src/approvals/flows.ts:69` 引擎配置就绪，但 `public/apps/` 下无 compliance 应用~~ | ~~P0~~ 待验收 |
| G-03 | ~~48h 代理人升级、14 天自动取消未做~~ ✅ 代码已交付（2026-10-14）：`FlowConfig` 新增 `sla` 段（默认 48h/14 天/队长，深合并向前兼容，config_flows 校验拦截非法值），新增 `src/approvals/sla.ts` 时效巡检（复用 `todo:tbl:<type>` 缓存、KV `approval:esc:` 幂等、取消后回写缓存防重复、脏数据跳过、主群汇总），cron `7 * * * *` 已接入 `wrangler.jsonc` 与 `src/index.ts`，单测 `src/__tests__/sla.test.ts` 7 条覆盖 §5.4 全部验收点；**待实测**：部署后按 §5.4 手动触发 cron 验证 | A-02 | ~~`wrangler.jsonc` 仅有 3 个 cron（看板预热/仓库缓存/周报），无审批时效扫描~~ | ~~P1~~ 待实测 |
| G-04 | ~~待办条无合规 T-1 标红；A-01 未登录实测~~ ✅ 代码已交付（2026-10-14）：`src/todos.ts` `buildTodos` 新增第四类 `approvals_local`（审批人见全部审批中单、队员仅见自己提交的单，复用 `engine.ts` 抽出的 `fetchFlowRecordsCached` 即 `todo:tbl:<type>` 5 分钟缓存）；compliance 带 `deadline`（计划发布时间），≤24h（含已过点）标 `urgent` 置顶；门户待办条 urgent 红色高亮 + 「T-1」徽标、非 urgent 显示倒计时；`total` 含四类之和；单测 `fe04-fe09.test.ts` G-04 三条（队员过滤 / 队长 T-1 置顶 / 表缓存复用）；**待实测**：§6.3 五条登录用例 | A-01 | ~~`src/todos.ts` 只聚合 tasks+finance+飞书审批 API，本地审批底表未并入~~ | ~~P1~~ 待实测 |
| G-05 | ~~邮件通道未选型~~ ✅ 代码已交付（2026-10-14）：队长决定提前开发，选型改为**飞书邮箱 OpenAPI 优先**（user 身份发信，复用现有 OAuth user_token 体系，零新增第三方依赖）；新增 `src/feishu/mail.ts`（EML 构建 + 草稿两段式发信 + 失败写 notify:failed）、`src/notify.ts` 通道调度层（NotifyChannel 抽象，审批结果双通道），`FlowConfig` 新增 `mailTo`，`send_notice` 支持 `channel: bot|mail|both`；单测 `src/__tests__/mail.test.ts` 16 条；**待验收**：飞书后台开通 mail scope + 配置 MAIL_SENDER_OPEN_ID 后实测收件，见 §7 | N-02 | ~~代码无邮件通道；V1.1 已注明"Worker 无法直发 SMTP，通道未选型"~~ | ~~P2~~ 待验收 |

**已补齐项（不再列入本期）**：refresh_token 持久化（`src/feishu/user-token.ts`，KV + 临期自动刷新）、R-01 报销应用页与 OCR、F-01 图纸评审全链路、F-02 硬件评审页与会议预约。

## 1. 目标与成功指标

**产品目标**：四条审批线全部"申请有入口、结果有回写、超时有兜底、库存有台账"，补齐后 V1.1 范围 100% 闭环。

| 指标 | 定义 | 目标值 | 测量方式 |
|---|---|---|---|
| 台账联动成功率 | 硬件单 arrive/issue 后台账正确增减的单数占比 | ≥ 99%，失败单有告警通知 | 抽查底表"台账联动"字段 |
| 超时升级覆盖率 | 审批中超 48h 的单子收到升级通知的比例 | 100% | 通知日志 vs 底表扫描 |
| 自动取消零误伤 | 被 14 天自动取消的单中，申请人申诉"仍在等审批"的比例 | 0（不另设 24h 预告，升级提醒文案中已含自动取消倒计时，口径见 §5.3） | 申诉记录 |
| T-1 标红准确率 | 合规单距计划发布 ≤24h 且仍审批中时，待办条标红命中率 | 100% | 验收测试用例 |
| 新增流程成本 | 第 5 条流程上线开发量 | 仍为零代码（SLA/驳回原因均走配置） | 架构走查 |

> 测量落点（2026-10-15 补，均无需新建报表）：台账联动成功率 = 底表「台账联动」字段抽查 + `notify:failed` KV 留痕；超时升级覆盖率 = `approval:esc:*` KV 标记 + 群通知记录比对；T-1 标红准确率 = §6.3 用例 3；自动取消零误伤 = 取消通知群反馈跟踪。

## 2. 范围

**本期做（In Scope）**：G-01～G-04 全部交付（**G-01 ✅、G-02/G-03/G-04 代码已交付待实测验收**）；G-05 原定为只沉淀选型结论，**队长决定提前开发**，选型改为飞书邮箱优先并已交付代码（见 §7）。

**明确不做（Out of Scope）**：
- 飞书审批引擎 Plan A 切换（`engine: "feishu"`）——scope 未开通，继续 Plan B；
- 真两级审批状态机——继续用"金额阈值额外通知"实现会签；
- 人工取消单动作（`cancel`）——本期只有系统自动取消；
- 审批中心独立聚合页——待办条能力增强即可，不新建页面。

---

## 3. G-01 update_inventory 工具 + 硬件审批台账联动（P0）

### 3.0 交付记录（2026-10-14 交付，已随 `956d710` 提交）

按 §3.2–§3.5 原样落地：新增 `src/approvals/inventory.ts`（`applyInventoryDelta`：匹配/新建行/负库存放行/未配置降级），`engine.ts` arrive/issue 挂钩 + KV `approval:inv:<appId>:<action>` 幂等 +「台账联动」留痕；`update_inventory` 工具三 action 注册（`src/mcp/tools.ts:143`），handler 工具说明同步；单测 `src/__tests__/inventory-link.test.ts`。**待办**：部署后按 §3.6 实测验收（尤其真实底表跑通一单联动）。

**2026-10-15 边界补齐**（评审 G-01 两条缺口）：① 匹配键比较增加 `normalizeMatchKey` 归一化（NFKC + 去空白 + 小写），全/半角括号、空格、大小写差异不再产生重复行，落库仍为规范形态；② 申请类型缺失/非新购领用/动作×类型组合不匹配由「静默不联动」改为「不联动 + 底表留痕 `未联动：…`」，行为定义见 §3.2「申请类型兜底」。新增单测 4 条（归一化 2、兜底 2），`inventory-link.test.ts` 共 16 条全绿。

### 3.1 现状

- 物资台账为标准四表之一：`物料(文本) / 数量(数字) / 位置(文本) / 领用人(文本)`（`src/mcp/implementations.ts:491`），table_id 存 `dashboard:config.tables.inventory`；
- 数据校验域已有 inventory 规则（数量为负告警、领用人不在名单、位置为空，`src/validation/rules.ts:315-335`）——联动产生的脏数据有现成兜底；
- 硬件审批底表字段（flows 配置）：`申请类型(新购/领用) / 物料名称 / 规格型号 / 数量 / 预估总价 / 用途说明 / 购买链接`；
- 状态机动作 `arrive`（已通过→已到货）与 `issue`（已通过→已领用）已上线（`src/approvals/engine.ts:146-147`），但目前**只改状态发通知，不动台账**。

### 3.2 联动设计

**触发点**：`runApprovalAction` 中，状态写底表成功且通知发出后，追加台账联动（失败不阻断动作本身，与 logEvent 同策略）：

| 审批动作 | 申请类型 | 台账动作 | 数量变化 |
|---|---|---|---|
| `arrive`（已到货） | 新购 | 入库：匹配行 数量 += 申请数量；无匹配行则新建 | +n |
| `issue`（已领用） | 领用 | 出库：匹配行 数量 -= 申请数量，领用人=申请人 | −n |
| 其他类型/动作 | — | 不联动 | — |

**申请类型兜底**：hardware 单执行 `arrive`/`issue` 时，若「申请类型」为空、非 `新购/领用`，或动作×类型组合不在上表矩阵内（如 `arrive`+领用、`issue`+新购），则**不联动、不写幂等标记、不发群告警**，仅在底表「台账联动」留痕 `未联动：申请类型「X」≠ 新购`（便于事后核对）。修正底表字段后不会自动补联动（状态机已走过该动作），用 `update_inventory` 手工补录。

**匹配规则**：按「物料」字段匹配 `物料名称`；若底表存在 `规格型号` 且非空，匹配键为 `物料名称（规格型号）`，台账侧同样按此命名新建行。字段名定位复用 `findFieldKey` 模糊匹配（`物料/物品/名称`、`数量/库存`、`位置/存放`、`领用人`），容忍手工改表头。

**匹配键归一化**：比较前对台账行「物料」值与拼接键两侧统一归一化——Unicode NFKC 兼容分解（全角括号 `（）`→`()`、全角字母数字→半角、全角空格→半角）→ 去除全部空白字符 → 小写化。因此 `电机（AK10）`、`电机(AK10)`、`电机 ( ak10 )`、`电机（ＡＫ１０）` 视为同一行，不会因手工录入差异产生重复行。归一化仅用于比较；**新建行落库仍为规范形态** `物料名称（规格型号）`（全角括号、值去首尾空格）。归一化函数 `normalizeMatchKey` 在 `src/approvals/inventory.ts`，联动与 `update_inventory` 共用。

**新建行默认值**（入库无匹配时）：`物料=物料名称（规格型号）`，`数量=申请数量`，`位置="未登记"`，`领用人=""`。

**负库存策略**：出库后数量为负**不阻断**（审批已通过，货已领走是事实），放行并追加一条 ⚠️ 库存告警群通知；validation 周报的 `inventory-qty-negative` 规则会二次兜底。

**幂等**：KV 标记 `approval:inv:<appId>:<action>`（TTL 90 天，与 `approval:map:` 一致），已联动过直接跳过。引擎动作本身有 from 状态校验，此为防御性双保险。

**回写留痕**：硬件申请底表增加文本字段「台账联动」（需在建表时补上，见 §3.5 配置项），联动后写 `已入库 2026-10-14` / `已出库 2026-10-14` / `失败：<原因>`。

**降级**：`dashboard:config.tables.inventory` 未配置时跳过联动，「台账联动」写 `未配置台账`，不报错。

### 3.3 MCP 工具 update_inventory（手工调账入口）

管理端专用（需 MCP_TOKEN），用于盘点修正、历史补录、联动失败补偿：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| action | string | 是 | `inbound` 入库 / `outbound` 出库 / `adjust` 盘点调账（直接设为目标值） |
| item_name | string | 是 | 物料名称（匹配规则同 §3.2） |
| spec | string | 否 | 规格型号，参与拼接匹配键 |
| quantity | number | 是 | 数量（>0；adjust 时为目标库存值，可为 0） |
| operator | string | 是 | 操作人姓名（写领用人/日志） |
| location | string | 否 | 位置（入库/新建行时写入） |
| note | string | 否 | 备注，追加到群通知 |
| approval_id | string | 否 | 关联申请单号（如 HW-2026-0003），写入通知便于追溯 |

返回：匹配到的台账行 record_id、变动前后数量、新建/更新标记。出库导致负库存时返回内容中带 ⚠️ 提示（不报错）。

工具注册于 `src/mcp/tools.ts` + `src/mcp/implementations.ts`，handler.ts 的工具说明同步追加一句。联动与工具共用同一个 `applyInventoryDelta(env, {...})` 内部函数。

### 3.4 通知模板

- 联动成功（静默）：不发群通知，只写底表字段——避免每次到货/领用都刷屏；
- 负库存告警：`⚠️ 库存告警 HW-2026-0003：<物料> 出库 5 件后库存 -2，请尽快补货或核对台账`；
- 联动失败：`⚠️ 台账联动失败 HW-2026-0003：<原因>，请用 update_inventory 手工补录`。

### 3.5 配置项

无新增 KV 配置——台账表走现有 `dashboard:config.tables.inventory`（`config_dashboard` 已支持）。仅需在硬件申请底表手工加一个文本字段「台账联动」。

### 3.6 验收标准

1. 新购单 arrive 后：台账对应物料数量 +n，底表「台账联动」= 已入库；重复调 arrive 不重复加（幂等）；
2. 领用单 issue 后：数量 −n，领用人 = 申请人；库存不足时数量为负且群收告警；
3. 台账无该物料时 arrive 自动建行，位置 = 未登记；
4. `update_inventory` 工具三种 action 各跑通一次，adjust 可把数量设为任意 ≥0 值；
5. 未配置 inventory 表时审批动作正常完成，「台账联动」= 未配置台账；
6. validation 周报对联动产生的负库存行能报出（兜底链路验证）。

---

## 4. G-02 合规审批申请页 + 驳回原因标准化（P0）

### 4.0 交付记录（2026-10-14 交付，已随 `956d710` 提交）

- 申请页 `public/apps/compliance/index.html` 已建（提交 + 我的申请 + 待我审批三视图）；
- 引擎 reject 支持 `reason`（`src/approvals/engine.ts:223-227`，底表有「驳回原因」字段才写，对其他流程零影响），通知带驳回原因；REST body 透传（`handlers.ts:71-80`）；
- mine 接口已泛化为全量字段透传（`handlers.ts:183-194`），不再是报销域硬编码；
- **超出原设计**：新增 `GET /api/approvals/pending`（待我审批列表，`handleApprovalPending`），审批人可在页内直接审批，不必跳底表；
- **待验收**：① ✅ 已完成（2026-10-14）：合规底表「驳回原因」字段由 text 原地转为单选（fldzJd0bU1，5 个选项按 §4.2 顺序，转换前列为空零风险）；② 按 §4.3 端到端实测（待登录门户实测）；③ ✅ 已完成（2026-10-14）：报销页回归通过——`public/apps/reimburse/index.html` 与门户「我的报销」卡片（`public/index.html`）均已按泛化后 `fields` 全量透传结构取值（金额 number、提交时间 ms 时间戳），`vitest run` 242/242 全绿（含 mine 报销域用例）、`tsc --noEmit` 通过。

### 4.1 页面

新增 `public/apps/compliance/index.html`（静态单页，与 drawing-review / hardware-review 应用同构，可直接 `deploy_app` 部署或入库），两个视图：

**视图一：提交申请**——字段与 `DEFAULT_FLOWS.compliance` 严格对齐：

| 表单项 | 底表字段 | 控件 | 校验 |
|---|---|---|---|
| 合规类型 | 合规类型 | 单选：对外发布 / 商务合作 / 授权使用 / 其他 | 必选 |
| 标题 | 标题 | 单行文本 | 必填 |
| 内容说明 | 内容说明 | 多行文本 | 必填 |
| 计划发布时间 | 计划发布时间 | 日期时间选择 | 必填（T-1 标红依赖此字段） |
| 赞助商相关 | 赞助商相关 | 单选：是 / 否 | 必选 |
| 赞助商要求 | 赞助商要求 | 多行文本 | 赞助商相关=是 时必填（前端提示 + 引擎 conditional 双保险） |

提交调 `POST /api/approvals`（`{ type: "compliance", fields: {...} }`，需登录）；成功页展示申请单号（CP-2026-XXXX）与底表链接。

**视图二：我的申请**——调 `GET /api/approvals/mine?type=compliance`。（~~⚠️ 现状该接口返回字段硬编码为报销域，本期需泛化~~ **已泛化为全量字段透传**，见 §4.0。）

### 4.2 驳回原因标准化

**底表改动**：合规底表增加单选字段「驳回原因」，选项（顺序固定）：

1. 内容事实错误
2. 排版或 VI 不规范
3. 涉及未授权信息
4. 发布时间冲突
5. 其他（须在审批意见中说明）

**引擎改动**：`POST /api/approvals/<type>/<appId>/reject` 的 body 增加可选 `reason` 字段；`runApprovalAction` 在 reject 分支将其写入「驳回原因」字段（findFieldKey 定位，表里没有该字段则跳过不写，对其他三条流程零影响）。现有"reject 必须填 comment"校验保持不变。

**通知模板**：`❌ 已驳回 CP-2026-0001\n驳回原因：涉及未授权信息\n审批人：XXX\n审批意见：…`

**发布回填**：审批通过后申请人执行 `publish` 动作（已上线，要求带 link），底表「发布后链接」回写——合规页"我的申请"列表提供"回填发布链接"入口。

### 4.3 验收标准

1. 运营组队员登录门户打开合规页，提交一条"对外发布"申请，群机器人收到通知，底表出现 CP 单号；
2. 赞助商相关=是 且不填赞助商要求时，前端拦截 + 引擎 400 各验证一次；
3. 审批人从待办进入驳回，驳回原因下拉必选；选"其他"不填审批意见被现有 comment 校验拦截；
4. 申请人"我的申请"里看到状态=已驳回 + 驳回原因；通过后回填发布链接，状态→已发布；
5. `GET /api/approvals/mine?type=compliance` 返回合规域字段（不再是事项/金额）；
6. 匿名/未登录访问提交接口返回 401。

---

## 5. G-03 审批时效治理：48h 升级提醒 + 14 天自动取消（P1）

### 5.1 配置设计（流程即配置原则不破）

`FlowConfig` 增加可选 `sla` 段，`config_flows` 校验同步扩展：

```jsonc
{
  "sla": {
    "escalateHours": 48,     // 审批中超此时长 → 升级提醒；0 = 关闭
    "autoCancelDays": 14,    // 审批中超此天数 → 自动取消；0 = 关闭
    "escalateTo": "队长"      // 升级提醒额外知会的角色（正则串）
  }
}
```

默认值 48h / 14 天 / "队长"写入 `DEFAULT_FLOWS` 四条流程；`getFlowsConfig` 的深合并保证旧配置向前兼容（不配置即默认开启，可配 0 关闭）。

### 5.2 Cron 与扫描算法

- `wrangler.jsonc` triggers 增加 `"7 * * * *"`（每小时第 7 分，避开整点）；
- `src/index.ts` scheduled 分支：`controller.cron === "7 * * * *"` → `ctx.waitUntil(runApprovalSla(env))`；
- `runApprovalSla`（新文件 `src/approvals/sla.ts`）：

```
for type in APPROVAL_TYPES:
  flow = cfg[type]; 若 !flow.tableId 或 sla 全关 → skip
  records = listBitableRecords(底表)   // 复用 todo:tbl:<type> 5 分钟缓存，避免每小时全量拉 4 表
  for r in records where 状态 = "审批中":
    age = now - 提交时间(epoch ms)
    if age > autoCancelDays:
      → 状态改「已取消」（直接 updateBitableRecord，不走 ACTION_TARGET）
      → 通知申请人 + 群：「⏰ 已自动取消 <appId>：提交超 N 天未审批，如需继续请重新提交」
      → 删除 KV 升级标记
    else if age > escalateHours 且 KV 无 approval:esc:<appId>:
      → 通知：「⏰ 审批超时提醒 <appId>：已等待 X 小时，请 <approvers.roles> + <escalateTo> 尽快处理；Y 天后将自动取消」
      → 写 KV approval:esc:<appId>（TTL = autoCancelDays 剩余秒数，防重复提醒）
```

单条失败只记日志不影响其他单（与 alert.service 同策略）；整轮运行结束向主群发一条汇总（仅当有动作发生时）：`时效巡检：升级提醒 2 条，自动取消 1 条`。

### 5.3 边界与口径

- 「提交时间」底表存 epoch ms（submit 时 `Date.now()`），无时区问题；历史脏数据该字段为空 → `fieldNum` 返回 null，跳过不处理（不误伤）；
- 自动取消只动「审批中」；已通过/已驳回/已打款等任何其他状态不触碰；
- 审批完成的单再次扫描时状态已变，天然幂等；升级提醒靠 KV 标记幂等；
- 14 天自动取消前**不另设 24h 预告**（升级提醒文案中已含"Y 天后将自动取消"，指标按此口径测量）；
- **升级提醒每单只发一次（有意决策）**：KV 标记 TTL 至自动取消时刻，避免每小时复读刷屏；若未来需要周期复提醒，再加 `sla.remindIntervalHours` 配置项（本期不做）。

### 5.4 验收标准

1. 构造一条提交时间为 49 小时前的审批中单，手动触发 cron（`wrangler dev` 的 `/__scheduled?cron=7+*+*+*+*` 或测试直接调 runApprovalSla）：群收升级提醒，KV 标记写入；再触发一次不重复提醒；
2. 构造提交时间为 15 天前的单：状态变「已取消」，申请人视角通知发出；再扫描不重复处理；
3. `sla.escalateHours = 0` 的流程不产生产升级提醒；`autoCancelDays = 0` 不自动取消；
4. 提交时间为空的脏数据行被跳过且记日志；
5. config_flows set 带非法 sla（负数/非对象）被校验拦截。

---

## 6. G-04 待办条合规 T-1 标红 + 登录实测（P1）

### 6.1 数据源改造

现状 `GET /api/todos`（`src/todos.ts`）聚合三类：逾期任务、财务报销、飞书审批 API（scope 未开通，稳定降级）。**本地四条审批底表的"审批中"单并不在门户待办条里**——这是 T-1 标红的前提缺口。

改造：`buildTodos` 增加第四类 `approvals_local`，复用 `aggregateTodos` 的读取与缓存（`todo:tbl:<type>` 5 分钟缓存），但过滤规则不同：

| 角色 | 可见范围 |
|---|---|
| 该流程审批人（isApprover） | 全部审批中单 |
| 普通队员 | 仅自己提交的单（申请人 open_id 匹配） |

### 6.2 T-1 标红判定

`approvals_local` 每条增加两个字段：

```jsonc
{
  "application_id": "CP-2026-0007",
  "title": "CP-2026-0007 招新推文发布",
  "url": "<底表记录链接>",
  "type": "compliance",
  "deadline": 1760313600000,   // 仅 compliance：计划发布时间（fieldTs），其他流程为 null
  "urgent": true               // type=compliance 且 deadline - now ≤ 24h 且仍审批中
}
```

前端待办条：`urgent=true` 的条目红色高亮 + 「T-1」徽标，排序置顶；`deadline` 非空的非 urgent 条目显示倒计时文案（"距计划发布还有 X 天"）。飞书审批 API 通道保留原降级逻辑不动。

**展示细节（实现口径，2026-10-15 补充）**：urgent 单显示「距计划发布不足 24h」；非 urgent 有 deadline 显示「距计划发布还有 X 天」（`Math.ceil` 向上取整），已过期显示「已过计划发布时间」；本地审批单区块整体排在待办清单最前（先于任务/报销/飞书审批），urgent 徽标在区块内自然靠前，不另设组内排序。

### 6.3 登录实测（A-01 遗留验收，随本期一起关闭）

| # | 用例 | 预期 |
|---|---|---|
| 1 | 队长账号登录，存在超 48h 未审单 | 待办条计数含该单，角标数字与底表一致 |
| 2 | 普通队员登录 | 只见自己的申请，不见他人单 |
| 3 | 合规单计划发布时间 = 明天 | 该条目标红 + T-1 徽标 |
| 4 | 飞书审批 scope 未开通 | warnings 有降级说明，页面不报错不白屏 |
| 5 | 5 分钟内重复刷新 | 命中缓存（cached=true），无重复拉表 |

### 6.4 验收标准

上面 5 条全部通过；`total` 计数 = tasks + finance + approvals + approvals_local 四类之和；移动端窄屏下红标不溢出（跟随本期门户移动端适配基线）。

---

## 7. G-05 邮件通道（P2 → 提前开发，选型：飞书邮箱优先）

### 7.0 决策变更（2026-10-14）

原结论为"本期只出选型结论不开发，启动时按 Resend 实施"。**队长决定提前开发，且优先采用飞书邮箱 OpenAPI**：复用现有飞书应用与 OAuth user_token 体系（`src/feishu/user-token.ts` 已有 KV 存取 + 临期自动刷新），零新增第三方依赖，队内可达性好。Resend 降级为备选（对外邮件送达率需要时再叠加，接口抽象已预留）。

### 7.1 候选对比（结论已更新）

| 方案 | 接入成本 | 送达能力 | 依赖 | 结论 |
|---|---|---|---|---|
| 飞书邮箱 OpenAPI（user 身份发信） | 中：需企业开通邮箱 + mail scope 审批 | 队内可达性好，对外一般 | 复用现有飞书应用与 user_token 体系 | **采用（已开发）** |
| Resend（HTTPS API） | 低：Worker 原生友好，免费 100 封/天 | 需域名验证（newenergycoder.club 已有） | 新增第三方依赖 | 备选（对外送达需要时叠加） |
| 腾讯云 SES | 中：实名认证 + 域名配置 | 国内送达率最好 | 新增云厂商依赖 | 过量 |
| SMTP 中继 | 高：Worker 无原生 SMTP，需第三方 relay | 取决于中继 | 链路过长 | 排除 |

### 7.2 实现方案（已交付代码，2026-10-14，工作区未提交）

- **发信模块** `src/feishu/mail.ts`：构建最小 EML（HTML 正文 base64、中文主题 RFC 2047 encoded-word）→ base64url → `POST /mail/v1/user_mailboxes/{mailbox}/drafts` 创建草稿 → `POST .../drafts/{id}/send` 发送；身份为发信人 user_access_token（`getUserAccessToken` 自动续期）；失败写 `notify:failed` 留痕（复用 N-01 机制），不抛错。
- **通道调度层** `src/notify.ts`：按 §7.2 原设计抽象 `NotifyChannel`（`feishu_bot | email`）；`notifyApprovalResult` = 群机器人始终发 + 邮件按流程 `mailTo` 配置发送（未配置 fallback env `MAIL_TO`）。
- **接入点**：审批引擎 approve/reject 结果通知改走 `notifyApprovalResult`（`src/approvals/engine.ts`），其余状态通知仍只走群机器人；`send_notice` MCP 工具新增 `channel: bot | mail | both` 与 `to` 参数（`src/approvals/handlers.ts`、`src/mcp/tools.ts`）。
- **配置**：env `MAIL_SENDER_OPEN_ID`（发信人 open_id，须已在门户完成 OAuth 授权）、可选 `MAIL_FROM` / `MAIL_MAILBOX`（默认 me）/ `MAIL_TO`（兜底收件人）；流程级收件人走 `config_flows` 的 `mailTo` 字段，零代码按流程开关。
- **降级**：缺任一配置返回 disabled，业务不受影响——与 V1.1 N-02 原契约一致。
- **覆盖面口径（有意决策）**：邮件仅接入审批结果（approve/reject）；SLA 升级/自动取消通知、状态流转通知仍只走群机器人——高频低价值信息不进邮箱。需要扩展时在 `notify.ts` 同源加接入点即可。
- **发送量报警暂缓**：V1.1 非功能要求「邮件日发送量 ≥50 报警」在本方案下本期不实现（无发送计数器）；邮件仅审批结果 + 显式 `send_notice`，量级极低。需要时以 KV 日计数 + 周报阈值告警补齐。

### 7.3 验收标准

| # | 用例 | 预期 |
|---|---|---|
| 1 | 未配置 MAIL_SENDER_OPEN_ID | 所有邮件调用返回 disabled，群通知照常，业务无报错 |
| 2 | 发信人未 OAuth 授权 / 授权过期 | 返回 disabled（提示重新授权），不抛错 |
| 3 | 配置齐全后 approve 一单 | 收件人收到 HTML 结果邮件（申请人/类型/意见/详情链接齐全），群通知同步送达 |
| 4 | `send_notice` channel=mail / both | 邮件单发与双通道各自报告送达结果；缺收件人时明确报错 |
| 5 | 飞书侧发信失败（如 scope 未开通） | 返回失败原因 + `notify:failed` 留痕，群通道不受影响 |

前置条件：飞书开发者后台为本应用开通邮箱 scope（`mail:user_mailbox.message:send`），发信人账号在门户重新登录一次以刷新 user_token 授权范围（门户登录与"我的任务"重绑两处授权链接已带 mail scope，2026-10-15）。**详细操作步骤见《飞书邮箱通道_配置手册.md》**（企业开通邮箱 → 后台开 scope → 覆盖授权 → wrangler secrets → mailTo → 验证 → 排障）。

---

## 8. 排期与工作量估算

| 顺序 | 条目 | 工作量 | 主要改动文件 | 依赖 |
|---|---|---|---|---|
| ~~1~~ | ~~G-01 台账联动 + update_inventory~~ ✅ 已交付 | ~~1.0 人日~~ | 见 §3.0 | — |
| ~~2~~ | ~~G-03 时效治理 cron~~ ✅ 代码已交付待实测 | ~~0.5 人日~~ | 已落地：`src/approvals/sla.ts`、`src/index.ts`、`wrangler.jsonc`、`flows.ts`、`handlers.ts` | — |
| ~~3~~ | ~~G-02 合规页 + 驳回原因 + mine 接口泛化~~ ✅ 代码已交付待验收 | ~~1.0 人日~~ | 见 §4.0 | — |
| ~~4~~ | ~~G-04 待办条聚合 + T-1 标红~~ ✅ 代码已交付待实测 | ~~0.5 人日~~ | 已落地：`src/todos.ts`、`engine.ts`（`fetchFlowRecordsCached` 复用）、`public/index.html` 待办条 | — |
| ~~5~~ | ~~G-05 邮件通道（提前开发，飞书邮箱优先）~~ ✅ 代码已交付待验收 | ~~0.5 人日~~ | 已落地：`src/feishu/mail.ts`、`src/notify.ts`、`flows.ts`（mailTo）、`engine.ts`、`handlers.ts`、`src/mcp/tools.ts` | 飞书后台开通 mail scope |
| 6 | 联调 + 登录实测 + 回写 V1.1 状态总览 | 0.5 人日 | `docs/PRD_审批与通知中心_V1.1.md` §0 | 全部完成 |

剩余约 **0.5 人日**（联调验收）；G-01～G-05 已于 2026-10-14 全部落地代码（工作区未提交）。

## 9. 风险与依赖

| 风险 | 影响 | 缓解 |
|---|---|---|
| 台账表头被手工改乱 | 联动匹配失败 | findFieldKey 模糊匹配 + 失败告警 + update_inventory 手工补偿 |
| cron 每小时扫 4 张底表 | 飞书 API 限流 | 复用 `todo:tbl:<type>` 5 分钟缓存；整轮失败只记日志 |
| 14 天自动取消误伤"真想继续等"的单 | 申请人需重提 | 升级提醒文案提前告知；sla 可配 0 关闭；取消有群通知留痕 |
| mine 接口泛化影响报销页 | R-01 页面字段错位 | 泛化时保留原字段别名，报销页回归测一遍 |
| 飞书审批 scope 持续未开通 | 待办双通道长期单通道 | G-04 的本地聚合即是兜底，不阻塞 |
| 飞书邮箱 mail scope 未开通 / 发信人授权过期 | 邮件通道长期 disabled | 通道降级设计（disabled 不报错不阻塞），群机器人仍是主通道；开通后配置 MAIL_SENDER_OPEN_ID 即启用 |

## 10. 验收总清单（DoD）

> 责任分工与时间点（2026-10-15 补）：§3.6 / §5.4 = 队长 + 机械组组长；§4.3 = 运营组组长 + 一名队员账号；§6.3 = 队长 + 一名队员（双账号对照）；§7.3 = 队长（需邮箱管理员配合开 scope）。全部验收在**部署后 3 天内**完成并回填本清单。

- [ ] §3.6 六条、§4.3 六条、§5.4 五条、§6.3 五条、§7.3 五条全部通过（其中 §3.6 / §4.3 对应代码已交付，待实测打勾；§5.4 五条已被 `src/__tests__/sla.test.ts` 单测覆盖，待生产手动触发 cron 复核；§7.3 第 1/2/4 条已被 `src/__tests__/mail.test.ts` 单测覆盖，第 3/5 条待飞书后台开通 mail scope 后实测）；
- [ ] `npm run test`（vitest）全绿，新增逻辑有对应单测（联动匹配/幂等 ✅ 已有 `inventory-link.test.ts`；SLA 判定 ✅ 已有 `sla.test.ts`；urgent 判定 ✅ 已有 `fe04-fe09.test.ts` G-04 三条；邮件通道 ✅ 已有 `mail.test.ts` 16 条）；
- [ ] 生产部署后实测：提交→审批→arrive→台账变动→群通知 全链路一条单跑通；
- [x] V1.1 §0 实施状态总览回写：F-02、M-01 已升 ✅；F-03（代码交付待实测）、A-01（G-04 代码交付待登录实测）、A-02（G-03 代码交付待 cron 实测）均已按 2026-10-14 交付状态刷新；
- [ ] 新增流程走查：假设新增第 5 条流程，确认只需 config_flows + 建表，零代码（含 sla 段）。

### 验收进展回填（2026-10-15 凌晨，部署后实测）

- ✅ **生产部署完成**：commit `1f5726f` 经本地 `wrangler deploy` 上线（Version `1f438e34`），`/api/health` 200。⚠️ CI deploy job 失败——仓库 secret `CLOUDFLARE_API_TOKEN` 缺失/失效，需队长在 GitHub 仓库 Settings → Secrets 补配后 CI 才能自动部署。
- ✅ **`npm run test` 全绿**：296 条（291 + 新增 role.test.ts 5 条）通过，typecheck 通过。
- ✅ **§6.3 登录实测 5 条中 3 条通过**（维护者账号 DarrenPig 朱佩韦，role 解析曾失败——根因：名单表 open_id 为 lark-cli 应用域，与中台应用域不同；已写回中台 open_id 并给 `role.ts` 加姓名双向包含兜底 + 5 条单测）：
  - 用例 3 ✅：CP-2026-0001（计划发布 24h 内）门户待办条标红 + T-1 徽标 + 「距计划发布不足 24h」；
  - 用例 4 ✅：飞书审批 scope 未开通时 `warnings` 降级提示、页面不白屏；
  - 用例 5 ✅：5 分钟内重复请求 `cached: true`；
  - 用例 1（队长 48h 视角）/ 用例 2（队员对照）⏳ 需第二个飞书账号，待人工。
- ✅ **FE-04 验收 3 联动通过**：goals 表灌入截止=次日测试目标后，门户顶部 goal-banner 出现 T-2 提醒条。
- ⏳ §3.6 / §4.3 / §5.4 / §7.3：§5.4 待 cron 整点（每小时 07 分）自动触发后复核群通知；§3.6/§4.3 需真实审批人操作一单；§7.3 第 3/5 条仍阻塞于飞书后台 mail scope 开通（`MAIL_SENDER_OPEN_ID` secret 已配）。
