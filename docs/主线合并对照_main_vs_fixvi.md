# 主线合并对照：main ↔ fix/vi-blueprint-grid-v1.1

> 日期：2026-10-14
> 更新：2026-10-14 晚 — A 组 5 项全部移植完成（含本次通知域/visibleApps），B 组 send_notice 与文档搬运完成；A/B 剩余工作量见文末。
> 背景：两条分支从 `e9c32af` 分叉。main 独有 10 个提交（OA 审批引擎线），fix/vi 独有 18 个提交（域拆分重构 + 评审域 + 首页 + 性能）。生产当前运行 fix/vi。
> 结论先行：**以 fix/vi 为存续主线**（架构更可持续、功能面更广），main 的能力按本清单**移植**（不是整体合并），完成后 main 归档只读。
> 试合并结果：仅 4 文件冲突（.gitignore / README / index.html / src/index.ts），其中 src/index.ts 为结构性冲突（单体 vs 域拆分），故走"能力移植"而非 git merge。

---

## A. 必须移植（fix/vi 缺口 / 含 bug 修复）

| 能力 | main 位置 | fix/vi 现状 | 移植说明 |
|---|---|---|---|
| **会话滑动续期 bug 修复**（同 sid 原地续期，消除第 4~7 天掉登录） | `resolveSession`（无 renewed 管线） | ✅ `94fc174`（2026-10-14，未部署） | 同 sid 原地续期，renewed 恒空；模块网关测试同步改写 |
| **报销审批动作**（approve / reject / pay，幂等 + 状态前置校验） | `/api/approvals/:type/:id/<action>` + `ACTION_TARGET` 状态机 | ✅ `c9fcfb9`（2026-10-14，未部署） | `src/reimburse.ts` 按 main 语义重写：角色门禁、状态机、幂等、字段模糊匹配 |
| **我的报销列表** | `GET /api/approvals/mine`（open_id 过滤、按提交时间倒序） | ✅ `c9fcfb9`（2026-10-14，未部署） | `GET /api/reimburse/mine` |
| **签名 webhook 群通知**（含 2 个已修复 bug：加签算法 string_to_sign 作 HMAC 密钥、`msg_type`/`content` 消息体） | `notifyFeishu` / `feishuBotSign` / `recordNotifyFailure` | ✅ 本次移植（2026-10-14，未部署） | `src/feishu/notify.ts`：加签/多群分流/重试/失败留痕；报销提交与 approve/reject/pay 已接入，单测 7 例全绿。Secrets 沿用 `FEISHU_BOT_WEBHOOK[_<TYPE>][_SECRET]`，生产已配置主群 |
| **应用广场按角色过滤** `visibleApps` | `/api/apps` 路由 | ✅ 本次移植（2026-10-14，未部署） | `src/hosting.ts` visibleApps + `/api/apps` 接入，单测 4 例全绿 |

## B. 建议移植（高价值）

| 能力 | main 位置 | fix/vi 现状 | 说明 |
|---|---|---|---|
| 通用审批引擎概念（flows:config：type→表/审批人/校验规则的声明式配置） | `flows:config` + `evalFlowFields` | ❌ 各评审域有独立 config（drawing/hardware/contract 各自的 config_xxx MCP） | 不必照搬实现；建议在 shared 层抽一个轻量 `flow-config` 约定，让第 5 条流程新增成本趋近零代码 |
| MCP `send_notice(flow, title, content)` | 工具表 | ✅ 本次移植（2026-10-14） | `src/mcp`：schema + toolSendNotice + 分发 + instructions，需 MCP_TOKEN |
| 引擎侧金额 >0 校验字段集 | `evalFlowFields`（报销金额/金额/数量/预估总价/预估加工费） | 待核对各域校验 | 报销域已有 `amount <= 0` 客户端校验；若其余域已有等价校验则弃用 |
| PRD_审批与通知中心_V1.1 + 两份 PRD 的 §0 状态总览 | `docs/`（main） | ✅ 本次搬运（2026-10-14） | 已复制入 fix/vi docs 并按 fix/vi 实际重标 §0 |

## C. 已被 fix/vi 覆盖（main 版弃用）

| main 能力 | fix/vi 对应物 | 备注 |
|---|---|---|
| 4-flow 通用审批引擎 + `/api/approvals` 路由族 | `reimburse.ts` + `drawing-review/` + `hardware-review/` + `contract-approval/` 按域重写 | fix/vi 版更强：multipart 文件上传、询价比价、飞书会议预约。main 的 `submit_approval/list_todos/config_flows` MCP 被各域 config 工具替代，**弃** |
| 门户报销表单 Tab（main 第 7 Tab） | 前端 home 组件（线上 42 处报销引用） | 需人工核对字段 parity（main 用中文字段直连，fix/vi 用 item/amount 英文 + matchField 模糊匹配） |
| `setup_bitable` MCP 一键建表 | 待核对（fix/vi 的 validation/feishu 域可能有等价物） | 若无则按 B 组顺手补 |
| MCP `whoami` 工具 | ✅ 已移植（2026-10-14 深夜） | `src/mcp`：schema + toolWhoami + 分发；MCP_TOKEN=admin / user_token=身份+角色，单测 5 例 |
| 数据校验 `validate_bitable` | `validation/` 域（report/run 已上线） | fix/vi 版更完整（规则可配置 + 报告接口），**弃 main 版** |
| FE-01 登录态主体（会话/whoami/财务脱敏） | `auth/` 域 | 已覆盖，仅续期 bug 除外（见 A 组） |

## D. 两边都没有（需要新做）

| 事项 | 说明 |
|---|---|
| **飞书邮件通道（N-02 替代方案）** | 已验证：飞书 `mail/v1/user_mailboxes/me/drafts` API 可用（lark-cli `mail +draft-create/+draft-send`，lark-mcp 有 mail_v1 工具包），scope `mail:user_mailbox.message:modify`，**仅 user 身份**。前置：M1.5 refresh_token 持久化（指定发件账号授权一次，refresh_token 14 天滚动）。比 Resend 更优：零外部依赖、直接进队员飞书邮箱 |
| refresh_token 持久化 | 登录流程把 user_access_token/refresh_token 存 KV `oauth:<open_id>`；是飞书审批 Plan A 待办 API + 邮件通道的共同前置 |
| 48h 代理人升级 / 14 天自动取消（Cron） | 两版皆无 |
| 真两级审批（金额阈值会签） | fix/vi 的 contract-approval 若已支持多级则复用其模式推广，否则等飞书审批引擎 |

## 移植工作量估计（2026-10-14 晚更新）

- A 组（5 项）：✅ 全部移植完成（续期 `94fc174`、报销动作/列表 `c9fcfb9`、通知域 + visibleApps 本次），**剩余 0**
- B 组：send_notice ✅、文档 ✅；剩余 flow-config 约定 ≈ 2h
- D 组邮件通道：refresh_token 2h + mailer 模块 3h + 授权联调 1h ≈ **0.5~1 天**（依赖用户完成一次扫码授权）

## 待裁决

1. main 归档时点：A 组移植全部完成后，main 打 tag `archive/pre-domain-split` 后只读（**A 组已零缺口，可执行**）
2. 报销前端字段：fix/vi 英文 matchField 方案 vs main 中文字段直连——建议保留 fix/vi 方案（对表结构变更有韧性）
3. 通知群：主群「NEC 中台通知」webhook 已存在于生产 secrets，fix/vi 通知域部署后直接可用
