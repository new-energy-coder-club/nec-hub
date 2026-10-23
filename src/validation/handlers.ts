/**
 * FE-05 数据校验 Agent — Worker 侧胶水层
 *
 * HTTP 端点（/api/validate/report、/api/validate/run）、MCP 工具（validate_bitable、
 * config_validate_rules）与每周一 cron 周报（runWeeklyValidation）。
 * 规则引擎与报告模型在 ./rules、./service；表数据复用 ../dashboard 的 5 分钟缓存。
 */

import { validateUserToken } from "../auth/feishu-auth";
import { ROLES, resolveUserRole } from "../auth/role";
import { fetchTableCached, getDashboardConfig, refreshTableCache } from "../dashboard";
import { resolveFlowWebhook } from "../feishu/bot";
import { json } from "../shared/http";
import { pushFeishuWebhook } from "../shared/notify-webhook";
import { resolveSession, type HubUser } from "../shared/session";
import { DEFAULT_RULES, VALIDATE_TABLES, type ValidateTable } from "./rules";
import {
  VALIDATE_REPORT_KEY,
  VALIDATE_RULES_KEY,
  buildWeeklySummaryText,
  filterViolationsForUser,
  getValidateRules,
  resetValidateRules,
  runValidation,
  setValidateRules,
  snapshotAndDiff,
  type ValidateReport,
} from "./service";

/** 全量校验允许的角色（队员只能 scope=mine） */
const LEADER_ROLE_RE = ROLES.LEADER;

/** 跑一次校验并（all 时）覆盖门户展示的最新报告；scope=mine 按 user 过滤归属记录 */
async function runValidateNow(
  env: Env,
  scope: "mine" | "all",
  user: HubUser | null,
  tables?: ValidateTable[],
): Promise<ValidateReport> {
  const [cfg, rules] = await Promise.all([getDashboardConfig(env), getValidateRules(env)]);
  if (!cfg) throw new Error("数据看板尚未配置：请先调用 config_dashboard（action=set）写入 base 与 tables");
  // 复用看板 5 分钟缓存（飞书免费版频次保护），多表并行拉取
  const report = await runValidation(cfg, (t) => fetchTableCached(env, cfg, t), rules, scope, tables);
  return scope === "mine" && user ? filterViolationsForUser(report, user) : report;
}

function parseValidateTables(raw: unknown): ValidateTable[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.map(String).filter((t): t is ValidateTable => (VALIDATE_TABLES as readonly string[]).includes(t));
  return out.length ? out : undefined;
}

function formatValidateReportText(report: ValidateReport, maxItems = 60): string {
  const head =
    `${report.scope === "all" ? "全量" : "个人"}校验完成（${report.generatedAt.slice(0, 16).replace("T", " ")}）：` +
    `共 ${report.total} 条异常` +
    (report.byType.length ? `（${report.byType.map((t) => `${t.type} ${t.count}`).join(" · ")}）` : "，数据全绿 🎉");
  if (!report.total) return head;
  const lines: string[] = [];
  let shown = 0;
  for (const v of report.violations) {
    if (shown >= maxItems) break;
    lines.push(`- [${v.type}] ${v.table} 表 · 字段「${v.field}」${v.value ? `=${v.value}` : "为空"} → ${v.suggestion}\n  记录：${v.link}`);
    shown++;
  }
  if (report.total > shown) lines.push(`… 另有 ${report.total - shown} 条未展示，门户「数据看板 → 数据健康」看全量`);
  const errs = report.errors
    ? Object.entries(report.errors).map(([t, e]) => `⚠ ${t} 表：${e}`).join("\n")
    : "";
  return `${head}\n\n${lines.join("\n")}${errs ? `\n\n${errs}` : ""}`;
}

export async function toolValidateBitable(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  const scope = String(args.scope ?? "mine");
  if (scope !== "mine" && scope !== "all") throw new Error("scope 必须是 mine | all");
  let user: HubUser | null = null;
  if (!hasMcpToken) {
    const userToken = String(args.user_token ?? "").trim();
    if (!userToken) {
      throw new Error("请提供 user_token（飞书 user_access_token），或由配置了 MCP_TOKEN 的管理端调用");
    }
    const { openId, name } = await validateUserToken(userToken);
    user = { name, open_id: openId };
    if (scope === "all") {
      const role = await resolveUserRole(env, user);
      if (!LEADER_ROLE_RE.test(role.role)) {
        throw new Error(`权限不足：全量校验仅队长/组长可触发（当前角色：${role.role}）；可用 scope=mine 校验自己的数据`);
      }
    }
  } else if (scope === "mine") {
    throw new Error("scope=mine 需要 user_token（要确定「我」是谁）；管理端请用 scope=all");
  }
  const report = await runValidateNow(env, scope, user, parseValidateTables(args.tables));
  if (scope === "all") await env.REGISTRY.put(VALIDATE_REPORT_KEY, JSON.stringify(report));
  return { content: [{ type: "text", text: formatValidateReportText(report) }] };
}

export async function toolConfigValidateRules(args: Record<string, unknown>, env: Env) {
  const action = String(args.action ?? "get");
  if (action === "get") {
    const custom = await env.REGISTRY.get(VALIDATE_RULES_KEY);
    const rules = await getValidateRules(env);
    return {
      content: [
        {
          type: "text",
          text: `当前生效 ${rules.length} 条校验规则（${custom ? "KV 自定义" : "内置默认"}）：\n${JSON.stringify(rules, null, 2)}`,
        },
      ],
    };
  }
  if (action === "reset") {
    await resetValidateRules(env);
    return {
      content: [{ type: "text", text: `✅ 已删除 KV 自定义规则，恢复内置默认规则（${DEFAULT_RULES.length} 条）。` }],
    };
  }
  if (action !== "set") throw new Error("action 必须是 get | set | reset");
  const rules = await setValidateRules(env, args.rules ?? []);
  return {
    content: [
      {
        type: "text",
        text: `✅ 校验规则已保存：共 ${rules.length} 条（${rules.map((r) => r.id).join(" / ")}）。\n立即用 validate_bitable 验证，或等每周一自动巡检。`,
      },
    ],
  };
}

/** GET /api/validate/report：门户「数据健康」读最新全量报告（需登录） */
export async function handleValidateReport(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "请先登录" }, 401);
  const report = (await env.REGISTRY.get(VALIDATE_REPORT_KEY, "json")) as ValidateReport | null;
  if (!report) return json({ empty: true, hint: "暂无校验报告：点「立即校验」或等每周一自动巡检" });
  return json(report);
}

/** POST /api/validate/run：门户触发校验。未登录 401；scope=all 仅队长/组长，越权 403 */
export async function handleValidateRun(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "请先登录后再触发校验" }, 401);
  const body = (await request.json().catch(() => ({}))) as { scope?: string; tables?: unknown };
  const scope = body.scope === "all" ? "all" : "mine";
  if (scope === "all") {
    const role = await resolveUserRole(env, session.user, ctx);
    if (!LEADER_ROLE_RE.test(role.role)) {
      return json({ error: `全量校验仅队长/组长可操作（当前角色：${role.role}）` }, 403);
    }
  }
  const report = await runValidateNow(env, scope, session.user, parseValidateTables(body.tables));
  if (scope === "all") await env.REGISTRY.put(VALIDATE_REPORT_KEY, JSON.stringify(report));
  return json(report);
}

/** GET /api/validate?scope=mine|all&tables=members,tasks：查询参数版触发入口（登录门禁同上） */
export async function handleValidateQuery(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "请先登录后再触发校验" }, 401);
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") === "all" ? "all" : "mine";
  if (scope === "all") {
    const role = await resolveUserRole(env, session.user, ctx);
    if (!LEADER_ROLE_RE.test(role.role)) {
      return json({ error: `全量校验仅队长/组长可操作（当前角色：${role.role}）` }, 403);
    }
  }
  const tables = url.searchParams.get("tables")?.split(",").map((s) => s.trim()).filter(Boolean);
  const report = await runValidateNow(env, scope, session.user, parseValidateTables(tables));
  if (scope === "all") await env.REGISTRY.put(VALIDATE_REPORT_KEY, JSON.stringify(report));
  return json(report);
}

/** 每周一 08:00（UTC+8，cron 0 0 * * 1 UTC）：全量校验 → 报告落 KV → 与上周 diff → 推飞书群机器人 */
export async function runWeeklyValidation(env: Env): Promise<void> {
  try {
    const [cfg, rules] = await Promise.all([getDashboardConfig(env), getValidateRules(env)]);
    if (!cfg || !env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) return;
    // 周报基于最新数据：强制刷新 4 张底表缓存；单表失败记 error 不中断整轮
    const fresh = (t: ValidateTable) =>
      refreshTableCache(env, cfg, t).catch((err) => ({
        records: [],
        cachedAt: "",
        error: err instanceof Error ? err.message : String(err),
      }));
    const report = await runValidation(cfg, fresh, rules, "all");
    await env.REGISTRY.put(VALIDATE_REPORT_KEY, JSON.stringify(report));
    const diff = await snapshotAndDiff(env, report);
    const { url, secret } = resolveFlowWebhook(env, "default");
    if (!url) {
      console.log("[nec-hub] weekly validate done；webhook 未配置，跳过群推送");
      return;
    }
    await pushFeishuWebhook(url, buildWeeklySummaryText(report, diff), secret);
  } catch (err) {
    console.error("[nec-hub] weekly validate failed:", err);
  }
}
