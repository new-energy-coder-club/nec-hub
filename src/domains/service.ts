/**
 * 域名分发系统 — 校验与 KV 存取
 *
 * 记录全部放在 REGISTRY 的 domains:index 列表里（团队规模下足够，
 * 与 apps:index / skills:index 同一模式）。
 */

import type { DomainEntry } from "./types";

export const DOMAINS_INDEX_KEY = "domains:index";

export const DOMAIN_ZONE_DEFAULT = "newenergycoder.club";

/** 每个普通成员最多持有的三级域名数（可用 var DOMAIN_MAX_PER_USER 覆盖） */
export const DOMAIN_MAX_PER_USER_DEFAULT = 3;

/** 保留子域名：平台自身与常见基础设施前缀，不开放申请 */
export const RESERVED_SUBDOMAINS = new Set([
  "hub", "www", "api", "docs", "doc", "mail", "smtp", "imap", "pop",
  "git", "github", "gitee", "mcp", "kimi", "status", "admin", "root",
  "ns1", "ns2", "ftp", "ssh", "vpn", "cdn", "static", "assets", "img",
  "app", "apps", "auth", "login", "sso", "oauth", "dashboard", "erp",
  "mes", "wiki", "blog", "forum", "shop", "pay", "test", "staging",
  "dev", "prod", "preview", "gateway", "proxy", "dns", "mx",
]);

export class DomainInputError extends Error {}

export function domainZone(env: Env): string {
  return (env.DOMAIN_ZONE ?? DOMAIN_ZONE_DEFAULT).toLowerCase();
}

export function maxPerUser(env: Env): number {
  const n = Number(env.DOMAIN_MAX_PER_USER);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DOMAIN_MAX_PER_USER_DEFAULT;
}

const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** 子域名部分最多 3 级标签（a.b.c.<zone>），即最深支持到六级域名 */
const MAX_LABELS = 3;

/** 深级标签的高危保留名（防止 xxx.hub / xxx.login 这类仿冒平台服务的四级域名） */
const RESERVED_DEEP_LABELS = new Set(["hub", "login", "auth", "admin", "pay", "sso"]);

/**
 * 子域名校验：支持多级（点分隔），每个标签小写字母数字中划线、2-63 字符、
 * 不能以中划线开头结尾。保留名规则：首标签按全量保留表校验（保护平台三级域名）；
 * 深级标签只拦高危词（成员自己的命名空间，允许 dev/team 等）。
 * 例："my-app" → 三级域名；"my-app.dev" → 四级域名 my-app.dev.<zone>
 */
export function validateSubdomain(raw: unknown): string {
  const sub = String(raw ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!sub) throw new DomainInputError("缺少 subdomain");
  const labels = sub.split(".");
  if (labels.length > MAX_LABELS) {
    throw new DomainInputError(`子域名最多 ${MAX_LABELS} 级标签（如 a.b），当前 ${labels.length} 级`);
  }
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (!LABEL_RE.test(label) || label.length < 2) {
      throw new DomainInputError("子域名标签只能含小写字母/数字/中划线，2-63 字符，且不能以中划线开头结尾");
    }
    const reserved = i === 0 ? RESERVED_SUBDOMAINS.has(label) : RESERVED_DEEP_LABELS.has(label);
    if (reserved) {
      throw new DomainInputError(`「${label}」是保留子域名，不开放申请`);
    }
  }
  return sub;
}

/** 是否为四级及更深域名（子域名部分含点）。Cloudflare Universal SSL 只覆盖三级，深级域名不可开代理 */
export function isDeepSubdomain(subdomain: string): boolean {
  return subdomain.includes(".");
}

const HOSTNAME_RE = /^(?=.{1,253}\.?$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+\.?$/i;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isIPv4(s: string): boolean {
  const m = IPV4_RE.exec(s);
  return !!m && m.slice(1).every((g) => Number(g) <= 255);
}

/** 校验记录类型与解析目标，返回规范化后的 type/target */
export function validateTarget(rawType: unknown, rawTarget: unknown, zone: string): { type: DomainEntry["type"]; target: string } {
  const type = String(rawType ?? "CNAME").trim().toUpperCase();
  const target = String(rawTarget ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!target) throw new DomainInputError("缺少 target");
  if (type === "CNAME") {
    if (!HOSTNAME_RE.test(target) || isIPv4(target)) {
      throw new DomainInputError("CNAME 目标必须是主机名（如 my-app.pages.dev），不能是 IP");
    }
    if (target === zone || target.endsWith(`.${zone}`)) {
      throw new DomainInputError(`CNAME 目标不能指向 ${zone} 自身（会形成回环）`);
    }
    return { type, target };
  }
  if (type === "A") {
    if (!isIPv4(target)) throw new DomainInputError("A 记录目标必须是合法 IPv4 地址");
    return { type, target };
  }
  if (type === "AAAA") {
    if (!/^[0-9a-f:]+$/i.test(target) || !target.includes(":")) {
      throw new DomainInputError("AAAA 记录目标必须是合法 IPv6 地址");
    }
    return { type, target };
  }
  throw new DomainInputError("type 只支持 CNAME | A | AAAA");
}

// ---------- KV 存取 ----------

export async function listDomains(env: Env): Promise<DomainEntry[]> {
  const raw = await env.REGISTRY.get(DOMAINS_INDEX_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as DomainEntry[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function saveDomains(env: Env, list: DomainEntry[]): Promise<void> {
  await env.REGISTRY.put(DOMAINS_INDEX_KEY, JSON.stringify(list));
}

export async function findDomain(env: Env, subdomain: string): Promise<DomainEntry | null> {
  const list = await listDomains(env);
  return list.find((e) => e.subdomain === subdomain) ?? null;
}

export async function upsertDomain(env: Env, entry: DomainEntry): Promise<void> {
  const list = await listDomains(env);
  const i = list.findIndex((e) => e.subdomain === entry.subdomain);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  await saveDomains(env, list);
}

export async function removeDomain(env: Env, subdomain: string): Promise<void> {
  const list = await listDomains(env);
  await saveDomains(env, list.filter((e) => e.subdomain !== subdomain));
}

export function countByOwner(list: DomainEntry[], openId: string): number {
  return list.filter((e) => e.owner.open_id === openId).length;
}

/** 对外展示的脱敏形态（不暴露 open_id / cfRecordId） */
export function publicView(e: DomainEntry) {
  return {
    subdomain: e.subdomain,
    fqdn: e.fqdn,
    type: e.type,
    target: e.target,
    description: e.description,
    status: e.status,
    /** true = 四级及更深域名（仅 DNS，无 Cloudflare 证书） */
    deep: isDeepSubdomain(e.subdomain),
    owner: e.owner.name,
    createdAt: e.createdAt,
  };
}
