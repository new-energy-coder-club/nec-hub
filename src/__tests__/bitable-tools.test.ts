/**
 * setup_bitable / add_records / remove_docs 测试
 *
 * mock 风格沿用 fe04-fe09.test.ts：内存 KV + fetch 路由（建表 / fields / batch_create）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DOCS_REGISTRY_KEY } from "../dashboard";
import { toolAddRecords, toolRemoveDocs, toolSetupBitable } from "../mcp/implementations";

const BASE = "appMockBaseX";

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

interface Ctx {
  env: Env;
  kv: Map<string, string>;
  createdTables: Array<{ name: string; fields: unknown[] }>;
  batchCreated: Array<Record<string, unknown>>;
}

function createCtx(): Ctx {
  const kv = new Map<string, string>();
  const createdTables: Ctx["createdTables"] = [];
  const batchCreated: Ctx["batchCreated"] = [];
  let seq = 0;

  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String((input as { url?: string })?.url ?? input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (/\/bitable\/v1\/apps\/[^/]+\/fields|\/tables\/[^/?]+\/fields/.test(url)) {
      return jsonResp({ code: 0, data: { items: [{ field_name: "姓名", ui_type: "Text" }, { field_name: "组别", ui_type: "Text" }], has_more: false } });
    }
    if (url.includes("/records/batch_create")) {
      const records = (JSON.parse(init!.body!).records as Array<{ fields: Record<string, unknown> }>).map((r) => r.fields);
      batchCreated.push(...records);
      return jsonResp({ code: 0, data: { records: records.map(() => ({ record_id: `rec-${++seq}` })) } });
    }
    const mt = url.match(/\/bitable\/v1\/apps\/[^/]+\/tables$/);
    if (mt && method === "POST") {
      const table = JSON.parse(init!.body!).table;
      createdTables.push(table);
      return jsonResp({ code: 0, data: { table_id: `tblNew${seq++}` } });
    }
    return jsonResp({ code: 404, msg: `not mocked: ${method} ${url}` });
  }));

  const env = {
    REGISTRY: {
      get: vi.fn(async (key: string, type?: string) => {
        if (key === "feishu:tenant_access_token") return { token: "mock-token", expireAt: Date.now() + 3600e3 };
        const v = kv.get(key);
        return v == null ? null : type === "json" ? JSON.parse(v) : v;
      }),
      put: vi.fn(async (key: string, value: string) => { kv.set(key, value); }),
      delete: vi.fn(async (key: string) => { kv.delete(key); }),
    },
    FEISHU_APP_ID: "mock-app-id",
    FEISHU_APP_SECRET: "mock-app-secret",
  } as unknown as Env;
  return { env, kv, createdTables, batchCreated };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("remove_docs", () => {
  it("按 id 移除，只删索引；空 ids 报错", async () => {
    const ctx = createCtx();
    ctx.kv.set(DOCS_REGISTRY_KEY, JSON.stringify([
      { id: "nec-vi", title: "VI", category: "brand", url: "https://x", visibility: "all", maintainer: "", updatedAt: "", source: "hub" },
      { id: "sop-1", title: "SOP", category: "sop", url: "https://y", visibility: "all", maintainer: "", updatedAt: "", source: "hub" },
    ]));
    const res = await toolRemoveDocs({ ids: ["nec-vi", "ghost"] }, ctx.env);
    expect(res.content[0].text).toContain("已移除 1 条");
    const kept = JSON.parse(ctx.kv.get(DOCS_REGISTRY_KEY)!);
    expect(kept.map((d: { id: string }) => d.id)).toEqual(["sop-1"]);
    await expect(toolRemoveDocs({ ids: [] }, ctx.env)).rejects.toThrow("ids 不能为空");
  });
});

describe("setup_bitable", () => {
  it("仅管理端；base 非法报错；默认建四张标准表并写入看板配置、清缓存", async () => {
    const ctx = createCtx();
    await expect(toolSetupBitable({ base: BASE }, ctx.env, false)).rejects.toThrow("MCP_TOKEN");
    await expect(toolSetupBitable({ base: "短" }, ctx.env, true)).rejects.toThrow("base 不合法");

    ctx.kv.set("dashboard:cache:tasks", "stale");
    const res = await toolSetupBitable({ base: BASE }, ctx.env, true);
    expect(res.content[0].text).toContain("新建 4 张");
    expect(ctx.createdTables.map((t) => t.name)).toEqual(["队员名单", "任务进度", "物资台账", "财务报销"]);
    const cfg = JSON.parse(ctx.kv.get("dashboard:config")!);
    expect(cfg.base).toBe(BASE);
    expect(Object.keys(cfg.tables)).toHaveLength(4);
    expect(ctx.kv.has("dashboard:cache:tasks")).toBe(false);
  });

  it("已存在的表跳过（force=true 强制重建）；tables 子集过滤", async () => {
    const ctx = createCtx();
    ctx.kv.set("dashboard:config", JSON.stringify({ base: BASE, tables: { members: "tblOld" }, updatedAt: "" }));
    const res = await toolSetupBitable({ base: BASE, tables: ["members", "tasks", "unknown"] }, ctx.env, true);
    expect(res.content[0].text).toContain("已存在跳过 1 张");
    expect(ctx.createdTables).toHaveLength(1); // 只建 tasks
    expect(JSON.parse(ctx.kv.get("dashboard:config")!).tables.members).toBe("tblOld");

    await toolSetupBitable({ base: BASE, tables: ["members"], force: true }, ctx.env, true);
    expect(JSON.parse(ctx.kv.get("dashboard:config")!).tables.members).not.toBe("tblOld");
  });
});

describe("add_records", () => {
  it("仅管理端；表未配置报错；字段预检拦非法字段；合法记录批量写入", async () => {
    const ctx = createCtx();
    await expect(toolAddRecords({ table: "members", records: [{ 姓名: "张三" }] }, ctx.env, false)).rejects.toThrow("MCP_TOKEN");
    await expect(toolAddRecords({ table: "members", records: [{ 姓名: "张三" }] }, ctx.env, true)).rejects.toThrow("尚未配置");

    ctx.kv.set("dashboard:config", JSON.stringify({ base: BASE, tables: { members: "tblM" }, updatedAt: "" }));
    await expect(
      toolAddRecords({ table: "members", records: [{ 姓名: "张三", 不存在字段: 1 }] }, ctx.env, true),
    ).rejects.toThrow("字段不存在：不存在字段");
    await expect(toolAddRecords({ table: "bad", records: [{ a: 1 }] }, ctx.env, true)).rejects.toThrow("table 必须是");
    await expect(toolAddRecords({ table: "members", records: [] }, ctx.env, true)).rejects.toThrow("records 不能为空");

    const res = await toolAddRecords({ table: "members", records: [{ 姓名: "张三", 组别: "机械" }, { 姓名: "李四" }] }, ctx.env, true);
    expect(res.content[0].text).toContain("已写入 2 条");
    expect(ctx.batchCreated).toHaveLength(2);
  });
});
