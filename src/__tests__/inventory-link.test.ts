/**
 * G-01 台账联动 + update_inventory 工具测试（PRD V1.2 §3）
 *
 * 覆盖验收标准：arrive 新购入库（新建行/幂等）· issue 领用出库（领用人=申请人）
 * 负库存放行+群告警 · 未配置台账降级 · update_inventory 三种 action · 联动失败不阻断
 *
 * mock 风格沿用 approvals.test.ts：内存 KV + fetch 路由（bitable records CRUD + 群机器人 webhook）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BitableRecord } from "../feishu/bitable";
import { runApprovalAction } from "../approvals/engine";
import { toolUpdateInventory } from "../mcp/tools/bitable-inventory";
import { KV_KEYS } from "../shared/kv-keys";
import { mockGetRecordResponse, mockSearchResponse } from "./bitable-search-mock";

const BASE = "appMockBase";
const TBL_HW = "tblHw";
const TBL_INV = "tblInv";

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

interface Ctx {
  env: Env;
  kv: Map<string, string>;
  tables: Record<string, BitableRecord[]>;
  webhookCalls: Array<{ url: string; body: Record<string, unknown> }>;
  seed(tableId: string, fields: Record<string, unknown>, recordId?: string): BitableRecord;
}

function createCtx(opts: { withWebhook?: boolean; inventoryTableId?: string } = {}): Ctx {
  const kv = new Map<string, string>();
  const tables: Record<string, BitableRecord[]> = {};
  const webhookCalls: Ctx["webhookCalls"] = [];
  let seq = 0;

  kv.set(KV_KEYS.flowsConfig, JSON.stringify({ hardware: { tableId: TBL_HW, base: BASE } }));
  const dashTables: Record<string, string> = { members: "tblM" };
  // inventoryTableId 缺省 = tblInv；传 "" 表示不配置台账（降级路径）
  const invId = opts.inventoryTableId === undefined ? TBL_INV : opts.inventoryTableId;
  if (invId) dashTables.inventory = invId;
  kv.set(KV_KEYS.dashboardConfig, JSON.stringify({ base: BASE, tables: dashTables, updatedAt: new Date().toISOString() }));

  const ctx: Ctx = {
    kv,
    tables,
    webhookCalls,
    env: undefined as unknown as Env,
    seed(tableId, fields, recordId) {
      const rec: BitableRecord = { record_id: recordId ?? `rec-${++seq}`, fields };
      (tables[tableId] ??= []).push(rec);
      return rec;
    },
  };

  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.includes("/bot/v2/hook/")) {
      webhookCalls.push({ url, body: JSON.parse(init?.body ?? "{}") });
      return jsonResp({ code: 0, msg: "ok" });
    }
    const m = url.match(/\/bitable\/v1\/apps\/([^/]+)\/tables\/([^/?]+)\/records(?:\/([^/?]+))?/);
    if (!m) return jsonResp({ code: 404, msg: `not mocked: ${url}` });
    const [, , tableId, recordId] = m;
    if (tableId === "tblBroken") return jsonResp({ code: 1254040, msg: "table not found" });
    const method = (init?.method ?? "GET").toUpperCase();
    const items = (tables[tableId] ??= []);
    if (method === "POST" && recordId === "search") return mockSearchResponse(items, init?.body ?? "{}");
    if (method === "GET" && recordId) return mockGetRecordResponse(items, recordId);
    if (method === "GET") return jsonResp({ code: 0, data: { items, has_more: false } });
    if (method === "POST" && !recordId) {
      const fields = JSON.parse(init!.body!).fields;
      return jsonResp({ code: 0, data: { record: ctx.seed(tableId, fields) } });
    }
    if (method === "PUT" && recordId) {
      const rec = items.find((r) => r.record_id === recordId);
      if (!rec) return jsonResp({ code: 1254045, msg: "record not found" });
      Object.assign(rec.fields, JSON.parse(init!.body!).fields);
      return jsonResp({ code: 0, data: { record: rec } });
    }
    return jsonResp({ code: 400, msg: `unsupported ${method} ${url}` });
  }));

  ctx.env = {
    REGISTRY: {
      get: vi.fn(async (key: string, type?: string) => {
        if (key === KV_KEYS.feishuTenantAccessToken) return { token: "mock-token", expireAt: Date.now() + 3600e3 };
        const v = kv.get(key);
        return v == null ? null : type === "json" ? JSON.parse(v) : v;
      }),
      put: vi.fn(async (key: string, value: string) => { kv.set(key, value); }),
      delete: vi.fn(async (key: string) => { kv.delete(key); }),
    },
    FEISHU_APP_ID: "mock-app-id",
    FEISHU_APP_SECRET: "mock-app-secret",
    ...(opts.withWebhook ? { FEISHU_BOT_WEBHOOK: "https://open.feishu.cn/open-apis/bot/v2/hook/abc" } : {}),
  } as unknown as Env;
  return ctx;
}

const CAPTAIN = { name: "张队", open_id: "ou-captain" };
const CAPTAIN_ROLE = { role: "队长", group: "管理组", matched: true };

function seedHw(ctx: Ctx, fields: Record<string, unknown>): BitableRecord {
  return ctx.seed(TBL_HW, {
    申请单号: "HW-2026-0001",
    状态: "已通过",
    申请人: "张三",
    "申请人 open_id": "ou-member",
    申请类型: "新购",
    物料名称: "电机",
    规格型号: "AK10",
    数量: 2,
    ...fields,
  });
}

const act = (ctx: Ctx, action: "arrive" | "issue", appId = "HW-2026-0001") =>
  runApprovalAction(ctx.env, { type: "hardware", appId, action, user: CAPTAIN, role: CAPTAIN_ROLE });

const notifyTexts = (ctx: Ctx) =>
  ctx.webhookCalls.map((c) => String((c.body.content as { text: string }).text));

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("arrive 新购 → 入库联动", () => {
  it("台账无该物料时自动建行：物料=电机（AK10）/ 数量=2 / 位置=未登记，底表留痕「已入库」", async () => {
    const ctx = createCtx();
    const rec = seedHw(ctx, {});
    const res = await act(ctx, "arrive");
    expect(res.status).toBe("已到货");

    const inv = ctx.tables[TBL_INV];
    expect(inv).toHaveLength(1);
    expect(inv[0].fields["物料"]).toBe("电机（AK10）");
    expect(inv[0].fields["数量"]).toBe(2);
    expect(inv[0].fields["位置"]).toBe("未登记");
    expect(inv[0].fields["领用人"]).toBe("");
    expect(String(rec.fields["台账联动"])).toMatch(/^已入库 \d{4}-\d{2}-\d{2}$/);
    expect(ctx.kv.has(KV_KEYS.approvalInventoryMark("HW-2026-0001", "arrive"))).toBe(true);
  });

  it("台账已有匹配行则数量 += 申请数量；重复 arrive 幂等不重复加", async () => {
    const ctx = createCtx();
    ctx.seed(TBL_INV, { 物料: "电机（AK10）", 数量: 3, 位置: "A 柜", 领用人: "" });
    seedHw(ctx, {});
    await act(ctx, "arrive");
    expect(ctx.tables[TBL_INV][0].fields["数量"]).toBe(5);

    // 状态机幂等：当前=已到货直接返回，不再次联动
    const again = await act(ctx, "arrive");
    expect(again.status).toBe("已到货");
    expect(ctx.tables[TBL_INV][0].fields["数量"]).toBe(5);
    expect(ctx.tables[TBL_INV]).toHaveLength(1);
  });

  it("规格型号为空时匹配键为纯物料名称", async () => {
    const ctx = createCtx();
    ctx.seed(TBL_INV, { 物料: "螺丝", 数量: 10, 位置: "B 柜" });
    seedHw(ctx, { 物料名称: "螺丝", 规格型号: "", 数量: 5 });
    await act(ctx, "arrive");
    expect(ctx.tables[TBL_INV][0].fields["数量"]).toBe(15);
    expect(ctx.tables[TBL_INV]).toHaveLength(1);
  });

  it("匹配键归一化：全/半角括号、空格、大小写差异仍可命中既有行", async () => {
    // 台账侧手工登记为半角括号
    const ctx = createCtx();
    ctx.seed(TBL_INV, { 物料: "电机(AK10)", 数量: 3, 位置: "A 柜" });
    seedHw(ctx, {});
    await act(ctx, "arrive");
    expect(ctx.tables[TBL_INV][0].fields["数量"]).toBe(5);
    expect(ctx.tables[TBL_INV]).toHaveLength(1);
  });

  it("匹配键归一化：全角字符 + 内部空格 + 小写 仍命中规范行", async () => {
    const ctx = createCtx();
    ctx.seed(TBL_INV, { 物料: "电机（AK10）", 数量: 3, 位置: "A 柜" });
    seedHw(ctx, { 规格型号: " ａｋ 1０ " });
    await act(ctx, "arrive");
    expect(ctx.tables[TBL_INV][0].fields["数量"]).toBe(5);
    expect(ctx.tables[TBL_INV]).toHaveLength(1);
  });
});

describe("issue 领用 → 出库联动", () => {
  it("数量 −n 且领用人=申请人；留痕「已出库」", async () => {
    const ctx = createCtx();
    ctx.seed(TBL_INV, { 物料: "电机（AK10）", 数量: 5, 位置: "A 柜", 领用人: "" });
    const rec = seedHw(ctx, { 申请类型: "领用", 数量: 2 });
    const res = await act(ctx, "issue");
    expect(res.status).toBe("已领用");
    expect(ctx.tables[TBL_INV][0].fields["数量"]).toBe(3);
    expect(ctx.tables[TBL_INV][0].fields["领用人"]).toBe("张三");
    expect(String(rec.fields["台账联动"])).toMatch(/^已出库 \d{4}-\d{2}-\d{2}$/);
  });

  it("负库存放行：状态照常已领用 + 台账为负 + 群收 ⚠️ 库存告警", async () => {
    const ctx = createCtx({ withWebhook: true });
    ctx.seed(TBL_INV, { 物料: "电机（AK10）", 数量: 1, 位置: "A 柜" });
    const rec = seedHw(ctx, { 申请类型: "领用", 数量: 3 });
    const res = await act(ctx, "issue");
    expect(res.status).toBe("已领用");
    expect(ctx.tables[TBL_INV][0].fields["数量"]).toBe(-2);
    expect(String(rec.fields["台账联动"])).toContain("已出库");
    const texts = notifyTexts(ctx);
    expect(texts.some((t) => t.includes("⚠️ 库存告警 HW-2026-0001") && t.includes("库存 -2"))).toBe(true);
  });

  it("台账无该物料时出库建负库存行，领用人=申请人", async () => {
    const ctx = createCtx({ withWebhook: true });
    seedHw(ctx, { 申请类型: "领用", 数量: 2 });
    await act(ctx, "issue");
    const inv = ctx.tables[TBL_INV];
    expect(inv).toHaveLength(1);
    expect(inv[0].fields["数量"]).toBe(-2);
    expect(inv[0].fields["领用人"]).toBe("张三");
    expect(notifyTexts(ctx).some((t) => t.includes("库存告警"))).toBe(true);
  });
});

describe("降级与不联动", () => {
  it("未配置 inventory 表：动作正常完成，「台账联动」= 未配置台账", async () => {
    const ctx = createCtx({ inventoryTableId: "" });
    const rec = seedHw(ctx, {});
    const res = await act(ctx, "arrive");
    expect(res.status).toBe("已到货");
    expect(rec.fields["台账联动"]).toBe("未配置台账");
    expect(ctx.tables[TBL_INV]).toBeUndefined();
  });

  it("动作×申请类型组合不匹配（arrive+领用）：不联动但留痕「未联动」，不发告警", async () => {
    const ctx = createCtx({ withWebhook: true });
    const rec = seedHw(ctx, { 申请类型: "领用" });
    const res = await act(ctx, "arrive");
    expect(res.status).toBe("已到货");
    expect(String(rec.fields["台账联动"])).toBe("未联动：申请类型「领用」≠ 新购");
    expect(ctx.tables[TBL_INV]).toBeUndefined();
    expect(notifyTexts(ctx).some((t) => t.includes("库存告警") || t.includes("台账联动失败"))).toBe(false);
  });

  it("申请类型缺失或非新购/领用：不联动，留痕「未联动：申请类型「空」…」", async () => {
    const ctx = createCtx();
    const rec = seedHw(ctx, { 申请类型: "" });
    const res = await act(ctx, "arrive");
    expect(res.status).toBe("已到货");
    expect(String(rec.fields["台账联动"])).toBe("未联动：申请类型「空」≠ 新购");
    expect(ctx.tables[TBL_INV]).toBeUndefined();

    const rec2 = seedHw(ctx, { 申请单号: "HW-2026-0002", 申请类型: "借用" });
    await act(ctx, "arrive", "HW-2026-0002");
    expect(String(rec2.fields["台账联动"])).toBe("未联动：申请类型「借用」≠ 新购");
  });

  it("台账读取失败不阻断动作：状态照常更新 + 留痕失败原因 + ⚠️ 群告警", async () => {
    const ctx = createCtx({ withWebhook: true, inventoryTableId: "tblBroken" });
    const rec = seedHw(ctx, {});
    const res = await act(ctx, "arrive");
    expect(res.status).toBe("已到货");
    expect(String(rec.fields["台账联动"])).toContain("失败：");
    expect(notifyTexts(ctx).some((t) => t.includes("⚠️ 台账联动失败 HW-2026-0001") && t.includes("update_inventory 手工补录"))).toBe(true);
    // 失败不写幂等标记（允许人工补录后状态自洽）
    expect(ctx.kv.has(KV_KEYS.approvalInventoryMark("HW-2026-0001", "arrive"))).toBe(false);
  });
});

describe("update_inventory（MCP 手工调账）", () => {
  it("非管理端拒绝；action 非法 / item_name 空 / operator 空 报参数错", async () => {
    const ctx = createCtx();
    await expect(toolUpdateInventory({ action: "inbound", item_name: "电机", quantity: 1, operator: "张队" }, ctx.env, false)).rejects.toThrow("MCP_TOKEN");
    await expect(toolUpdateInventory({ action: "x", item_name: "电机", quantity: 1, operator: "张队" }, ctx.env, true)).rejects.toThrow("inbound | outbound | adjust");
    await expect(toolUpdateInventory({ action: "inbound", item_name: "", quantity: 1, operator: "张队" }, ctx.env, true)).rejects.toThrow("item_name");
    await expect(toolUpdateInventory({ action: "inbound", item_name: "电机", quantity: 1, operator: "" }, ctx.env, true)).rejects.toThrow("operator");
  });

  it("inbound 新建行并带 location；outbound 写领用人；adjust 可把数量设为 0", async () => {
    const ctx = createCtx({ withWebhook: true });
    const inRes = await toolUpdateInventory(
      { action: "inbound", item_name: "联轴器", spec: "LK-20", quantity: 4, operator: "张队", location: "C 柜", note: "盘点补录", approval_id: "HW-2026-0003" },
      ctx.env,
      true,
    );
    expect(inRes.content[0].text).toContain("✅ 台账入库完成：联轴器（LK-20） 0 → 4（新建行");
    expect(ctx.tables[TBL_INV][0].fields["位置"]).toBe("C 柜");
    const notice = notifyTexts(ctx).find((t) => t.includes("台账入库"));
    expect(notice).toContain("关联单号：HW-2026-0003");
    expect(notice).toContain("备注：盘点补录");

    const outRes = await toolUpdateInventory({ action: "outbound", item_name: "联轴器", spec: "LK-20", quantity: 1, operator: "张三" }, ctx.env, true);
    expect(outRes.content[0].text).toContain("4 → 3（更新");
    expect(ctx.tables[TBL_INV][0].fields["领用人"]).toBe("张三");

    const adjRes = await toolUpdateInventory({ action: "adjust", item_name: "联轴器", spec: "LK-20", quantity: 0, operator: "张队" }, ctx.env, true);
    expect(adjRes.content[0].text).toContain("3 → 0");
    expect(ctx.tables[TBL_INV][0].fields["数量"]).toBe(0);
  });

  it("outbound 负库存：返回 ⚠️ 提示且不报错；adjust 负数被拒", async () => {
    const ctx = createCtx({ withWebhook: true });
    ctx.seed(TBL_INV, { 物料: "轴承", 数量: 1, 位置: "A 柜" });
    const res = await toolUpdateInventory({ action: "outbound", item_name: "轴承", quantity: 3, operator: "张三" }, ctx.env, true);
    expect(res.content[0].text).toContain("1 → -2");
    expect(res.content[0].text).toContain("⚠️ 库存为负");
    expect(ctx.tables[TBL_INV][0].fields["数量"]).toBe(-2);
    await expect(toolUpdateInventory({ action: "adjust", item_name: "轴承", quantity: -1, operator: "张队" }, ctx.env, true)).rejects.toThrow("≥0");
  });

  it("未配置台账 → ⚠️ 引导文案", async () => {
    const ctx = createCtx({ inventoryTableId: "" });
    const res = await toolUpdateInventory({ action: "inbound", item_name: "电机", quantity: 1, operator: "张队" }, ctx.env, true);
    expect(res.content[0].text).toContain("未配置物资台账");
  });
});
