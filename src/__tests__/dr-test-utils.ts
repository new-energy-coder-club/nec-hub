/**
 * drawing-review 测试共享 mock：内存 KV + 内存多维表格（fetch 路由）。
 */
import { vi } from "vitest";
import type { BitableRecord } from "../feishu/bitable";
import type { DrawingReviewConfig } from "../drawing-review/types";
import { KV_KEYS } from "../shared/kv-keys";
import { mockGetRecordResponse, mockSearchResponse } from "./bitable-search-mock";

export const DR_TABLES = {
  reviews: "tblRev",
  minutes: "tblMin",
  rectifications: "tblRect",
  bom: "tblBom",
  assessments: "tblAss",
  inventory: "tblInv",
  delivery: "tblDel",
  schedule: "tblSch",
  inquiries: "tblInq",
  events: "tblEvt",
} as const;

export interface DrMockCtx {
  env: Env;
  kv: Map<string, string>;
  tables: Record<string, BitableRecord[]>;
  seed(tableId: string, fields: Record<string, unknown>, recordId?: string): BitableRecord;
  fetchMock: ReturnType<typeof vi.fn>;
}

interface DrMockOptions {
  /** 从 config 中移除的逻辑表名（模拟表未配置，验证降级） */
  omitTables?: Array<keyof typeof DR_TABLES>;
  /** 读取这些 tableId 时飞书返回错误（验证降级） */
  failTables?: string[];
  /** 预置登录会话 sid；设置后可用 Cookie: nec_session=<sid> 调路由 */
  session?: { sid: string; openId: string; name: string };
}

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function createDrMock(opts: DrMockOptions = {}): DrMockCtx {
  const kv = new Map<string, string>();
  const tables: Record<string, BitableRecord[]> = {};
  let seq = 0;

  const cfgTables: Record<string, string> = {};
  for (const [k, v] of Object.entries(DR_TABLES)) {
    if (!opts.omitTables?.includes(k as keyof typeof DR_TABLES)) cfgTables[k] = v;
  }
  const cfg: DrawingReviewConfig = { base: "appMockBase", tables: cfgTables, updatedAt: new Date().toISOString() };
  kv.set(KV_KEYS.drawingReviewConfig, JSON.stringify(cfg));

  if (opts.session) {
    kv.set(
      KV_KEYS.session(opts.session.sid),
      JSON.stringify({
        name: opts.session.name,
        open_id: opts.session.openId,
        createdAt: new Date().toISOString(),
        expiresAt: Date.now() + 3600e3,
      }),
    );
  }

  const fetchMock = vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.includes("/auth/v3/tenant_access_token/internal")) {
      return jsonResp({ code: 0, tenant_access_token: "mock-token", expire: 7200 });
    }
    const m = url.match(/\/bitable\/v1\/apps\/([^/]+)\/tables\/([^/?]+)\/records(?:\/([^/?]+))?/);
    if (!m) return jsonResp({ code: 404, msg: `not mocked: ${url}` });
    const [, , tableId, recordId] = m;
    if (opts.failTables?.includes(tableId)) {
      return jsonResp({ code: 1254045, msg: "mocked table failure" });
    }
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
    kv,
    tables,
    fetchMock,
    seed(tableId, fields, recordId) {
      const rec: BitableRecord = { record_id: recordId ?? `rec-${++seq}`, fields };
      (tables[tableId] ??= []).push(rec);
      return rec;
    },
  };
}

export function hoursAgo(hours: number, now: number): string {
  return new Date(now - hours * 3600e3).toISOString();
}
