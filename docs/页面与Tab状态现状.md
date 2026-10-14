# NEC Hub 页面与 Tab 状态现状（含优化评估）

> 盘点日期：2026-10-14 ｜ 范围：`public/` 全部页面、`src/` Worker 路由与业务模块
> 用途：作为后续路由统一、双实现收敛、前端补齐等规划的输入基线。

---

## 1. 全景清单

### 1.1 页面（全站仅 3 个 HTML）

| 页面 | 路径 | 功能 | 文件 |
|---|---|---|---|
| 门户 Hub（单页应用） | `/` | Hero + 13 个 Tab，hash 路由 `#/<tab>` | `public/index.html`（676 行骨架）+ `public/portal/`（ES Module：main.js + shared/ + tabs/，ST-01 已拆 home/dashboard/drawing-review，M2 继续） |
| 图纸评审独立页 | `/apps/drawing-review/` | 新增机图纸评审全屏版 | `public/apps/drawing-review/index.html`（约 450 行） |
| 品牌视觉中心 | `/brand/` | Logo / PPT 模板 / VI 下载，无 Tab | `public/brand/index.html`（约 230 行） |

### 1.2 Worker 路由（`src/index.ts:166-237`）

- 页面：`/`（ASSETS）、`/apps/<name>/*`（R2，`serveApp :553`）、`/skills/<name>/SKILL.md`（R2，`serveSkill :576`）、兜底 `env.ASSETS.fetch :231`
- 通用 API：`/api/health|apps|skills|docs|config|whoami|dashboard|repos`、`POST /api/reimburse :1926`、`POST /auth/feishu|logout`、`POST /mcp :608-859`（14 个工具）
- 业务子路由（动态 import）：
  - `/api/drawing-review/*` → `src/drawing-review/`（8 个服务模块，**有前端**）
  - `/api/hardware-review/*` → `src/hardware-review/`（与图纸同构，**无前端**）
  - `/api/contract-approval/*` → `src/contract-approval/`（**无前端**）
  - 公共依赖：`src/feishu/bitable.ts`（三模块共用的多维表格客户端）

---

## 2. 三层级结构树

```
nec-hub（Cloudflare Worker · src/index.ts:166-237 路由入口）
│
├── L1 页面①：门户 Hub ── / ── public/index.html
│   │   机制：class 切换 tab-active/hidden（:443-450），无 URL 同步、无持久化
│   │
│   ├── L2 Tab1：应用广场 apps（默认激活）
│   │   └── L3：核心流程卡片区（仅图纸评审一张卡 :214-224）
│   │
│   ├── L2 Tab2：图纸评审 drawing-review（登录门控 :806-827）
│   │   ├── L3：看板/列表模式 DR_MODE（setDrMode :783-794）
│   │   ├── L3：状态筛选 chips DR_FILTER（filterDr :1106，每次点击整表重拉）
│   │   ├── L3：卡片点击 drOpen(:797) 切列表并展开详情
│   │   ├── L3：联想输入 suggestions（仅门户版有）
│   │   ├── L3：登录自动注入 designerId = ME.user.open_id（:812）
│   │   └── L3：底部链接 → 独立全屏页（:195）
│   │
│   ├── L2 Tab3：Skills 技能库 skills
│   │   └── L3：数据来自 /api/skills（R2 托管）
│   │
│   ├── L2 Tab4：资料 docs
│   │   └── L3：分类筛选 docsCat（全部/品牌规范/文档模板/制度SOP/培训材料 :664-668）
│   │       └── ⚠ 种子链接 /#tab-dashboard 断链（src/index.ts:1708）
│   │
│   ├── L2 Tab5：开源仓库 repos
│   │   ├── L3：来源筛选 reposHost（全部/GitHub/Gitee :690-694）
│   │   └── L3：表头排序 reposSort（sortRepos :712）
│   │
│   ├── L2 Tab6：数据看板 dashboard（财务区按角色 hidden/summary/full :1795）
│   │   └── L3：报销表单 REIMBURSE_NODE（:1298-1316，唯一做节点搬迁持久化的交互）
│   │
│   └── L2 Tab7：NEC-MCP agent
│       └── L3：MCP 14 工具说明展示
│
├── L1 页面②：图纸评审独立页 ── /apps/drawing-review/ ── public/apps/drawing-review/index.html
│   │   机制：router() 纯内存视图切换（:133-142），无 URL 同步、无登录态
│   ├── L2 视图1：列表 view-list（默认）
│   │   └── L3：看板/表格 displayMode + 状态筛选 chips（drFilter，含计数）；联想/登录态仍仅门户版有
│   ├── L2 视图2：提交 view-submit（手填 designerId :59，无登录门控 ⚠）
│   ├── L2 视图3：详情 view-detail（id 仅函数传参，刷新回列表；含询价/比价面板）
│   └── L2 隐藏模式：embedded（?embedded=1 / iframe 检测 :107-118）
│       └── ⚠ 死代码：门户已原生集成，无调用方；独立打开时无返回 Hub 链接
│
├── L1 页面③：品牌视觉中心 ── /brand/ ── public/brand/index.html（无 Tab）
│   ├── L2：锚点 section（标志/色彩/KV/PPT/禁忌）
│   ├── L3：点色块复制 HEX（:220-225）
│   └── L3：返回 Hub 链接（:112）——全站唯一跨页返回导航
│
├── L1 后端业务路由（src/index.ts 动态 import）
│   ├── L2：/api/drawing-review/*
│   │   └── L3：config/submit/list/board/start/suggestions/{id}/meeting/minutes/
│   │           conclusion/rectify/bom*/inquiries/task-suggestions
│   ├── L2：/api/hardware-review/*
│   │   └── L3：config/submit/list/start/{id}/meeting/minutes/conclusion/rectify/
│   │           report/assess/archive —— ⚠ 无前端页面
│   ├── L2：/api/contract-approval/*
│   │   └── L3：config/submit/list/start/{id}/start-review/action/comments —— ⚠ 无前端页面
│   └── L2：src/feishu/bitable.ts（公共客户端）
│
└── L1 全局状态（横跨所有页面）
    ├── L2：登录会话 ── Cookie nec_session + KV，7 天滑动续期
    │   └── L3：⚠ resolveSession 复制三份（各模块 resolveSessionFor*），副本不续期
    ├── L2：角色权限 ── resolveUserRole（:468-501，KV 缓存 60s）
    │   └── L3：财务明细仅队长/财务/指导可见
    ├── L2：OAuth ── sessionStorage nec_oauth_state（唯一前端 Web Storage）
    ├── L2：流程配置 ── 各业务 config 存 KV，缺失时 503 + 前端黄条
    └── L2：环境 ── ⚠ 无测试/生产切换，wrangler.jsonc 单环境
```

---

## 3. 问题清单（按严重度排序）

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| 1 | ~~`/#tab-dashboard` hash 断链：种子资料链接指向 hash，门户完全不读 hash~~ ✅ 已解决（2026-10-15，ST-02）：hash 路由升级为 `#/<tab>` 规范，旧式 `#tab-<x>` 自动升级兼容；未登录门控 Tab 深链经 `pendingHashTab` 暂存 + OAuth 往返 `sessionStorage` 桥接，登录后自动重放 | `portal/main.js` 路由层 | 已清零 |
| 2 | 图纸评审双实现部分漂移：独立页已同步筛选 chips 与询价/比价面板，联想/自动填人/登录态仍仅门户版有；`statusMap` 两处重复定义且文案略异 | `index.html:766-1156` vs `apps/drawing-review/index.html` | 维护双倍成本，部分行为不一致 |
| 3 | ~~会话解析复制三份，副本不含滑动续期~~ ✅ 已解决（2026-10-15）：`resolveSession` 已收敛至 `src/shared/session.ts` 唯一定义，全部 27 个调用点统一导入，滑动续期一致 | 原三模块 `resolveSessionFor*` | 已清零 |
| 4 | 硬件评审/合同审批后端就绪但无前端入口 | 门户仅 1 张流程卡 `:214-224` | 已建能力闲置 |
| 5 | 全部 Tab/筛选/视图状态零持久化（10+ 处内存变量） | 见结构树 L3 | 刷新即丢、不可分享链接 |
| 6 | embedded 模式死代码 + 独立页无返回 Hub 入口 | `apps/drawing-review/index.html:107-118` | 维护噪音、导航断头路 |
| 7 | 无测试/生产环境切换 | `wrangler.jsonc`、`scripts/deploy-hub.sh` | 改动直发生产，风险高 |
| 8 | 登出强制跳 Tab 靠 `click()` DOM 操作，较脆弱 | `index.html:817-819` | 竞态隐患 |

---

## 4. 优化评估与建议

### 4.1 总体判断

当前架构是"单页门户 + 散点独立页"，前端状态全部裸奔在内存变量上，没有路由层。随着硬件评审、合同审批前端补齐，Tab 数量和状态变量会持续膨胀，`index.html` 已 1500 行且持续变重。**现在引入 hash 路由 + 状态持久化，是成本最低的窗口期**——等业务前端补齐后再改，要动的状态点会多一倍。

### 4.2 分级建议

#### P0 —— 立即修复（缺陷级，成本极低）

1. **hash 路由支持**（修复问题 1、顺带改善 5、8）
   - 在 `index.html` 加初始化读 `location.hash` + `hashchange` 监听，Tab 切换时 `history.replaceState` 写 hash（形如 `#tab=drawing-review&mode=board&status=pending`）。
   - 收益：修复 `/#tab-dashboard` 断链；Tab 可分享、刷新不丢；登出跳转改为 `location.hash = 'apps'`，消除 DOM 竞态。
   - 成本：约 30 行原生 JS，不引入依赖。

2. ~~**收敛 resolveSession**（修复问题 3）~~ ✅ 已完成（2026-10-15）：唯一实现位于 `src/shared/session.ts`，全部模块经 `shared/module-gateway.ts` 等统一导入，无 `resolveSessionFor*` 残留。

#### P1 —— 近期改造（结构级，中等成本）

3. **收敛图纸评审双实现**（修复问题 2、6）
   - 推荐方案：以门户内嵌版为准（功能更全），独立页改为**直接重定向到 `/#tab=drawing-review`**；若保留独立页（全屏专注场景有价值），则抽取共享的 `statusMap`/API 调用层为公共模块，独立页复用并接入登录态（`whoami` + 自动填 designer）。
   - 同时删除 embedded 死代码，或反过来正式用 iframe 方案替代门户内嵌——二选一，不要维持第三态。
   - 关键决策点：独立页是否保留？建议先在团队内确认有无"脱离门户单独发给外部评审人"的场景。

4. **补齐硬件评审 / 合同审批前端**（修复问题 4）
   - 后端 API 与图纸评审同构，前端可**以图纸评审 Tab 为模板**复制改造：同套看板/列表/筛选/详情交互，换 API 前缀和字段映射。
   - 建议借机把"流程类 Tab"抽象成一个可配置组件（状态列定义 + 字段 schema + API 前缀三参数），第三个流程接入时边际成本趋近于零。
   - 门户"核心流程"卡片区同步补两张卡。

5. **L3 状态统一持久化**（修复问题 5）
   - 约定：`docsCat`、`reposHost`、`reposSort`、`DR_MODE` 等偏好类状态写 localStorage；`DR_FILTER` 等筛选类状态进 URL（可分享）。
   - 配合 P0 的 hash 路由一起做，避免两套状态源。

#### P2 —— 规划级（依赖排期）

6. **多环境支持**（修复问题 7）：`wrangler.jsonc` 增加 `env.staging`（独立 KV/R2 preview），`deploy-hub.sh` 支持 `--env staging`，前端顶部在非生产环境显示环境徽标。
7. **统一跨页导航**：品牌页、独立页统一加返回 Hub 的顶栏链接；长期可考虑把 `/brand/` 收编为门户一个 Tab，消灭第三页面。
8. **`index.html` 拆分**：1500 行单文件已接近可维护性上限，建议按 Tab 拆成 ES Module（`public/js/tabs/*.js`），配合流程 Tab 组件化（P1-4）一起做。

### 4.3 建议路线图

```
第一步（P0）：hash 路由 + resolveSession 收敛        → 缺陷清零，改动 < 100 行
第二步（P1-4）：流程 Tab 组件化 + 硬件/合同审批前端    → 用模板化摊薄两个新 Tab 的成本
第三步（P1-3）：图纸评审双实现收敛                     → 借组件化成果顺势统一
第四步（P1-5 + P2）：状态持久化规范 + 多环境 + 导航统一  → 体验与工程治理收尾
```

> 注：第二步先于第三步，是因为组件化后图纸评审门户版自然变成组件的一个实例，收敛双实现时可直接复用，避免先改一遍再推翻。
>
> **更新（2026-10-14）**：若采纳第 5 节的 React/Vue 框架化方案，第二~四步的"原生 JS 组件化"应直接替换为"按流程独立 SPA"路线，详见 5.4 迁移路线。

---

## 5. 框架化重构方案（React + Vue，按流程拆分）

### 5.1 选型评估

| 方案 | 评价 |
|---|---|
| 单一框架（React 或 Vue 全覆盖） | 工程成本最低，但不满足双栈诉求 |
| 同应用内 React/Vue 混用 | ❌ 禁止：运行时冲突、双份组件库与状态库 |
| **按流程页面级隔离，不同流程不同框架（推荐）** | 流程页本是独立 HTML（`/apps/<name>/` 走 R2），无共享运行时，天然隔离；团队同时积累双栈经验 |

### 5.2 框架分配

| 应用 | 框架 | 理由 |
|---|---|---|
| 图纸评审 `drawing-review-web` | **Vue 3 + Vite + Pinia + Vue Router** | 交互最重（看板/联想/筛选/详情），Vue 模板与响应式上手快，适合作为第一个迁移样板 |
| 硬件评审 `hardware-review-web` | **React + Vite + Zustand + React Router** | 与图纸同构，是验证"公共层跨框架复用"成色的试金石 |
| 合同审批 `contract-approval-web` | **React**（同硬件评审栈） | 流程最简，做 React 侧第二个实例，摊薄 React 模板成本 |
| 门户 Hub 壳 | 暂保持 vanilla + hash 路由（P0），最后评估是否迁 Vue | 壳的职责是导航与登录态，过早迁移收益低 |
| 品牌页 | 不迁移 | 纯静态展示页，无状态 |

### 5.3 工程结构（双栈不翻车的前提：公共层框架无关）

```
nec-hub/
├── src/                    # Worker 后端（不动，API 契约保持不变）
├── packages/
│   └── core/               # @nec/core：框架无关 TS 包
│       ├── api/            #   三个流程的 API client（fetch 封装 + 类型）
│       ├── constants/      #   statusMap 等（消灭当前两处重复定义）
│       ├── auth/           #   whoami / 登录跳转 / 会话角色
│       └── config/         #   环境变量、API base
├── apps/
│   ├── drawing-review-web/     # Vue 3 工程（Vite）
│   ├── hardware-review-web/    # React 工程（Vite）
│   └── contract-approval-web/  # React 工程（Vite）
└── public/                 # 门户壳 + 品牌页（现状保留）
```

关键约束：

- **公共层零框架依赖**：`@nec/core` 只允许纯 TS，不 import 任何 React/Vue API；框架相关的组件复用不做（双栈下跨框架共享组件得不偿失）。
- **构建产物走现有通道**：各 SPA `vite build` 输出静态文件，经 MCP `deploy_app` 或 wrangler 发布到 R2 `/apps/<name>/`，Worker 路由零改动。
- **路由模式**：SPA 用 history 模式 + `serveApp` 增加 404→index.html 回退（约 5 行，比对见 5.6.2），URL 干净可分享。
- **登录态**：各 SPA 启动时调 `/api/whoami`（`@nec/core` 封装），未登录跳转门户登录；消灭独立页"手填 designerId"的不一致。
- **门户集成方式**：门户 Tab 从"内嵌原生实现"改为**整页跳转**到各 SPA（比对见 5.6.1，iframe 仅保留为可选 embedded 模式）；Tab 点击 = `location.href = '/apps/<name>/'`。

### 5.4 迁移路线（替代原 4.3 第二~四步）

```
第〇步（P0 不变）：门户 hash 路由 + resolveSession 收敛
第一步：搭 monorepo（pnpm workspace）+ @nec/core 公共包
        抽 API client / statusMap / auth，类型与后端 src/ 对齐
第二步：图纸评审 Vue SPA 试点（最成熟流程，验证公共层与发布链路）
        门户图纸评审 Tab 改为整页跳转，原内嵌实现下线 → 双实现收敛自动完成
第三步：硬件评审 React SPA（复用 @nec/core，验证跨框架成色）
        → 门户"核心流程"补卡
第四步：合同审批 React SPA（模板复制，边际成本趋零）→ 补卡
第五步：门户壳评估迁移 Vue / 保持 vanilla；多环境、导航统一等 P2 收尾
```

### 5.6 方案比对与最佳用法结论

#### 5.6.1 门户集成方式比对（微前端五方案）

| 方案 | 双栈支持 | 体验 | 工程成本 | 结论 |
|---|---|---|---|---|
| **整页跳转（导航式）** | ✅ 天然隔离 | 中（整页加载，但可深链分享） | 极低 | ✅ **采用** |
| iframe 嵌入 | ✅ | 差（弹层遮罩、双滚动条、URL 不同步、高度自适应） | 低 | 仅保留为可选 embedded 模式 |
| Module Federation | ❌ 要求同框架同版本 | 好 | 高 | 双栈下不可行，排除 |
| qiankun / single-spa | ✅ 同页多框架共存 | 好 | 高（沙箱、生命周期注册） | 3 个应用属过度工程，排除 |
| Web Components | ✅ | 中 | 中高 | `@nec/core` 已框架无关，WC 收益不抵成本，排除 |

**最佳用法**：壳只做导航 + 登录态，流程页整页跳转 + 统一返回入口 + 深链可达。这是"页面级微前端"（Google 多产品线同款），小团队双栈场景的行业惯例——iframe 的弹层/滚动/URL 三大坑在评审这种重交互页面会被全部踩中。

#### 5.6.2 SPA 路由模式比对

| 模式 | Worker 改动 | URL 形态 | 结论 |
|---|---|---|---|
| hash 模式 | 零 | `/apps/drawing-review/#/review/123` | 可用但丑，双 hash 与门户 `#tab=` 语义混淆 |
| **history + 回退** | `serveApp` 加 404→index.html 回退（约 5 行） | `/apps/drawing-review/review/123` | ✅ **采用**——`serveApp` 已通配 `/apps/<name>/*`，只缺回退逻辑 |

#### 5.6.3 框架内最佳用法（防过度设计）

| 层 | Vue 侧 | React 侧 | 约束 |
|---|---|---|---|
| 组件 | Composition API + `<script setup>` | 函数组件 + Hooks | 禁 Options API / Class 组件 |
| 全局状态 | Pinia | Zustand | 不上 Vuex / Redux（流程页状态量不需要） |
| 数据获取 | **TanStack Query (Vue)** | **TanStack Query (React)** | ✅ 双栈统一心智的关键 |
| 路由 | Vue Router（history） | React Router（history） | — |
| 构建 | Vite | Vite | — |
| Monorepo | pnpm workspace | 同左 | 3~4 个包不上 Turborepo/Nx |

统一 **TanStack Query** 是双栈方案的核心收益：两侧数据层心智完全一致（缓存/重试/失效），`@nec/core` 的 API client 直接被两侧 Query 包装，后端契约变更只需改公共包。

#### 5.6.4 状态归属最佳实践（落实原 4.2-P1-5）

| 状态类型 | 存放 | 例子 |
|---|---|---|
| 筛选/分页/详情 id | **URL** | `?status=pending`、`/review/123`（可分享、可后退） |
| 视图偏好 | **localStorage** | 看板/列表模式 |
| 服务端数据 | **TanStack Query 缓存** | 评审单列表、详情（不进全局 store） |
| 会话级全局态 | Pinia/Zustand | 当前用户、流程配置（少量） |

### 5.5 风险与对策

| 风险 | 对策 |
|---|---|
| 双栈长期维护成本 | 公共层框架无关 + 每个 SPA 模板化（同栈第二个应用必须能从第一个复制改造 < 1 天） |
| 构建/发布链路复杂化 | 每个 app 固定 `build → deploy_app` 两步，写进根 package.json scripts |
| 整页跳转的加载白屏与"跳失感" | 各 SPA 首屏走 Vite 代码分割 + R2/CDN 缓存；门户与 SPA 统一顶栏样式与返回入口，视觉上像同一产品 |
| 团队 React/Vue 经验不均 | 图纸评审（Vue）由熟悉者试点并留脚手架 README，后续应用照抄 |

---

## 6. 中台架构选型：Serverless 薄中台

### 6.1 四选项比对

| 架构 | 典型代表 | 适用规模 | 运维成本 | 对本项目 |
|---|---|---|---|---|
| 重型中台（微服务+业务/数据中台） | 阿里/美团 | 数百人研发、多业务线 | 极高（服务治理/分库分表） | ❌ 过度工程 |
| 模块化单体 | 中型 SaaS | 20-100 人 | 中（常驻服务器） | ❌ 仍需运维 |
| **Serverless 薄中台** | 小团队/创新业务 | 3-20 人 | 极低 | ✅ **推荐，现状已是此形态** |
| 纯低代码拼装 | 无研发团队 | 非技术团队 | 零 | ❌ AI/MCP 集成表达力不足 |

### 6.2 五层参考架构（现状形式化）

```
┌─ 前端层   门户壳 + 页面级微前端 SPA（Vue/React，R2 托管）
├─ 接入层   Cloudflare Worker：路由 / 鉴权 / BFF 聚合
├─ 能力层   领域模块插件化：drawing-review | hardware-review | contract-approval
│           （同构子路由，新增业务 = 加一个模块 + 注册一行）
├─ 数据层   飞书多维表格（业务数据底座）+ KV（会话/配置）+ R2（制品）
└─ AI 层    MCP Server 统一暴露工具 ← "AI 中台"区别于传统中台的关键层
```

核心原则：

- **复用发生在代码层而非网络层**：`@nec/core` + `src/feishu/bitable.ts` 共享客户端，不做微服务拆分
- **数据底座外置**：飞书多维表格兼任数据库 + 管理后台 + 权限系统，省掉中台最重的数据建模后台与运营界面
- **AI 原生**：MCP 层让 Agent 与前端共用同一套业务能力，是差异化优势
- **契约先行**：Worker API 与 MCP schema 保持稳定，前后端/Agent 三端依赖同一契约

### 6.3 何时升级重型架构（出现信号再迁，不提前）

- 单流程日活破千，Worker/飞书 API 配额吃紧
- 多团队并发改同一领域模块、发布冲突频繁
- 出现跨流程强事务一致性需求（飞书表格无事务能力）
- 数据合规要求脱离飞书自存
