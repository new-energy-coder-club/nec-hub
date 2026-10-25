/**
 * 账号密码登录（/auth/password）+ 本地账号管理（供 /api/admin/accounts* 复用）
 *
 * 为没有飞书身份的成员（如实习生）提供门户登录：
 *   - 口令存储：PBKDF2-SHA256（100k 迭代，16 字节随机盐），KV key `pwd:account:<username>`，不落明文
 *   - 会话：与飞书登录同一套 nec_session Cookie（open_id 为 `local:<username>`，角色兜底"队员"）
 *   - 防爆破：连续失败 10 次锁定 15 分钟（KV 计数器 `pwd:lock:<username>`）
 *
 * 管理端能力（在 src/admin/index.ts 挂载，需 CONFIG_ADMIN）：
 *   建号 / 重置密码（可指定或自动生成）/ 删除 / 列表——明文密码只在创建/重置的响应里出现一次。
 */

import { createSession, sessionCookie, type HubUser } from "../shared/session";

export const PWD_KEY_PREFIX = "pwd:account:";
export const PWD_LOCK_PREFIX = "pwd:lock:";
const PBKDF2_ITERATIONS = 100_000;
const MAX_FAILS = 10;
const LOCK_TTL_SEC = 15 * 60;
const USERNAME_RE = /^[a-z][a-z0-9_-]{1,31}$/;

export interface PasswordAccount {
  username: string;
  name: string;
  open_id: string;
  salt: string;
  hash: string;
  iterations: number;
  createdAt: string;
  updatedAt: string;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function deriveHash(password: string, saltHex: string, iterations: number): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return toHex(bits);
}

/** 生成可读口令：12 位，去除易混淆字符（0/O/1/l/I） */
export function generatePassword(len = 12): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

export function validUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

export async function getAccount(env: Env, username: string): Promise<PasswordAccount | null> {
  const raw = await env.REGISTRY.get(`${PWD_KEY_PREFIX}${username}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PasswordAccount;
  } catch {
    return null;
  }
}

/** 建号；password 缺省时自动生成。返回明文密码（仅此一次可见） */
export async function createAccount(
  env: Env,
  input: { username: string; name: string; password?: string },
): Promise<{ account: PasswordAccount; password: string }> {
  const username = input.username.trim();
  const name = input.name.trim();
  if (!validUsername(username)) {
    throw new Error("用户名须为小写字母开头的 2-32 位小写字母/数字/下划线/连字符");
  }
  if (!name || name.length > 32) throw new Error("姓名必填且不超过 32 字");
  if (await getAccount(env, username)) throw new Error(`用户名 ${username} 已存在`);
  const password = input.password?.trim() || generatePassword();
  if (password.length < 8) throw new Error("密码至少 8 位");
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer);
  const hash = await deriveHash(password, salt, PBKDF2_ITERATIONS);
  const account: PasswordAccount = {
    username,
    name,
    open_id: `local:${username}`,
    salt,
    hash,
    iterations: PBKDF2_ITERATIONS,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await env.REGISTRY.put(`${PWD_KEY_PREFIX}${username}`, JSON.stringify(account));
  return { account, password };
}

/** 重置密码；password 缺省时自动生成。返回新明文密码（仅此一次可见） */
export async function resetAccountPassword(
  env: Env,
  username: string,
  password?: string,
): Promise<{ account: PasswordAccount; password: string }> {
  const account = await getAccount(env, username);
  if (!account) throw new Error(`账号 ${username} 不存在`);
  const next = password?.trim() || generatePassword();
  if (next.length < 8) throw new Error("密码至少 8 位");
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer);
  account.salt = salt;
  account.hash = await deriveHash(next, salt, account.iterations);
  account.updatedAt = new Date().toISOString();
  await env.REGISTRY.put(`${PWD_KEY_PREFIX}${username}`, JSON.stringify(account));
  return { account, password: next };
}

export async function deleteAccount(env: Env, username: string): Promise<boolean> {
  if (!(await getAccount(env, username))) return false;
  await env.REGISTRY.delete(`${PWD_KEY_PREFIX}${username}`);
  return true;
}

export async function listAccounts(env: Env): Promise<Array<Pick<PasswordAccount, "username" | "name" | "createdAt" | "updatedAt">>> {
  const listed = await env.REGISTRY.list({ prefix: PWD_KEY_PREFIX });
  const out: Array<Pick<PasswordAccount, "username" | "name" | "createdAt" | "updatedAt">> = [];
  for (const key of listed.keys) {
    const acc = await getAccount(env, key.name.slice(PWD_KEY_PREFIX.length));
    if (acc) out.push({ username: acc.username, name: acc.name, createdAt: acc.createdAt, updatedAt: acc.updatedAt });
  }
  return out.sort((a, b) => a.username.localeCompare(b.username));
}

/** 校验口令（constant-time 比较 + 失败锁定：10 次失败锁 15 分钟）。返回账号或错误 */
export async function verifyAccountPassword(
  env: Env,
  username: string,
  password: string,
): Promise<{ account: PasswordAccount } | { error: string; status: number; retryAfterSec?: number }> {
  const lockKey = `${PWD_LOCK_PREFIX}${username}`;
  const fails = Number((await env.REGISTRY.get(lockKey)) ?? "0") || 0;
  if (fails >= MAX_FAILS) {
    return { error: "失败次数过多，已锁定 15 分钟，请稍后再试", status: 429, retryAfterSec: LOCK_TTL_SEC };
  }
  const account = await getAccount(env, username);
  // 账号不存在也走一次派生，避免时间侧信道探测有效用户名
  const salt = account?.salt ?? "00".repeat(16);
  const iterations = account?.iterations ?? PBKDF2_ITERATIONS;
  const hash = await deriveHash(password, salt, iterations);
  const ok = account && account.hash === hash;
  if (!ok) {
    const next = fails + 1;
    await env.REGISTRY.put(lockKey, String(next), { expirationTtl: LOCK_TTL_SEC });
    if (next >= MAX_FAILS) {
      return { error: "失败次数过多，已锁定 15 分钟", status: 429, retryAfterSec: LOCK_TTL_SEC };
    }
    return { error: "账号或密码错误", status: 401 };
  }
  if (fails > 0) await env.REGISTRY.delete(lockKey);
  return { account };
}

/** POST /auth/password {username, password} → 签发 nec_session（与飞书登录同 Cookie 口径） */
export async function handlePasswordLogin(request: Request, env: Env): Promise<Response> {
  const jsonBody = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  if (request.method !== "POST") return jsonBody({ error: "method not allowed" }, 405);
  let body: { username?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonBody({ error: "请求体必须是 JSON" }, 400);
  }
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  if (!username || !password) return jsonBody({ error: "请输入账号和密码" }, 400);

  const result = await verifyAccountPassword(env, username, password);
  if ("error" in result) {
    const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8" };
    if (result.retryAfterSec) headers["retry-after"] = String(result.retryAfterSec);
    return new Response(JSON.stringify({ error: result.error }, null, 2), { status: result.status, headers });
  }
  const user: HubUser = { name: result.account.name, open_id: result.account.open_id };
  const sid = await createSession(env, user);
  const payload = encodeURIComponent(
    JSON.stringify({ name: user.name, avatar_url: "", at: new Date().toISOString(), local: true }),
  );
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  headers.append("set-cookie", sessionCookie(sid));
  headers.append("set-cookie", `nec_last_login=${payload}; Path=/; SameSite=Lax; Secure; Max-Age=${30 * 24 * 3600}`);
  return new Response(JSON.stringify({ name: user.name, open_id: user.open_id, session: true }, null, 2), {
    headers,
  });
}
