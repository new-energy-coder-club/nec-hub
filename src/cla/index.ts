/**
 * 开源社区贡献协议（CLA）签署 — /api/cla/*
 *
 * 存储：KV key `cla:signatures` → ClaSignature[]（按 GitHub 用户名小写幂等去重）
 *
 * 路由：
 *   GET  /api/cla        → 协议元信息 + 公开签署名单（不含邮箱/openId）
 *   GET  /api/cla/status → 当前会话（或 ?github=xxx）是否已签署
 *   POST /api/cla/sign   → 签署协议（agree 必须为 true；登录会话自动绑定 open_id）
 */

import { json } from "../shared/http";
import { applyRenewedSession, resolveSession } from "../shared/session";

export const CLA_TITLE = "常州工学院 NEC 开源社区贡献者许可协议（CLA）";
export const CLA_VERSION = "1.0";
export const CLA_UPDATED_AT = "2026-10-14";

const KV_KEY = "cla:signatures";
const GITHUB_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

async function readSignatures(env: Env): Promise<ClaSignature[]> {
  const raw = await env.REGISTRY.get(KV_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as ClaSignature[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
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
    const list = await readSignatures(env);
    return json({
      agreement: { title: CLA_TITLE, version: CLA_VERSION, updatedAt: CLA_UPDATED_AT },
      count: list.length,
      // 荣誉榜按签署先后升序
      signatures: list.map(publicView),
    });
  }

  if (pathname === "/api/cla/status" && request.method === "GET") {
    const url = new URL(request.url);
    const list = await readSignatures(env);
    const session = await resolveSession(env, request, ctx);
    const github = (url.searchParams.get("github") ?? "").trim().toLowerCase();
    const hit = list.find((s) => (github && s.id === github) || (session && s.openId === session.user.open_id));
    const res = json({ signed: Boolean(hit), signature: hit ? publicView(hit) : null, authenticated: Boolean(session) });
    return applyRenewedSession(res, session?.renewed);
  }

  if (pathname === "/api/cla/sign" && request.method === "POST") {
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
    if (email && !EMAIL_RE.test(email)) return json({ error: "邮箱格式不正确" }, 400);

    const id = github.toLowerCase();
    const list = await readSignatures(env);
    const existing = list.find((s) => s.id === id);
    if (existing) {
      return json({ ok: true, alreadySigned: true, signature: publicView(existing), count: list.length });
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
      ip: request.headers.get("cf-connecting-ip") ?? undefined,
    };
    list.push(sig);
    await env.REGISTRY.put(KV_KEY, JSON.stringify(list));
    return json({ ok: true, alreadySigned: false, signature: publicView(sig), count: list.length });
  }

  return null;
}
