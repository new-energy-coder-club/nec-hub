/**
 * 合同审批流程测试（迁移后：审批单本体/状态机/会签/单号/通知由审批引擎承担）
 *
 * 覆盖：状态表导出 · 提交前纯校验（金额/币种/日期/审批人名单）· 薄壳 submit 走引擎拿
 * HT-2026-001 年计数单号（审批单号=申请单号、提交人/创建时间薄壳补写）· 手动编号查重 ·
 * start-review/action/resubmit/archive 薄壳（participant/owner 守卫旧文案保留）·
 * 会签全流程（未全过不流转/全过流转/重复审批拒绝）· 评论副作用前置（写失败则中止）·
 * revise 落个人意见 · next-number 预览走引擎 serial 计数器 · members/file/start 端点。
 *
 * mock 风格：内存 KV + fetch 路由（bitable records CRUD，复用 bitable-search-mock）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildContractApprovers,
  nextStatus,
  validateContractAmount,
  validateCurrency,
} from "../flow.service";
import { peekNextSerial } from "../../approvals/core/serial";
import { handleContractApproval } from "../index";
import { loadMemberDirectory } from "../../feishu/member-directory";
import type { BitableRecord } from "../../feishu/bitable";
import { KV_KEYS } from "../../shared/kv-keys";
import { mockGetRecordResponse, mockSearchResponse } from "../../__tests__/bitable-search-mock";

vi.mock("../../feishu/member-directory", () => ({ loadMemberDirectory: vi.fn() }));

// ---------- 状态表与纯校验 ----------

describe("contract-approval 状态机", () => {
  it("nextStatus 覆盖全部流转", () => {
    expect(nextStatus("draft", "submit")).toBe("pending_approval");
    expect(nextStatus("pending_approval", "start_review")).toBe("in_review");
    expect(nextStatus("in_review", "approve")).toBe("approved");
    expect(nextStatus("in_review", "reject")).toBe("rejected");
    expect(nextStatus("in_review", "revise")).toBe("revised");
    expect(nextStatus("revised", "resubmit")).toBe("pending_approval");
    expect(nextStatus("approved", "archive")).toBe("archived");
    expect(nextStatus("rejected", "archive")).toBe("archived");
    expect(nextStatus("archived", "submit")).toBeNull();
  });
});

describe("contract-approval 提交前纯校验", () => {
  it("金额缺失 / 为 0 / 负数 / 超上限 / 超两位小数 → 错误", () => {
    expect(() => validateContractAmount(undefined)).toThrow("金额为必填项");
    expect(() => validateContractAmount(0)).toThrow("金额必须大于 0");
    expect(() => validateContractAmount(-1)).toThrow("金额必须大于 0");
    expect(() => validateContractAmount(10_000_000)).toThrow("金额不能超过 9,999,999.99");
    expect(() => validateContractAmount(100.123)).toThrow("金额最多两位小数");
    expect(validateContractAmount(9_999_999.99)).toBe(9_999_999.99);
  });

  it("非法币种 → 错误；缺省默认 CNY；大小写规范化", () => {
    expect(() => validateCurrency("RMB")).toThrow(/币种不合法/);
    expect(validateCurrency(undefined)).toBe("CNY");
    expect(validateCurrency("usd")).toBe("USD");
  });

  it("审批人名单：至少一名；提交人不能自审；初始全部 pending", () => {
    expect(() => buildContractApprovers([], "ou_x")).toThrow("至少指定一名审批人");
    expect(() =>
      buildContractApprovers([{ level: "team_lead", approverId: "ou_x" }], "ou_x"),
    ).toThrow("提交人不能兼任审批人");
    const list = buildContractApprovers([{ level: "finance", approverId: "ou_a", name: "王A" }], "ou_x");
    expect(list).toEqual([{ level: "finance", approverId: "ou_a", name: "王A", status: "pending" }]);
  });
});

// ---------- 路由级（薄壳转调引擎，内存 Base mock） ----------

const BASE = "neuBase0123456789";
const TABLES = { approvals: "tblApprovals1", comments: "tblComments1", events: "tblEvents1" } as const;

const USERS = {
  sub: { sid: "sid-sub", name: "提交人", open_id: "ou_submitter" },
  a: { name: "王A", open_id: "ou_approver_a" },
  b: { name: "李B", open_id: "ou_approver_b" },
  out: { name: "外人", open_id: "ou_outsider" },
} as const;
const SID_A = "sid-a";
const SID_B = "sid-b";
const SID_OUT = "sid-out";

interface Ctx {
  env: Env;
  kv: Map<string, string>;
  tables: Record<string, BitableRecord[]>;
  objects: Map<string, { body: string; contentType?: string }>;
  failTables: Set<string>;
  seed(tableId: string, fields: Record<string, unknown>, recordId?: string): BitableRecord;
}

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function createCtx(): Ctx {
  const kv = new Map<string, string>();
  const tables: Record<string, BitableRecord[]> = {};
  const objects = new Map<string, { body: string; contentType?: string }>();
  const failTables = new Set<string>();
  let seq = 0;

  kv.set(
    KV_KEYS.contractApprovalConfig,
    JSON.stringify({ base: BASE, tables: { ...TABLES }, updatedAt: new Date().toISOString() }),
  );
  for (const [sid, u] of [
    [USERS.sub.sid, USERS.sub],
    [SID_A, USERS.a],
    [SID_B, USERS.b],
    [SID_OUT, USERS.out],
  ] as const) {
    kv.set(
      KV_KEYS.session(sid),
      JSON.stringify({ name: u.name, open_id: u.open_id, createdAt: new Date().toISOString(), expiresAt: Date.now() + 4 * 24 * 3600e3 }),
    );
  }

  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String((input as { url?: string })?.url ?? input);
    const m = url.match(/\/bitable\/v1\/apps\/([^/]+)\/tables\/([^/?]+)\/records(?:\/([^/?]+))?/);
    if (!m) return jsonResp({ code: 404, msg: `not mocked: ${url}` });
    const [, , tableId, recordId] = m;
    const method = (init?.method ?? "GET").toUpperCase();
    const items = (tables[tableId] ??= []);
    if (failTables.has(tableId)) return jsonResp({ code: 1254045, msg: "mocked table failure" });
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
      list: async () => ({ keys: [] }),
    },
    APPS_BUCKET: {
      get: async (k: string) => {
        const o = objects.get(k);
        return o ? { body: o.body, httpMetadata: { contentType: o.contentType } } : null;
      },
      put: async (k: string, v: string) => void objects.set(k, v as never),
      delete: async (k: string) => void objects.delete(k),
    },
    FEISHU_APP_ID: "mock-app-id",
    FEISHU_APP_SECRET: "mock-app-secret",
  } as unknown as Env;

  return {
    env,
    kv,
    tables,
    objects,
    failTables,
    seed(tableId, fields, recordId) {
      const rec: BitableRecord = { record_id: recordId ?? `rec-${++seq}`, fields };
      (tables[tableId] ??= []).push(rec);
      return rec;
    },
  };
}

async function api(ctx: Ctx, sid: string, fullPath: string, method = "GET", body?: unknown): Promise<{ status: number; data: any }> {
  const url = new URL(`https://hub.test${fullPath}`);
  const res = await handleContractApproval(
    new Request(url.toString(), {
      method,
      headers: { "content-type": "application/json", cookie: `nec_session=${sid}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    ctx.env,
    url.pathname,
  );
  if (!res) throw new Error(`no handler matched ${url.pathname}`);
  return { status: res.status, data: await res.json() };
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractName: "测试采购合同",
    contractFiles: [{ name: "contract.pdf", token: "tok-1" }],
    amount: 100,
    approvers: [
      { level: "team_lead", approverId: USERS.a.open_id, name: USERS.a.name },
      { level: "finance", approverId: USERS.b.open_id, name: USERS.b.name },
    ],
    ...overrides,
  };
}

/** 提交并开始审批，返回审批单号 */
async function submitAndStart(ctx: Ctx, overrides: Record<string, unknown> = {}): Promise<string> {
  const submitted = await api(ctx, USERS.sub.sid, "/api/contract-approval/submit", "POST", validBody(overrides));
  expect(submitted.status).toBe(200);
  const id = submitted.data.approvalId as string;
  const started = await api(ctx, SID_A, `/api/contract-approval/${id}/start-review`, "POST");
  expect(started.status).toBe(200);
  return id;
}

describe("contract-approval 薄壳提交（引擎写单）", () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = createCtx();
    vi.mocked(loadMemberDirectory).mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("缺合同名称 / 合同文件 / 审批人 → 旧文案 500", async () => {
    for (const [overrides, msg] of [
      [{ contractName: "" }, "合同名称为必填项"],
      [{ contractFiles: [] }, "合同文件为必填项"],
      [{ approvers: [] }, "至少指定一名审批人"],
      [{ amount: undefined }, "金额为必填项"],
      [{ approvers: [{ level: "team_lead", approverId: USERS.sub.open_id }] }, "提交人不能兼任审批人"],
    ] as const) {
      const res = await api(ctx, USERS.sub.sid, "/api/contract-approval/submit", "POST", validBody(overrides as Record<string, unknown>));
      expect(res.status).toBe(500);
      expect(res.data.error).toContain(msg);
    }
  });

  it("提交成功：HT 三位年计数单号，审批单号=申请单号=合同编号，薄壳补写提交人/创建时间", async () => {
    const year = new Date().getFullYear();
    const res = await api(ctx, USERS.sub.sid, "/api/contract-approval/submit", "POST", validBody());
    expect(res.status).toBe(200);
    expect(res.data.approvalId).toBe(`HT-${year}-001`);
    expect(res.data.contractNumber).toBe(`HT-${year}-001`);
    expect(res.data.status).toBe("pending_approval");
    expect(res.data.submittedBy).toBe(USERS.sub.open_id);
    expect(res.data.approvers).toHaveLength(2);
    expect(res.data.approvers.every((a: { status: string }) => a.status === "pending")).toBe(true);

    const row = ctx.tables[TABLES.approvals][0];
    expect(row.fields["审批单号"]).toBe(res.data.approvalId);
    expect(row.fields["申请单号"]).toBe(res.data.approvalId);
    expect(row.fields["提交人"]).toBe(USERS.sub.open_id);
    expect(row.fields["申请人"]).toBe(USERS.sub.name);
    expect(row.fields["创建时间"]).toBeTruthy();
    expect(row.fields["状态"]).toBe("pending_approval");
    // 引擎 serial 计数器已占用 001
    expect(ctx.kv.get(KV_KEYS.serial("HT", year))).toBe("1");

    // 第二单 → 002；submit 事件落 events 表
    const second = await api(ctx, USERS.sub.sid, "/api/contract-approval/submit", "POST", validBody());
    expect(second.data.approvalId).toBe(`HT-${year}-002`);
    const actions = (ctx.tables[TABLES.events] ?? []).map((r) => r.fields["动作"]);
    expect(actions).toEqual(["submit", "submit"]);
  });

  it("手动编号查重保留；手动编号只影响合同编号，审批单号仍走 HT 计数", async () => {
    const year = new Date().getFullYear();
    const first = await api(ctx, USERS.sub.sid, "/api/contract-approval/submit", "POST", validBody({ contractNumber: "CT-USR-9" }));
    expect(first.status).toBe(200);
    expect(first.data.contractNumber).toBe("CT-USR-9");
    // 引擎审批单号始终分配 HT 年计数（与旧版 approvalId 随机号、合同编号独立计数不同）
    expect(first.data.approvalId).toBe(`HT-${year}-001`);

    const dup = await api(ctx, USERS.sub.sid, "/api/contract-approval/submit", "POST", validBody({ contractNumber: "CT-USR-9" }));
    expect(dup.status).toBe(500);
    expect(dup.data.error).toContain("合同编号已存在（CT-USR-9）");
  });
});

describe("contract-approval 薄壳会签（引擎承担）", () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = createCtx();
    vi.mocked(loadMemberDirectory).mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("非参与人不能开始审批；审批人 start_review → in_review", async () => {
    const submitted = await api(ctx, USERS.sub.sid, "/api/contract-approval/submit", "POST", validBody());
    const id = submitted.data.approvalId as string;
    const denied = await api(ctx, SID_OUT, `/api/contract-approval/${id}/start-review`, "POST");
    expect(denied.status).toBe(500);
    expect(denied.data.error).toContain("参与人");
    const ok = await api(ctx, SID_A, `/api/contract-approval/${id}/start-review`, "POST");
    expect(ok.status).toBe(200);
    expect(ok.data.status).toBe("in_review");
    // 重复开始 → 旧文案
    const again = await api(ctx, SID_A, `/api/contract-approval/${id}/start-review`, "POST");
    expect(again.status).toBe(500);
    expect(again.data.error).toContain("不允许开始审批");
  });

  it("非审批人不能审批（提交人/外人都不行）；重复审批拒绝", async () => {
    const id = await submitAndStart(ctx);
    const byOutsider = await api(ctx, SID_OUT, `/api/contract-approval/${id}/action`, "POST", { action: "approve" });
    expect(byOutsider.status).toBe(500);
    expect(byOutsider.data.error).toContain("参与人");
    const bySubmitter = await api(ctx, USERS.sub.sid, `/api/contract-approval/${id}/action`, "POST", { action: "approve" });
    expect(bySubmitter.status).toBe(500);
    expect(bySubmitter.data.error).toContain("会签审批人");

    await api(ctx, SID_A, `/api/contract-approval/${id}/action`, "POST", { action: "approve" });
    const dup = await api(ctx, SID_A, `/api/contract-approval/${id}/action`, "POST", { action: "approve" });
    expect(dup.status).toBe(500);
    expect(dup.data.error).toContain("已提交过审批意见");
  });

  it("会签：第一人通过保持 in_review 且名单落个人意见，全部通过才 approved；评论写入", async () => {
    const id = await submitAndStart(ctx);
    const afterA = await api(ctx, SID_A, `/api/contract-approval/${id}/action`, "POST", { action: "approve", comment: "同意" });
    expect(afterA.status).toBe(200);
    expect(afterA.data.status).toBe("in_review");
    const a = afterA.data.approvers.find((x: { approverId: string }) => x.approverId === USERS.a.open_id);
    expect(a.status).toBe("approved");
    expect(a.comment).toBe("同意");
    expect(a.actedAt).toBeTruthy();

    const comments = await api(ctx, SID_A, `/api/contract-approval/${id}/comments`);
    expect(comments.data).toHaveLength(1);
    expect(comments.data[0].reviewerId).toBe(USERS.a.open_id);
    expect(comments.data[0].content).toBe("同意");

    const afterB = await api(ctx, SID_B, `/api/contract-approval/${id}/action`, "POST", { action: "approve" });
    expect(afterB.data.status).toBe("approved");
    expect(afterB.data.approvers.every((x: { status: string }) => x.status === "approved")).toBe(true);
  });

  it("评论写入失败则整个操作中止，状态与名单不变", async () => {
    const id = await submitAndStart(ctx);
    ctx.failTables.add(TABLES.comments);
    const res = await api(ctx, SID_A, `/api/contract-approval/${id}/action`, "POST", { action: "approve", comment: "x" });
    expect(res.status).toBe(500);
    ctx.failTables.delete(TABLES.comments);
    const detail = await api(ctx, SID_A, `/api/contract-approval/${id}`);
    expect(detail.data.status).toBe("in_review");
    expect(detail.data.approvers.every((a: { status: string }) => a.status === "pending")).toBe(true);
  });

  it("任一审批人拒绝即整体 rejected；此后不能再审批", async () => {
    const id = await submitAndStart(ctx);
    const after = await api(ctx, SID_A, `/api/contract-approval/${id}/action`, "POST", { action: "reject", comment: "条款有问题" });
    expect(after.data.status).toBe("rejected");
    const detail = await api(ctx, SID_A, `/api/contract-approval/${id}`);
    const a = detail.data.approvers.find((x: { approverId: string }) => x.approverId === USERS.a.open_id);
    expect(a.status).toBe("rejected");
    const late = await api(ctx, SID_B, `/api/contract-approval/${id}/action`, "POST", { action: "approve" });
    expect(late.status).toBe(500);
    expect(late.data.error).toContain("不允许审批操作");
  });

  it("revise 落本人 rejected 意见；仅提交人可 resubmit，且审批人重置", async () => {
    const id = await submitAndStart(ctx);
    const revised = await api(ctx, SID_A, `/api/contract-approval/${id}/action`, "POST", { action: "revise", comment: "金额条款需修改" });
    expect(revised.data.status).toBe("revised");
    const a = revised.data.approvers.find((x: { approverId: string }) => x.approverId === USERS.a.open_id);
    expect(a.status).toBe("rejected");
    expect(a.comment).toBe("金额条款需修改");

    const byOther = await api(ctx, SID_B, `/api/contract-approval/${id}/resubmit`, "POST", {});
    expect(byOther.status).toBe(500);
    expect(byOther.data.error).toContain("只有提交人可以重新提交");

    const resubmitted = await api(ctx, USERS.sub.sid, `/api/contract-approval/${id}/resubmit`, "POST", {});
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.data.status).toBe("pending_approval");
    expect(resubmitted.data.approvers.every((x: { status: string; comment?: string }) => x.status === "pending" && !x.comment && !("actedAt" in x && x.actedAt))).toBe(true);

    const actions = (ctx.tables[TABLES.events] ?? []).map((r) => r.fields["动作"]);
    expect(actions).toEqual(expect.arrayContaining(["submit", "start_review", "revise", "resubmit"]));
  });

  it("归档：仅终态可归档（旧文案），非参与人不可归档，提交人可归档", async () => {
    const id = await submitAndStart(ctx);
    const early = await api(ctx, SID_A, `/api/contract-approval/${id}/archive`, "POST");
    expect(early.status).toBe(500);
    expect(early.data.error).toContain("不允许归档");

    await api(ctx, SID_A, `/api/contract-approval/${id}/action`, "POST", { action: "approve" });
    await api(ctx, SID_B, `/api/contract-approval/${id}/action`, "POST", { action: "approve" });

    const byOutsider = await api(ctx, SID_OUT, `/api/contract-approval/${id}/archive`, "POST");
    expect(byOutsider.status).toBe(500);
    expect(byOutsider.data.error).toContain("参与人");

    const archived = await api(ctx, USERS.sub.sid, `/api/contract-approval/${id}/archive`, "POST");
    expect(archived.status).toBe(200);
    expect(archived.data.status).toBe("archived");
  });

  it("旧格式单号（仅审批单号字段）经引擎第二通道流转", async () => {
    // 新格式记录让「申请单号」字段在表中存在；旧记录只有「审批单号」
    ctx.seed(TABLES.approvals, {
      审批单号: "HT-2026-001", 申请单号: "HT-2026-001", 状态: "archived",
      提交人: USERS.sub.open_id, 审批人: JSON.stringify([{ level: "team_lead", approverId: USERS.a.open_id, status: "approved" }]),
    });
    ctx.seed(TABLES.approvals, {
      审批单号: "CA-20261024-001", 状态: "approved",
      提交人: USERS.sub.open_id, 审批人: JSON.stringify([{ level: "team_lead", approverId: USERS.a.open_id, status: "approved" }]),
    });
    const res = await api(ctx, USERS.sub.sid, "/api/contract-approval/CA-20261024-001/archive", "POST");
    expect(res.status).toBe(200);
    expect(res.data.status).toBe("archived");
    expect(res.data.approvalId).toBe("CA-20261024-001");
  });
});

describe("contract-approval 编号预览（引擎 serial 计数器）", () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = createCtx();
    vi.mocked(loadMemberDirectory).mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("peekNextSerial 只读不占用", async () => {
    const year = new Date().getFullYear();
    ctx.kv.set(KV_KEYS.serial("HT", year), "41");
    expect(await peekNextSerial(ctx.env.REGISTRY, "HT", year, 3)).toBe(`HT-${year}-042`);
    expect(ctx.kv.get(KV_KEYS.serial("HT", year))).toBe("41");
  });

  it("GET /next-number：预览 serial 计数；为空时 001 且不创建键", async () => {
    const year = new Date().getFullYear();
    ctx.kv.set(KV_KEYS.serial("HT", year), "41");
    const res = await api(ctx, USERS.sub.sid, "/api/contract-approval/next-number");
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ number: `HT-${year}-042` });
    expect(ctx.kv.get(KV_KEYS.serial("HT", year))).toBe("41");

    const ctx2 = createCtx();
    const empty = await api(ctx2, USERS.sub.sid, "/api/contract-approval/next-number");
    expect(empty.data).toEqual({ number: `HT-${year}-001` });
    expect(ctx2.kv.has(KV_KEYS.serial("HT", year))).toBe(false);
  });
});

describe("contract-approval 读取与附件端点（保留原样）", () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = createCtx();
    vi.mocked(loadMemberDirectory).mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("GET /members：q 命中姓名与 ou_ 子串；目录未配置 → 空数组 + hint", async () => {
    vi.mocked(loadMemberDirectory).mockResolvedValue(
      new Map([
        ["张三", "ou_zhangsan"],
        ["李四", "ou_lisi"],
      ]),
    );
    const byName = await api(ctx, USERS.sub.sid, "/api/contract-approval/members?q=%E5%BC%A0");
    expect(byName.data).toEqual({ members: [{ name: "张三", open_id: "ou_zhangsan" }] });

    const byOid = await api(ctx, USERS.sub.sid, "/api/contract-approval/members?q=ou_li");
    expect(byOid.data.members).toEqual([{ name: "李四", open_id: "ou_lisi" }]);

    vi.mocked(loadMemberDirectory).mockResolvedValue(null);
    const none = await api(ctx, USERS.sub.sid, "/api/contract-approval/members?q=%E5%BC%A0");
    expect(none.data).toEqual({ members: [], hint: "队员名单未配置" });
  });

  it("GET /file：200 流式返回 R2 对象；对象不存在 404", async () => {
    ctx.objects.set("receipts/20261015/uuid-x.pdf", { body: "%PDF-1.4 fake", contentType: "application/pdf" });
    const url = new URL(`https://hub.test/api/contract-approval/file?key=${encodeURIComponent("receipts/20261015/uuid-x.pdf")}&name=${encodeURIComponent("采购合同.pdf")}`);
    const res = await handleContractApproval(
      new Request(url.toString(), { headers: { cookie: `nec_session=${USERS.sub.sid}` } }),
      ctx.env,
      url.pathname,
    );
    expect(res!.status).toBe(200);
    expect(res!.headers.get("content-type")).toBe("application/pdf");
    expect(res!.headers.get("content-disposition")).toContain("inline");
    expect(await res!.text()).toBe("%PDF-1.4 fake");

    const miss = await api(ctx, USERS.sub.sid, "/api/contract-approval/file?key=receipts%2Fnope.pdf");
    expect(miss.status).toBe(404);
    expect(miss.data).toEqual({ error: "文件不存在" });
  });

  it("GET /start：required 含 amount，rules 含金额/币种/日期校验描述", async () => {
    const res = await api(ctx, USERS.sub.sid, "/api/contract-approval/start");
    expect(res.status).toBe(200);
    expect(res.data.required).toContain("amount");
    expect(res.data.rules.join(" ")).toContain("金额必须大于 0");
    expect(res.data.rules.join(" ")).toContain("币种仅支持");
    expect(res.data.rules.join(" ")).toContain("到期日期必须晚于生效日期");
  });
});
