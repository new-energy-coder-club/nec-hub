/**
 * 门户会话解析（nec_session Cookie）— 各 /api 子模块共用
 *
 * 主 index.ts 内另有带滑动续期的完整版；本模块只读解析，供子流程模块使用。
 */

export interface HubUser {
  name: string;
  open_id: string;
  avatar_url?: string;
}

interface SessionData extends HubUser {
  createdAt: string;
  expiresAt: number;
}

export function parseCookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** 解析会话 Cookie；失效会话顺手清掉。未登录/过期返回 null */
export async function resolveSession(request: Request, env: Env): Promise<HubUser | null> {
  const sid = parseCookies(request)["nec_session"];
  if (!sid) return null;
  const raw = await env.REGISTRY.get(`session:${sid}`);
  if (!raw) return null;
  let data: SessionData;
  try {
    data = JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
  if (!data.open_id || data.expiresAt <= Date.now()) {
    await env.REGISTRY.delete(`session:${sid}`);
    return null;
  }
  return { name: data.name, open_id: data.open_id, avatar_url: data.avatar_url };
}
