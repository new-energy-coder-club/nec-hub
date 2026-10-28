/**
 * NEC 团队 AI 中台 — 单体 Worker
 * 路由：
 *   GET  /                → 门户静态页（Assets）
 *   GET  /api/health      → 健康检查
 *   GET  /api/apps        → 应用广场注册表（KV）
 *   GET  /api/skills      → Skill 中心注册表（KV）
 *   GET  /api/config      → 公开配置（飞书 App ID 等，供门户登录跳转用）
 *   GET  /api/whoami      → 当前登录用户与角色（session Cookie）
 *   GET  /api/dashboard   → 数据看板聚合（飞书多维表格 + KV 5 分钟缓存；按登录角色脱敏财务区）
 *   GET  /api/home        → 我的首页生效布局（FE-06/07，登录 401；个人 > 组 > 默认）
 *   GET  /api/home/defaults → 公开全员默认布局与组件元数据
 *   POST /api/home        → 写个人首页布局（白名单组件）
 *   POST /api/home/reset  → 恢复默认（删个人布局）
 *   GET  /api/todos       → 审批/待办聚合（FE-09，需登录，KV 5 分钟缓存）
 *   GET  /api/prd         → PRD 看板（M1/M2/M3 状态 + 总进度 + 最近 git 提交；状态经 MCP update_prd 维护）
 *   POST /api/hooks/github → GitHub push webhook（HMAC-SHA256 验签 → 记录最近提交 → 飞书群机器人通知）
 *   POST /api/approvals   → 发起审批（4 流程统一入口，flows:config 配置驱动，Plan B 状态机落底表）
 *   POST /api/approvals/<type>/<单号>/<action> → 审批与流程动作（approve/reject/pay/start/archive/arrive/issue/publish）
 *   GET  /api/approvals/mine → 我的申请列表（各流程申请页数据源，按 open_id 过滤，降序 20 条，fields 全量透传）
 *   POST /api/approvals/upload → 凭证文件上传（R-01 应用页，multipart → R2 receipts/，返回 key）
 *   /api/erp/reimburse/*  → R-01 报销助手 ERP 接口（D1：费用项目目录/收款账户/单据快照；附件在 R2）
 *   /api/season-goals/*   → 赛季目标管理（收集单提交/采纳 + 按任务自动规划，模块网关）
 *   /api/domains/*        → 域名分发系统（成员自助申请 <name>.newenergycoder.club 三级域名，Cloudflare API 落 DNS）
 *   GET  /api/my-tasks    → 我的任务（绑定飞书任务后 Task v2 同步拉取，KV my-tasks:<open_id> 5 分钟缓存，?refresh=1 强刷）
 *   POST /api/my-tasks/unbind → 解绑飞书任务（清授权 token 与缓存）
 *   GET  /api/validate    → 数据校验触发（FE-05，?scope=mine|all，登录门禁）
 *   POST /api/reports/weekly/run → 团队周报手动触发（队长/组长；cron 每周一 00:16 UTC 自动推送飞书群）
 *   POST /auth/feishu     → 飞书 code 兑换用户信息 + 签发中台会话（MES 免登与本门户登录共用）
 *   POST /auth/password   → 账号密码登录（本地账号，open_id 为 local:<username>，实习生等无飞书身份成员用）
 *   POST /auth/logout     → 登出（销毁会话）
 *   POST /api/auth/logout-all → 退出所有设备（删除当前用户全部会话 key + 清本机 Cookie）
 *   GET  /api/admin/overview  → 管理总览（队长/组长/管理员：租户接入状态、活跃会话数、成员名单聚合、模块配置状态）
 *   GET  /api/admin/sessions  → 会话清单（按 open_id 分组聚合）；POST /api/admin/sessions/revoke → 强制下线
 *   POST /api/admin/announce  → 管理员一键发飞书群公告（title/content/link/flow/dry_run；LEADER 或 CONFIG_ADMIN）
 *   POST /api/admin/config/<dashboard|flows> → 模块配置 HTTP 写入口（复用 MCP 工具校验口径）
 *   /api/admin/cf/*（DNS 查/增/删、边缘缓存清除、URL 探测）与 /api/admin/accounts*（本地账号管理）
 *     → Cloudflare 运维后台数据源（CONFIG_ADMIN，含维护者；详见 admin/index.ts 与 public/apps/admin/）
 *   GET  /api/repos       → NEC 开源仓库列表（GitHub org + KV 1 小时缓存）
 *   GET  /api/cla         → 开源社区贡献协议（CLA）元信息 + 公开签署名单（KV cla:signatures，脱敏）
 *   GET  /api/cla/status  → 当前会话或 ?github= 是否已签署
 *   POST /api/cla/sign    → 签署 CLA（按 GitHub 用户名幂等去重，登录会话自动绑定 open_id）
 *   GET  /apps/<name>/*   → 队员应用（R2 托管）
 *   *.<zone>/*            → 泛域名应用直达：<app>.<zone> 直接服务 R2 apps/<app>/（domains/wildcard.ts；
 *                           登记过外部目标的域名与保留名透传回源）
 *   GET  /skills/<name>/SKILL.md → Skill 原文（R2）
 *   POST /mcp             → MCP (streamable HTTP, JSON-RPC)
 *
 * 本文件只保留路由表与 fetch 入口；cron 调度在 ./scheduled，secrets 的 Env 声明在 ./env.d.ts。
 * 实现按域拆分：
 *   auth/（飞书免登、角色、登录态处理器）· hosting（R2 托管与 KV 注册表）· dashboard（看板/资料页）
 *   repos（开源仓库聚合）· reimburse（报销提交）· mcp/（MCP 端点与工具）· validation/（FE-05 校验）
 *   home/（FE-06/07 首页布局）· todos.ts（FE-09 审批/待办聚合）· season-goals/（赛季目标）· my-tasks/（飞书任务绑定与同步）
 *   prd.ts（PRD 看板 + GitHub webhook）· approvals/（Plan B 审批引擎：状态机 + 群机器人通知 + G-03 时效巡检 cron）
 *   admin/（管理总览：租户接入/会话计数/成员名单聚合/模块配置状态）
 *   ERP 状态回写等跨域钩子在本路由层注入（组合根），依赖保持 erp → approvals 单向。
 */

import { handleFeishuAuth } from "./auth/feishu-auth";
import { handleLogout, handleLogoutAll, handleWhoami } from "./auth/handlers";
import { handlePasswordLogin } from "./auth/password";
import { buildDashboard } from "./dashboard";
import { buildDocs } from "./docs";
import { handleGetHome, handleGetHomeDefaults, handleResetHome, handleSetHome } from "./home/handlers";
import { listPortalApps, readIndex, serveApp, serveSkill, type SkillEntry } from "./hosting";
import { handleMcp } from "./mcp/handler";
import { handleGetMyTasks, handleUnbindMyTasks } from "./my-tasks";
import { handleReimburse, handleReimburseAction, handleReimburseMine } from "./reimburse";
import { buildRepos } from "./repos";
import { scheduled } from "./scheduled";
import { json } from "./shared/http";
import { KV_KEYS } from "./shared/kv-keys";
import { handleInvalidateTodos, handleTodos } from "./todos";
import { handleValidateQuery, handleValidateReport, handleValidateRun } from "./validation/handlers";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    console.log(`[nec-hub] ${request.method} ${url.pathname}`);
    try {
      // 泛域名应用直达：<app>.<zone> → R2 apps/<app>/（deploy_app 零配置获得独立三级域名；详见 domains/wildcard.ts）
      const subRes = await import("./domains/wildcard").then((m) => m.handleAppSubdomain(request, env, ctx));
      if (subRes) return subRes;
      if (url.pathname === "/mcp" && request.method === "POST") {
        return await handleMcp(request, env);
      }
      if (url.pathname === "/auth/feishu") {
        return await handleFeishuAuth(request, env);
      }
      if (url.pathname === "/auth/password") {
        return await handlePasswordLogin(request, env);
      }
      if (url.pathname === "/auth/logout") {
        return await handleLogout(request, env, ctx);
      }
      if (url.pathname === "/api/auth/logout-all") {
        return await handleLogoutAll(request, env, ctx);
      }
      if (url.pathname === "/api/whoami") {
        return await handleWhoami(request, env, ctx);
      }
      if (url.pathname === "/api/admin/overview") {
        const ad = await import("./admin");
        return await ad.handleAdminOverview(request, env, ctx);
      }
      if (url.pathname === "/api/admin/sessions" && request.method === "GET") {
        const ad = await import("./admin");
        return await ad.handleAdminSessions(request, env, ctx);
      }
      if (url.pathname === "/api/admin/sessions/revoke") {
        const ad = await import("./admin");
        return await ad.handleAdminRevokeSessions(request, env, ctx);
      }
      if (url.pathname === "/api/admin/announce") {
        const { handleAdminAnnounce } = await import("./admin/announce");
        return await handleAdminAnnounce(request, env, ctx);
      }
      if (url.pathname.startsWith("/api/admin/config/")) {
        const ad = await import("./admin");
        const module = decodeURIComponent(url.pathname.slice("/api/admin/config/".length));
        if (!ad.isAdminConfigModule(module)) return json({ error: "not found" }, 404);
        return await ad.handleAdminConfig(request, env, ctx, module);
      }
      if (url.pathname === "/api/config") {
        return json({
          feishuAppId: env.FEISHU_APP_ID ?? null,
          loginEnabled: Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET),
        });
      }
      if (url.pathname === "/api/health") {
        return json({ ok: true, service: env.HUB_NAME ?? "nec-hub", time: new Date().toISOString() });
      }
      if (url.pathname === "/api/prd") {
        const { buildPrdBoard } = await import("./prd");
        return json(await buildPrdBoard(env));
      }
      if (url.pathname === "/api/hooks/github" && request.method === "POST") {
        const { handleGithubPush } = await import("./prd");
        return await handleGithubPush(request, env);
      }
      if (url.pathname.startsWith("/api/approvals")) {
        const ap = await import("./approvals");
        // 组合根注入 ERP 状态回写钩子：审批域不 import erp，依赖保持 erp → approvals 单向
        const { syncReimburseDocStatus } = await import("./erp/reimburse");
        const res = await ap.handleApprovals(request, env, url.pathname, ctx, { onStatusChange: syncReimburseDocStatus });
        if (res) return res;
      }
      if (url.pathname === "/api/apps") {
        return json(await listPortalApps(env, request, ctx));
      }
      if (url.pathname === "/api/skills") {
        return json(await readIndex<SkillEntry>(env, KV_KEYS.skillsIndex));
      }
      if (url.pathname === "/api/docs") {
        return json(await buildDocs(env, request, ctx));
      }
      if (url.pathname === "/api/dashboard") {
        return json(await buildDashboard(env, request, ctx));
      }
      if (url.pathname === "/api/validate" && request.method === "GET") {
        return await handleValidateQuery(request, env, ctx);
      }
      if (url.pathname === "/api/validate/report") {
        return await handleValidateReport(request, env, ctx);
      }
      if (url.pathname === "/api/validate/run" && request.method === "POST") {
        return await handleValidateRun(request, env, ctx);
      }
      if (url.pathname === "/api/reports/weekly/run" && (request.method === "POST" || request.method === "GET")) {
        const rp = await import("./reports/weekly");
        return await rp.handleWeeklyReportRun(request, env, ctx);
      }
      if (url.pathname === "/api/home/defaults" && request.method === "GET") {
        return handleGetHomeDefaults();
      }
      if (url.pathname === "/api/home") {
        if (request.method === "GET") return await handleGetHome(request, env, ctx);
        if (request.method === "POST") return await handleSetHome(request, env, ctx);
        return json({ error: "method not allowed" }, 405);
      }
      if (url.pathname === "/api/home/reset" && request.method === "POST") {
        return await handleResetHome(request, env, ctx);
      }
      if (url.pathname === "/api/todos") {
        return await handleTodos(request, env, ctx);
      }
      if (url.pathname === "/api/todos/invalidate" && request.method === "POST") {
        return await handleInvalidateTodos(request, env, ctx);
      }
      if (url.pathname === "/api/my-tasks" && request.method === "GET") {
        return await handleGetMyTasks(request, env, ctx);
      }
      if (url.pathname === "/api/my-tasks/unbind" && request.method === "POST") {
        return await handleUnbindMyTasks(request, env, ctx);
      }
      if (url.pathname.startsWith("/api/drawing-review")) {
        const dr = await import("./drawing-review");
        const res = await dr.handleDrawingReview(request, env, url.pathname);
        if (res) return res;
      }
      if (url.pathname.startsWith("/api/hardware-review")) {
        const hr = await import("./hardware-review");
        const res = await hr.handleHardwareReview(request, env, url.pathname);
        if (res) return res;
      }
      if (url.pathname.startsWith("/api/contract-approval")) {
        const ca = await import("./contract-approval");
        const res = await ca.handleContractApproval(request, env, url.pathname);
        if (res) return res;
      }
      if (url.pathname.startsWith("/api/season-goals")) {
        const sg = await import("./season-goals");
        const res = await sg.handleSeasonGoals(request, env, url.pathname);
        if (res) return res;
      }
      if (url.pathname.startsWith("/api/domains")) {
        const dm = await import("./domains");
        const res = await dm.handleDomains(request, env, url.pathname, ctx);
        if (res) return res;
      }
      if (url.pathname.startsWith("/api/admin")) {
        const adm = await import("./admin");
        return await adm.handleAdmin(request, env, url.pathname, ctx);
      }
      if (url.pathname.startsWith("/api/erp/reimburse")) {
        const er = await import("./erp/reimburse");
        const res = await er.handleErpReimburse(request, env, url.pathname, ctx);
        if (res) return res;
      }
      if (url.pathname === "/api/reimburse" && request.method === "POST") {
        return await handleReimburse(request, env, ctx);
      }
      if (url.pathname.startsWith("/api/reimburse/")) {
        const parts = url.pathname.replace("/api/reimburse/", "").split("/").filter(Boolean);
        if (parts.length === 1 && parts[0] === "mine" && request.method === "GET") {
          return await handleReimburseMine(request, env, ctx);
        }
        if (parts.length === 2 && request.method === "POST") {
          return await handleReimburseAction(request, env, ctx, decodeURIComponent(parts[0]), parts[1]);
        }
        return json({ error: "not found" }, 404);
      }
      if (url.pathname === "/api/repos") {
        return json(await buildRepos(env, ctx));
      }
      if (url.pathname.startsWith("/api/cla")) {
        const cla = await import("./cla");
        const res = await cla.handleCla(request, env, url.pathname, ctx);
        if (res) return res;
      }
      if (url.pathname.startsWith("/apps/")) {
        return await serveApp(url, env, ctx);
      }
      if (url.pathname.startsWith("/skills/")) {
        return await serveSkill(url, env, ctx);
      }
      return await env.ASSETS.fetch(request);
    } catch (err) {
      console.error(`[nec-hub] ${request.method} ${url.pathname} error:`, err);
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  },

  scheduled,
} satisfies ExportedHandler<Env>;
