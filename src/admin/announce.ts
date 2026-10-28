/**
 * 管理员一键公告（POST /api/admin/announce）
 *
 *   请求体：{ title: string, content: string, link?: string, flow?: string, dry_run?: boolean }
 *     - title/content 必填；title ≤ 100 字符，content ≤ 3000 字符（飞书机器人 text 消息的工程上限）
 *     - flow：可选，默认 "announce"——按 resolveFlowWebhook 规则优先取 FEISHU_BOT_WEBHOOK_ANNOUNCE，
 *       未配置则回退 FEISHU_BOT_WEBHOOK 主群；传其他 flow（如 "drawing_review"）可分流到流程群
 *     - dry_run=true：只返回解析预览（目标渠道、消息体），不实际发送、不写审计
 *   鉴权：requireAdmin（LEADER 队长/组长 或 CONFIG_ADMIN 队长/指导/管理员/维护者）
 *   审计：发送（含失败）写 KV announce:log（最近 50 条，30 天 TTL），含操作人/标题/渠道/结果
 */
import { requireAdmin } from "./index";
import { notifyFeishu } from "../feishu/bot";
import { envSecret } from "../feishu/client";
import { json, readJson } from "../shared/http";
import { KV_KEYS } from "../shared/kv-keys";
import type { HubUser } from "../shared/session";

const TITLE_MAX = 100;
const CONTENT_MAX = 3000;
const LOG_LIMIT = 50;
const LOG_TTL = 30 * 24 * 3600;

interface AnnounceBody {
  title?: unknown;
  content?: unknown;
  link?: unknown;
  flow?: unknown;
  dry_run?: unknown;
}

interface AnnounceLogEntry {
  at: string;
  actor: string;
  open_id: string;
  title: string;
  flow: string;
  ok: boolean;
  detail: string;
}

/** 公告审计留痕（announce:log，最新在前，截断 50 条）；记录失败不阻断主流程 */
async function appendAnnounceLog(env: Env, entry: AnnounceLogEntry): Promise<void> {
  try {
    const raw = await env.REGISTRY.get(KV_KEYS.announceLog);
    let list: AnnounceLogEntry[] = [];
    try {
      list = raw ? (JSON.parse(raw) as AnnounceLogEntry[]) : [];
    } catch {
      list = [];
    }
    list.unshift(entry);
    await env.REGISTRY.put(KV_KEYS.announceLog, JSON.stringify(list.slice(0, LOG_LIMIT)), { expirationTtl: LOG_TTL });
  } catch {
    /* 留痕失败不影响发送结果 */
  }
}

/** 解析 webhook 渠道标识（不回显 URL/secret，只回渠道来源） */
function webhookChannel(env: Env, flow: string): "flow" | "bot" | "legacy" | "none" {
  const flowUrl = envSecret(env, `FEISHU_BOT_WEBHOOK_${flow.toUpperCase()}`);
  if (flowUrl !== undefined) return "flow";
  if (env.FEISHU_BOT_WEBHOOK !== undefined) return "bot";
  if (env.FEISHU_WEBHOOK_URL !== undefined) return "legacy";
  return "none";
}

export async function handleAdminAnnounce(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  // 鉴权：requireAdmin 统一门控（LEADER 或 CONFIG_ADMIN）
  const gate = await requireAdmin(request, env, ctx, "发布公告");
  if (gate instanceof Response) return gate;
  const user: HubUser = gate.user;

  // 参数解析与校验
  let body: AnnounceBody;
  try {
    body = (await readJson(request)) as AnnounceBody;
  } catch {
    return json({ error: "请求体必须是 JSON" }, 400);
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const link = typeof body.link === "string" && body.link.trim() ? body.link.trim() : undefined;
  const flow = typeof body.flow === "string" && body.flow.trim() ? body.flow.trim() : "announce";
  const dryRun = body.dry_run === true;

  if (!title) return json({ error: "title 不能为空" }, 400);
  if (!content) return json({ error: "content 不能为空" }, 400);
  if (title.length > TITLE_MAX) return json({ error: `title 超长（>${TITLE_MAX} 字符）` }, 400);
  if (content.length > CONTENT_MAX) return json({ error: `content 超长（>${CONTENT_MAX} 字符）` }, 400);
  if (link && !/^https?:\/\//.test(link)) return json({ error: "link 必须是 http(s) 链接" }, 400);
  if (!/^[a-z][a-z0-9_]*$/i.test(flow)) return json({ error: "flow 只能含字母/数字/下划线" }, 400);

  const channel = webhookChannel(env, flow);

  // 干跑：只预览，不发送不留痕
  if (dryRun) {
    return json({
      dry_run: true,
      flow,
      channel,
      preview: { title, content, link },
      note: channel === "none" ? "未配置任何 webhook，正式发送将返回失败" : "预览模式：未发送",
    });
  }

  // 发送 + 留痕
  const result = await notifyFeishu(env, flow, title, content, link);
  await appendAnnounceLog(env, {
    at: new Date().toISOString(),
    actor: user.name,
    open_id: user.open_id,
    title,
    flow,
    ok: result.ok,
    detail: result.detail,
  });

  if (!result.ok) {
    return json({ error: `公告发送失败：${result.detail}`, flow, channel }, 502);
  }
  return json({ ok: true, flow, channel, detail: result.detail });
}
