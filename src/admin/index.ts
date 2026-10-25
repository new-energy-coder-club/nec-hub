/**
 * NEC 管理后台 API — Cloudflare 线上配置（/api/admin/*）
 *
 * 面向 队长/指导/管理员/维护者（CONFIG_ADMIN，与域名分发同一口径）：
 *   GET  /api/admin/cf/status       → CF 凭证配置状态（不回显 token）
 *   GET  /api/admin/cf/dns?name=&type=  → 列 DNS 记录
 *   POST /api/admin/cf/dns          → 建 DNS 记录 {type, name, content, proxied?}（允许 * 泛解析）
 *   POST /api/admin/cf/dns/delete   → 删 DNS 记录 {id}
 *   POST /api/admin/cf/purge        → 清边缘缓存 {files?} {prefixes?} {purge_everything, confirm}
 *   GET  /api/admin/probe?url=      → 服务端探测任意 https URL 的状态与关键响应头（排障用）
 *   GET  /api/admin/accounts        → 本地账号列表（账号密码登录）
 *   POST /api/admin/accounts        → 建号 {username, name, password?}（密码缺省自动生成，仅响应回显一次）
 *   POST /api/admin/accounts/reset  → 重置密码 {username, password?}
 *   POST /api/admin/accounts/delete → 删号 {username}（已有会话最长存活 7 天自然过期）
 *
 * 依赖 secrets：CF_API_TOKEN + CF_ZONE_ID（与域名分发系统共用）。
 * 注意：CF_API_TOKEN 若只有 Zone.DNS 权限，purge_cache 会返回 Cloudflare 403——错误原样透出，提示换 token。
 */

import { ROLES, resolveUserRole } from "../auth/role";
import {
  createAccount,
  deleteAccount,
  listAccounts,
  resetAccountPassword,
} from "../auth/password";
import {
  cfApi,
  cfConfigured,
  createRawDnsRecord,
  deleteDnsRecord,
  listDnsRecords,
  purgeCache,
} from "../domains/cloudflare";
import { domainZone } from "../domains/service";
import { json } from "../shared/http";
import { resolveSession } from "../shared/session";

const DNS_TYPES = new Set(["A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA"]);
const PROBE_TIMEOUT_MS = 10_000;
/** 探测防 SSRF：禁内网/链路本地地址 */
const BLOCKED_PROBE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?(::1|fc|fd|fe80))/i;

function errJson(err: unknown, fallbackStatus = 502): Response {
  const msg = err instanceof Error ? err.message : String(err);
  // Cloudflare 权限类错误原样透出（如 purge_cache 403），状态用 502 与上游区分
  return json({ error: msg, upstream: msg.startsWith("Cloudflare API:") }, fallbackStatus);
}

export async function handleAdmin(
  request: Request,
  env: Env,
  pathname: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  // 统一鉴权：全部 /api/admin/* 需登录 + CONFIG_ADMIN
  const s = await resolveSession(env, request, ctx);
  if (!s) return json({ error: "未登录，请先在门户登录" }, 401);
  const role = await resolveUserRole(env, s.user, ctx);
  if (!ROLES.CONFIG_ADMIN.test(role.role)) {
    return json({ error: "需要管理员角色（队长/指导/管理员/维护者）" }, 403);
  }

  if (pathname === "/api/admin/cf/status" && request.method === "GET") {
    const zone = domainZone(env);
    return json({
      configured: cfConfigured(env),
      zone,
      zoneId: env.CF_ZONE_ID ? `${env.CF_ZONE_ID.slice(0, 4)}…${env.CF_ZONE_ID.slice(-4)}` : null,
      hint: cfConfigured(env)
        ? undefined
        : "未配置 CF_API_TOKEN / CF_ZONE_ID：wrangler secret put CF_API_TOKEN && wrangler secret put CF_ZONE_ID",
    });
  }

  if (pathname === "/api/admin/cf/dns" && request.method === "GET") {
    if (!cfConfigured(env)) return json({ error: "尚未配置 Cloudflare 凭证（CF_API_TOKEN / CF_ZONE_ID）" }, 503);
    const u = new URL(request.url);
    const name = u.searchParams.get("name")?.trim();
    const type = u.searchParams.get("type")?.trim().toUpperCase();
    try {
      const records = await listDnsRecords(env, name || type ? { name: name || undefined, type: type || undefined } : undefined);
      return json({ records });
    } catch (err) {
      return errJson(err);
    }
  }

  if (pathname === "/api/admin/cf/dns" && request.method === "POST") {
    if (!cfConfigured(env)) return json({ error: "尚未配置 Cloudflare 凭证（CF_API_TOKEN / CF_ZONE_ID）" }, 503);
    const body = (await request.json().catch(() => ({}))) as {
      type?: string;
      name?: string;
      content?: string;
      proxied?: boolean;
      comment?: string;
    };
    const type = (body.type ?? "").toUpperCase();
    const name = (body.name ?? "").trim().toLowerCase();
    const content = (body.content ?? "").trim();
    if (!DNS_TYPES.has(type)) return json({ error: `记录类型不支持：${type || "(空)"}（支持 ${[...DNS_TYPES].join("/")}）` }, 400);
    const zone = domainZone(env);
    if (name !== "*" && name !== zone && !name.endsWith(`.${zone}`)) {
      return json({ error: `记录名必须是 ${zone} 或其子域（* 泛解析直接写 *）` }, 400);
    }
    if (!content) return json({ error: "解析目标 content 不能为空" }, 400);
    try {
      const record = await createRawDnsRecord(env, { type, name, content, proxied: Boolean(body.proxied), comment: body.comment });
      return json({ ok: true, record });
    } catch (err) {
      return errJson(err);
    }
  }

  if (pathname === "/api/admin/cf/dns/delete" && request.method === "POST") {
    if (!cfConfigured(env)) return json({ error: "尚未配置 Cloudflare 凭证（CF_API_TOKEN / CF_ZONE_ID）" }, 503);
    const body = (await request.json().catch(() => ({}))) as { id?: string };
    if (!body.id) return json({ error: "缺少记录 id" }, 400);
    try {
      await deleteDnsRecord(env, body.id);
      return json({ ok: true, deleted: body.id });
    } catch (err) {
      return errJson(err);
    }
  }

  if (pathname === "/api/admin/cf/purge" && request.method === "POST") {
    if (!cfConfigured(env)) return json({ error: "尚未配置 Cloudflare 凭证（CF_API_TOKEN / CF_ZONE_ID）" }, 503);
    const body = (await request.json().catch(() => ({}))) as {
      files?: string[];
      prefixes?: string[];
      purge_everything?: boolean;
      confirm?: string;
    };
    try {
      if (body.purge_everything) {
        if (body.confirm !== domainZone(env)) {
          return json({ error: `清全站缓存是高危操作，请在 confirm 字段输入域名「${domainZone(env)}」确认` }, 400);
        }
        const result = await purgeCache(env, { purge_everything: true });
        return json({ ok: true, result });
      }
      const files = (body.files ?? []).filter((f) => typeof f === "string" && /^https:\/\//.test(f));
      const prefixes = (body.prefixes ?? []).filter((f) => typeof f === "string" && /^https:\/\//.test(f));
      if (files.length === 0 && prefixes.length === 0) {
        return json({ error: "至少提供一个 https:// URL（files 精确 / prefixes 前缀）" }, 400);
      }
      const result = await purgeCache(env, {
        ...(files.length ? { files: files.slice(0, 30) } : {}),
        ...(prefixes.length ? { prefixes: prefixes.slice(0, 30) } : {}),
      });
      return json({ ok: true, result });
    } catch (err) {
      return errJson(err);
    }
  }

  if (pathname === "/api/admin/probe" && request.method === "GET") {
    const raw = new URL(request.url).searchParams.get("url") ?? "";
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return json({ error: "url 参数不是合法 URL" }, 400);
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      return json({ error: "仅支持 http/https" }, 400);
    }
    if (BLOCKED_PROBE_HOST.test(target.hostname)) {
      return json({ error: "禁止探测内网/链路本地地址" }, 400);
    }
    try {
      const res = await fetch(target.toString(), {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      const headers: Record<string, string> = {};
      for (const k of ["cf-cache-status", "x-vercel-id", "x-vercel-cache", "location", "server", "content-type", "cache-control"]) {
        const v = res.headers.get(k);
        if (v) headers[k] = v;
      }
      let title: string | null = null;
      const ct = headers["content-type"] ?? "";
      if (ct.includes("text/html")) {
        const text = await res.text();
        title = text.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
      }
      return json({ status: res.status, headers, title, probedUrl: target.toString() });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  }

  // ---- 本地账号管理（账号密码登录，供实习生等无飞书身份成员使用） ----
  if (pathname === "/api/admin/accounts" && request.method === "GET") {
    try {
      return json({ accounts: await listAccounts(env) });
    } catch (err) {
      return errJson(err);
    }
  }

  if (pathname === "/api/admin/accounts" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { username?: string; name?: string; password?: string };
    try {
      const { account, password } = await createAccount(env, {
        username: body.username ?? "",
        name: body.name ?? "",
        password: body.password,
      });
      return json({ ok: true, username: account.username, name: account.name, password }, 201);
    } catch (err) {
      return errJson(err, 400);
    }
  }

  if (pathname === "/api/admin/accounts/reset" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
    if (!body.username) return json({ error: "缺少 username" }, 400);
    try {
      const { password } = await resetAccountPassword(env, body.username.trim(), body.password);
      return json({ ok: true, username: body.username.trim(), password });
    } catch (err) {
      return errJson(err, 400);
    }
  }

  if (pathname === "/api/admin/accounts/delete" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { username?: string };
    if (!body.username) return json({ error: "缺少 username" }, 400);
    try {
      const deleted = await deleteAccount(env, body.username.trim());
      return json({ ok: true, deleted, username: body.username.trim() });
    } catch (err) {
      return errJson(err, 400);
    }
  }

  // 兜底：允许后续路由继续（当前 /api/admin 均由本模块收口，返回 404 更直观）
  return json({ error: "not found" }, 404);
}
