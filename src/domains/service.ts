/**
 * 域名分发系统 — 校验、KV 存取与申请/释放核心逻辑
 *
 * 存储模型：每条记录一个 key（domains:rec:<subdomain>），整条 JSON 同时写 value 与
 * metadata（list 时直接取 metadata，避免 N+1 读）。单 key 写入消除了旧版整表
 * domains:index 的 read-modify-write 并发覆盖问题；同一子域名的并发抢占由
 * Cloudflare 侧「同名记录已存在」错误兜底（后到者落为 failed，可 retry）。
 * 旧整表 domains:index 只读回退：listDomains 读到后自动迁移并删除。
 */

import { cfConfigured, createDnsRecord, deleteDnsRecord } from "./cloudflare";
import type { CreateDomainBody, DomainEntry } from "./types";

/** 旧版整表索引 key（仅迁移用，勿再写入） */
export const DOMAINS_INDEX_KEY = "domains:index";

/** 每域名一个记录 key 的前缀 */
export const DOMAIN_REC_PREFIX = "domains:rec:";

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

/** 携带 HTTP 状态码的域名错误（400 输入 / 404 不存在 / 403 越权 / 409 占用 / 429 限额 / 502 CF 失败） */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

export class DomainInputError extends DomainError {}

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

function recKey(subdomain: string): string {
  return DOMAIN_REC_PREFIX + subdomain;
}

function parseEntry(raw: unknown): DomainEntry | null {
  if (!raw) return null;
  if (typeof raw === "object") {
    const e = raw as DomainEntry;
    return typeof e.subdomain === "string" ? e : null;
  }
  try {
    const e = JSON.parse(String(raw)) as DomainEntry;
    return e && typeof e.subdomain === "string" ? e : null;
  } catch {
    return null;
  }
}

function readLegacyIndex(raw: string | null): DomainEntry[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as DomainEntry[];
    return Array.isArray(list) ? list.filter((e) => e && typeof e.subdomain === "string") : [];
  } catch {
    return [];
  }
}

/** 旧整表 domains:index → 每域名单 key 的一次性迁移（幂等；迁移后删除旧 key） */
async function migrateLegacyIndex(env: Env): Promise<DomainEntry[]> {
  const list = readLegacyIndex(await env.REGISTRY.get(DOMAINS_INDEX_KEY));
  if (!list.length) return [];
  await Promise.all(
    list.map((e) => env.REGISTRY.put(recKey(e.subdomain), JSON.stringify(e), { metadata: e as unknown as Record<string, unknown> })),
  );
  await env.REGISTRY.delete(DOMAINS_INDEX_KEY);
  return list;
}

export async function listDomains(env: Env): Promise<DomainEntry[]> {
  const legacy = await migrateLegacyIndex(env);
  // 团队规模远小于 1000，单页 list 足够；metadata 即整条记录，不再逐条 get
  const res = await env.REGISTRY.list({ prefix: DOMAIN_REC_PREFIX });
  const bySub = new Map<string, DomainEntry>();
  const missing: string[] = [];
  for (const k of res.keys) {
    const e = parseEntry(k.metadata);
    if (e) bySub.set(e.subdomain, e);
    else missing.push(k.name);
  }
  await Promise.all(
    missing.map(async (name) => {
      const e = parseEntry(await env.REGISTRY.get(name));
      if (e) bySub.set(e.subdomain, e);
    }),
  );
  for (const e of legacy) if (!bySub.has(e.subdomain)) bySub.set(e.subdomain, e);
  return [...bySub.values()];
}

export async function findDomain(env: Env, subdomain: string): Promise<DomainEntry | null> {
  const rec = parseEntry(await env.REGISTRY.get(recKey(subdomain)));
  if (rec) return rec;
  // 旧整表索引只读回退（未迁移时的存量数据）
  return readLegacyIndex(await env.REGISTRY.get(DOMAINS_INDEX_KEY)).find((e) => e.subdomain === subdomain) ?? null;
}

/** 写入/覆盖单条记录（单 key 原子写，无整表 read-modify-write） */
export async function putDomain(env: Env, entry: DomainEntry): Promise<void> {
  await env.REGISTRY.put(recKey(entry.subdomain), JSON.stringify(entry), { metadata: entry as unknown as Record<string, unknown> });
}

export async function removeDomain(env: Env, subdomain: string): Promise<void> {
  await env.REGISTRY.delete(recKey(subdomain));
  // 旧索引若仍含该记录则一并清除（迁移前的存量）
  const legacy = readLegacyIndex(await env.REGISTRY.get(DOMAINS_INDEX_KEY));
  if (legacy.some((e) => e.subdomain === subdomain)) {
    await env.REGISTRY.put(DOMAINS_INDEX_KEY, JSON.stringify(legacy.filter((e) => e.subdomain !== subdomain)));
  }
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

// ---------- 申请 / 释放核心（HTTP 处理器与 MCP 工具共用） ----------

export interface DomainOwner {
  name: string;
  open_id: string;
}

export interface ApplyDomainResult {
  entry: DomainEntry;
  /** 面向申请人的结果说明（DNS 状态 / 深级域名证书提示） */
  hint: string;
}

/**
 * 申请域名：校验 → 占用与限额检查 → 配置 CF 凭证时同步建 DNS → 单 key 落 KV。
 * 错误一律抛 DomainError（status 即 HTTP 语义），调用方决定如何呈现。
 */
export async function applyDomain(
  env: Env,
  body: CreateDomainBody,
  owner: DomainOwner,
  opts: { isAdmin?: boolean } = {},
): Promise<ApplyDomainResult> {
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
    throw new DomainError(`「${subdomain}.${zone}」已被占用`, 409);
  }
  if (!opts.isAdmin) {
    const list = await listDomains(env);
    if (countByOwner(list, owner.open_id) >= maxPerUser(env)) {
      throw new DomainError(`每个成员最多申请 ${maxPerUser(env)} 个域名，请先释放不用的`, 429);
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
    owner,
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

  await putDomain(env, entry);
  const statusHint =
    entry.status === "active"
      ? "DNS 已生效"
      : entry.status === "pending"
        ? "已登记，等待管理员配置 Cloudflare 凭证后同步"
        : `Cloudflare 同步失败：${entry.error}`;
  return { entry, hint: deepHint ? `${statusHint}。${deepHint}` : statusHint };
}

/** 释放域名：先删 Cloudflare 记录（成功才删登记，避免 DNS 残留指向失效目标） */
export async function releaseDomain(
  env: Env,
  rawSubdomain: unknown,
  requester: DomainOwner,
  opts: { isAdmin?: boolean } = {},
): Promise<DomainEntry> {
  const subdomain = validateSubdomain(rawSubdomain);
  const entry = await findDomain(env, subdomain);
  if (!entry) throw new DomainError("域名不存在", 404);
  if (!opts.isAdmin && entry.owner.open_id !== requester.open_id) {
    throw new DomainError("只能释放自己的域名", 403);
  }
  if (entry.cfRecordId && cfConfigured(env)) {
    try {
      await deleteDnsRecord(env, entry.cfRecordId);
    } catch (err) {
      throw new DomainError(`Cloudflare 删除失败，登记保留：${err instanceof Error ? err.message : String(err)}`, 502);
    }
  }
  await removeDomain(env, subdomain);
  return entry;
}
