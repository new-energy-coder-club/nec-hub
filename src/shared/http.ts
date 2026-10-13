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
