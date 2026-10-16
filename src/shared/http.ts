/**
 * 共享 HTTP 工具 — index.ts 与各 /api 子模块共用
 */

/** 统一 JSON 响应：2 空格缩进，utf-8 */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** 解析 JSON 请求体；非法 JSON 返回 null（调用方统一回 400「请求体必须是 JSON」） */
export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
