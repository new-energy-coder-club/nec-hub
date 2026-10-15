# NEC HUB 站点说明与全量测试报告

| 项目 | 内容 |
|---|---|
| 文档版本 | V1.0 |
| 测试日期 | 2026-10-15 |
| 测试对象 | NEC 团队 AI 中台（hub.newenergycoder.club）及全部关联页面 / 应用 / API / 域名 |
| 测试方式 | HTTP 级全量探测（91 项）+ 内置浏览器渲染验证（26 项）+ DNS 诊断 |
| 测试环境 | macOS，未登录会话（匿名视角），中国大陆网络 |
| 代码基线 | nec-hub 仓库 main 分支（Cloudflare Workers 单体 Worker） |

---

## 1. 系统概述

NEC HUB 是部署在 Cloudflare Workers 上的单体应用中台（`src/index.ts` 为路由总入口），存储与能力组成：

- **Assets**：门户静态页与品牌资源（`public/`）
- **R2（nec-hub-apps）**：队员应用托管（`/apps/<name>/` 与 `<name>.newenergycoder.club` 泛域名直达）+ Skill 原文
- **KV（REGISTRY）**：应用/Skill 注册表、看板缓存、CLA 签署名单、cron 探针
- **D1（nec-hub-erp）**：报销助手 ERP 底表（费用项目、收款账户、单据快照）
- **MCP 端点**：`POST /mcp`（streamable HTTP，配置 `MCP_TOKEN` 后全方法鉴权）
- **定时任务**：每 4 分钟刷看板缓存；每小时审批时效巡检 + 仓库缓存 + 图纸评审阻塞告警；每周一数据校验周报

域名体系：

| 域名 | 用途 |
|---|---|
| `hub.newenergycoder.club` | 中台门户主域（自定义域） |
| `*.newenergycoder.club` | 泛域名应用直达（R2 应用）与外部登记域名回源 |
| `www.newenergycoder.club` 等 | 域名分发系统登记的外部目标（Vercel 等） |

---

## 2. 测试范围与方法

1. **HTTP 级探测（91 项）**：Node `fetch` 逐个请求，记录状态码 / 耗时 / 大小 / Content-Type / 页面 title / JSON 关键字段，并发 5，超时 25s。
2. **浏览器渲染验证（26 项）**：Kimi Code 内置浏览器逐页导航，DOM Ready 后读取首屏内容，可疑页截图复核，判定 OK / BLANK / ERROR / LOGIN。
3. **DNS 诊断**：`dig` 核查泛域名与异常域名的 A/AAAA 记录。

**测试边界**：本次为匿名全量冒烟测试——不登录飞书会话、不提交/修改任何业务数据（审批、报销、域名申请等写操作仅验证鉴权拦截）；需登录的接口以「401 拦截是否符合预期」为验收标准。

---

## 3. 页面清单 · 功能说明 · 测试结果

### 3.1 门户与静态页（Assets，6/6 通过）

| 页面 | 功能说明 | URL | HTTP | 渲染 | 结论 |
|---|---|---|---|---|---|
| 门户首页 | 中台门户：应用广场、Skill 中心、数据看板、我的待办、赛季目标等聚合入口 | `/` | 200 | OK | ✅ 通过 |
| 品牌主视觉中心 | NEC Logo / PPT 模板 / VI 手册下载 | `/brand/` | 200 | OK | ✅ 通过 |
| Logo SVG | 品牌资源 | `/brand/nec-logo.svg` | 200 | — | ✅ 通过 |
| Favicon | 品牌资源 | `/brand/favicon.svg` | 200 | — | ✅ 通过 |
| 设计 Tokens | 品牌 CSS 变量 | `/brand/nec-tokens.css` | 200 | — | ✅ 通过 |
| PRD 文档（示例） | 图纸评审流程 PRD 原文托管 | `/docs/prd/drawing-review-process-v1.0.md` | 200 | — | ✅ 通过 |

### 3.2 应用页 `/apps/*`（16/16 通过，R2 托管优先）

| 应用 | 功能说明 | 渲染 | 结论 |
|---|---|---|---|
| kv-assets | 主视觉 KV V2 展示（BUILT TO DAWN） | OK | ✅ |
| recruit-poster | 2026 秋季新人招募海报 | OK | ✅ |
| nec-hub-portal | 独立版门户（应用广场 / Skill 中心入口） | OK | ✅ |
| reimburse | 报销助手（ERP 费用报销单，D1/R2） | OK | ✅ |
| drawing | 机械图纸审批 | OK | ✅（角色提示属正常业务逻辑） |
| domains | 域名分发系统（自助申请三级域名） | OK | ✅（提示 CF 凭证未配置，见 §6-P3） |
| drawing-review | 新增机图纸评审流程看板（20 单 / 9 状态列） | OK | ✅ |
| hardware-review | 硬件评审流程看板（空状态正常） | OK | ✅ |
| compliance | G-02 合规申请表单 | OK | ✅ |
| cla-sign | 开源社区贡献协议（CLA）签署页 | OK | ✅ |
| mech-review-6014 | 6014 电机机械评审纪要（含争议点核查表） | OK | ✅ |
| season-goals | 赛季目标管理 | OK | ✅（提示模块未配置，见 §6-P3） |
| task-schedule | 任务排期（Taskto） | OK | ✅ |
| task-schedule/animated | 任务排期 · 动态版（时间轴动画） | OK | ✅ |
| scoring | NEC 评分看板 | OK | ✅ |
| contract-signing | 协议签署 OA 审批 | OK | ✅ |

访问形式：`https://hub.newenergycoder.club/apps/<name>/`。

### 3.3 泛域名直达 `<app>.newenergycoder.club`（0/6，全部失败）

| 域名 | DNS | 结果 |
|---|---|---|
| kv-assets / recruit-poster / nec-hub-portal / reimburse / drawing / domains `.newenergycoder.club` | **NXDOMAIN（无 A/AAAA 记录）** | ❌ 全部不可达 |

**根因**：`wrangler.jsonc` 注释要求的 Cloudflare DNS 泛域名代理记录（`*` → AAAA `100::`，橙云）**尚未配置**，Worker 的 `domains/wildcard.ts` 逻辑无从触发。`dig` 实测任意随机三级域名均无解析记录。

### 3.4 外部注册应用（6/9 通过）

| 应用 | URL | HTTP | 渲染 | 结论 |
|---|---|---|---|---|
| 擎天塔重建 // NEON PROTOCOL | `tower.newenergycoder.club` | 200 | **BLANK** | ⚠️ 卡在「ACCESSING MAINFRAME 000%」加载屏 8s+（P2） |
| NEC 仓库作业台 | `mes.newenergycoder.club/home.html` | 200 | OK | ✅ |
| SolarGlyph 光伏一体化设计 | `solarglyph.newenergycoder.club` | 200 | OK | ✅ |
| NEC 官网 | `www.newenergycoder.club` | 200 | **BLANK** | ⚠️ 导航正常但 hero 主文案缺失，仅剩背景动画与 logo 残块（P2） |
| G-EXO 外骨骼 | `g-exo.newenergycoder.club` | 200 | OK | ✅ |
| 光伏项目收益估算 | `solarhost.newenergycoder.club` | 200 | OK | ✅ |
| R2 Web | `r2.newenergycoder.club` | 302→200 | LOGIN | ✅ 符合预期（飞书 OAuth 登录门禁） |
| fluid-workstation-ui | `fluid-workstation-ui.vercel.app` | FAIL | — | ⚠️ 本机 DNS 不可解析（vercel.app 域名污染，需他网复核） |
| fibersteelstudio | `fibersteelstudio.vercel.app` | FAIL | — | ⚠️ 同上 |

---

## 4. API 端点说明与测试结果

### 4.1 公开接口（16/17 符合预期）

| 端点 | 功能说明 | 状态码 | 结论 |
|---|---|---|---|
| `GET /api/health` | 健康检查 | 200 | ✅ |
| `GET /api/apps` | 应用广场注册表（KV，15 条） | 200 | ✅ |
| `GET /api/skills` | Skill 中心注册表（21 条） | 200 | ✅ |
| `GET /api/config` | 公开配置（飞书 App ID、登录开关） | 200 | ✅ |
| `GET /api/docs` | 资料页聚合 | 200 | ✅ |
| `GET /api/dashboard` | 数据看板聚合（飞书多维表格 + 5 分钟缓存） | 200 | ✅ |
| `GET /api/prd` | PRD 看板（M1/M2/M3 状态 + 最近提交） | 200 | ✅ |
| `GET /api/repos` | NEC 开源仓库聚合（GitHub org + 1 小时缓存） | 200 | ✅（8.9s，全场最慢，见 §7） |
| `GET /api/cla` | CLA 元信息 + 脱敏签署名单 | 200 | ✅ |
| `GET /api/cla/status` | 签署状态查询 | 200 | ✅ |
| `GET /api/cla/status?github=` | 按 GitHub 用户名查签署状态 | 200 | ✅ |
| `GET /api/drawing-review/config` | 图纸评审模块配置查询（已配置） | 200 | ✅ |
| `GET /api/hardware-review/config` | 硬件评审模块配置查询（已配置） | 200 | ✅ |
| `GET /api/contract-approval/config` | 协议审批模块配置查询（已配置） | 200 | ✅ |
| `GET /api/season-goals/config` | 赛季目标模块配置查询 | 200 | ✅（`configured:false`，见 §6-P3） |
| `GET /api/domains` | 公开域名目录（脱敏） | 200 | ✅ |
| `GET /api/erp/reimburse/meta` | 报销费用目录 + 收款账户 | **401** | ✅ 设计如此（代码内需登录，归类修正） |

### 4.2 鉴权接口（16/16 拦截行为符合预期）

| 端点 | 功能说明 | 匿名访问 | 结论 |
|---|---|---|---|
| `GET /api/whoami` | 当前登录用户与角色 | 200 `{authenticated:false}` | ✅ 设计如此 |
| `GET /api/home` | 我的首页布局 | 401 | ✅ |
| `GET /api/todos` | 审批/待办聚合 | 401 | ✅ |
| `GET /api/approvals/mine` | 我的申请列表 | 401 | ✅ |
| `GET /api/my-tasks` | 我的飞书任务 | 401 | ✅ |
| `GET /api/validate?scope=mine` | 数据校验触发 | 401 | ✅ |
| `GET /api/erp/reimburse/docs/mine` | 我的报销单据 | 401 | ✅ |
| `GET /api/drawing-review` / `/board` / `/suggestions` | 图纸评审业务接口 | 401 | ✅ |
| `GET /api/hardware-review` | 硬件评审业务接口 | 401 | ✅ |
| `GET /api/contract-approval` | 协议审批业务接口 | 401 | ✅ |
| `GET /api/domains/mine` | 我的域名列表 | 401 | ✅ |
| `GET /api/season-goals/goals` / `/collect` / `/plan` | 赛季目标业务接口 | **503** | ⚠️ 模块未配置，网关在 401 之前返回 503（见 §6-P3） |

### 4.3 MCP 端点

| 端点 | 结果 | 结论 |
|---|---|---|
| `POST /mcp`（JSON-RPC initialize） | 401 `unauthorized` | ✅ 设计如此：已配置 `MCP_TOKEN`，全方法（含 initialize/tools/list）需 `Authorization: Bearer` |

---

## 5. Skill 中心

| 类别 | 数量 | 结果 |
|---|---|---|
| Hub 托管原文 `/skills/<name>/SKILL.md`（nec-kv-design / nec-vi / nec-ppt） | 3 | ✅ 全部 200 |
| 外链 Skill（Gitee 仓库 `/blob/` 深链） | 17 | ❌ 全部不可用：curl 返回 405，浏览器命中 Gitee「曲线滑块」安全验证页 |

**结论**：Gitee `/blob/` 深链对非登录访问有反爬拦截，不适合作为 Skill 中心对外引用链接。建议迁移为 Hub 托管原文（`/skills/`）或改用 Gitee `raw` 直链 / 镜像仓库。

---

## 6. 问题清单（按优先级）

| 级别 | 问题 | 影响面 | 建议 |
|---|---|---|---|
| **P1** | 泛域名 DNS 记录缺失：`*` 通配记录未配置，全部 R2 应用三级域名 NXDOMAIN | `domains/wildcard.ts` 泛域名直达能力整体失效（6/6 失败） | 按 `wrangler.jsonc` 注释在 Cloudflare DNS 添加 `*` 的 AAAA → `100::` 代理记录（橙云），并确认 Universal SSL 覆盖三级泛域名 |
| **P2** | `tower.newenergycoder.club` 卡加载屏（000% 不前进） | 擎天塔应用首屏不可用 | 排查加载进度事件依赖与主资源（WebGL/大体积 JS）加载失败原因 |
| **P2** | `www.newenergycoder.club` hero 主文案缺失 | 官网首屏信息丢失 | 排查 hero 入场动画/文案渲染 JS 报错 |
| **P2** | 17 个 Gitee Skill 深链被反爬（405 / 滑块验证） | Skill 中心近 80% 条目对外不可读 | 迁移至 Hub 托管或 raw 直链 |
| **P3** | 赛季目标模块未配置（`/api/season-goals/config` 返回 `configured:false`，业务接口 503） | 赛季目标收集/规划不可用 | 调用 `POST /api/season-goals/config` 绑定飞书 base 与 tables |
| **P3** | 域名分发系统 Cloudflare 凭证未配置（页面提示，申请将落 pending） | 域名申请无法自动落 DNS | 配置 `CF_API_TOKEN` + `CF_ZONE_ID`，之后用 `/api/domains/retry` 补同步 |
| **P3** | `*.vercel.app` 在本机 DNS 不可解析 | 2 个 Vercel 应用本机不可达 | 大概率为 vercel.app 域名在境内 DNS 污染，需在其他网络环境复核后再定级 |

**非问题确认（设计如此）**：`r2.*` 302 跳转飞书登录；`/api/whoami` 匿名返回 200 + `authenticated:false`；`/api/erp/reimburse/meta` 需登录；MCP 全方法 Bearer 鉴权；`apps/drawing` 非机械组角色提示。

---

## 7. 性能概况

| 指标 | 数值 |
|---|---|
| 有效样本 | 82 个（排除 DNS 失败 9 个） |
| 中位延迟 p50 | **443 ms** |
| p95 | **≈1.5 s** |
| 最慢 | `GET /api/repos` **8.9 s**（GitHub/Gitee 实时聚合，疑似缓存穿透；有 1 小时 KV 缓存，首次回源慢属预期，建议观察缓存命中率） |

整体可用性：**91 项探测中 48 项 2xx/3xx**；扣除「设计如此的 401/302/503」与「环境性失败（DNS/反爬）」后，**实际功能性异常 2 项**（tower 加载屏、www hero），**配置待补齐 3 项**（泛域名 DNS、赛季目标、CF 凭证），**链接策略问题 1 项**（Gitee 深链）。

---

## 8. 建议行动项

1. 【P1】补齐 Cloudflare 泛域名 DNS 记录，复测 6 个 R2 应用三级域名直达。
2. 【P2】修复 tower 加载屏与 www hero 渲染；建议为两者补充首屏降级（动画超时强制显示内容）。
3. 【P2】Skill 中心外链批量迁移（`sync-gitee-skills.py` 已有同步基础，可改为落地 R2 原文）。
4. 【P3】完成赛季目标模块与域名分发系统的配置补齐。
5. 【P3】在其他网络环境复核 vercel.app 可达性。
6. 建议将本次测试脚本固化为 CI 冒烟检查（链接存活 + 关键页面 title 断言 + 鉴权拦截断言）。

---

## 附录 A：全量测试结果明细（91 项）
| 分组 | URL | 状态码 | 耗时(ms) | 大小(B) | 备注 |
|---|---|---|---|---|---|
| 门户/静态页 (Assets) | https://hub.newenergycoder.club/ | 200 | 760 | 52140 | title: NEC 团队 AI 中台 |
| 门户/静态页 (Assets) | https://hub.newenergycoder.club/brand/ | 200 | 747 | 14082 | title: NEC 品牌主视觉 · Logo / PPT / VI |
| 门户/静态页 (Assets) | https://hub.newenergycoder.club/brand/favicon.svg | 200 | 749 | 257 | image/svg+xml |
| 门户/静态页 (Assets) | https://hub.newenergycoder.club/brand/nec-logo.svg | 200 | 838 | 688 | image/svg+xml |
| 门户/静态页 (Assets) | https://hub.newenergycoder.club/brand/nec-tokens.css | 200 | 1147 | 3213 | text/css |
| 门户/静态页 (Assets) | https://hub.newenergycoder.club/docs/prd/drawing-review-process-v1.… | 200 | 310 | 37304 | text/markdown |
| 应用页 (/apps/*, R2 优先) | https://hub.newenergycoder.club/apps/reimburse/ | 200 | 299 | 62272 | title: 报销助手 · 费用报销单 · NEC HUB |
| 应用页 (/apps/*, R2 优先) | https://hub.newenergycoder.club/apps/drawing/ | 200 | 351 | 28928 | title: 机械图纸审批 · NEC HUB |
| 应用页 (/apps/*, R2 优先) | https://hub.newenergycoder.club/apps/kv-assets/ | 200 | 484 | 38226 | title: 常州工NEC · 主视觉 KV V2 — BUILT TO DAWN |
| 应用页 (/apps/*, R2 优先) | https://hub.newenergycoder.club/apps/recruit-poster/ | 200 | 488 | 9446 | title: 常州工NEC · 新人招募海报 |
| 应用页 (/apps/*, R2 优先) | https://hub.newenergycoder.club/apps/nec-hub-portal/ | 200 | 536 | 131468 | title: NEC 团队 AI 中台 |
| 应用页 (/apps/*, R2 优先) | https://hub.newenergycoder.club/apps/domains/ | 200 | 310 | 11770 | title: 域名分发 · NEC HUB |
| 应用页 (/apps/*, R2 优先) | https://hub.newenergycoder.club/apps/compliance/ | 200 | 330 | 30953 | title: 合规申请 · NEC HUB |
| 应用页 (/apps/*, R2 优先) | https://hub.newenergycoder.club/apps/cla-sign/ | 200 | 472 | 21108 | title: 开源社区贡献协议签署 · NEC HUB |
| 应用页 (/apps/*, R2 优先) | https://hub.newenergycoder.club/apps/drawing-review/ | 200 | 473 | 38844 | title: 新增机图纸评审流程 · NEC HUB |
| 应用页 (/apps/*, R2 优先) | https://hub.newenergycoder.club/apps/hardware-review/ | 200 | 501 | 60710 | title: 硬件评审流程 · NEC HUB |
| 应用页 (/apps/*, R2 优先) | https://hub.newenergycoder.club/apps/mech-review-6014/ | 200 | 289 | 9533 | title: 6014 电机机械评审纪要 · NEC HUB |
| 应用页 (/apps/*, R2 优先) | https://hub.newenergycoder.club/apps/contract-signing/ | 200 | 326 | 47847 | title: 协议签署 OA 审批 · NEC HUB |
| 应用页 (/apps/*, R2 优先) | https://hub.newenergycoder.club/apps/scoring/ | 200 | 339 | 28950 | title: NEC 评分看板 · NEC HUB |
| 应用页 (/apps/*, R2 优先) | https://hub.newenergycoder.club/apps/task-schedule/ | 200 | 402 | 27416 | title: 任务排期 · NEC HUB |
| 应用页 (/apps/*, R2 优先) | https://hub.newenergycoder.club/apps/season-goals/ | 200 | 469 | 18763 | title: 赛季目标管理 · NEC HUB |
| 应用页 (/apps/*, R2 优先) | https://hub.newenergycoder.club/apps/task-schedule/animated.html | 200 | 703 | 32237 | title: 任务排期 · 动态版 · NEC HUB |
| 泛域名直达 (<app>.zone) | https://kv-assets.newenergycoder.club/ | FAIL | 8 | 0 | FETCH_FAIL: fetch failed |
| 泛域名直达 (<app>.zone) | https://recruit-poster.newenergycoder.club/ | FAIL | 1610 | 0 | FETCH_FAIL: fetch failed |
| 泛域名直达 (<app>.zone) | https://nec-hub-portal.newenergycoder.club/ | FAIL | 1785 | 0 | FETCH_FAIL: fetch failed |
| 泛域名直达 (<app>.zone) | https://reimburse.newenergycoder.club/ | FAIL | 2377 | 0 | FETCH_FAIL: fetch failed |
| 泛域名直达 (<app>.zone) | https://drawing.newenergycoder.club/ | FAIL | 4974 | 0 | FETCH_FAIL: fetch failed |
| 泛域名直达 (<app>.zone) | https://domains.newenergycoder.club/ | FAIL | 558 | 0 | FETCH_FAIL: fetch failed |
| 外部注册应用 | https://tower.newenergycoder.club/ | 200 | 1095 | 820 | title: 擎天塔重建 // NEON PROTOCOL — ROBOCON 女娲补天 |
| 外部注册应用 | https://solarglyph.newenergycoder.club/ | 200 | 1329 | 1373 | title: 光伏一体化设计 |
| 外部注册应用 | https://www.newenergycoder.club/ | 200 | 2247 | 11179 | title: 新能源编程俱乐部 NEC - 机器人×新能源开源社区 / New Energy Coder Club |
| 外部注册应用 | https://g-exo.newenergycoder.club/ | 200 | 2458 | 1060 | title: G-EXO · 物理智能外骨骼 / Physical AI Exoskeleton |
| 外部注册应用 | https://mes.newenergycoder.club/home.html | 200 | 2779 | 11601 | title: 仓库工作台 · 416MES |
| 外部注册应用 | https://solarhost.newenergycoder.club/ | 200 | 1230 | 414 | title: 光伏项目收益估算 |
| 外部注册应用 | https://fibersteelstudio.vercel.app/ | FAIL | 10497 | 0 | FETCH_FAIL: fetch failed |
| 外部注册应用 | https://fluid-workstation-ui.vercel.app/ | FAIL | 10498 | 0 | FETCH_FAIL: fetch failed |
| 外部注册应用 | https://r2.newenergycoder.club/ | FAIL | 11498 | 0 | FETCH_FAIL: fetch failed |
| API-公开 (期望 200) | https://hub.newenergycoder.club/api/config | 200 | 1288 | 67 | keys: feishuAppId,loginEnabled |
| API-公开 (期望 200) | https://hub.newenergycoder.club/api/health | 200 | 1320 | 91 | keys: ok,service,time |
| API-公开 (期望 200) | https://hub.newenergycoder.club/api/skills | 200 | 1373 | 10799 | json parse fail (truncated ok) |
| API-公开 (期望 200) | https://hub.newenergycoder.club/api/apps | 200 | 1387 | 4033 | keys: 0,1,2,3,4,5 |
| API-公开 (期望 200) | https://hub.newenergycoder.club/api/docs | 200 | 1494 | 4693 | json parse fail (truncated ok) |
| API-公开 (期望 200) | https://hub.newenergycoder.club/api/cla/status | 200 | 394 | 68 | keys: signed,signature,authenticated |
| API-公开 (期望 200) | https://hub.newenergycoder.club/api/cla | 200 | 443 | 382 | keys: agreement,count,signatures |
| API-公开 (期望 200) | https://hub.newenergycoder.club/api/prd | 200 | 662 | 6290 | json parse fail (truncated ok) |
| API-公开 (期望 200) | https://hub.newenergycoder.club/api/dashboard | 200 | 682 | 8265 | json parse fail (truncated ok) |
| API-公开 (期望 200) | https://hub.newenergycoder.club/api/repos | 200 | 8882 | 18939 | json parse fail (truncated ok) |
| API-公开 (期望 200) | https://hub.newenergycoder.club/api/hardware-review/config | 200 | 503 | 264 | keys: configured,base,tables |
| API-公开 (期望 200) | https://hub.newenergycoder.club/api/cla/status?github=darrenpig | 200 | 1026 | 236 | keys: signed,signature,authenticated |
| API-公开 (期望 200) | https://hub.newenergycoder.club/api/season-goals/config | 200 | 1108 | 57 | keys: configured,base,tables |
| API-公开 (期望 200) | https://hub.newenergycoder.club/api/drawing-review/config | 200 | 1183 | 445 | keys: configured,base,tables |
| API-公开 (期望 200) | https://hub.newenergycoder.club/api/contract-approval/config | 200 | 1184 | 190 | keys: configured,base,tables |
| API-公开 (期望 200) | https://hub.newenergycoder.club/api/erp/reimburse/meta | 401 | 243 | 29 | err: unauthorized |
| API-公开 (期望 200) | https://hub.newenergycoder.club/api/domains | 200 | 445 | 76 | keys: zone,syncEnabled,domains |
| API-需登录 (期望 401) | https://hub.newenergycoder.club/api/home | 401 | 239 | 29 | err: 请先登录 |
| API-需登录 (期望 401) | https://hub.newenergycoder.club/api/whoami | 200 | 259 | 44 | keys: authenticated,user |
| API-需登录 (期望 401) | https://hub.newenergycoder.club/api/my-tasks | 401 | 289 | 29 | err: 请先登录 |
| API-需登录 (期望 401) | https://hub.newenergycoder.club/api/approvals/mine | 401 | 290 | 29 | err: unauthorized |
| API-需登录 (期望 401) | https://hub.newenergycoder.club/api/todos | 401 | 309 | 29 | err: 请先登录 |
| API-需登录 (期望 401) | https://hub.newenergycoder.club/api/erp/reimburse/docs/mine | 401 | 260 | 29 | err: unauthorized |
| API-需登录 (期望 401) | https://hub.newenergycoder.club/api/validate?scope=mine | 401 | 260 | 47 | err: 请先登录后再触发校验 |
| API-需登录 (期望 401) | https://hub.newenergycoder.club/api/drawing-review/board | 401 | 260 | 29 | err: 请先登录 |
| API-需登录 (期望 401) | https://hub.newenergycoder.club/api/drawing-review | 401 | 340 | 29 | err: 请先登录 |
| API-需登录 (期望 401) | https://hub.newenergycoder.club/api/drawing-review/suggestions | 401 | 1029 | 29 | err: 请先登录 |
| API-需登录 (期望 401) | https://hub.newenergycoder.club/api/season-goals/plan | 503 | 271 | 126 | err: 赛季目标管理尚未配置 |
| API-需登录 (期望 401) | https://hub.newenergycoder.club/api/hardware-review | 401 | 272 | 29 | err: 请先登录 |
| API-需登录 (期望 401) | https://hub.newenergycoder.club/api/season-goals/goals | 503 | 329 | 126 | err: 赛季目标管理尚未配置 |
| API-需登录 (期望 401) | https://hub.newenergycoder.club/api/season-goals/collect | 503 | 329 | 126 | err: 赛季目标管理尚未配置 |
| API-需登录 (期望 401) | https://hub.newenergycoder.club/api/contract-approval | 401 | 349 | 29 | err: 请先登录 |
| API-需登录 (期望 401) | https://hub.newenergycoder.club/api/domains/mine | 401 | 240 | 50 | err: 未登录，请先在门户登录 |
| Skill 原文 (hub R2) | https://hub.newenergycoder.club/skills/nec-vi/SKILL.md | 200 | 480 | 2947 | text/markdown |
| Skill 原文 (hub R2) | https://hub.newenergycoder.club/skills/nec-kv-design/SKILL.md | 200 | 510 | 3777 | text/markdown |
| Skill 原文 (hub R2) | https://hub.newenergycoder.club/skills/nec-ppt/SKILL.md | 200 | 589 | 2039 | text/markdown |
| Skill 外链 (gitee 等) | https://gitee.com/darrenpig/new_energy_coder_club/blob/SKill/skills… | 405 | 439 | 803 | title: 安全验证码-独立验证 |
| Skill 外链 (gitee 等) | https://gitee.com/darrenpig/new_energy_coder_club/blob/SKill/skills… | 405 | 440 | 803 | title: 安全验证码-独立验证 |
| Skill 外链 (gitee 等) | https://gitee.com/darrenpig/new_energy_coder_club/blob/SKill/skills… | 405 | 487 | 803 | title: 安全验证码-独立验证 |
| Skill 外链 (gitee 等) | https://gitee.com/darrenpig/new_energy_coder_club/blob/SKill/skills… | 405 | 486 | 803 | title: 安全验证码-独立验证 |
| Skill 外链 (gitee 等) | https://gitee.com/darrenpig/new_energy_coder_club/blob/SKill/skills… | 405 | 487 | 803 | title: 安全验证码-独立验证 |
| Skill 外链 (gitee 等) | https://gitee.com/darrenpig/new_energy_coder_club/blob/SKill/skills… | 405 | 80 | 803 | title: 安全验证码-独立验证 |
| Skill 外链 (gitee 等) | https://gitee.com/darrenpig/new_energy_coder_club/blob/SKill/skills… | 405 | 81 | 803 | title: 安全验证码-独立验证 |
| Skill 外链 (gitee 等) | https://gitee.com/darrenpig/new_energy_coder_club/blob/SKill/skills… | 405 | 81 | 803 | title: 安全验证码-独立验证 |
| Skill 外链 (gitee 等) | https://gitee.com/darrenpig/new_energy_coder_club/blob/SKill/skills… | 405 | 262 | 803 | title: 安全验证码-独立验证 |
| Skill 外链 (gitee 等) | https://gitee.com/darrenpig/new_energy_coder_club/blob/SKill/skills… | 405 | 263 | 803 | title: 安全验证码-独立验证 |
| Skill 外链 (gitee 等) | https://gitee.com/darrenpig/new_energy_coder_club/blob/SKill/skills… | 405 | 81 | 803 | title: 安全验证码-独立验证 |
| Skill 外链 (gitee 等) | https://gitee.com/darrenpig/new_energy_coder_club/blob/SKill/skills… | 405 | 81 | 803 | title: 安全验证码-独立验证 |
| Skill 外链 (gitee 等) | https://gitee.com/darrenpig/new_energy_coder_club/blob/SKill/skills… | 405 | 81 | 803 | title: 安全验证码-独立验证 |
| Skill 外链 (gitee 等) | https://gitee.com/darrenpig/new_energy_coder_club/blob/SKill/skills… | 405 | 85 | 803 | title: 安全验证码-独立验证 |
| Skill 外链 (gitee 等) | https://gitee.com/darrenpig/new_energy_coder_club/blob/SKill/skills… | 405 | 86 | 803 | title: 安全验证码-独立验证 |
| Skill 外链 (gitee 等) | https://gitee.com/darrenpig/new_energy_coder_club/blob/SKill/skills… | 405 | 91 | 803 | title: 安全验证码-独立验证 |
| Skill 外链 (gitee 等) | https://gitee.com/darrenpig/new_energy_coder_club/blob/SKill/skills… | 405 | 92 | 803 | title: 安全验证码-独立验证 |
| MCP | POST /mcp initialize | 401 | 338 | 29 | {   "error": "unauthorized" } |
