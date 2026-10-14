# PRD：应用中台结构优化 V1.0

| 字段 | 值 |
|---|---|
| 文档编号 | PRD-STRUCT-1.0 |
| 日期 | 2026-10-15 |
| 状态 | 已评审通过（2026-10-15），M1 进行中（ST-08a 已落地） |
| 关联文档 | `docs/团队AI中台PRD_V2.0.md`（FE-01~FE-14 主 PRD）、`docs/页面与Tab状态现状.md`（现状盘点，本文档数据已刷新）、`docs/PRD_审批与通知中心_V1.1/V1.2.md` |
| 编号体系 | 本文档需求编号 **ST-01 ~ ST-10**（Structure），与主 PRD 的 FE-xx 并行；落地后同步 PRD 看板 |

---

## 0. 一句话概述

中台功能面（FE-01~FE-14）已基本铺完，但**工程结构已追不上功能增速**：门户 `public/index.html` 三周内从 ~1500 行膨胀到 3161 行 / 167KB，10 个 Tab 全内联；全部状态挤在一个 KV 命名空间；两条后端就绪的流程没有前端。本 PRD 定义一轮**不改功能、只改结构**的治理迭代，让下一批功能（V2.1+）有得放、放得稳。

## 1. 背景与现状

### 1.1 现状数据（2026-10-15 实测）

| 维度 | 现状 | 位置 |
|---|---|---|
| 门户首页 | 单文件 SPA，3161 行 / 167KB，HTML + Tailwind CDN + ~2600 行内联 JS，无构建无模块 | `public/index.html`（脚本起于 :583） |
| Tab 数量 | 10 个（home / my-tasks / drawing-review / apps / skills / docs / repos / dashboard / prd / agent），「更多」下拉收 3 个低频 | `public/index.html:148-158` |
| 首页组件 | 白名单 6 组件（my-apps/my-tasks/my-reimburse/docs/goals/inventory）+ 3 个固定条（团队动态 / 待办条 / T-7 目标提醒） | `src/home/layout.ts:9`，渲染器 `public/index.html:1209-1330` |
| 后端入口 | `src/index.ts` 247 行路由表，if 链 + 8 个业务子路由动态 `import()`，fallthrough 依赖「返回 null 继续」隐式约定 | `src/index.ts:137-220`，`src/shared/module-gateway.ts:7` |
| 业务模块 | 约 20 个（approvals / drawing-review / hardware-review / contract-approval / erp / home / mcp / validation ...） | `src/` |
| MCP 工具 | 27 个 | `src/mcp/tools.ts:7-479` |
| 存储 | 1 个 KV（REGISTRY，20+ 种 key 前缀全塞一起）、R2、D1（ERP_DB）、Assets | `wrangler.jsonc` |
| 测试 | 23 个 vitest 文件，仅本地跑 | `src/__tests__/` |
| CI | 仅 typecheck + push main 直发生产，**不跑测试、无 staging** | `.github/workflows/ci-cd.yml` |

### 1.2 痛点清单（按严重度排序）

1. **P0 门户单文件失控**：3161 行且仍在快速增长，10 个 Tab 的 HTML/JS 无模块边界，任何小改动都在同一文件里 merge-conflict 高发。
2. **P0 无 URL 路由**：Tab/筛选/排序全是内存变量，刷新即丢、链接不可分享；种子资料里的 `/#tab-dashboard` 深链已断。
3. **P0 CI 无测试门禁**：23 个测试文件不进 CI，push main 直发生产，回归全靠人肉。
4. **P1 图纸评审双实现漂移**：门户内嵌版（`public/index.html:214-280`）与 `public/apps/drawing-review/` 独立页两套实现，`statusMap` 等常量重复定义，改一处漏一处。
5. **P1 能力闲置**：hardware-review、contract-approval 后端（含 module-gateway、配置工厂）已就绪但**无前端**，队员看不到入口。
6. **P1 KV 大杂烩**：注册表 / 模块配置 / 用户态 / 缓存 20+ 种前缀共用一个 REGISTRY，无清单文档、TTL 约定不一致（部分有 TTL 部分永久）。
7. **P2 路由层隐式契约脆弱**：动态 import + 「返回 null 继续 fallthrough」语义仅靠注释约定（`module-gateway.ts:7` 明示「此语义不可变」），新增子路由容易踩坑。
8. **P2 抽象不彻底**：session 已收敛到 `shared/session.ts`，但用户偏好 key 出现 `user-prefs:`（drawing-review）与 `user-prefs:hw:`（hardware-review）两个变体。
9. **P3 文档行号引用过期**：`页面与Tab状态现状.md` 引用的行号对应拆分前单体，已失效。

## 2. 目标与非目标

### 2.1 目标（可度量）

| 指标 | 现状 | 目标 |
|---|---|---|
| `public/index.html` 行数 | 3161 | < 800（仅骨架 + 加载器） |
| 前端模块数 | 1 | 按 Tab 拆 10+ 个 ES Module |
| 深链可用性 | 0（hash 断链） | 全部 10 个 Tab 可 `#/tab` 直达、可分享 |
| CI 测试门禁 | 无 | vitest 全量进 CI，红则 block merge |
| 双实现漂移点 | 图纸评审 2 套 | 收敛为 1 套代码源 |
| 后端就绪无前端流程 | 2（hardware / contract） | 全部有门户入口 |
| KV key 清单文档 | 无 | 1 份权威清单 + TTL 约定表 |
| 环境分层 | 仅生产 | 增加 staging（`wrangler env`） |

### 2.2 非目标（本轮不做）

- 不引入 React/Vue 等框架重写门户（`页面与Tab状态现状.md` §5 的框架化方案留作 V3 备选，本轮用原生 ES Module 拆分为后续迁移铺路）。
- 不新增业务功能、不改任何审批流逻辑。
- 不做 KV 数据迁移（只治理 key 规范与文档，存量 key 不动）。
- 不动 MCP 工具的对外契约（27 个工具签名不变）。

## 3. 需求明细

### ST-01 门户前端模块化拆分 【P0】

**问题**：3161 行单文件，无模块边界。

**方案**：无构建原生化拆分，保持 Cloudflare Assets 静态托管不变：

```
public/
  index.html            # < 800 行：HTML 骨架 + Tab 容器 + <script type="module" src="/portal/main.js">
  portal/
    main.js             # 启动器：Tab 注册表 + 动态 import
    shared/api.js       # fetch 封装、shared.load() 去重（自 index.html:1113 迁出）
    shared/session.js   # 登录态、角色
    tabs/home.js        # 首页渲染器（自 :1209-1330 迁出）
    tabs/my-tasks.js
    tabs/drawing-review.js
    tabs/apps.js / skills.js / docs.js / repos.js
    tabs/dashboard.js / prd.js / agent.js
```

**验收**：
- `index.html` < 800 行；每个 Tab 一个文件，懒加载（切到才 import）。
- 功能逐 Tab 回归：10 个 Tab 与现状截图/操作路径一致。
- Tailwind CDN 保留（不动样式体系）。

### ST-02 Hash 路由与深链 【P0】

**问题**：Tab 切换（`switchTab` `index.html:623`）纯内存态，刷新丢状态、链接不可分享。

**方案**：
- URL 规范：`#/<tab>`，可选二级 `#/<tab>/<子状态>`（如 `#/dashboard/inventory`、`#/drawing-review/DR-2026-0012`）。
- `main.js` 启动时解析 hash → 激活对应 Tab；`switchTab` 写回 hash（`history.replaceState`，不刷历史栈）；监听 `hashchange`。
- 未登录可见性规则保持现状（drawing-review 登录后显示），未授权 hash 落回 `#/home`。

**验收**：10 个 Tab 均可深链直达；修复种子资料中的 `/#tab-dashboard` 断链（兼容旧 hash 做 301 式映射）。

### ST-03 图纸评审双实现收敛 【P1】

**问题**：门户内嵌版与 `public/apps/drawing-review/index.html` 两套实现漂移。

**方案**：以独立页 `/apps/drawing-review/` 为**唯一代码源**，门户 Tab 改为：
- 方案 A（推荐）：门户 Tab 内 iframe 嵌入独立页，postMessage 同步高度与单号跳转；
- 方案 B：把独立页的 JS 拆成模块，门户 Tab 直接复用同一份模块。
二选一在方案评审时定，**验收标准相同**：`statusMap` 等常量全库只剩 1 处定义；改状态文案只需改 1 个文件。

### ST-04 补齐硬件评审 / 合同审批前端入口 【P1】

**问题**：`src/hardware-review/`、`src/contract-approval/` 后端就绪（走 module-gateway），无前端。

**方案**：
- 复用 ST-01 的 Tab 模块骨架，各加一个轻量 Tab（收进「更多」，导航保持 6 个高频入口原则不变）。
- UI 复用图纸评审 Tab 的列表/详情模式（同构流程：提交单 → 状态机 → 整改项 → 群通知）。
- 沿用各自 `*-config` 未配置时 503 的网关行为，前端展示「未配置多维表格」引导态而非报错。

**验收**：两条流程可从门户发起申请、查看状态、处理审批待办；「更多」下拉变为 5 项。

### ST-05 KV 命名空间治理 【P1】

**问题**：REGISTRY 单命名空间 20+ 种前缀混存，无清单、TTL 不一。

**方案**（不迁移存量数据）：
- 产出 `docs/KV键值清单.md`：全部 key 前缀的权威清单（前缀 / 含义 / 读写方 / TTL / 负责人），CI 加 lint 脚本校验代码里出现的 KV key 必须在清单中登记。
- TTL 约定表：session 类 7d、缓存类必设 TTL、注册表/配置类永久、用户态永久。
- 新 key 命名规范：`<域>:<用途>[:<id>]`，禁止再出 `user-prefs:hw:` 这类临时变体（配合 ST-07 收敛）。
- wrangler 暂不拆多 namespace；清单运行一个迭代后，若前缀数仍增长再评估拆分。

### ST-06 路由层契约显式化 【P2】

**问题**：`src/index.ts` if 链 + 动态 import，「子路由返回 null 则 fallthrough」是注释级隐式契约。

**方案**：
- 抽 `src/shared/router.ts`：统一 `(req, env, ctx) => Response | null` 的子路由签名与按序分发器，fallthrough 语义由类型和测试保证，不再靠注释。
- 8 个 startsWith 子路由迁入注册表（`{ prefix, load: () => import(...) }`），新增子路由只加一行。
- 补路由级测试：每个前缀命中正确模块、未命中返回 null 继续、最终 404。

### ST-07 用户偏好 key 统一 【P2】

**方案**：`user-prefs:hw:<actorId>` 收敛进 `user-prefs:<actorId>`（结构上按域分字段），读取侧做一次性兼容（先读新 key，miss 回退旧 key 并惰性回写），两周后删回退。

### ST-08 CI 测试门禁 + staging 环境 【P0/P1】

**方案**：
- ST-08a【P0】：`ci-cd.yml` 增加 `npm test`（vitest 全量）步骤，置于 typecheck 之后、deploy 之前；PR 上测试红即 block。
- ST-08b【P1】：`wrangler.jsonc` 增加 `env.staging`（独立 KV/R2/D1 命名空间 + `staging.` 子域），CI 对非 main 分支 push 自动部署 staging；main 仍直发生产。

**验收**：提一个故意挂测试的 PR 被 CI 拦下；staging 域名可访问且数据与生产隔离。

### ST-09 MCP 工具分组与文档 【P2】

**方案**：27 个工具按域分组（看板 / 审批 / 应用发布 / 配置 / 通知），在 NEC-MCP Tab 渲染分组清单（数据来自 `src/mcp/tools.ts` 的单一来源，附一句话用途与所需权限）；不改任何工具签名。

### ST-10 文档保鲜机制 【P3】

**方案**：
- `docs/页面与Tab状态现状.md` 中所有行号引用改为「文件 + 锚点（函数/小节名）」写法，本文档同步执行。
- README 增加「改结构先改清单」链接（指向 KV 清单、Tab 注册表、MCP 分组三处权威来源）。

## 4. 里程碑

| 里程碑 | 内容 | 出口标准 |
|---|---|---|
| **M1 止血**（1 周） | ST-08a 测试门禁、ST-02 hash 路由、ST-01 拆分（可先拆 3 个最重 Tab：home / dashboard / drawing-review） | CI 拦红生效；`index.html` ≤ 2000 行；深链可用 |
| **M2 收敛**（1 周） | ST-01 拆完、ST-03 双实现收敛、ST-05 KV 清单 + CI lint | `index.html` < 800 行；statusMap 唯一；KV 清单入库 |
| **M3 补齐**（1 周） | ST-04 两个流程前端、ST-06 路由层、ST-07 key 统一、ST-08b staging、ST-09/10 | §2.1 指标全绿 |

## 5. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| 拆 3161 行单文件时行为回归 | 高 | 逐 Tab 迁移 + 每步对照现状截图回归；M1 先拆 3 个验证方法论；拆分期间冻结该文件的其他需求 |
| iframe 嵌入（ST-03 方案 A）带来登录态/高度问题 | 中 | 方案评审时用 drawing-review 做 spike，半天内出结论，不行转方案 B |
| KV 清单 lint 误报阻塞开发 | 低 | lint 先 warn 一周再转 error |
| staging 独立命名空间产生额外费用/配置漂移 | 低 | staging 用最小 binding；`wrangler.jsonc` 单文件双环境避免漂移 |

## 6. 与主 PRD 的关系

- 本迭代**不改 FE-01~FE-14 的任何功能行为**，但为它们还债：FE-06/07（首页布局）的渲染器是 ST-01 首批迁出对象；FE-09（审批待办）的降级路径依赖 ST-04 的引导态。
- 完成后建议将 ST 编号并入主 PRD V2.1（届时新建 `团队AI中台PRD_V2.1.md`，含 MCP 生态规划），本文档作为 V2.1 的工程先行部分归档。

---

## 7. 评审记录（2026-10-15）

**结论：通过。** M1（ST-08a + ST-02 + ST-01 首批 3 Tab）已按原计划启动。

评审发现与修订（评审人已部分核实现状，文档数据以评审日实测为准）：

1. **Tab 数量口径过期**：§1.1 写 10 个 Tab，评审日实测 13 个（home / my-tasks / drawing-review / reimburse / task-schedule / season-goals / apps / skills / docs / repos / dashboard / prd / agent）。ST-01/ST-02 的验收口径按 13 个执行；ST-04 落地后「更多」为 5 项的结论同步顺延。
2. **ST-08a 已落地**：随 V1.2 提交（2026-10-15）进入 `ci-cd.yml`（独立 test job，deploy 需 typecheck+test 双绿）。验收项「故意挂测试的 PR 被 CI 拦下」仍待实测勾选。
3. **resolveSession 三副本问题已清零**：唯一实现 `src/shared/session.ts`，27 个调用点全部收敛；`docs/页面与Tab状态现状.md` 问题 3 已同步标记解决。§1.2 痛点 8 仅剩 `user-prefs:hw:` 变体（ST-07 覆盖）。
4. **`web/` 废弃 Vite 脚手架需处置**：该目录是不完整的 Vue3 预研残留（缺 App.vue，build 必败），wrangler 不引用。建议本轮直接删除，或在 §2.2 非目标中显式交代去留，避免误导后续迭代。
5. **ST-03 方案 A/B**：维持「M2 开始前用 drawing-review 做半天 spike」的决策点，不提前锁方案。
