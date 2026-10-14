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
 *   POST /api/home        → 写个人首页布局（白名单组件）
 *   POST /api/home/reset  → 恢复默认（删个人布局）
 *   GET  /api/todos       → 审批/待办聚合（FE-09，需登录，KV 5 分钟缓存）
 *   GET  /api/prd         → PRD 看板（M1/M2/M3 状态 + 总进度 + 最近 git 提交；状态经 MCP update_prd 维护）
 *   POST /api/hooks/github → GitHub push webhook（HMAC-SHA256 验签 → 记录最近提交 → 飞书群机器人通知）
 *   POST /api/approvals   → 发起审批（4 流程统一入口，flows:config 配置驱动，Plan B 状态机落底表）
 *   POST /api/approvals/<type>/<单号>/<action> → 审批与流程动作（approve/reject/pay/start/archive/arrive/issue/publish）
 *   GET  /api/approvals/mine → 我的申请列表（R-01 报销页数据源，按 open_id 过滤，降序 20 条）
 *   /api/season-goals/*   → 赛季目标管理（收集单提交/采纳 + 按任务自动规划，模块网关）
 *   GET  /api/my-tasks    → 我的任务（绑定飞书任务后 Task v2 同步拉取，KV my-tasks:<open_id> 5 分钟缓存，?refresh=1 强刷）
 *   POST /api/my-tasks/unbind → 解绑飞书任务（清授权 token 与缓存）
 *   GET  /api/validate    → 数据校验触发（FE-05，?scope=mine|all，登录门禁）
 *   POST /auth/feishu     → 飞书 code 兑换用户信息 + 签发中台会话（MES 免登与本门户登录共用）
 *   POST /auth/logout     → 登出（销毁会话）
 *   GET  /api/repos       → NEC 开源仓库列表（GitHub org + KV 1 小时缓存）
 *   GET  /apps/<name>/*   → 队员应用（R2 托管）
 *   GET  /skills/<name>/SKILL.md → Skill 原文（R2）
 *   POST /mcp             → MCP (streamable HTTP, JSON-RPC)
 *
 * 本文件只保留路由表与 fetch/scheduled 入口；实现按域拆分：
 *   auth/（飞书免登、角色、登录态处理器）· hosting（R2 托管与 KV 注册表）· dashboard（看板/资料页）
 *   repos（开源仓库聚合）· reimburse（报销提交）· mcp/（MCP 端点与工具）· validation/（FE-05 校验）
 *   home/（FE-06/07 首页布局）· todos.ts（FE-09 审批/待办聚合）· season-goals/（赛季目标）· my-tasks/（飞书任务绑定与同步）
 *   prd.ts（PRD 看板 + GitHub webhook）· approvals/（Plan B 审批引擎：状态机 + 群机器人通知）
 *
 * 类型：运行 `npx wrangler types` 生成 worker-configuration.d.ts 后，下面的声明合并会把
 * secrets 补到 Cloudflare.Env 上。wrangler.jsonc 变更后请重新生成类型。
 */

// 通过 wrangler secret put 配置的 secrets，wrangler types 不会自动生成。
declare global {
  interface Env {
    /** 设置后，/mcp 写操作需携带 Authorization: Bearer <token>（用 wrangler secret put MCP_TOKEN 配置） */
    MCP_TOKEN?: string;
    /** 飞书自建应用凭证（第二阶段接入 query_bitable 时启用） */
    FEISHU_APP_ID?: string;
    FEISHU_APP_SECRET?: string;
    /** Vercel 同步（sync_vercel 工具用） */
    VERCEL_TOKEN?: string;
    VERCEL_TEAM?: string;
    /** GitHub API（/api/repos 仓库列表用，可选；配置后限额更高） */
    GITHUB_TOKEN?: string;
    /** Gitee API（/api/repos 仓库列表用，可选；匿名 60 次/小时，配置后限额更高） */
    GITEE_TOKEN?: string;
    /** GitHub Webhook secret（/api/hooks/github 验签用；未配置时拒绝接收推送） */
    GITHUB_WEBHOOK_SECRET?: string;
    /** 飞书群自定义机器人 webhook（FE-05 每周校验摘要推送 + 图纸评审流程通知/阻塞告警；未配置则跳过推送不报错） */
    FEISHU_WEBHOOK_URL?: string;
    /** FEISHU_WEBHOOK_URL 的加签 secret（机器人开启加签时必填，否则推送被拒） */
    FEISHU_WEBHOOK_SECRET?: string;
    /** 审批通知群机器人 webhook（PRD V1.1 N-01）；可按流程分流 FEISHU_BOT_WEBHOOK_<TYPE>，加签 secret 为同名 _SECRET 变量 */
    FEISHU_BOT_WEBHOOK?: string;
    FEISHU_BOT_WEBHOOK_SECRET?: string;
    FEISHU_BOT_WEBHOOK_PRD?: string;
    FEISHU_BOT_WEBHOOK_PRD_SECRET?: string;
    FEISHU_BOT_WEBHOOK_REIMBURSE?: string;
    FEISHU_BOT_WEBHOOK_REIMBURSE_SECRET?: string;
    FEISHU_BOT_WEBHOOK_DRAWING?: string;
    FEISHU_BOT_WEBHOOK_DRAWING_SECRET?: string;
    FEISHU_BOT_WEBHOOK_HARDWARE?: string;
    FEISHU_BOT_WEBHOOK_HARDWARE_SECRET?: string;
    FEISHU_BOT_WEBHOOK_COMPLIANCE?: string;
    FEISHU_BOT_WEBHOOK_COMPLIANCE_SECRET?: string;
  }
}

import { handleFeishuAuth } from "./auth/feishu-auth";
import { handleLogout, handleWhoami } from "./auth/handlers";
import { buildDashboard, buildDocs, prewarmDashboard } from "./dashboard";
import { handleGetHome, handleResetHome, handleSetHome } from "./home/handlers";
import { readIndex, serveApp, serveSkill, type AppEntry, type SkillEntry } from "./hosting";
import { handleMcp } from "./mcp/handler";
import { handleGetMyTasks, handleUnbindMyTasks } from "./my-tasks";
import { handleReimburse } from "./reimburse";
import { buildRepos, prewarmRepos } from "./repos";
import { json } from "./shared/http";
import { handleTodos } from "./todos";
import { handleValidateQuery, handleValidateReport, handleValidateRun, runWeeklyValidation } from "./validation/handlers";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    console.log(`[nec-hub] ${request.method} ${url.pathname}`);
    try {
      if (url.pathname === "/mcp" && request.method === "POST") {
        return await handleMcp(request, env);
      }
      if (url.pathname === "/auth/feishu") {
        return await handleFeishuAuth(request, env);
      }
      if (url.pathname === "/auth/logout") {
        return await handleLogout(request, env, ctx);
      }
      if (url.pathname === "/api/whoami") {
        return await handleWhoami(request, env, ctx);
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
        const res = await ap.handleApprovals(request, env, url.pathname, ctx);
        if (res) return res;
      }
      if (url.pathname === "/api/apps") {
        return json(await readIndex<AppEntry>(env, "apps:index"));
      }
      if (url.pathname === "/api/skills") {
        return json(await readIndex<SkillEntry>(env, "skills:index"));
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
      if (url.pathname === "/api/reimburse" && request.method === "POST") {
        return await handleReimburse(request, env, ctx);
      }
      if (url.pathname === "/api/repos") {
        return json(await buildRepos(env, ctx));
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

  /** Cron：每 4 分钟刷看板缓存，每小时刷仓库缓存并推送图纸评审阻塞告警；每周一 08:00（UTC+8）跑数据校验周报（见 wrangler.jsonc triggers） */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (controller.cron === "0 0 * * 1") ctx.waitUntil(runWeeklyValidation(env));
    else if (controller.cron === "*/4 * * * *") ctx.waitUntil(prewarmDashboard(env));
    else {
      ctx.waitUntil(prewarmRepos(env));
      ctx.waitUntil(
        import("./drawing-review/alert.service").then((m) => m.pushBlockerAlerts(env)),
      );
    }
  },
} satisfies ExportedHandler<Env>;
