/**
 * 硬件评审附件落库（路由级，内存 Base mock）
 *
 * 覆盖 P0-3 修复：提交时 hardwareFiles 序列化进「硬件资料」文本字段，
 * 详情/列表读回不再恒为 []；读取侧兼容飞书原生附件数组（file_token 结构）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BitableRecord } from "../feishu/bitable";
import { handleHardwareReview } from "../hardware-review";
import type { HardwareReviewConfig } from "../hardware-review/types";
import { KV_KEYS } from "../shared/kv-keys";
import { mockGetRecordResponse, mockSearchResponse } from "./bitable-search-mock";

const TABLES = {
  reviews: "tblHwRev",
  minutes: "tblHwMin",
  rectifications: "tblHwRect",
  reports: "tblHwRep",
  events: "tblHwEvt",
} as const;

const SID = "sid-hw";

interface HwMockCtx {
  env: Env;
  tables: Record<string, BitableRecord[]>;
  seed(tableId: string, fields: Record<string, unknown>, recordId?: string): BitableRecord;
}

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createHwMock(): HwMockCtx {
  const kv = new Map<string, string>();
  const tables: Record<string, BitableRecord[]> = {};
  let seq = 0;

  const cfg: HardwareReviewConfig = { base: "appHwBase", tables: { ...TABLES }, updatedAt: new Date().toISOString() };
  kv.set(KV_KEYS.hardwareReviewConfig, JSON.stringify(cfg));
  kv.set(
    KV_KEYS.session(SID),
    JSON.stringify({ name: "硬件测试", open_id: "ou-hw", createdAt: new Date().toISOString(), expiresAt: Date.now() + 3600e3 }),
  );

  const fetchMock = vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.includes("/auth/v3/tenant_access_token/internal")) {
      return jsonResp({ code: 0, tenant_access_token: "mock-token", expire: 7200 });
    }
    const m = url.match(/\/bitable\/v1\/apps\/([^/]+)\/tables\/([^/?]+)\/records(?:\/([^/?]+))?/);
    if (!m) return jsonResp({ code: 404, msg: `not mocked: ${url}` });
    const [, , tableId, recordId] = m;
    const method = (init?.method ?? "GET").toUpperCase();
    const items = (tables[tableId] ??= []);
    if (method === "POST" && recordId === "search") {
      return mockSearchResponse(items, init?.body ?? "{}");
    }
    if (method === "GET" && recordId) {
      return mockGetRecordResponse(items, recordId);
    }
    if (method === "GET") {
      return jsonResp({ code: 0, data: { items, has_more: false } });
    }
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
  });
  vi.stubGlobal("fetch", fetchMock);

  const REGISTRY = {
    get: vi.fn(async (key: string, type?: string) => {
      if (key === KV_KEYS.feishuTenantAccessToken) return { token: "mock-token", expireAt: Date.now() + 3600e3 };
      const v = kv.get(key);
      if (v == null) return null;
      return type === "json" ? JSON.parse(v) : v;
    }),
    put: vi.fn(async (key: string, value: string) => {
      kv.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      kv.delete(key);
    }),
  };

  const env = {
    REGISTRY,
    FEISHU_APP_ID: "mock-app-id",
    FEISHU_APP_SECRET: "mock-app-secret",
  } as unknown as Env;

  return {
    env,
    tables,
    seed(tableId, fields, recordId) {
      const rec: BitableRecord = { record_id: recordId ?? `rec-${++seq}`, fields };
      (tables[tableId] ??= []).push(rec);
      return rec;
    },
  };
}

let ctx: HwMockCtx;
let currentSid = SID;

async function apiJson(pathname: string, method = "GET", body?: unknown): Promise<{ status: number; data: any }> {
  const res = await handleHardwareReview(
    new Request(`http://localhost${pathname}`, {
      method,
      headers: { "content-type": "application/json", cookie: `nec_session=${currentSid}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    ctx.env,
    pathname,
  );
  expect(res).not.toBeNull();
  const setCookie = res!.headers.get("set-cookie");
  const m = setCookie?.match(/nec_session=([^;]+)/);
  if (m) currentSid = m[1];
  return { status: res!.status, data: await res!.json() };
}

describe("硬件评审附件落库", () => {
  beforeEach(() => {
    currentSid = SID;
    ctx = createHwMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("提交时附件序列化进「硬件资料」文本字段，详情/列表读回一致", async () => {
    const files = [
      { name: "原理图 V1.0.pdf", token: "receipts/20261016/sch.pdf", size: 1024 },
      { name: "BOM 表.xlsx", token: "manual", url: "https://example.com/bom.xlsx" },
    ];
    const submit = await apiJson("/api/hardware-review/submit", "POST", {
      projectId: "PRJ-HW",
      hardwareName: "主控板",
      hardwareType: "controller",
      hardwareFiles: files,
    });
    expect(submit.status).toBe(200);
    expect(submit.data.status).toBe("pending_review");
    expect(submit.data.hardwareFiles).toEqual(files);

    const stored = (ctx.tables[TABLES.reviews] ?? [])[0];
    expect(typeof stored.fields["硬件资料"]).toBe("string");
    expect(JSON.parse(stored.fields["硬件资料"] as string)).toEqual(files);

    const detail = await apiJson(`/api/hardware-review/${submit.data.reviewId}`);
    expect(detail.status).toBe(200);
    expect(detail.data.hardwareFiles).toEqual(files);

    const list = await apiJson("/api/hardware-review");
    expect(list.status).toBe(200);
    const row = list.data.find((r: any) => r.reviewId === submit.data.reviewId);
    expect(row.hardwareFiles).toEqual(files);
  });

  it("读取侧兼容飞书原生附件数组（file_token 结构）与非法值兜底", async () => {
    ctx.seed(TABLES.reviews, {
      评审单号: "HR-20261016-001",
      项目编号: "PRJ-HW",
      硬件名称: "传感器",
      状态: "pending_review",
      硬件资料: [
        { file_token: "boxcnabc", name: "规格书.pdf", size: 2048, url: "https://feishu.cn/file/spec.pdf" },
        { name: "无token条目.png" },
      ],
      创建时间: new Date().toISOString(),
      更新时间: new Date().toISOString(),
    });
    ctx.seed(TABLES.reviews, {
      评审单号: "HR-20261016-002",
      项目编号: "PRJ-HW",
      硬件名称: "电机",
      状态: "draft",
      硬件资料: "not-json",
      创建时间: new Date().toISOString(),
      更新时间: new Date().toISOString(),
    });

    const native = await apiJson("/api/hardware-review/HR-20261016-001");
    expect(native.data.hardwareFiles).toEqual([
      { name: "规格书.pdf", token: "boxcnabc", url: "https://feishu.cn/file/spec.pdf", size: 2048 },
      { name: "无token条目.png", token: "" },
    ]);

    const bad = await apiJson("/api/hardware-review/HR-20261016-002");
    expect(bad.data.hardwareFiles).toEqual([]);
  });
});
