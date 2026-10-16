/**
 * 开源社区贡献协议（CLA）签署 — /api/cla/*
 *
 * 存储：每签署一条 KV key `cla:sig:<github 小写>`（天然幂等去重，避免整份名单读-改-写并发丢失），
 *       登录用户另写索引 `cla:oid:<open_id>` → github 小写；名单经 REGISTRY.list 前缀聚合。
 * 防滥用：POST /api/cla/sign 按 cf-connecting-ip 滑动窗口限流（10 次/小时，key `rl:cla:<ip>`）。
 *         可升级：要求飞书登录会话（resolveSession 已接入，当前仅用于绑定 open_id）
 *         或接入 Turnstile 人机校验，即可从"限流"升级为"强身份"。
 *
 * 路由：
 *   GET  /api/cla        → 协议元信息 + 公开签署名单（不含邮箱/openId，限最近 100 条）
 *   GET  /api/cla/status → 当前会话（或 ?github=xxx）是否已签署
 *   POST /api/cla/sign   → 签署协议（agree 必须为 true；登录会话自动绑定 open_id）
 */

import { json } from "../shared/http";
import { resolveSession } from "../shared/session";

export const CLA_TITLE = "常州工学院 NEC 开源社区贡献者许可协议（CLA）";
export const CLA_VERSION = "1.0";
export const CLA_UPDATED_AT = "2026-10-14";

const SIG_PREFIX = "cla:sig:";
const OID_PREFIX = "cla:oid:";
const RL_PREFIX = "rl:cla:";
const RL_LIMIT = 10;
const RL_WINDOW_MS = 3600e3;
const PUBLIC_LIST_LIMIT = 100;

const GITHUB_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export interface ClaSignature {
  /** 幂等键：github 用户名小写 */
  id: string;
  name: string;
  github: string;
  email?: string;
  /** 单位 / 组织（可选） */
  org?: string;
  version: string;
  /** 飞书登录用户 open_id（签署时已登录则记录） */
  openId?: string;
  signedAt: string;
  ip?: string;
}

interface SignBody {
  name?: unknown;
  github?: unknown;
  email?: unknown;
  org?: unknown;
  agree?: unknown;
}

/** 滑动日志窗口限流：窗口内已达上限返回 false；KV 并发写允许少量超限，属可接受的近似 */
async function rateLimit(env: Env, ip: string): Promise<boolean> {
  const key = RL_PREFIX + (ip || "unknown");
  const now = Date.now();
  let hits: number[] = [];
  const raw = await env.REGISTRY.get(key);
  if (raw) {
    try {
      const arr = JSON.parse(raw) as number[];
      if (Array.isArray(arr)) hits = arr.filter((t) => now - t < RL_WINDOW_MS);
    } catch {
      hits = [];
    }
  }
  if (hits.length >= RL_LIMIT) return false;
  hits.push(now);
  await env.REGISTRY.put(key, JSON.stringify(hits), { expirationTtl: Math.ceil(RL_WINDOW_MS / 1000) });
  return true;
}

async function readSignature(env: Env, id: string): Promise<ClaSignature | null> {
  const raw = await env.REGISTRY.get(SIG_PREFIX + id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ClaSignature;
  } catch {
    return null;
  }
}

/** 聚合名单：总数为 key 数（单页 list 上限 1000，社区规模内足够），返回最近 limit 条按签署先后升序 */
async function listSignatures(env: Env, limit: number): Promise<{ list: ClaSignature[]; count: number }> {
  const res = await env.REGISTRY.list({ prefix: SIG_PREFIX });
  const raws = await Promise.all(res.keys.map((k) => env.REGISTRY.get(k.name)));
  const sigs: ClaSignature[] = [];
  for (const raw of raws) {
    if (!raw) continue;
    try {
      sigs.push(JSON.parse(raw) as ClaSignature);
    } catch {
      /* 跳过坏记录 */
    }
  }
  sigs.sort((a, b) => a.signedAt.localeCompare(b.signedAt) || a.id.localeCompare(b.id));
  return { list: sigs.slice(-limit), count: res.keys.length };
}

/** 脱敏后的公开视图（荣誉榜用） */
function publicView(s: ClaSignature): Record<string, unknown> {
  return { name: s.name, github: s.github, org: s.org, version: s.version, signedAt: s.signedAt };
}

export async function handleCla(
  request: Request,
  env: Env,
  pathname: string,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  if (pathname === "/api/cla" && request.method === "GET") {
    const { list, count } = await listSignatures(env, PUBLIC_LIST_LIMIT);
    return json({
      agreement: { title: CLA_TITLE, version: CLA_VERSION, updatedAt: CLA_UPDATED_AT },
      count,
      // 荣誉榜按签署先后升序，仅返回最近 PUBLIC_LIST_LIMIT 条
      signatures: list.map(publicView),
    });
  }

  if (pathname === "/api/cla/status" && request.method === "GET") {
    const url = new URL(request.url);
    const session = await resolveSession(env, request, ctx);
    const github = (url.searchParams.get("github") ?? "").trim().toLowerCase();
    let hit: ClaSignature | null = null;
    if (github) {
      hit = await readSignature(env, github);
    } else if (session) {
      const id = await env.REGISTRY.get(OID_PREFIX + session.user.open_id);
      if (id) hit = await readSignature(env, id);
    }
    const res = json({ signed: Boolean(hit), signature: hit ? publicView(hit) : null, authenticated: Boolean(session) });
    return res;
  }

  if (pathname === "/api/cla/sign" && request.method === "POST") {
    const ip = request.headers.get("cf-connecting-ip") ?? "";
    if (!(await rateLimit(env, ip))) {
      return json({ error: "提交过于频繁，请稍后再试" }, 429);
    }

    let body: SignBody;
    try {
      body = (await request.json()) as SignBody;
    } catch {
      return json({ error: "请求体必须是 JSON" }, 400);
    }

    if (body.agree !== true) return json({ error: "请先阅读并勾选同意协议（agree: true）" }, 400);
    const name = String(body.name ?? "").trim();
    const github = String(body.github ?? "").trim();
    const email = String(body.email ?? "").trim();
    const org = String(body.org ?? "").trim();
    if (!name || name.length > 40) return json({ error: "姓名必填且不超过 40 字" }, 400);
    if (!GITHUB_RE.test(github)) return json({ error: "GitHub 用户名格式不正确" }, 400);
    if (email && (email.length > 254 || !EMAIL_RE.test(email))) return json({ error: "邮箱格式不正确" }, 400);
    if (org.length > 60) return json({ error: "单位 / 组织不超过 60 字" }, 400);

    const id = github.toLowerCase();
    const existing = await readSignature(env, id);
    if (existing) {
      const { count } = await listSignatures(env, PUBLIC_LIST_LIMIT);
      return json({ ok: true, alreadySigned: true, signature: publicView(existing), count });
    }

    const session = await resolveSession(env, request, ctx);
    const sig: ClaSignature = {
      id,
      name,
      github,
      email: email || undefined,
      org: org || undefined,
      version: CLA_VERSION,
      openId: session?.user.open_id,
      signedAt: new Date().toISOString(),
      ip: ip || undefined,
    };
    await env.REGISTRY.put(SIG_PREFIX + id, JSON.stringify(sig));
    if (sig.openId) await env.REGISTRY.put(OID_PREFIX + sig.openId, id);
    const { count } = await listSignatures(env, PUBLIC_LIST_LIMIT);
    return json({ ok: true, alreadySigned: false, signature: publicView(sig), count });
  }

  return null;
}
