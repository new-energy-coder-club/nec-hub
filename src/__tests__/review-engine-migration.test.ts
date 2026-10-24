/**
 * 评审模块 → 审批引擎迁移（Phase 1 选项 A 兼容迁移）路由级测试
 *
 * 覆盖：薄壳 submit 走引擎拿 DR/HR 年计数单号（评审单号 = 申请单号、flows:config 自动回填
 * 模块 reviews 表）、conclude 触发状态流转 + 整改项创建 + 事件日志、旧端点错误文案兼容、
 * 旧格式单号（仅「评审单号」字段）经引擎第二通道继续流转、硬件归档薄壳。
 * mock 风格：dr-test-utils 内存 Base；硬件侧内联一个最小内存 mock。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BitableRecord } from "../feishu/bitable";
import { handleDrawingReview } from "../drawing-review";
import { handleHardwareReview } from "../hardware-review";
import type { HardwareReviewConfig } from "../hardware-review/types";
import { getFlowsConfig } from "../approvals/flows";
import { KV_KEYS } from "../shared/kv-keys";
import { mockGetRecordResponse, mockSearchResponse } from "./bitable-search-mock";
import { createDrMock, DR_TABLES, type DrMockCtx } from "./dr-test-utils";

// ---------- drawing-review（复用 dr-test-utils） ----------

const DR_SID = "sid-mig-dr";

function drApi(ctx: DrMockCtx, pathname: string, method = "GET", body?: unknown): Promise<Response | null> {
  return handleDrawingReview(
    new Request(`http://localhost${pathname}`, {
      method,
      headers: { "content-type": "application/json", cookie: `nec_session=${DR_SID}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    ctx.env,
    pathname,
  );
}

async function drApiJson(ctx: DrMockCtx, pathname: string, method = "GET", body?: unknown): Promise<{ status: number; data: any }> {
  const res = await drApi(ctx, pathname, method, body);
  expect(res).not.toBeNull();
  return { status: res!.status, data: await res!.json() };
}

describe("drawing-review 薄壳转调引擎", () => {
  let ctx: DrMockCtx;

  beforeEach(() => {
    ctx = createDrMock({ session: { sid: DR_SID, openId: "ou-mig", name: "迁移测试" } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("submit 走引擎：DR 年计数单号、评审单号=申请单号、初始 pending_review、flows:config 自动回填、submit 事件", async () => {
    const res = await drApiJson(ctx, "/api/drawing-review/submit", "POST", {
      projectId: "PRJ-MIG",
      machineName: "迁移机型",
      drawingVersion: "V1.0",
      drawingFiles: [{ name: "a.pdf", token: "tok" }],
    });
    expect(res.status).toBe(200);
    expect(res.data.reviewId).toMatch(/^DR-\d{4}-0001$/);
    expect(res.data.status).toBe("pending_review");

    const row = ctx.tables[DR_TABLES.reviews][0];
    expect(row.fields["评审单号"]).toBe(res.data.reviewId);
    expect(row.fields["申请单号"]).toBe(res.data.reviewId);
    expect(row.fields["状态"]).toBe("pending_review");
    expect(JSON.parse(String(row.fields["图纸文件"]))).toEqual([{ name: "a.pdf", token: "tok" }]);

    // 引擎 flows:config 自动回填到模块 reviews 表（双配置同源）
    const flows = await getFlowsConfig(ctx.env);
    expect(flows.drawing_review.tableId).toBe(DR_TABLES.reviews);
    expect(flows.drawing_review.base).toBe("appMockBase");

    const actions = (ctx.tables[DR_TABLES.events] ?? []).map((r) => r.fields["动作"]);
    expect(actions).toContain("submit");
  });

  it("conclude(conditional) 触发 in_review→rectifying + 整改项创建 + conclude 事件；结论字段回写", async () => {
    ctx.seed(DR_TABLES.reviews, {
      评审单号: "DR-2026-0001", 申请单号: "DR-2026-0001", 状态: "in_review", 机型名称: "X", 项目编号: "P",
    });
    const res = await drApiJson(ctx, "/api/drawing-review/DR-2026-0001/conclusion", "POST", {
      conclusion: "conditional",
      notes: "整改后通过",
      issues: [{ issueId: "ISS-1", description: "补充急停回路", raisedBy: { open_id: "ou-r" }, owner: { open_id: "ou-o" }, dueDate: "2026-11-01", severity: "high", status: "open" }],
    });
    expect(res.status).toBe(200);
    expect(res.data.status).toBe("rectifying");
    expect(res.data.conclusion).toBe("conditional");
    expect(res.data.conclusionNotes).toBe("整改后通过");

    const rects = ctx.tables[DR_TABLES.rectifications] ?? [];
    expect(rects).toHaveLength(1);
    expect(rects[0].fields["关联评审单"]).toBe("DR-2026-0001");
    expect(rects[0].fields["问题描述"]).toBe("补充急停回路");
    expect(rects[0].fields["完成状态"]).toBe("未完成");

    const concludeEvent = (ctx.tables[DR_TABLES.events] ?? []).find((r) => r.fields["动作"] === "conclude");
    expect(concludeEvent?.fields["原状态"]).toBe("in_review");
    expect(concludeEvent?.fields["新状态"]).toBe("rectifying");
  });

  it("旧端点错误文案兼容：非评审中提交结论 → 500「只能在评审中状态下提交评审结论」", async () => {
    ctx.seed(DR_TABLES.reviews, {
      评审单号: "DR-2026-0002", 申请单号: "DR-2026-0002", 状态: "pending_review", 机型名称: "X",
    });
    const res = await drApiJson(ctx, "/api/drawing-review/DR-2026-0002/conclusion", "POST", { conclusion: "passed" });
    expect(res.status).toBe(500);
    expect(res.data.error).toBe("只能在评审中状态下提交评审结论");
  });

  it("旧格式单号（仅评审单号字段）经引擎第二通道流转", async () => {
    // 新格式记录让「申请单号」字段在表中存在；旧记录只有「评审单号」
    ctx.seed(DR_TABLES.reviews, { 评审单号: "DR-2026-0001", 申请单号: "DR-2026-0001", 状态: "archived", 机型名称: "新" });
    ctx.seed(DR_TABLES.reviews, { 评审单号: "DR-20261013-001", 状态: "in_review", 机型名称: "旧" });
    const res = await drApiJson(ctx, "/api/drawing-review/DR-20261013-001/conclusion", "POST", { conclusion: "passed" });
    expect(res.status).toBe(200);
    expect(res.data.status).toBe("bom_generating");
  });
});

// ---------- hardware-review（内联最小 mock） ----------

const HW_TABLES = { reviews: "tblHwRev", minutes: "tblHwMin", rectifications: "tblHwRect", reports: "tblHwRep", events: "tblHwEvt" } as const;
const HW_SID = "sid-mig-hw";

function createHwMock() {
  const kv = new Map<string, string>();
  const tables: Record<string, BitableRecord[]> = {};
  let seq = 0;
  const cfg: HardwareReviewConfig = { base: "appHwBase", tables: { ...HW_TABLES }, updatedAt: new Date().toISOString() };
  kv.set(KV_KEYS.hardwareReviewConfig, JSON.stringify(cfg));
  kv.set(KV_KEYS.session(HW_SID), JSON.stringify({ name: "硬件迁移", open_id: "ou-hw-mig", createdAt: new Date().toISOString(), expiresAt: Date.now() + 3600e3 }));

  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.includes("/auth/v3/tenant_access_token/internal")) return jsonResp({ code: 0, tenant_access_token: "mock-token", expire: 7200 });
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
    return jsonResp({ code: 400, msg: `unsupported ${method}` });
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
  } as unknown as Env;

  return {
    env,
    tables,
    seed(tableId: string, fields: Record<string, unknown>, recordId?: string) {
      const rec: BitableRecord = { record_id: recordId ?? `rec-${++seq}`, fields };
      (tables[tableId] ??= []).push(rec);
      return rec;
    },
  };
}

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

async function hwApiJson(ctx: ReturnType<typeof createHwMock>, pathname: string, method = "GET", body?: unknown): Promise<{ status: number; data: any }> {
  const res = await handleHardwareReview(
    new Request(`http://localhost${pathname}`, {
      method,
      headers: { "content-type": "application/json", cookie: `nec_session=${HW_SID}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    ctx.env,
    pathname,
  );
  expect(res).not.toBeNull();
  return { status: res!.status, data: await res!.json() };
}

describe("hardware-review 薄壳转调引擎", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("submit 走引擎拿 HR 年计数单号；assess/archive 薄壳流转", async () => {
    const ctx = createHwMock();
    const submit = await hwApiJson(ctx, "/api/hardware-review/submit", "POST", {
      projectId: "PRJ-HW",
      hardwareName: "主控板",
      hardwareType: "controller",
      hardwareFiles: [{ name: "sch.pdf", token: "tok" }],
    });
    expect(submit.status).toBe(200);
    expect(submit.data.reviewId).toMatch(/^HR-\d{4}-0001$/);
    expect(submit.data.status).toBe("pending_review");
    const row = ctx.tables[HW_TABLES.reviews][0];
    expect(row.fields["评审单号"]).toBe(submit.data.reviewId);
    expect(row.fields["申请单号"]).toBe(submit.data.reviewId);

    const flows = await getFlowsConfig(ctx.env);
    expect(flows.hardware_review.tableId).toBe(HW_TABLES.reviews);

    // 直接置为 assessing 验证 assess 薄壳（pass → approved）与事件日志
    row.fields["状态"] = "assessing";
    const assess = await hwApiJson(ctx, `/api/hardware-review/${submit.data.reviewId}/assess`, "POST", { result: "pass" });
    expect(assess.status).toBe(200);
    expect(assess.data.status).toBe("approved");

    const archive = await hwApiJson(ctx, `/api/hardware-review/${submit.data.reviewId}/archive`, "POST");
    expect(archive.status).toBe(200);
    expect(archive.data.status).toBe("archived");

    const actions = (ctx.tables[HW_TABLES.events] ?? []).map((r) => r.fields["动作"]);
    expect(actions).toEqual(expect.arrayContaining(["submit", "pass", "archive"]));
  });
});
