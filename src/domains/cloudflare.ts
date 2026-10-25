/**
 * Cloudflare DNS API 客户端（域名分发系统专用）
 *
 * 依赖 secrets：CF_API_TOKEN（Zone.DNS 编辑权限）+ CF_ZONE_ID（newenergycoder.club 的 Zone ID）。
 * 未配置时调用方应把记录存为 pending，配置后由 /api/domains/retry 补同步。
 */

import type { DomainEntry } from "./types";

const CF_API = "https://api.cloudflare.com/client/v4";

export function cfConfigured(env: Env): boolean {
  return Boolean(env.CF_API_TOKEN && env.CF_ZONE_ID);
}

interface CfResult<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: T;
}

async function cfFetch<T>(env: Env, path: string, init?: RequestInit): Promise<T> {
  return cfApi<T>(env, `/dns_records${path}`, init);
}

/** 通用 Cloudflare Zone API 调用（admin 模块用于 purge_cache 等非 DNS 端点） */
export async function cfApi<T>(env: Env, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CF_API}/zones/${env.CF_ZONE_ID}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.CF_API_TOKEN}`,
      "content-type": "application/json",
    },
  });
  const data = (await res.json()) as CfResult<T>;
  if (!res.ok || !data.success) {
    const msg = data.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API: ${msg}`);
  }
  return data.result;
}

interface CfRecord {
  id: string;
  name: string;
  type: string;
  content: string;
}

/** 创建 DNS 记录，返回 record id；若同名记录已存在则抛错（调用方决定是 409 还是复用） */
export async function createDnsRecord(env: Env, entry: DomainEntry): Promise<string> {
  const rec = await cfFetch<CfRecord>(env, "", {
    method: "POST",
    body: JSON.stringify({
      type: entry.type,
      name: entry.fqdn,
      content: entry.target,
      proxied: entry.proxied,
      ttl: 1, // 1 = automatic
      comment: `nec-hub domains: ${entry.owner.name}`,
    }),
  });
  return rec.id;
}

/** 按 fqdn 查现有记录（冲突检测 / 补同步时找回 record id） */
export async function findDnsRecord(env: Env, fqdn: string): Promise<CfRecord | null> {
  const list = await cfFetch<CfRecord[]>(env, `?name=${encodeURIComponent(fqdn)}`);
  return list[0] ?? null;
}

/** 删除 DNS 记录；记录已不存在（404/81044）视为成功 */
export async function deleteDnsRecord(env: Env, recordId: string): Promise<void> {
  try {
    await cfFetch<{ id: string }>(env, `/${recordId}`, { method: "DELETE" });
  } catch (err) {
    if (err instanceof Error && /81044|not found|HTTP 404/i.test(err.message)) return;
    throw err;
  }
}

export interface CfDnsRecord {
  id: string;
  name: string;
  type: string;
  content: string;
  proxied?: boolean;
  ttl?: number;
  comment?: string;
}

/** 列 DNS 记录（可按 name/type 过滤；不过滤则拉取前 100 条） */
export async function listDnsRecords(env: Env, filter?: { name?: string; type?: string }): Promise<CfDnsRecord[]> {
  const params = new URLSearchParams();
  if (filter?.name) params.set("name", filter.name);
  if (filter?.type) params.set("type", filter.type);
  params.set("per_page", "100");
  return cfFetch<CfDnsRecord[]>(env, `?${params.toString()}`);
}

/** 直接创建 DNS 记录（admin 后台用；不做域名分发系统的保留名校验） */
export async function createRawDnsRecord(
  env: Env,
  rec: { type: string; name: string; content: string; proxied?: boolean; comment?: string },
): Promise<CfDnsRecord> {
  return cfFetch<CfDnsRecord>(env, "", {
    method: "POST",
    body: JSON.stringify({ ...rec, ttl: 1, comment: rec.comment ?? "nec-hub admin" }),
  });
}

/** 清除边缘缓存：按 URL/前缀；purge_everything 需调用方自行做好二次确认 */
export async function purgeCache(
  env: Env,
  payload: { files?: string[]; prefixes?: string[]; purge_everything?: boolean },
): Promise<unknown> {
  return cfApi(env, "/purge_cache", { method: "POST", body: JSON.stringify(payload) });
}
