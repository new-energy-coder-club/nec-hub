/**
 * MCP 工具注册表行为钉住测试（P2-19 注册表化）：
 * 30 个工具名称与 tools/list 顺序、readOnly 派生集合、schema 必需字段完整性。
 */
import { describe, expect, it } from "vitest";
import { handleMcp } from "../mcp/handler";
import { READONLY_TOOLS, TOOL_REGISTRY, TOOLS, findTool } from "../mcp/registry";

const EXPECTED_TOOL_NAMES = [
  "deploy_app",
  "register_app",
  "sync_vercel",
  "import_skills",
  "remove_skills",
  "publish_skill",
  "query_bitable",
  "update_inventory",
  "config_dashboard",
  "config_drawing_review",
  "config_hardware_review",
  "config_contract_approval",
  "publish_doc",
  "update_progress",
  "validate_bitable",
  "config_validate_rules",
  "schedule_meeting",
  "whoami",
  "set_home_layout",
  "remove_docs",
  "add_records",
  "setup_bitable",
  "update_prd",
  "submit_approval",
  "list_todos",
  "send_notice",
  "send_mail",
  "config_flows",
  "apply_domain",
  "release_domain",
];

describe("TOOL_REGISTRY", () => {
  it("注册 30 个工具，名称与顺序与注册表化前 tools/list 输出一致", () => {
    expect(TOOL_REGISTRY.map((t) => t.name)).toEqual(EXPECTED_TOOL_NAMES);
  });

  it("每个工具同处定义 description / inputSchema / impl", () => {
    for (const t of TOOL_REGISTRY) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema).toMatchObject({ type: "object" });
      expect(typeof t.impl).toBe("function");
    }
  });

  it("TOOLS 仅暴露协议三字段（name/description/inputSchema），不含 impl 与 readOnly", () => {
    expect(TOOLS.map((t) => t.name)).toEqual(EXPECTED_TOOL_NAMES);
    for (const t of TOOLS) {
      expect(Object.keys(t).sort()).toEqual(["description", "inputSchema", "name"]);
    }
  });

  it("READONLY_TOOLS 由 readOnly 标记派生：query_bitable / list_todos / whoami", () => {
    expect([...READONLY_TOOLS].sort()).toEqual(["list_todos", "query_bitable", "whoami"]);
  });

  it("findTool 命中注册工具，未知名返回 undefined", () => {
    expect(findTool("whoami")?.name).toBe("whoami");
    expect(findTool("nonexistent")).toBeUndefined();
  });
});

function mcpReq(body: unknown, token?: string): Request {
  return new Request("https://hub.example.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("handleMcp 协议行为", () => {
  it("initialize 返回 instructions 与 serverInfo", async () => {
    const res = await handleMcp(mcpReq({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }), {} as Env);
    const body = (await res.json()) as { result: { serverInfo: { name: string }; instructions: string } };
    expect(body.result.serverInfo.name).toBe("NEC-MCP");
    expect(body.result.instructions).toContain("deploy_app");
    expect(body.result.instructions).toContain("支持自然语言指令");
  });

  it("tools/list 返回注册表生成的 30 个工具", async () => {
    const res = await handleMcp(mcpReq({ jsonrpc: "2.0", id: 2, method: "tools/list" }), {} as Env);
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((t) => t.name)).toEqual(EXPECTED_TOOL_NAMES);
  });

  it("未配置 MCP_TOKEN 降级：写工具拒绝、只读工具放行、未知工具报 Unknown tool", async () => {
    const env = {} as Env;
    const write = await handleMcp(
      mcpReq({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "remove_docs", arguments: { ids: ["a"] } } }),
      env,
    );
    const writeBody = (await write.json()) as { error: { code: number; message: string } };
    expect(writeBody.error.code).toBe(-32000);
    expect(writeBody.error.message).toContain("仅放行只读工具");

    const ro = await handleMcp(
      mcpReq({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "whoami", arguments: {} } }),
      env,
    );
    const roBody = (await ro.json()) as { result: { content: Array<{ text: string }> } };
    expect(roBody.result.content[0].text).toContain("MCP_TOKEN 持有者");

    const unknown = await handleMcp(
      mcpReq({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } }),
      { MCP_TOKEN: "secret" } as Env,
    );
    // 配置了 MCP_TOKEN 但请求未带 → 401
    expect(unknown.status).toBe(401);

    // Node 的 crypto.subtle 无 Workers 专有 timingSafeEqual，补桩后走鉴权通过路径
    (crypto.subtle as unknown as Record<string, unknown>).timingSafeEqual ??= (a: Uint8Array, b: Uint8Array) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    const authed = await handleMcp(
      mcpReq({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "nope" } }, "secret"),
      { MCP_TOKEN: "secret" } as Env,
    );
    const authedBody = (await authed.json()) as { error: { code: number; message: string } };
    expect(authedBody.error.code).toBe(-32602);
    expect(authedBody.error.message).toBe("Unknown tool: nope");
  });

  it("配置 MCP_TOKEN 时错误 token 一律 401（含 tools/list）", async () => {
    const res = await handleMcp(mcpReq({ jsonrpc: "2.0", id: 7, method: "tools/list" }, "wrong"), {
      MCP_TOKEN: "secret",
    } as Env);
    expect(res.status).toBe(401);
  });

  it("未知 method 报 -32601", async () => {
    const res = await handleMcp(mcpReq({ jsonrpc: "2.0", id: 8, method: "nope/method" }), {} as Env);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32601);
  });
});
