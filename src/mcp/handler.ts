/**
 * MCP (JSON-RPC over streamable HTTP) — 端点与 tools/call 分发
 *
 * 鉴权决策点保持在 handleMcp 入口：配置 MCP_TOKEN 时所有方法（含 tools/list）
 * 都需 Authorization: Bearer 通过 timingSafeEqual 比对；未配置时降级为只读模式，
 * tools/call 仅放行注册表 readOnly 标记派生的只读集合，写工具返回 JSON-RPC 错误。
 * 工具清单/schema/实现/instructions 的单一来源在 ./registry 与 ./instructions。
 */

import { json } from "../shared/http";
import { SERVER_INSTRUCTIONS } from "./instructions";
import { findTool, READONLY_TOOLS, TOOLS } from "./registry";

function rpc(id: string | number | null, result: unknown): Response {
  return json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: string | number | null, code: number, message: string): Response {
  return json({ jsonrpc: "2.0", id, error: { code, message } }, 200);
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  let hasMcpToken = false;
  if (env.MCP_TOKEN) {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    hasMcpToken = await timingSafeEqual(token, env.MCP_TOKEN);
    if (!hasMcpToken) {
      return json({ error: "unauthorized" }, 401);
    }
  } else {
    hasMcpToken = true;
  }
  let msg: {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
  };
  try {
    msg = (await request.json()) as typeof msg;
  } catch {
    return rpcError(null, -32700, "Parse error");
  }
  const id = msg.id ?? null;
  switch (msg.method) {
    case "initialize":
      return rpc(id, {
        protocolVersion: (msg.params?.protocolVersion as string) ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "NEC-MCP", version: "0.4.0" },
        instructions: SERVER_INSTRUCTIONS,
      });
    case "ping":
      return rpc(id, {});
    case "notifications/initialized":
      return new Response(null, { status: 202 });
    case "tools/list":
      return rpc(id, { tools: TOOLS });
    case "tools/call":
      return await callTool(id, msg.params ?? {}, env, request, hasMcpToken);
    default:
      return rpcError(id, -32601, `Method not found: ${String(msg.method)}`);
  }
}

async function callTool(
  id: string | number | null,
  params: Record<string, unknown>,
  env: Env,
  request: Request,
  hasMcpToken: boolean,
): Promise<Response> {
  const name = params.name as string;
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  if (!env.MCP_TOKEN && !READONLY_TOOLS.has(name)) {
    console.warn(`[mcp] 未配置 MCP_TOKEN，拒绝写工具调用: ${name}`);
    return rpcError(
      id,
      -32000,
      `工具 ${name} 为写操作：未配置 MCP_TOKEN 时仅放行只读工具（${[...READONLY_TOOLS].join("/")}），请在 Worker 环境变量配置 MCP_TOKEN 后重试`,
    );
  }
  const tool = findTool(name);
  if (!tool) {
    return rpcError(id, -32602, `Unknown tool: ${name}`);
  }
  try {
    return rpc(id, await tool.impl(args, env, { request, hasMcpToken }));
  } catch (err) {
    return rpc(id, {
      content: [{ type: "text", text: `执行失败：${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    });
  }
}
