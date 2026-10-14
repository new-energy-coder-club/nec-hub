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
 */

import { resolveUserRole } from "../auth/role";
import { json } from "../shared/http";
import { resolveSession, sessionCookie, type HubUser } from "../shared/session";
import { cfConfigured, createDnsRecord, deleteDnsRecord } from "./cloudflare";
import {
  countByOwner,
  DomainInputError,
  domainZone,
  findDomain,
  isDeepSubdomain,
  listDomains,
  maxPerUser,
  publicView,
  removeDomain,
  upsertDomain,
  validateSubdomain,
  validateTarget,
} from "./service";
import type { CreateDomainBody, DomainEntry } from "./types";

const ADMIN_ROLE_RE = /队长|指导|管理员|admin/i;

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
    return withRenewed(await createDomain(request, env, user, isAdmin), s.renewed);
  }

  if (pathname === "/api/domains/delete" && request.method === "POST") {
    return withRenewed(await deleteDomain(request, env, user, isAdmin), s.renewed);
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

async function createDomain(request: Request, env: Env, user: HubUser, isAdmin: boolean): Promise<Response> {
  let body: CreateDomainBody;
  try {
    body = (await request.json()) as CreateDomainBody;
  } catch {
    return json({ error: "请求体必须是 JSON" }, 400);
  }

  try {
    const zone = domainZone(env);
    const subdomain = validateSubdomain(body.subdomain);
    const { type, target } = validateTarget(body.type, body.target, zone);
    const description = String(body.description ?? "").trim().slice(0, 120);

    // 四级及更深域名不在 Universal SSL（*.<zone>）覆盖范围内，橙云代理 TLS 握手会失败，强制仅 DNS
    const deep = isDeepSubdomain(subdomain);
    const proxied = deep ? false : Boolean(body.proxied);
    const deepHint = deep
      ? "注意：四级及更深域名不受 Cloudflare 免费证书覆盖，已强制「仅 DNS」，HTTPS 证书由目标平台（Vercel/Pages 等）签发"
      : "";

    if (await findDomain(env, subdomain)) {
      return json({ error: `「${subdomain}.${zone}」已被占用` }, 409);
    }
    if (!isAdmin) {
      const list = await listDomains(env);
      if (countByOwner(list, user.open_id) >= maxPerUser(env)) {
        return json({ error: `每个成员最多申请 ${maxPerUser(env)} 个域名，请先释放不用的` }, 429);
      }
    }

    const now = new Date().toISOString();
    const entry: DomainEntry = {
      subdomain,
      fqdn: `${subdomain}.${zone}`,
      type,
      target,
      proxied,
      description,
      owner: { name: user.name, open_id: user.open_id },
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    if (cfConfigured(env)) {
      try {
        entry.cfRecordId = await createDnsRecord(env, entry);
        entry.status = "active";
      } catch (err) {
        entry.status = "failed";
        entry.error = err instanceof Error ? err.message : String(err);
      }
    }

    await upsertDomain(env, entry);
    const statusHint =
      entry.status === "active"
        ? "DNS 已生效"
        : entry.status === "pending"
          ? "已登记，等待管理员配置 Cloudflare 凭证后同步"
          : `Cloudflare 同步失败：${entry.error}`;
    const hint = deepHint ? `${statusHint}。${deepHint}` : statusHint;
    return json({ ok: entry.status !== "failed", entry: publicView(entry), hint }, entry.status === "failed" ? 502 : 200);
  } catch (err) {
    if (err instanceof DomainInputError) return json({ error: err.message }, 400);
    throw err;
  }
}

async function deleteDomain(request: Request, env: Env, user: HubUser, isAdmin: boolean): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { subdomain?: string };
  let subdomain: string;
  try {
    subdomain = validateSubdomain(body.subdomain);
  } catch (err) {
    if (err instanceof DomainInputError) return json({ error: err.message }, 400);
    throw err;
  }

  const entry = await findDomain(env, subdomain);
  if (!entry) return json({ error: "域名不存在" }, 404);
  if (!isAdmin && entry.owner.open_id !== user.open_id) {
    return json({ error: "只能释放自己的域名" }, 403);
  }

  let cfError: string | undefined;
  if (entry.cfRecordId && cfConfigured(env)) {
    try {
      await deleteDnsRecord(env, entry.cfRecordId);
    } catch (err) {
      cfError = err instanceof Error ? err.message : String(err);
    }
  }
  if (cfError) return json({ error: `Cloudflare 删除失败，登记保留：${cfError}` }, 502);

  await removeDomain(env, subdomain);
  return json({ ok: true, deleted: entry.fqdn });
}

async function retryDomain(request: Request, env: Env, user: HubUser, isAdmin: boolean): Promise<Response> {
  if (!cfConfigured(env)) return json({ error: "尚未配置 Cloudflare 凭证（CF_API_TOKEN / CF_ZONE_ID）" }, 503);
  const body = (await request.json().catch(() => ({}))) as { subdomain?: string };
  let subdomain: string;
  try {
    subdomain = validateSubdomain(body.subdomain);
  } catch (err) {
    if (err instanceof DomainInputError) return json({ error: err.message }, 400);
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
  await upsertDomain(env, entry);
  return json({ ok: entry.status === "active", entry: publicView(entry), error: entry.error }, entry.status === "active" ? 200 : 502);
}
