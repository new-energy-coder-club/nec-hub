/**
 * 硬件评审群通知（迁移后：通知由审批引擎承担）
 *
 * 覆盖：submit 走引擎后发「新硬件评审」通知并分流到 FEISHU_BOT_WEBHOOK_HARDWARE_REVIEW；
 * 状态流转（assessing --pass--> approved）后回退主群 webhook 推送状态更新。
 * mock 风格：内存 KV + fetch 路由（bitable records CRUD + 群机器人 webhook）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BitableRecord } from "../feishu/bitable";
import { runApprovalAction, submitApprovalCore } from "../approvals/engine";
import { KV_KEYS } from "../shared/kv-keys";
import { mockGetRecordResponse, mockSearchResponse } from "./bitable-search-mock";

const BASE = "appHwBase";
const TBL = "tblHwRev";

interface Ctx {
  env: Env;
  tables: Record<string, BitableRecord[]>;
  webhookCalls: Array<{ url: string; body: { content: { text: string }; sign?: string } }>;
  seed(tableId: string, fields: Record<string, unknown>, recordId?: string): BitableRecord;
}

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function createCtx(webhookEnvs: Record<string, string>): Ctx {
  const kv = new Map<string, string>();
  const tables: Record<string, BitableRecord[]> = {};
  const webhookCalls: Ctx["webhookCalls"] = [];
  let seq = 0;

  kv.set(KV_KEYS.flowsConfig, JSON.stringify({ hardware_review: { tableId: TBL, base: BASE } }));

  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.includes("/bot/v2/hook/") || url.includes("example/hook")) {
      webhookCalls.push({ url, body: JSON.parse(init?.body ?? "{}") });
      return jsonResp({ code: 0, msg: "ok" });
    }
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
        if (key === KV_KEYS.feishuTenantAccessToken) return { token: "mock-token", expireAt: Date.now() + 3600e3 };
        const v = kv.get(key);
        return v == null ? null : type === "json" ? JSON.parse(v) : v;
      }),
      put: vi.fn(async (key: string, value: string) => { kv.set(key, value); }),
      delete: vi.fn(async (key: string) => { kv.delete(key); }),
    },
    FEISHU_APP_ID: "mock-app-id",
    FEISHU_APP_SECRET: "mock-app-secret",
    ...webhookEnvs,
  } as unknown as Env;

  return {
    env,
    tables,
    webhookCalls,
    seed(tableId, fields, recordId) {
      const rec: BitableRecord = { record_id: recordId ?? `rec-${++seq}`, fields };
      (tables[tableId] ??= []).push(rec);
      return rec;
    },
  };
}

const DESIGNER = { name: "王工", open_id: "ou-designer" };
const MEMBER_ROLE = { role: "队员", group: "", matched: false };

describe("硬件评审群通知（引擎承担）", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("submit 走引擎拿 HR 年计数单号，并推送到 hardware_review 专属 webhook", async () => {
    const ctx = createCtx({
      FEISHU_BOT_WEBHOOK_HARDWARE_REVIEW: "https://hardware.example/hook",
      FEISHU_BOT_WEBHOOK_HARDWARE_REVIEW_SECRET: "hardware-secret",
    });

    const res = await submitApprovalCore(ctx.env, {
      type: "hardware_review",
      fields: {
        评审单号: "@appId",
        项目编号: "PRJ-HW",
        硬件名称: "主控板",
        硬件资料: JSON.stringify([{ name: "sch.pdf", token: "r2/sch.pdf" }]),
      },
      user: DESIGNER,
      role: MEMBER_ROLE,
      source: "portal",
    });

    expect(res.application_id).toMatch(/^HR-\d{4}-0001$/);
    expect(res.status).toBe("pending_review");
    expect(ctx.tables[TBL][0].fields["评审单号"]).toBe(res.application_id);
    expect(ctx.webhookCalls).toHaveLength(1);
    expect(ctx.webhookCalls[0].url).toBe("https://hardware.example/hook");
    expect(ctx.webhookCalls[0].body.content.text).toContain(`新硬件评审 ${res.application_id}`);
    expect(ctx.webhookCalls[0].body.content.text).toContain("王工");
    expect(ctx.webhookCalls[0].body.sign).toEqual(expect.any(String));
  });

  it("状态流转后回退主群 webhook 推送状态更新", async () => {
    const ctx = createCtx({
      FEISHU_BOT_WEBHOOK: "https://main.example/hook",
      FEISHU_BOT_WEBHOOK_SECRET: "main-secret",
    });
    ctx.seed(TBL, {
      申请单号: "HR-2026-0001",
      评审单号: "HR-2026-0001",
      状态: "assessing",
      硬件名称: "主控板",
    });

    const res = await runApprovalAction(ctx.env, {
      type: "hardware_review",
      appId: "HR-2026-0001",
      action: "pass",
      user: DESIGNER,
      role: MEMBER_ROLE,
    });

    expect(res.status).toBe("approved");
    expect(ctx.webhookCalls).toHaveLength(1);
    expect(ctx.webhookCalls[0].url).toBe("https://main.example/hook");
    expect(ctx.webhookCalls[0].body.content.text).toContain("HR-2026-0001 状态更新：approved");
    expect(ctx.webhookCalls[0].body.sign).toEqual(expect.any(String));
  });

  it("旧格式单号（仅评审单号字段）也能驱动引擎流转", async () => {
    const ctx = createCtx({ FEISHU_BOT_WEBHOOK: "https://main.example/hook" });
    // 新格式记录让「申请单号」字段在表中存在（search 下推有效），旧记录只有「评审单号」
    ctx.seed(TBL, { 申请单号: "HR-2026-0001", 评审单号: "HR-2026-0001", 状态: "archived" });
    const legacy = ctx.seed(TBL, { 评审单号: "HR-20261024-001", 状态: "approved" });

    const res = await runApprovalAction(ctx.env, {
      type: "hardware_review",
      appId: "HR-20261024-001",
      action: "archive",
      user: DESIGNER,
      role: MEMBER_ROLE,
    });

    expect(res.status).toBe("archived");
    expect(legacy.fields["状态"]).toBe("archived");
  });
});
