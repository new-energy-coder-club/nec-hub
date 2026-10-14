/**
 * NEC 域名分发系统 — 路由注册（/api/domains/*）
 *
 * 成员登录后可自助申请 <subdomain>.newenergycoder.club 三级域名：
 *   GET  /api/domains        → 公开域名目录（active，脱敏）
 *   GET  /api/domains/mine   → 我的域名列表（登录 401）
 *   POST /api/domains        → 申请域名 {subdomain, type?, target, description?, proxied?}
 *   POST /api/domains/delete → 释放域名 {subdomain}（本人或管理员）
 *   POST /api/domains/retry  → 重试同步 pending/failed 记录 {subdomain}（本人或管理员）
 *
 * DNS 记录通过 Cloudflare API 落盘（secrets: CF_API_TOKEN + CF_ZONE_ID）；
 * 未配置凭证时记录保存为 pending，配置后 retry 补同步，系统仍可用。
 * 申请/释放成功推飞书群公示（notifyFeishu flow=domains，复用 FEISHU_BOT_WEBHOOK[_DOMAINS]）。
 */

import { resolveUserRole } from "../auth/role";
import { notifyFeishu } from "../feishu/bot";
import { json } from "../shared/http";
import { resolveSession, sessionCookie, type HubUser } from "../shared/session";
import { cfConfigured, createDnsRecord } from "./cloudflare";
import {
  applyDomain,
  DomainError,
  domainZone,
  findDomain,
  listDomains,
  maxPerUser,
  publicView,
  putDomain,
  releaseDomain,
  validateSubdomain,
} from "./service";
import type { DomainEntry } from "./types";

const ADMIN_ROLE_RE = /队长|指导|管理员|admin/i;

/** 域名分发系统的飞书群通知 flow 标识（webhook 变量 FEISHU_BOT_WEBHOOK_DOMAINS，未配置回退 FEISHU_BOT_WEBHOOK） */
const NOTIFY_FLOW = "domains";

export async function handleDomains(
  request: Request,
  env: Env,
  pathname: string,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  // 公开目录
  if (pathname === "/api/domains" && request.method === "GET") {
    const list = await listDomains(env);
    return json({
      zone: domainZone(env),
      syncEnabled: cfConfigured(env),
      domains: list.filter((e) => e.status === "active").map(publicView),
    });
  }

  const s = await resolveSession(env, request, ctx);
  if (!s) return json({ error: "未登录，请先在门户登录" }, 401);
  const user = s.user;
  const role = await resolveUserRole(env, user, ctx);
  const isAdmin = ADMIN_ROLE_RE.test(role.role);

  if (pathname === "/api/domains/mine" && request.method === "GET") {
    const list = await listDomains(env);
    const mine = isAdmin ? list : list.filter((e) => e.owner.open_id === user.open_id);
    return withRenewed(json({ zone: domainZone(env), isAdmin, limit: maxPerUser(env), domains: mine }), s.renewed);
  }

  if (pathname === "/api/domains" && request.method === "POST") {
    return withRenewed(await createDomain(request, env, user, isAdmin, ctx), s.renewed);
  }

  if (pathname === "/api/domains/delete" && request.method === "POST") {
    return withRenewed(await deleteDomain(request, env, user, isAdmin, ctx), s.renewed);
  }

  if (pathname === "/api/domains/retry" && request.method === "POST") {
    return withRenewed(await retryDomain(request, env, user, isAdmin), s.renewed);
  }

  return null;
}

function withRenewed(res: Response, renewed?: string): Response {
  if (renewed) res.headers.set("set-cookie", sessionCookie(renewed));
  return res;
}

/** 群公示通知：有 ctx 挂 waitUntil 不拖慢响应；notifyFeishu 内部不抛错（失败重试后留痕 KV） */
function notify(env: Env, ctx: ExecutionContext | undefined, title: string, content: string, link?: string): void {
  const p = notifyFeishu(env, NOTIFY_FLOW, title, content, link);
  if (ctx) ctx.waitUntil(p);
}

function errorResponse(err: unknown): Response {
  if (err instanceof DomainError) return json({ error: err.message }, err.status);
  throw err;
}

async function createDomain(
  request: Request,
  env: Env,
  user: HubUser,
  isAdmin: boolean,
  ctx?: ExecutionContext,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求体必须是 JSON" }, 400);
  }
  try {
    const { entry, hint } = await applyDomain(env, body as never, { name: user.name, open_id: user.open_id }, { isAdmin });
    notify(
      env,
      ctx,
      "🌐 域名申请",
      `${user.name} 申请了 ${entry.fqdn} → ${entry.type} ${entry.target}（${entry.status === "active" ? "DNS 已生效" : entry.status === "pending" ? "待同步 DNS" : "DNS 同步失败"}）`,
      `https://${entry.fqdn}`,
    );
    return json(
      { ok: entry.status !== "failed", entry: publicView(entry), hint },
      entry.status === "failed" ? 502 : 200,
    );
  } catch (err) {
    return errorResponse(err);
  }
}

async function deleteDomain(
  request: Request,
  env: Env,
  user: HubUser,
  isAdmin: boolean,
  ctx?: ExecutionContext,
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { subdomain?: string };
  try {
    const entry = await releaseDomain(env, body.subdomain, { name: user.name, open_id: user.open_id }, { isAdmin });
    notify(env, ctx, "🌐 域名释放", `${user.name} 释放了 ${entry.fqdn}（原指向 ${entry.type} ${entry.target}）`);
    return json({ ok: true, deleted: entry.fqdn });
  } catch (err) {
    return errorResponse(err);
  }
}

async function retryDomain(request: Request, env: Env, user: HubUser, isAdmin: boolean): Promise<Response> {
  if (!cfConfigured(env)) return json({ error: "尚未配置 Cloudflare 凭证（CF_API_TOKEN / CF_ZONE_ID）" }, 503);
  const body = (await request.json().catch(() => ({}))) as { subdomain?: string };
  let subdomain: string;
  try {
    subdomain = validateSubdomain(body.subdomain);
  } catch (err) {
    if (err instanceof DomainError) return json({ error: err.message }, 400);
    throw err;
  }

  const entry = await findDomain(env, subdomain);
  if (!entry) return json({ error: "域名不存在" }, 404);
  if (!isAdmin && entry.owner.open_id !== user.open_id) {
    return json({ error: "只能操作自己的域名" }, 403);
  }
  if (entry.status === "active") return json({ ok: true, entry: publicView(entry), hint: "已是 active，无需同步" });

  try {
    entry.cfRecordId = await createDnsRecord(env, entry);
    entry.status = "active";
    entry.error = undefined;
  } catch (err) {
    entry.status = "failed";
    entry.error = err instanceof Error ? err.message : String(err);
  }
  entry.updatedAt = new Date().toISOString();
  await putDomain(env, entry as DomainEntry);
  return json({ ok: entry.status === "active", entry: publicView(entry), error: entry.error }, entry.status === "active" ? 200 : 502);
}
