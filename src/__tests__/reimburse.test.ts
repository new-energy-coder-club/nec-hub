/**
 * 报销旧端点兼容壳测试（src/reimburse.ts → 委托 approvals 引擎）
 *
 * 覆盖：POST /api/reimburse（校验/R2 存档/引擎写表/单号 BX 格式/warning 降级）
 * POST /api/reimburse/<单号>/<action>（401/400/403/404/409 形状、approve→pay 全链路、
 * D1 回写钩子随委托生效）· GET /api/reimburse/mine（open_id 过滤 + 降序 + hint）
 *
 * mock 风格沿用 approvals.test.ts：内存 KV + fetch 路由（bitable records CRUD）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BitableRecord } from "../feishu/bitable";
import { handleReimburse, handleReimburseAction, handleReimburseMine } from "../reimburse";
import { mockGetRecordResponse, mockSearchResponse } from "./bitable-search-mock";

const BASE = "appMockBase";
const TBL_REIMBURSE = "tblReimburse";

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function createCtx(opts: { withFlow?: boolean } = {}) {
  const kv = new Map<string, string>();
  const tables: Record<string, BitableRecord[]> = {};
  const bucketPuts: Array<{ key: string }> = [];
  const d1Updates: Array<{ status: unknown; appId: unknown }> = [];
  let seq = 0;

  if (opts.withFlow !== false) {
    kv.set("flows:config", JSON.stringify({ reimburse: { tableId: TBL_REIMBURSE, base: BASE } }));
  }
  kv.set("dashboard:config", JSON.stringify({ base: BASE, tables: { members: "tblM" }, updatedAt: new Date().toISOString() }));
  kv.set("session:sid-member", JSON.stringify({ name: "张三", open_id: "ou-member", createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3 }));
  kv.set("session:sid-captain", JSON.stringify({ name: "张队", open_id: "ou-captain", createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3 }));

  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.includes("/bot/v2/hook/")) return jsonResp({ code: 0, msg: "ok" });
    const m = url.match(/\/bitable\/v1\/apps\/([^/]+)\/tables\/([^/?]+)\/records(?:\/([^/?]+))?/);
    if (!m) return jsonResp({ code: 404, msg: `not mocked: ${url}` });
    const [, , tableId, recordId] = m;
    const method = (init?.method ?? "GET").toUpperCase();
    const items = (tables[tableId] ??= []);
    if (method === "POST" && recordId === "search") return mockSearchResponse(items, init?.body ?? "{}");
    if (method === "GET" && recordId) return mockGetRecordResponse(items, recordId);
    if (method === "GET") return jsonResp({ code: 0, data: { items, has_more: false } });
    if (method === "POST" && !recordId) {
      const rec: BitableRecord = { record_id: `rec-${++seq}`, fields: JSON.parse(init!.body!).fields };
      items.push(rec);
      return jsonResp({ code: 0, data: { record: rec } });
    }
    if (method === "PUT" && recordId) {
      const rec = items.find((r) => r.record_id === recordId);
      if (!rec) return jsonResp({ code: 1254045, msg: "record not found" });
      Object.assign(rec.fields, JSON.parse(init!.body!).fields);
      return jsonResp({ code: 0, data: { record: rec } });
    }
    return jsonResp({ code: 400, msg: `unsupported ${method} ${url}` });
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
    APPS_BUCKET: {
      put: vi.fn(async (key: string) => { bucketPuts.push({ key }); return {}; }),
    },
    ERP_DB: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: async () => {
            if (sql.includes("UPDATE reimburse_docs")) d1Updates.push({ status: args[0], appId: args[1] });
            return { success: true };
          },
        }),
      }),
    },
    FEISHU_APP_ID: "mock-app-id",
    FEISHU_APP_SECRET: "mock-app-secret",
  } as unknown as Env;

  // 队员名单：张三=队员/机械组，张队=队长
  tables["tblM"] = [
    { record_id: "m1", fields: { 姓名: "张三", 飞书ID: "ou-member", 权限角色: "队员", 组别: "机械组" } },
    { record_id: "m2", fields: { 姓名: "张队", 飞书ID: "ou-captain", 权限角色: "队长", 组别: "管理组" } },
  ];
  return { env, kv, tables, bucketPuts, d1Updates };
}

function submitReq(sid: string, fields: Record<string, string>, files: Array<[string, File]> = []): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  for (const [k, f] of files) fd.set(k, f);
  return new Request("https://hub.test/api/reimburse", {
    method: "POST",
    headers: { cookie: `nec_session=${sid}` },
    body: fd,
  });
}

function actionReq(sid: string, body?: unknown): Request {
  return new Request("https://hub.test/api/reimburse/x/approve", {
    method: "POST",
    headers: { cookie: `nec_session=${sid}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function mineReq(sid: string): Request {
  return new Request("https://hub.test/api/reimburse/mine", { headers: { cookie: `nec_session=${sid}` } });
}

const GOOD_FORM = { item: "铝型材打样运费", amount: "120", date: "2026-10-14", note: "关联底盘任务", invno: "12345678" };

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/reimburse（提交，委托引擎）", () => {
  it("未登录 401；缺事项/金额非法/日期非法 均 400（旧文案）", async () => {
    const ctx = createCtx();
    const noAuth = await handleReimburse(submitReq("nope", GOOD_FORM), ctx.env);
    expect(noAuth.status).toBe(401);
    expect(((await noAuth.json()) as { error: string }).error).toBe("请先登录后再提交报销");

    expect(((await (await handleReimburse(submitReq("sid-member", { ...GOOD_FORM, item: "" }), ctx.env)).json()) as { error: string }).error).toBe("请填写报销事项");
    expect(((await (await handleReimburse(submitReq("sid-member", { ...GOOD_FORM, amount: "abc" }), ctx.env)).json()) as { error: string }).error).toBe("请填写有效金额");
    expect(((await (await handleReimburse(submitReq("sid-member", { ...GOOD_FORM, date: "10/14" }), ctx.env)).json()) as { error: string }).error).toBe("请选择报销时间");
  });

  it("合法提交：凭证进 R2 → 引擎写底表（审批中 + BX 单号）→ 响应保持旧形状", async () => {
    const ctx = createCtx();
    const res = await handleReimburse(
      submitReq("sid-member", GOOD_FORM, [
        ["receipt", new File(["r"], "发票.jpg", { type: "image/jpeg" })],
        ["payment", new File(["p"], "付款.png", { type: "image/png" })],
      ]),
      ctx.env,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean; files: Record<string, string>; recordId: string; application_id: string; status: string; warning?: string;
    };
    expect(data.ok).toBe(true);
    expect(data.warning).toBeUndefined();
    expect(data.application_id).toMatch(/^BX-\d{4}-0001$/);
    expect(data.status).toBe("审批中");
    expect(data.recordId).toMatch(/^rec-/);
    expect(data.files.receipt).toMatch(/^receipts\/20261014\/.+-发票\.jpg$/);
    expect(data.files.payment).toMatch(/^receipts\/20261014\/.+-付款\.png$/);
    expect(ctx.bucketPuts).toHaveLength(2);

    // 引擎底表行：状态/单号/申请人由引擎写入；附件 keys 合入发票照片；报销时间折进事项
    const row = ctx.tables[TBL_REIMBURSE][0];
    expect(row.fields["状态"]).toBe("审批中");
    expect(row.fields["申请单号"]).toBe(data.application_id);
    expect(row.fields["申请人"]).toBe("张三");
    expect(row.fields["报销金额"]).toBe(120);
    expect(row.fields["发票号"]).toBe("12345678");
    expect(String(row.fields["发票照片"])).toContain(data.files.receipt);
    expect(String(row.fields["发票照片"])).toContain(data.files.payment);
    expect(String(row.fields["事项"])).toContain("铝型材打样运费");
    expect(String(row.fields["事项"])).toContain("报销时间 2026-10-14");
    expect(String(row.fields["事项"])).toContain("关联底盘任务");
    // KV 映射由引擎写入；看板缓存被清理
    expect(JSON.parse(ctx.kv.get(`approval:map:${data.application_id}`)!).record_id).toBe(data.recordId);
  });

  it("流程未配置 → 200 + warning 降级，凭证仍存档", async () => {
    const ctx = createCtx({ withFlow: false });
    const res = await handleReimburse(submitReq("sid-member", GOOD_FORM), ctx.env);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; warning?: string; application_id?: string };
    expect(data.ok).toBe(true);
    expect(data.warning).toContain("流程未配置");
    expect(data.application_id).toBeUndefined();
    expect(ctx.tables[TBL_REIMBURSE]).toBeUndefined();
  });

  it("引擎字段校验未过（缺发票号且无票说明）→ 200 + warning 降级", async () => {
    const ctx = createCtx();
    const res = await handleReimburse(submitReq("sid-member", { ...GOOD_FORM, invno: "" }), ctx.env);
    const data = (await res.json()) as { warning?: string };
    expect(data.warning).toContain("字段校验未通过");
  });
});

describe("POST /api/reimburse/<单号>/<action>（审批动作，委托引擎）", () => {
  async function submitOne(ctx: ReturnType<typeof createCtx>): Promise<string> {
    const res = await handleReimburse(
      submitReq("sid-member", GOOD_FORM, [["receipt", new File(["r"], "发票.jpg", { type: "image/jpeg" })]]),
      ctx.env,
    );
    return ((await res.json()) as { application_id: string }).application_id;
  }

  it("未登录 401；未知动作 400；队员 403（带 role）", async () => {
    const ctx = createCtx();
    const appId = await submitOne(ctx);
    expect((await handleReimburseAction(actionReq("nope"), ctx.env, undefined as unknown as ExecutionContext, appId, "approve")).status).toBe(401);

    const bad = await handleReimburseAction(actionReq("sid-captain", {}), ctx.env, undefined as unknown as ExecutionContext, appId, "start");
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("未知动作：支持 approve | reject | pay");

    const denied = await handleReimburseAction(actionReq("sid-member", {}), ctx.env, undefined as unknown as ExecutionContext, appId, "approve");
    expect(denied.status).toBe(403);
    const deniedBody = (await denied.json()) as { error: string; role: string };
    expect(deniedBody.error).toBe("权限不足：报销审批仅队长/财务角色可执行");
    expect(deniedBody.role).toBe("队员");
  });

  it("队长 approve → 已通过；幂等重放 200；pay → 已打款；D1 回写钩子随委托生效", async () => {
    const ctx = createCtx();
    const appId = await submitOne(ctx);

    const approve = await handleReimburseAction(actionReq("sid-captain", { comment: "同意" }), ctx.env, undefined as unknown as ExecutionContext, appId, "approve");
    expect(approve.status).toBe(200);
    expect(await approve.json()).toEqual({ application_id: appId, status: "已通过" });
    const row = ctx.tables[TBL_REIMBURSE][0];
    expect(row.fields["状态"]).toBe("已通过");
    expect(row.fields["审批人"]).toBe("张队");
    expect(ctx.d1Updates).toContainEqual({ status: "已通过", appId });

    // 幂等：目标状态=当前状态 → 200 原样返回
    const again = await handleReimburseAction(actionReq("sid-captain", {}), ctx.env, undefined as unknown as ExecutionContext, appId, "approve");
    expect(again.status).toBe(200);
    expect(((await again.json()) as { status: string }).status).toBe("已通过");

    const pay = await handleReimburseAction(actionReq("sid-captain", {}), ctx.env, undefined as unknown as ExecutionContext, appId, "pay");
    expect(pay.status).toBe(200);
    expect(((await pay.json()) as { status: string }).status).toBe("已打款");
    expect(ctx.d1Updates).toContainEqual({ status: "已打款", appId });
  });

  it("reject 无 comment → 400；reject 成功 → 已驳回；驳回后再 approve → 409 旧形状", async () => {
    const ctx = createCtx();
    const appId = await submitOne(ctx);

    const noComment = await handleReimburseAction(actionReq("sid-captain", {}), ctx.env, undefined as unknown as ExecutionContext, appId, "reject");
    expect(noComment.status).toBe(400);
    expect(((await noComment.json()) as { error: string }).error).toBe("驳回必须填写审批意见（comment）");

    const reject = await handleReimburseAction(actionReq("sid-captain", { comment: "票据不全" }), ctx.env, undefined as unknown as ExecutionContext, appId, "reject");
    expect(reject.status).toBe(200);
    expect(((await reject.json()) as { status: string }).status).toBe("已驳回");

    const conflict = await handleReimburseAction(actionReq("sid-captain", {}), ctx.env, undefined as unknown as ExecutionContext, appId, "approve");
    expect(conflict.status).toBe(409);
    const body = (await conflict.json()) as { application_id: string; status: string; error: string };
    expect(body.application_id).toBe(appId);
    expect(body.status).toBe("已驳回");
    expect(body.error).toContain("不能执行 approve");
  });

  it("单号不存在 → 404", async () => {
    const ctx = createCtx();
    await submitOne(ctx);
    const res = await handleReimburseAction(actionReq("sid-captain", {}), ctx.env, undefined as unknown as ExecutionContext, "BX-2026-9999", "approve");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain("BX-2026-9999");
  });
});

describe("GET /api/reimburse/mine（我的报销，读引擎底表）", () => {
  it("未登录 401；流程未配置 → 空列表 + hint", async () => {
    const ctx = createCtx({ withFlow: false });
    expect((await handleReimburseMine(mineReq("nope"), ctx.env)).status).toBe(401);
    const res = await handleReimburseMine(mineReq("sid-member"), ctx.env);
    const data = (await res.json()) as { records: unknown[]; hint: string };
    expect(data.records).toEqual([]);
    expect(data.hint).toBe("未配置财务报销表");
  });

  it("按 open_id 过滤 + 提交时间降序 + 旧 fields 形状", async () => {
    const ctx = createCtx();
    ctx.tables[TBL_REIMBURSE] = [
      { record_id: "r1", fields: { 申请单号: "BX-2026-0001", 状态: "已通过", 事项: "旧单", 报销金额: 50, 提交时间: 1000, 审批人: "张队", 审批意见: "同意", "申请人 open_id": "ou-member" } },
      { record_id: "r2", fields: { 申请单号: "BX-2026-0002", 状态: "审批中", 事项: "新单", 报销金额: 80, 提交时间: 2000, "申请人 open_id": "ou-member" } },
      { record_id: "r3", fields: { 申请单号: "BX-2026-0003", 状态: "审批中", 事项: "别人的", 提交时间: 3000, "申请人 open_id": "ou-other" } },
    ];
    const res = await handleReimburseMine(mineReq("sid-member"), ctx.env);
    const data = (await res.json()) as { records: Array<{ application_id: string; status: string; fields: Record<string, string> }> };
    expect(data.records.map((r) => r.application_id)).toEqual(["BX-2026-0002", "BX-2026-0001"]);
    expect(data.records[1].fields["事项"]).toBe("旧单");
    expect(data.records[1].fields["金额"]).toBe("50");
    expect(data.records[1].fields["审批人"]).toBe("张队");
    expect(data.records[1].fields["审批意见"]).toBe("同意");
    expect(data.records[0].fields["审批人"]).toBe("");
  });
});
