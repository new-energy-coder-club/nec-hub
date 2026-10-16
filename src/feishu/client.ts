/**
 * 飞书 OpenAPI 共享底座：API 常量、Env 动态读取、access_token 缓存骨架。
 *
 * cachedToken：实例内存 + KV 两级缓存 + in-flight 去重的通用骨架，
 * tenant_access_token（bitable.ts）与 app_access_token（auth/feishu-auth.ts）共用，
 * 两种 token 各自的 KV key 与过期策略由调用方保持。
 */

export const FEISHU_API = "https://open.feishu.cn/open-apis";

/** 动态读 Env 字符串变量（webhook 按流程名拼接变量名等场景用） */
export function envSecret(env: Env, key: string): string | undefined {
  return (env as unknown as Record<string, string | undefined>)[key];
}

/** envSecret 的 trim 版：空白视为未配置 */
export function envVar(env: Env, key: string): string | undefined {
  return envSecret(env, key)?.trim() || undefined;
}

export interface CachedToken {
  token: string;
  expireAt: number;
}

interface TokenCacheState {
  mem: CachedToken | null;
  inflight: Promise<string> | null;
}

const tokenCaches = new Map<string, TokenCacheState>();

/**
 * access_token 缓存（实例内存 + KV，均提前过期由 fetcher 决定 expireAt）。
 * 命中内存时连 KV 都不读；缓存过期瞬间的并发调用共享同一次飞书请求。
 * fetcher 负责真正换取 token 并返回 { token, expireAt }。
 */
export async function cachedToken(env: Env, kvKey: string, fetcher: (env: Env) => Promise<CachedToken>): Promise<string> {
  let state = tokenCaches.get(kvKey);
  if (!state) {
    state = { mem: null, inflight: null };
    tokenCaches.set(kvKey, state);
  }
  const s = state;
  if (s.mem && s.mem.expireAt > Date.now()) return s.mem.token;
  s.inflight ??= (async () => {
    const cached = (await env.REGISTRY.get(kvKey, "json")) as CachedToken | null;
    if (cached && cached.expireAt > Date.now()) {
      s.mem = cached;
      return cached.token;
    }
    const fresh = await fetcher(env);
    s.mem = fresh;
    await env.REGISTRY.put(kvKey, JSON.stringify(fresh));
    return fresh.token;
  })().finally(() => {
    s.inflight = null;
  });
  return s.inflight;
}
