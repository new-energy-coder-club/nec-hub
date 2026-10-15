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
 *   GET  /api/approvals/mine → 我的申请列表（各流程申请页数据源，按 open_id 过滤，降序 20 条，fields 全量透传）
 *   POST /api/approvals/upload → 凭证文件上传（R-01 应用页，multipart → R2 receipts/，返回 key）
 *   /api/erp/reimburse/*  → R-01 报销助手 ERP 接口（D1：费用项目目录/收款账户/单据快照；附件在 R2）
 *   /api/season-goals/*   → 赛季目标管理（收集单提交/采纳 + 按任务自动规划，模块网关）
 *   /api/domains/*        → 域名分发系统（成员自助申请 <name>.newenergycoder.club 三级域名，Cloudflare API 落 DNS）
 *   GET  /api/my-tasks    → 我的任务（绑定飞书任务后 Task v2 同步拉取，KV my-tasks:<open_id> 5 分钟缓存，?refresh=1 强刷）
 *   POST /api/my-tasks/unbind → 解绑飞书任务（清授权 token 与缓存）
 *   GET  /api/validate    → 数据校验触发（FE-05，?scope=mine|all，登录门禁）
 *   POST /auth/feishu     → 飞书 code 兑换用户信息 + 签发中台会话（MES 免登与本门户登录共用）
 *   POST /auth/logout     → 登出（销毁会话）
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
 * 本文件只保留路由表与 fetch/scheduled 入口；实现按域拆分：
 *   auth/（飞书免登、角色、登录态处理器）· hosting（R2 托管与 KV 注册表）· dashboard（看板/资料页）
 *   repos（开源仓库聚合）· reimburse（报销提交）· mcp/（MCP 端点与工具）· validation/（FE-05 校验）
 *   home/（FE-06/07 首页布局）· todos.ts（FE-09 审批/待办聚合）· season-goals/（赛季目标）· my-tasks/（飞书任务绑定与同步）
 *   prd.ts（PRD 看板 + GitHub webhook）· approvals/（Plan B 审批引擎：状态机 + 群机器人通知 + G-03 时效巡检 cron）
 *
 * 类型：运行 `npx wrangler types` 生成 worker-configuration.d.ts 后，下面的声明合并会把
 * secrets 补到 Cloudflare.Env 上。wrangler.jsonc 变更后请重新生成类型。
 */

// 通过 wrangler secret put 配置的 secrets，wrangler types 不会自动生成。
// 注意：本地 .dev.vars 中存在的 secret 会被 wrangler types 生成为必填 string 并并入 __BaseEnv_Env，
// 因此与其重叠的字段（MCP_TOKEN / FEISHU_APP_ID / FEISHU_BOT_WEBHOOK / FEISHU_BOT_WEBHOOK_SECRET）
// 此处声明为必填 string，兼顾"生成文件有无该字段"两种环境。
declare global {
  interface Env {
    /** 设置后，/mcp 写操作需携带 Authorization: Bearer <token>（用 wrangler secret put MCP_TOKEN 配置） */
    MCP_TOKEN: string;
    /** 飞书自建应用凭证（第二阶段接入 query_bitable 时启用） */
    FEISHU_APP_ID: string;
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
    FEISHU_BOT_WEBHOOK: string;
    FEISHU_BOT_WEBHOOK_SECRET: string;
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
    /** 域名分发系统申请/释放公示（可选；未配置回退 FEISHU_BOT_WEBHOOK） */
    FEISHU_BOT_WEBHOOK_DOMAINS?: string;
    FEISHU_BOT_WEBHOOK_DOMAINS_SECRET?: string;
    /** 域名分发系统：Cloudflare API Token（需 Zone.DNS 编辑权限）与 Zone ID（newenergycoder.club），用 wrangler secret put 配置 */
    CF_API_TOKEN?: string;
    CF_ZONE_ID?: string;
    /** 域名分发系统：根域（默认 newenergycoder.club）与每成员域名上限（默认 3），可在 wrangler.jsonc vars 覆盖 */
    DOMAIN_ZONE?: string;
    DOMAIN_MAX_PER_USER?: string;
  }
}

import { handleFeishuAuth } from "./auth/feishu-auth";
import { handleLogout, handleWhoami } from "./auth/handlers";
import { buildDashboard, buildDocs, prewarmDashboard } from "./dashboard";
import { handleGetHome, handleResetHome, handleSetHome } from "./home/handlers";
import { readIndex, serveApp, serveSkill, visibleApps, type SkillEntry } from "./hosting";
import { handleMcp } from "./mcp/handler";
import { handleGetMyTasks, handleUnbindMyTasks } from "./my-tasks";
import { handleReimburse, handleReimburseAction, handleReimburseMine } from "./reimburse";
import { buildRepos, prewarmRepos } from "./repos";
import { json } from "./shared/http";
import { handleTodos } from "./todos";
import { handleValidateQuery, handleValidateReport, handleValidateRun, runWeeklyValidation } from "./validation/handlers";

/** cron 任务去重守卫：guardSec 秒内已执行过返回 false（多触发器并存/旧触发器残留时防双重执行与重复推送） */
async function cronDue(env: Env, name: string, guardSec: number): Promise<boolean> {
  try {
    const raw = await env.REGISTRY.get(`cron:guard:${name}`);
    if (raw) {
      const at = (JSON.parse(raw) as { at?: number }).at ?? 0;
      if (Date.now() - at < guardSec * 1000) return false;
    }
  } catch { /* 读失败视为可执行，任务内部另有幂等保护 */ }
  return true;
}

/** 标记 cron 任务已执行（30 天 TTL；写失败不影响本次执行） */
function cronMark(env: Env, ctx: ExecutionContext, name: string): void {
  ctx.waitUntil(
    env.REGISTRY.put(`cron:guard:${name}`, JSON.stringify({ at: Date.now() }), { expirationTtl: 30 * 86400 }).catch(() => {}),
  );
}

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
        return json(await visibleApps(env, request, ctx));
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
      if (url.pathname.startsWith("/api/domains")) {
        const dm = await import("./domains");
        const res = await dm.handleDomains(request, env, url.pathname, ctx);
        if (res) return res;
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

  /** Cron 调度：时间窗驱动 + guard 去重，与"实际生效的是哪条触发器"解耦。
   *  设计背景（2026-10-15/16 实测）：
   *  ① 本账户触发器变更疑似不生效——曾配置的 7 * 从未触发，已下线两天的 23 * 却持续每小时触发；
   *     故 handler 不依赖触发器表达式路由任务，全部按 UTC 时间窗判定，任意触发器组合都能驱动全部任务；
   *  ② 免费档单次 cron 50 子请求上限：SLA（重）独占 :08 窗口，仓库预热/阻塞告警在 :24 窗口，看板预热 TTL 过期才写，互不叠加超限；
   *  ③ 多触发器可能并发命中同一窗口（新 8 分钟档 + 残留的 4 分钟档 / 23 *），每任务带 cron:guard:<name> 时间戳去重，防双重执行/重复推送；
   *  ④ 窗口选取：旧 4 分钟档与新 8 分钟档的共同 tick 必为 8 的倍数，宽 4 分钟的窗口恰含一个 tick——
   *     :08 G-03 审批时效巡检 · :24 仓库缓存+图纸评审阻塞告警 · 周一 00:00–00:04 数据校验周报。
   *  配额治理（2026-10-15）：快触发器 360→180 次/日；看板缓存 TTL 900→1800s（过期才重写，≤240 写/日），
   *  探针整点才落 KV，给登录会话等用户写入留出免费档 1,000 写/日的余量。 */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const t = new Date(controller.scheduledTime);
    const minute = t.getUTCMinutes();
    const isFastCron = controller.cron === "*/4 * * * *" || controller.cron === "*/8 * * * *";
    const isHourlyCron = controller.cron === "7 * * * *" || controller.cron === "23 * * * *";
    const isWeeklyCron = controller.cron === "0 0 * * 1";

    // 触发探针：每个 cron 事件落 KV（30 天），确认触发器真实到达（排障手段，勿删）。
    // 快触发器每天 180–360 次，全量落 KV 会吃掉免费档写配额大头，故只在整点写一次。
    if (!isFastCron || minute === 0) {
      ctx.waitUntil(
        env.REGISTRY.put("cron:last:" + controller.cron, JSON.stringify({ at: Date.now() }), { expirationTtl: 30 * 86400 }).catch(() => {}),
      );
    }

    // ① 看板缓存预热：快触发器每 tick；TTL（30 分钟）过期才重写
    if (isFastCron) ctx.waitUntil(prewarmDashboard(env, ctx));

    // ② G-03 审批时效巡检：每小时 :08 窗口（只挂快触发器，与 ③ 错峰；30 分钟去重防并发双跑）
    if (isFastCron && minute >= 6 && minute < 10 && (await cronDue(env, "sla", 1800))) {
      cronMark(env, ctx, "sla");
      ctx.waitUntil(import("./approvals/sla").then((m) => m.runApprovalSla(env)));
    }

    // ③ 仓库缓存 + 图纸评审阻塞告警：每小时 :24 窗口（小时级触发器 :23 直接命中；其不触发时由快触发器兜底）
    if ((isHourlyCron || (isFastCron && minute >= 22 && minute < 26)) && (await cronDue(env, "hourly", 2700))) {
      cronMark(env, ctx, "hourly");
      ctx.waitUntil(prewarmRepos(env));
      ctx.waitUntil(import("./drawing-review/alert.service").then((m) => m.pushBlockerAlerts(env)));
    }

    // ④ 数据校验周报：周一 00:00（UTC）窗口（周触发器与快触发器谁先到谁跑，12 小时去重）
    const isWeeklyWindow = t.getUTCDay() === 1 && t.getUTCHours() === 0 && minute < 4;
    if ((isWeeklyCron || isFastCron) && isWeeklyWindow && (await cronDue(env, "weekly", 12 * 3600))) {
      cronMark(env, ctx, "weekly");
      ctx.waitUntil(runWeeklyValidation(env));
    }
  },
} satisfies ExportedHandler<Env>;
