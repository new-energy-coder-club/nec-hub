/**
 * R-01 报销助手 ERP 接口测试（src/erp/reimburse.ts）
 *
 * 覆盖：validateErpDoc 服务端 SOP 校验 · buildApprovalFields 整单→底表字段
 * meta（目录+收款账户）· payee upsert · submit（审批引擎 + D1 快照）· docs/mine 与 docs/<id> 权限
 *
 * mock 风格沿用 approvals.test.ts：内存 KV + fetch 路由（bitable CRUD）；D1 用按 SQL 分支的假实现。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BitableRecord } from "../feishu/bitable";
import { buildApprovalFields, handleErpReimburse, validateErpDoc } from "../erp/reimburse";

const BASE = "appMockBase";
const TBL_REIMBURSE = "tblReimburse";

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

/** 按 SQL 文本分支的最小 D1 假实现 */
function fakeD1() {
  const expenseItems = [
    { code: "F38.01", grp: "研发费用支出", name: "材料费" },
    { code: "F41.02", grp: "运营办公", name: "快递运费" },
  ];
  const payees = new Map<string, Record<string, unknown>>();
  const docs = new Map<string, Record<string, unknown>>();
  const runSql = (sql: string, args: unknown[]) => ({
    run: vi.fn(async () => {
      if (sql.includes("INSERT INTO payees")) {
        payees.set(String(args[0]), { method: args[1], account_name: args[2], account_no: args[3], bank: args[4] });
      } else if (sql.includes("INSERT INTO reimburse_docs")) {
        docs.set(String(args[0]), {
          application_id: args[0], open_id: args[1], applicant: args[2],
          payload_json: args[3], status: args[4], created_at: args[5],
        });
      }
      return { success: true };
    }),
    first: vi.fn(async () => {
      if (sql.includes("FROM payees")) return payees.get(String(args[0])) ?? null;
      if (sql.includes("FROM reimburse_docs")) return docs.get(String(args[0])) ?? null;
      return null;
    }),
    all: vi.fn(async () => {
      if (sql.includes("FROM expense_items")) return { results: expenseItems };
      if (sql.includes("FROM reimburse_docs") && sql.includes("WHERE open_id")) {
        const rows = [...docs.values()].filter((d) => d.open_id === args[0]);
        rows.sort((a, b) => Number(b.created_at) - Number(a.created_at));
        return { results: rows };
      }
      return { results: [] };
    }),
  });
  const prepare = (sql: string) => {
    const direct = runSql(sql, []);
    return {
      ...direct,
      bind: (...args: unknown[]) => runSql(sql, args),
    };
  };
  return { prepare, payees, docs, expenseItems };
}

function createCtx() {
  const kv = new Map<string, string>();
  const tables: Record<string, BitableRecord[]> = {};
  const d1 = fakeD1();
  let seq = 0;

  kv.set("flows:config", JSON.stringify({ reimburse: { tableId: TBL_REIMBURSE, base: BASE } }));
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
    if (method === "GET") return jsonResp({ code: 0, data: { items, has_more: false } });
    if (method === "POST" && !recordId) {
      const rec: BitableRecord = { record_id: `rec-${++seq}`, fields: JSON.parse(init!.body!).fields };
      items.push(rec);
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
    ERP_DB: d1,
    FEISHU_APP_ID: "mock-app-id",
    FEISHU_APP_SECRET: "mock-app-secret",
  } as unknown as Env;

  // 队员名单：张三=队员/机械组，张队=队长
  tables["tblM"] = [
    { record_id: "m1", fields: { 姓名: "张三", 飞书ID: "ou-member", 权限角色: "队员", 组别: "机械组" } },
    { record_id: "m2", fields: { 姓名: "张队", 飞书ID: "ou-captain", 权限角色: "队长", 组别: "管理组" } },
  ];
  return { env, kv, tables, d1 };
}

function req(pathname: string, sid: string, method = "GET", body?: unknown): Request {
  return new Request("https://hub.test" + pathname, {
    method,
    headers: { cookie: `nec_session=${sid}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const GOOD_LINE = { cat: "研发费用支出.材料费", item: "铝型材打样运费", date: "", invno: "12345678", amount: "120", note: "" };

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("validateErpDoc（服务端 SOP 校验）", () => {
  it("空明细 / 缺字段 / 发票号格式 / 无票无附件无说明 均报错", () => {
    expect(validateErpDoc([], "", 0)).toContain("至少填写一行明细");
    const errs = validateErpDoc([{ ...GOOD_LINE, cat: "", invno: "123" }], "", 0);
    expect(errs.some((e) => e.includes("费用项目"))).toBe(true);
    expect(errs.some((e) => e.includes("8 或 20 位"))).toBe(true);
    // 与引擎 conditional 对齐：无发票照片附件时必须填无票说明（只填发票号不算有票）
    expect(errs.some((e) => e.includes("无票说明"))).toBe(true);
    const noInv = validateErpDoc([{ ...GOOD_LINE, invno: "" }], "", 1);
    expect(noInv).toEqual([]); // 有附件即可
    const ok = validateErpDoc([{ ...GOOD_LINE, invno: "" }], "小额收据无票", 0);
    expect(ok).toEqual([]); // 无附件但有无票说明
  });

  it("开票日期须在本赛季内且不晚于今天", () => {
    const today = new Date().toLocaleDateString("sv-SE");
    expect(validateErpDoc([{ ...GOOD_LINE, date: today }], "", 1)).toEqual([]);
    expect(validateErpDoc([{ ...GOOD_LINE, date: "2020-01-01" }], "", 1).some((e) => e.includes("本赛季"))).toBe(true);
    expect(validateErpDoc([{ ...GOOD_LINE, date: "2099-12-31" }], "", 1).some((e) => e.includes("本赛季"))).toBe(true);
  });
});

describe("buildApprovalFields（整单 → 底表字段）", () => {
  it("金额=合计、发票号去重合并、事项带明细、附件 keys 进发票照片", () => {
    const fields = buildApprovalFields(
      [GOOD_LINE, { ...GOOD_LINE, item: "快递费", amount: "25.5", invno: "87654321" }, { ...GOOD_LINE, item: "重复票", amount: "10" }],
      "关联底盘任务",
      "",
      ["receipts/20261014/uuid-发票.jpg"],
    );
    expect(fields["报销金额"]).toBe(155.5);
    expect(fields["发票号"]).toBe("12345678、87654321");
    expect(String(fields["事项"])).toContain("铝型材打样运费（研发费用支出.材料费 ¥120.00");
    expect(String(fields["事项"])).toContain("备注：关联底盘任务");
    expect(fields["发票照片"]).toBe("receipts/20261014/uuid-发票.jpg");
    expect(fields["来源"]).toBe("报销助手");
  });
});

describe("GET /api/erp/reimburse/meta 与 PUT payee", () => {
  it("未登录 401；登录后返回目录；payee upsert 后 meta 带出", async () => {
    const ctx = createCtx();
    const noAuth = await handleErpReimburse(req("/api/erp/reimburse/meta", "nope"), ctx.env, "/api/erp/reimburse/meta");
    expect(noAuth!.status).toBe(401);

    const meta1 = await (await handleErpReimburse(req("/api/erp/reimburse/meta", "sid-member"), ctx.env, "/api/erp/reimburse/meta"))!.json() as { items: unknown[]; payee: unknown };
    expect(meta1.items).toHaveLength(2);
    expect(meta1.payee).toBeNull();

    const put = await handleErpReimburse(
      req("/api/erp/reimburse/payee", "sid-member", "PUT", { method: "电汇", account_name: "张三", account_no: "110927942210401", bank: "招商银行北京清河支行" }),
      ctx.env, "/api/erp/reimburse/payee",
    );
    expect(put!.status).toBe(200);
    const meta2 = await (await handleErpReimburse(req("/api/erp/reimburse/meta", "sid-member"), ctx.env, "/api/erp/reimburse/meta"))!.json() as { payee: { account_no: string } };
    expect(meta2.payee.account_no).toBe("110927942210401");
  });

  it("收款账号含非法字符 → 400", async () => {
    const ctx = createCtx();
    const res = await handleErpReimburse(
      req("/api/erp/reimburse/payee", "sid-member", "PUT", { method: "电汇", account_name: "张三", account_no: "abc;DROP", bank: "" }),
      ctx.env, "/api/erp/reimburse/payee",
    );
    expect(res!.status).toBe(400);
  });
});

describe("POST /api/erp/reimburse/submit（整单提交）", () => {
  const goodBody = {
    lines: [GOOD_LINE],
    note: "",
    noinv: "",
    payee: { method: "电汇", account_name: "张三", account_no: "110927942210401", bank: "招行" },
    attachments: ["receipts/20261014/uuid-发票.jpg"],
  };

  it("SOP 未过 → 400 detail；合法提交 → 引擎单号 + D1 快照 + 底表记录", async () => {
    const ctx = createCtx();
    const bad = await handleErpReimburse(
      req("/api/erp/reimburse/submit", "sid-member", "POST", { ...goodBody, lines: [{ ...GOOD_LINE, amount: "-1" }] }),
      ctx.env, "/api/erp/reimburse/submit",
    );
    expect(bad!.status).toBe(400);
    expect(((await bad!.json()) as { detail: string[] }).detail[0]).toContain("金额");

    const res = await handleErpReimburse(req("/api/erp/reimburse/submit", "sid-member", "POST", goodBody), ctx.env, "/api/erp/reimburse/submit");
    expect(res!.status).toBe(200);
    const data = (await res!.json()) as { application_id: string; status: string };
    expect(data.application_id).toMatch(/^BX-\d{4}-0001$/);
    expect(data.status).toBe("审批中");
    // D1 快照
    expect(ctx.d1.docs.has(data.application_id)).toBe(true);
    const snap = JSON.parse(String(ctx.d1.docs.get(data.application_id)!.payload_json));
    expect(snap.payee.account_no).toBe("110927942210401");
    expect(snap.attachments).toEqual(["receipts/20261014/uuid-发票.jpg"]);
    // 底表
    const row = ctx.tables[TBL_REIMBURSE][0];
    expect(row.fields["报销金额"]).toBe(120);
    expect(row.fields["发票照片"]).toBe("receipts/20261014/uuid-发票.jpg");
    expect(row.fields["来源"]).toBe("报销助手");
  });

  it("非法附件 key（非 receipts/ 前缀）被丢弃", async () => {
    const ctx = createCtx();
    const res = await handleErpReimburse(
      req("/api/erp/reimburse/submit", "sid-member", "POST", { ...goodBody, attachments: ["../../etc/passwd", "receipts/20261014/ok.jpg"] }),
      ctx.env, "/api/erp/reimburse/submit",
    );
    expect(res!.status).toBe(200);
    const row = ctx.tables[TBL_REIMBURSE][0];
    expect(row.fields["发票照片"]).toBe("receipts/20261014/ok.jpg");
  });
});

describe("GET docs/mine 与 docs/<id>", () => {
  async function submitOne(ctx: ReturnType<typeof createCtx>, sid: string, item: string) {
    const res = await handleErpReimburse(
      req("/api/erp/reimburse/submit", sid, "POST", {
        lines: [{ ...GOOD_LINE, item }], note: "", noinv: "",
        payee: { method: "", account_name: "", account_no: "", bank: "" }, attachments: ["receipts/20261014/ok.jpg"],
      }),
      ctx.env, "/api/erp/reimburse/submit",
    );
    if (res!.status !== 200) throw new Error("submit failed: " + res!.status + " " + (await res!.text()));
    return ((await res!.json()) as { application_id: string }).application_id;
  }

  it("mine 只返回本人单据（含明细摘要）；详情本人/队长可看，其他队员 403", async () => {
    const ctx = createCtx();
    const id1 = await submitOne(ctx, "sid-member", "我的第一单");
    await submitOne(ctx, "sid-captain", "队长的单");

    const mine = await (await handleErpReimburse(req("/api/erp/reimburse/docs/mine", "sid-member"), ctx.env, "/api/erp/reimburse/docs/mine"))!.json() as { docs: Array<{ application_id: string; lines: number; total: number; firstItem: string }> };
    expect(mine.docs).toHaveLength(1);
    expect(mine.docs[0].application_id).toBe(id1);
    expect(mine.docs[0].firstItem).toBe("我的第一单");
    expect(mine.docs[0].total).toBe(120);

    // 本人详情
    const own = await handleErpReimburse(req(`/api/erp/reimburse/docs/${id1}`, "sid-member"), ctx.env, `/api/erp/reimburse/docs/${id1}`);
    expect(own!.status).toBe(200);
    // 队长可看他人详情
    const cap = await handleErpReimburse(req(`/api/erp/reimburse/docs/${id1}`, "sid-captain"), ctx.env, `/api/erp/reimburse/docs/${id1}`);
    expect(cap!.status).toBe(200);
    // 其他队员 403（再注册一名队员）
    ctx.kv.set("session:sid-other", JSON.stringify({ name: "李四", open_id: "ou-other", createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3 }));
    ctx.tables["tblM"].push({ record_id: "m3", fields: { 姓名: "李四", 飞书ID: "ou-other", 权限角色: "队员", 组别: "电控组" } });
    const denied = await handleErpReimburse(req(`/api/erp/reimburse/docs/${id1}`, "sid-other"), ctx.env, `/api/erp/reimburse/docs/${id1}`);
    expect(denied!.status).toBe(403);
    // 不存在 404
    const missing = await handleErpReimburse(req("/api/erp/reimburse/docs/BX-2026-9999", "sid-member"), ctx.env, "/api/erp/reimburse/docs/BX-2026-9999");
    expect(missing!.status).toBe(404);
  });
});
