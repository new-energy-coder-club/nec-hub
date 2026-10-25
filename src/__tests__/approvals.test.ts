/**
 * Plan B 审批引擎测试（PRD V1.1）
 *
 * 覆盖：evalFlowFields 声明式校验（required/conditional/金额>0）· submitApprovalCore 发起落表
 * runApprovalAction 状态机（角色门禁/幂等/reject 必填意见）· handleApprovalMine 我的申请
 * config_flows 深合并校验 · notifyFeishu 重试与 notify:failed 留痕
 *
 * mock 风格沿用 fe04-fe09.test.ts：内存 KV + fetch 路由（bitable records CRUD + 群机器人 webhook）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BitableRecord } from "../feishu/bitable";
import { evalFlowFields, getFlowsConfig, DEFAULT_FLOWS } from "../approvals/flows";
import { consumeNextSerial, formatSerial, serialKey, type SerialCounter } from "../approvals/core/serial";
import { aggregateTodos, fetchFlowRecordsCached, runApprovalAction, submitApprovalCore } from "../approvals/engine";
import { runApprovalSla } from "../approvals/sla";
import { handleApprovalMine, handleApprovalPending, handleApprovalSubmit, handleApprovalUpload, toolConfigFlows, toolSendNotice } from "../approvals/handlers";
import { notifyFeishu } from "../feishu/bot";
import { KV_KEYS } from "../shared/kv-keys";
import { mockGetRecordResponse, mockSearchResponse } from "./bitable-search-mock";

const BASE = "appMockBase";
const TBL_REIMBURSE = "tblReimburse";

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

interface Ctx {
  env: Env;
  kv: Map<string, string>;
  tables: Record<string, BitableRecord[]>;
  webhookCalls: Array<{ url: string; body: Record<string, unknown> }>;
  webhookFailTimes: number;
  seed(tableId: string, fields: Record<string, unknown>, recordId?: string): BitableRecord;
}

function createCtx(opts: { webhookFailTimes?: number; withWebhook?: boolean } = {}): Ctx {
  const kv = new Map<string, string>();
  const tables: Record<string, BitableRecord[]> = {};
  const webhookCalls: Ctx["webhookCalls"] = [];
  let seq = 0;
  let webhookFailBudget = opts.webhookFailTimes ?? 0;

  // 流程配置：reimburse 底表挂到看板 base；其余流程保持未配置
  kv.set(KV_KEYS.flowsConfig, JSON.stringify({ reimburse: { tableId: TBL_REIMBURSE, base: BASE } }));
  kv.set(KV_KEYS.dashboardConfig, JSON.stringify({ base: BASE, tables: { members: "tblM" }, updatedAt: new Date().toISOString() }));
  kv.set(KV_KEYS.session("sid-member"), JSON.stringify({ name: "张三", open_id: "ou-member", createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3 }));
  kv.set(KV_KEYS.session("sid-captain"), JSON.stringify({ name: "张队", open_id: "ou-captain", createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3 }));

  const ctx: Ctx = {
    kv,
    tables,
    webhookCalls,
    webhookFailTimes: 0,
    env: undefined as unknown as Env,
    seed(tableId, fields, recordId) {
      const rec: BitableRecord = { record_id: recordId ?? `rec-${++seq}`, fields };
      (tables[tableId] ??= []).push(rec);
      return rec;
    },
  };

  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.includes("/bot/v2/hook/")) {
      if (webhookFailBudget > 0) {
        webhookFailBudget--;
        ctx.webhookFailTimes++;
        return jsonResp({ code: 19024, msg: "sign match fail" });
      }
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
    APPS_BUCKET: {
      put: vi.fn(async () => ({})),
      get: vi.fn(async () => null),
    },
    ...(opts.withWebhook ? { FEISHU_BOT_WEBHOOK: "https://open.feishu.cn/open-apis/bot/v2/hook/abc" } : {}),
  } as unknown as Env;

  // 队员名单：张三=队员/机械组，张队=队长
  ctx.seed("tblM", { 姓名: "张三", 飞书ID: "ou-member", 权限角色: "队员", 组别: "机械组" });
  ctx.seed("tblM", { 姓名: "张队", 飞书ID: "ou-captain", 权限角色: "队长", 组别: "管理组" });
  return ctx;
}

const CAPTAIN = { name: "张队", open_id: "ou-captain" };
const MEMBER = { name: "张三", open_id: "ou-member" };
const CAPTAIN_ROLE = { role: "队长", group: "管理组", matched: true };
const MEMBER_ROLE = { role: "队员", group: "机械组", matched: true };

function sessionReq(url: string, sid: string, body?: unknown): Request {
  return new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie: `nec_session=${sid}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("consumeNextSerial（KV 单号计数器）", () => {
  function mapCounter() {
    const m = new Map<string, string>();
    const counter: SerialCounter = {
      get: async (k) => m.get(k) ?? null,
      put: async (k, v) => { m.set(k, v); },
    };
    return { m, counter };
  }

  it("首单 0001 逐次递增；格式 <prefix>-<年>-<4位序号> 且按 前缀+年 分桶", async () => {
    const { m, counter } = mapCounter();
    const year = new Date().getFullYear();
    expect(await consumeNextSerial(counter, "BX")).toBe(`BX-${year}-0001`);
    expect(await consumeNextSerial(counter, "BX")).toBe(`BX-${year}-0002`);
    expect(m.get(serialKey("BX", year))).toBe("2");
    // 不同前缀互不影响
    expect(await consumeNextSerial(counter, "MECH")).toBe(`MECH-${year}-0001`);
  });

  it("计数器值损坏（非数字）时从 0001 重新计数", async () => {
    const { m, counter } = mapCounter();
    const year = new Date().getFullYear();
    m.set(serialKey("BX", year), "oops");
    expect(await consumeNextSerial(counter, "BX")).toBe(`BX-${year}-0001`);
  });
});

describe("evalFlowFields（声明式字段校验）", () => {
  const flow = DEFAULT_FLOWS.reimburse;

  it("required 缺失与 conditional 触发都报出", () => {
    const missing = evalFlowFields(flow, { 事项: "打样" });
    expect(missing).toContain("报销金额");
    expect(missing).toContain("发票号");
    // 发票照片为空（缺省）→ 触发 conditional 要求无票说明
    expect(missing).toContain("无票说明");
  });

  it("金额字段 ≤0 报「须大于 0」；填了发票照片则不要求无票说明", () => {
    const missing = evalFlowFields(flow, { 事项: "打样", 报销金额: -5, 发票号: "12345678", 发票照片: "https://img" });
    expect(missing).toEqual(["报销金额（须大于 0）"]);
  });

  it("金额字段为空不触发正数校验（由 required 负责）", () => {
    const missing = evalFlowFields(DEFAULT_FLOWS.hardware, { 申请类型: "新购", 物料名称: "电机", 规格型号: "AK10", 用途说明: "底盘", 购买链接: "https://x" });
    expect(missing).toContain("数量");
    expect(missing).toContain("预估总价");
    expect(missing.some((m) => m.includes("须大于 0"))).toBe(false);
  });
});

describe("submitApprovalCore（发起审批）", () => {
  const goodFields = { 事项: "铝型材打样运费", 报销金额: 120, 发票号: "12345678", 发票照片: "https://img" };

  it("流程未配置 tableId → ApprovalError", async () => {
    const ctx = createCtx();
    await expect(
      submitApprovalCore(ctx.env, { type: "drawing", fields: {}, user: MEMBER, role: MEMBER_ROLE, source: "portal" }),
    ).rejects.toThrow("流程未配置");
  });

  it("合法提交：写底表（状态=审批中 + 单号 BX-年-0001）→ KV 映射 → 群通知", async () => {
    const ctx = createCtx({ withWebhook: true });
    const res = await submitApprovalCore(ctx.env, { type: "reimburse", fields: goodFields, user: MEMBER, role: MEMBER_ROLE, source: "portal" });
    expect(res.status).toBe("审批中");
    expect(res.application_id).toMatch(/^BX-\d{4}-0001$/);
    const row = ctx.tables[TBL_REIMBURSE][0];
    expect(row.fields["状态"]).toBe("审批中");
    expect(row.fields["申请人"]).toBe("张三");
    expect(row.fields["申请人 open_id"]).toBe("ou-member");
    expect(row.fields["申请单号"]).toBe(res.application_id);
    expect(JSON.parse(ctx.kv.get(KV_KEYS.approvalMap(res.application_id))!).record_id).toBe(row.record_id);
    expect(ctx.webhookCalls).toHaveLength(1);
    expect(String(ctx.webhookCalls[0].body.content && (ctx.webhookCalls[0].body.content as { text: string }).text)).toContain("新报销申请");
  });

  it("字段校验未通过 → ApprovalError 列出缺失", async () => {
    const ctx = createCtx();
    await expect(
      submitApprovalCore(ctx.env, { type: "reimburse", fields: { 事项: "x" }, user: MEMBER, role: MEMBER_ROLE, source: "portal" }),
    ).rejects.toThrow("字段校验未通过");
  });

  it("MCP 代提交需 applicant_name；单号随 KV 计数器递增（不依赖表记录数）", async () => {
    const ctx = createCtx();
    await expect(
      submitApprovalCore(ctx.env, { type: "reimburse", fields: goodFields, user: null, role: null, source: "mcp" }),
    ).rejects.toThrow("申请人姓名为空");
    ctx.kv.set(KV_KEYS.serial("BX", new Date().getFullYear()), "1"); // BX-<年>-0001 已占用
    const res = await submitApprovalCore(ctx.env, { type: "reimburse", fields: goodFields, user: null, role: null, applicantName: "李四", source: "mcp" });
    expect(res.application_id).toMatch(/-0002$/);
  });

  it("drawing：图号 @appId 占位符替换为分配单号；mine 透传图纸字段与 record 链接", async () => {
    const ctx = createCtx({ withWebhook: true });
    ctx.kv.set(KV_KEYS.flowsConfig, JSON.stringify({
      reimburse: { tableId: TBL_REIMBURSE, base: BASE },
      drawing: { tableId: "tblDrawing", base: BASE },
    }));
    const res = await submitApprovalCore(ctx.env, {
      type: "drawing",
      fields: {
        图纸名称: "6014 电机转接板", 图号: "@appId", 版本: "V1.0", 所属机构: "底盘",
        材料与工艺: "7075 铝合金 / CNC", 加工方式: "外协加工", 预估加工费: 600, 图纸文件: "plate.pdf",
      },
      user: MEMBER,
      role: MEMBER_ROLE,
      source: "portal",
    });
    expect(res.application_id).toMatch(/^MECH-\d{4}-0001$/);
    const row = ctx.tables["tblDrawing"][0];
    expect(row.fields["图号"]).toBe(res.application_id); // 占位符已替换
    expect(row.fields["状态"]).toBe("审批中");
    // 预估加工费 600 ≥ 500 → 额外会签提醒（共 2 条群通知）
    expect(ctx.webhookCalls).toHaveLength(2);

    const mine = await handleApprovalMine(sessionReq("https://hub.test/api/approvals/mine?type=drawing", "sid-member"), ctx.env);
    const data = (await mine.json()) as { records: Array<{ application_id: string; record_id: string; url: string; fields: Record<string, unknown> }> };
    expect(data.records).toHaveLength(1);
    expect(data.records[0].application_id).toBe(res.application_id);
    expect(data.records[0].fields["图纸名称"]).toBe("6014 电机转接板");
    expect(data.records[0].fields["预估加工费"]).toBe(600);
    expect(data.records[0].record_id).toBe(row.record_id);
    expect(data.records[0].url).toContain("table=tblDrawing");
  });
});

describe("POST /api/approvals（门户入口）", () => {
  const goodFields = { 事项: "打样", 报销金额: 120, 发票号: "12345678", 发票照片: "https://img" };

  it("未登录 401；未知 type 400", async () => {
    const ctx = createCtx();
    const noAuth = await handleApprovalSubmit(sessionReq("https://hub.test/api/approvals", "nope", { type: "reimburse", fields: goodFields }), ctx.env);
    expect(noAuth.status).toBe(401);
    const badType = await handleApprovalSubmit(sessionReq("https://hub.test/api/approvals", "sid-member", { type: "unknown", fields: {} }), ctx.env);
    expect(badType.status).toBe(400);
  });

  it("限组流程：非本组且非队长 → 403；队长硬编码放行进入字段校验 → 400", async () => {
    const ctx = createCtx();
    // drawing 流程限机械组；配好 tableId 后走组别门禁
    ctx.kv.set(KV_KEYS.flowsConfig, JSON.stringify({ drawing: { tableId: "tblD", base: BASE } }));
    ctx.seed("tblM", { 姓名: "李四", 飞书ID: "ou-other", 权限角色: "队员", 组别: "电控组" });
    ctx.kv.set(KV_KEYS.session("sid-other"), JSON.stringify({ name: "李四", open_id: "ou-other", createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3 }));
    const res403 = await handleApprovalSubmit(sessionReq("https://hub.test/api/approvals", "sid-other", { type: "drawing", fields: {} }), ctx.env);
    expect(res403.status).toBe(403);
    expect(((await res403.json()) as { hint?: string }).hint).toContain("机械组");
    // 队长硬编码放行，进入字段校验 → 400 字段缺失
    const res400 = await handleApprovalSubmit(sessionReq("https://hub.test/api/approvals", "sid-captain", { type: "drawing", fields: {} }), ctx.env);
    expect(res400.status).toBe(400);
  });
});

describe("GET /api/approvals/pending（G-02 待我审批）", () => {
  it("审批人看到审批中行（升序）；非审批人空列表；未登录 401；未知 type 400", async () => {
    const ctx = createCtx();
    ctx.seed(TBL_REIMBURSE, { 申请单号: "BX-2026-0001", 状态: "审批中", 申请人: "张三", 事项: "打样", 提交时间: 2000 });
    ctx.seed(TBL_REIMBURSE, { 申请单号: "BX-2026-0002", 状态: "已通过", 申请人: "张三", 事项: "运费", 提交时间: 1000 });
    ctx.seed(TBL_REIMBURSE, { 申请单号: "BX-2026-0003", 状态: "审批中", 申请人: "李四", 事项: "耗材", 提交时间: 1500 });

    const noAuth = await handleApprovalPending(new Request("https://hub.test/api/approvals/pending?type=reimburse"), ctx.env);
    expect(noAuth.status).toBe(401);
    const badType = await handleApprovalPending(sessionReq("https://hub.test/api/approvals/pending?type=nope", "sid-captain"), ctx.env);
    expect(badType.status).toBe(400);

    // 非审批人（队员）→ 空列表而非 403
    const member = await handleApprovalPending(sessionReq("https://hub.test/api/approvals/pending?type=reimburse", "sid-member"), ctx.env);
    expect(((await member.json()) as { records: unknown[] }).records).toHaveLength(0);

    // 队长 → 仅审批中行，按提交时间升序，不含已通过
    const captain = await handleApprovalPending(sessionReq("https://hub.test/api/approvals/pending?type=reimburse", "sid-captain"), ctx.env);
    const data = (await captain.json()) as { records: Array<{ application_id: string; applicant: string; url: string }> };
    expect(data.records.map((r) => r.application_id)).toEqual(["BX-2026-0003", "BX-2026-0001"]);
    expect(data.records[0].applicant).toBe("李四");
    expect(data.records[0].url).toContain("table=tblReimburse");
  });
});

describe("runApprovalAction（状态机）", () => {
  async function seedPending(ctx: Ctx): Promise<{ appId: string; rec: BitableRecord }> {
    const rec = ctx.seed(TBL_REIMBURSE, {
      申请单号: "BX-2026-0001",
      状态: "审批中",
      申请人: "张三",
      "申请人 open_id": "ou-member",
      事项: "打样",
      报销金额: 120,
    });
    return { appId: "BX-2026-0001", rec };
  }

  it("队员审批 → 403；队长 approve → 已通过 + 写审批人/意见 + 群通知", async () => {
    const ctx = createCtx({ withWebhook: true });
    const { appId, rec } = await seedPending(ctx);
    await expect(
      runApprovalAction(ctx.env, { type: "reimburse", appId, action: "approve", user: MEMBER, role: MEMBER_ROLE }),
    ).rejects.toThrow("无权执行 approve");

    const res = await runApprovalAction(ctx.env, { type: "reimburse", appId, action: "approve", comment: "同意", user: CAPTAIN, role: CAPTAIN_ROLE });
    expect(res.status).toBe("已通过");
    expect(rec.fields["状态"]).toBe("已通过");
    expect(rec.fields["审批人"]).toBe("张队");
    expect(rec.fields["审批意见"]).toBe("同意");
    expect(String((ctx.webhookCalls[0].body.content as { text: string }).text)).toContain("✅ 已通过");
  });

  it("幂等：目标状态=当前状态直接返回；前置状态不符 → 409", async () => {
    const ctx = createCtx();
    const { appId, rec } = await seedPending(ctx);
    rec.fields["状态"] = "已通过";
    const again = await runApprovalAction(ctx.env, { type: "reimburse", appId, action: "approve", user: CAPTAIN, role: CAPTAIN_ROLE });
    expect(again.status).toBe("已通过");
    await expect(
      runApprovalAction(ctx.env, { type: "reimburse", appId, action: "reject", comment: "x", user: CAPTAIN, role: CAPTAIN_ROLE }),
    ).rejects.toThrow("不能执行 reject");
  });

  it("reject 必须填审批意见；pay 仅财务/队长", async () => {
    const ctx = createCtx();
    const { appId } = await seedPending(ctx);
    await expect(
      runApprovalAction(ctx.env, { type: "reimburse", appId, action: "reject", user: CAPTAIN, role: CAPTAIN_ROLE }),
    ).rejects.toThrow("驳回必须填写审批意见");
    await expect(
      runApprovalAction(ctx.env, { type: "reimburse", appId, action: "pay", user: MEMBER, role: MEMBER_ROLE }),
    ).rejects.toThrow("仅财务/队长");
  });

  it("G-02：reject 带 reason → 写「驳回原因」字段 + 群通知含驳回原因", async () => {
    const ctx = createCtx({ withWebhook: true });
    const { appId, rec } = await seedPending(ctx);
    rec.fields["驳回原因"] = ""; // 底表已有该单选字段
    const res = await runApprovalAction(ctx.env, {
      type: "reimburse", appId, action: "reject",
      comment: "请修正后重提", reason: "内容事实错误",
      user: CAPTAIN, role: CAPTAIN_ROLE,
    });
    expect(res.status).toBe("已驳回");
    expect(rec.fields["驳回原因"]).toBe("内容事实错误");
    const text = String((ctx.webhookCalls[0].body.content as { text: string }).text);
    expect(text).toContain("❌ 已驳回");
    expect(text).toContain("驳回原因：内容事实错误");
    expect(text).toContain("审批意见：请修正后重提");
  });

  it("G-02：底表无「驳回原因」字段时 reject 带 reason 静默跳过，不影响动作", async () => {
    const ctx = createCtx({ withWebhook: true });
    const { appId, rec } = await seedPending(ctx); // 无驳回原因字段
    const res = await runApprovalAction(ctx.env, {
      type: "reimburse", appId, action: "reject",
      comment: "x", reason: "发布时间冲突",
      user: CAPTAIN, role: CAPTAIN_ROLE,
    });
    expect(res.status).toBe("已驳回");
    expect(rec.fields["驳回原因"]).toBeUndefined();
    const text = String((ctx.webhookCalls[0].body.content as { text: string }).text);
    expect(text).toContain("驳回原因：发布时间冲突");
  });

  it("start 仅申请人本人；单号不存在 → 404", async () => {
    const ctx = createCtx();
    const { appId, rec } = await seedPending(ctx);
    rec.fields["状态"] = "已通过";
    await expect(
      runApprovalAction(ctx.env, { type: "reimburse", appId, action: "start", user: CAPTAIN, role: CAPTAIN_ROLE }),
    ).rejects.toThrow("仅申请人本人");
    const res = await runApprovalAction(ctx.env, { type: "reimburse", appId, action: "start", user: MEMBER, role: MEMBER_ROLE });
    expect(res.status).toBe("加工中");
    await expect(
      runApprovalAction(ctx.env, { type: "reimburse", appId: "BX-2026-9999", action: "approve", user: CAPTAIN, role: CAPTAIN_ROLE }),
    ).rejects.toThrow("未找到申请单号");
  });

  it("onStatusChange：流转成功触发回调；幂等路径不触发；回调抛错不阻断动作", async () => {
    const ctx = createCtx();
    const { appId } = await seedPending(ctx);
    const calls: string[] = [];
    const onStatusChange = async (_env: Env, change: { status: string }) => { calls.push(change.status); };

    const res = await runApprovalAction(ctx.env, { type: "reimburse", appId, action: "approve", user: CAPTAIN, role: CAPTAIN_ROLE, onStatusChange });
    expect(res.status).toBe("已通过");
    expect(calls).toEqual(["已通过"]);

    // 幂等：目标状态=当前状态直接返回，不触发回调
    const again = await runApprovalAction(ctx.env, { type: "reimburse", appId, action: "approve", user: CAPTAIN, role: CAPTAIN_ROLE, onStatusChange });
    expect(again.status).toBe("已通过");
    expect(calls).toEqual(["已通过"]);

    // 回调抛错：动作照常成功，仅 console.error 留痕
    ctx.seed(TBL_REIMBURSE, { 申请单号: "BX-2026-0002", 状态: "审批中", 申请人: "张三" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = async () => { throw new Error("callback down"); };
    const res2 = await runApprovalAction(ctx.env, { type: "reimburse", appId: "BX-2026-0002", action: "approve", user: CAPTAIN, role: CAPTAIN_ROLE, onStatusChange: boom });
    expect(res2.status).toBe("已通过");
    expect(spy.mock.calls.some((c) => String(c[0]).includes("onStatusChange"))).toBe(true);
    spy.mockRestore();
  });
});

describe("POST /api/approvals/upload（R-01 凭证上传）", () => {
  function uploadReq(sid: string, files: Array<[string, File]>): Request {
    const fd = new FormData();
    for (const [k, f] of files) fd.append(k, f);
    return new Request("https://hub.test/api/approvals/upload", {
      method: "POST",
      headers: { cookie: `nec_session=${sid}` },
      body: fd,
    });
  }

  it("未登录 401；空表单 400；合法文件写 R2 receipts/ 并返回 key", async () => {
    const ctx = createCtx();
    const noAuth = await handleApprovalUpload(uploadReq("nope", [["receipt", new File(["x"], "f.jpg")]]), ctx.env);
    expect(noAuth.status).toBe(401);
    const empty = await handleApprovalUpload(uploadReq("sid-member", []), ctx.env);
    expect(empty.status).toBe(400);

    const res = await handleApprovalUpload(
      uploadReq("sid-member", [["receipt", new File(["abc"], "发票.jpg", { type: "image/jpeg" })]]),
      ctx.env,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; files: Array<{ field: string; key: string; size: number }> };
    expect(data.ok).toBe(true);
    expect(data.files[0].field).toBe("receipt");
    expect(data.files[0].key).toMatch(/^receipts\/\d{8}\/.+-发票\.jpg$/);
    expect(data.files[0].size).toBe(3);
    expect(ctx.env.APPS_BUCKET.put).toHaveBeenCalledTimes(1);
  });

  it("超过 10MB → 400，且不写 R2", async () => {
    const ctx = createCtx();
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" });
    const res = await handleApprovalUpload(uploadReq("sid-member", [["receipt", big]]), ctx.env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("10MB");
    expect(ctx.env.APPS_BUCKET.put).not.toHaveBeenCalled();
  });
});

describe("GET /api/approvals/mine（我的申请）", () => {
  it("未登录 401；按 open_id 过滤 + 提交时间降序 + 前 20 条", async () => {
    const ctx = createCtx();
    const noAuth = await handleApprovalMine(sessionReq("https://hub.test/api/approvals/mine", "nope"), ctx.env);
    expect(noAuth.status).toBe(401);

    ctx.seed(TBL_REIMBURSE, { 申请单号: "BX-2026-0001", 状态: "已通过", 事项: "旧", 金额: 50, 提交时间: 1000, 审批人: "张队", "申请人 open_id": "ou-member" });
    ctx.seed(TBL_REIMBURSE, { 申请单号: "BX-2026-0002", 状态: "审批中", 事项: "新", 金额: 80, 提交时间: 2000, "申请人 open_id": "ou-member" });
    ctx.seed(TBL_REIMBURSE, { 申请单号: "BX-2026-0003", 状态: "审批中", 事项: "别人的", 提交时间: 3000, "申请人 open_id": "ou-other" });

    const res = await handleApprovalMine(sessionReq("https://hub.test/api/approvals/mine?type=reimburse", "sid-member"), ctx.env);
    const data = (await res.json()) as { records: Array<{ application_id: string; status: string; fields: Record<string, unknown> }> };
    expect(data.records.map((r) => r.application_id)).toEqual(["BX-2026-0002", "BX-2026-0001"]);
    expect(data.records[0].fields["金额"]).toBe(80);
  });

  it("流程未配置 → 空列表 + hint；未知 type → 400", async () => {
    const ctx = createCtx();
    const res = await handleApprovalMine(sessionReq("https://hub.test/api/approvals/mine?type=drawing", "sid-member"), ctx.env);
    const data = (await res.json()) as { records: unknown[]; hint?: string };
    expect(data.records).toEqual([]);
    expect(data.hint).toBe("流程未配置");
    const bad = await handleApprovalMine(sessionReq("https://hub.test/api/approvals/mine?type=bad", "sid-member"), ctx.env);
    expect(bad.status).toBe(400);
  });
});

describe("config_flows（MCP 工具）", () => {
  it("无 MCP_TOKEN 拒绝；get 返回与默认值深合并的配置", async () => {
    const ctx = createCtx();
    await expect(toolConfigFlows({ action: "get" }, ctx.env, false)).rejects.toThrow("MCP_TOKEN");
    const res = await toolConfigFlows({ action: "get" }, ctx.env, true);
    const cfg = JSON.parse(res.content[0].text.replace("当前 flows:config：\n", ""));
    expect(cfg.reimburse.tableId).toBe(TBL_REIMBURSE);
    expect(cfg.drawing.prefix).toBe("MECH"); // 未覆盖部分取默认
  });

  it("set 深合并 + 校验（tableId 须 tbl 开头 / roles 须合法正则）并清待办缓存", async () => {
    const ctx = createCtx();
    ctx.kv.set(KV_KEYS.todoTable("reimburse"), "x");
    await expect(
      toolConfigFlows({ action: "set", flows: { reimburse: { tableId: "bad" } } }, ctx.env, true),
    ).rejects.toThrow("table_id 不合法");
    await expect(
      toolConfigFlows({ action: "set", flows: { reimburse: { approvers: { roles: "([" } } } }, ctx.env, true),
    ).rejects.toThrow("不是合法正则");
    const res = await toolConfigFlows({ action: "set", flows: { reimburse: { prefix: "BX2" } } }, ctx.env, true);
    expect(res.content[0].text).toContain("✅");
    const saved = (await getFlowsConfig(ctx.env)).reimburse;
    expect(saved.prefix).toBe("BX2");
    expect(saved.tableId).toBe(TBL_REIMBURSE); // 未传字段保留
    expect(ctx.kv.has(KV_KEYS.todoTable("reimburse"))).toBe(false);
  });
});

describe("notifyFeishu（群机器人通知）", () => {
  it("未配置 webhook → 降级返回不抛错", async () => {
    const ctx = createCtx();
    const res = await notifyFeishu(ctx.env, "reimburse", "t", "c");
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("未配置 webhook");
  });

  it("按流程分流：FEISHU_BOT_WEBHOOK_<FLOW> 优先于主 webhook", async () => {
    const ctx = createCtx({ withWebhook: true });
    (ctx.env as unknown as Record<string, string>).FEISHU_BOT_WEBHOOK_REIMBURSE = "https://open.feishu.cn/open-apis/bot/v2/hook/reimburse-special";
    const res = await notifyFeishu(ctx.env, "reimburse", "标题", "正文", "https://link");
    expect(res.ok).toBe(true);
    expect(ctx.webhookCalls[0].url).toContain("reimburse-special");
    const text = (ctx.webhookCalls[0].body.content as { text: string }).text;
    expect(text).toBe("标题\n正文\n去处理：https://link");
  });

  it("持续失败重试 2 次后写 KV notify:failed", async () => {
    vi.useFakeTimers();
    try {
      const ctx = createCtx({ withWebhook: true, webhookFailTimes: 99 });
      const p = notifyFeishu(ctx.env, "hardware", "t", "c");
      await vi.advanceTimersByTimeAsync(10_000);
      const res = await p;
      expect(res.ok).toBe(false);
      expect(res.detail).toContain("重试 2 次");
      expect(ctx.webhookFailTimes).toBe(3); // 首发 + 2 次重试
      const failed = JSON.parse(ctx.kv.get(KV_KEYS.notifyFailed)!);
      expect(failed[0].flow).toBe("hardware");
      expect(failed[0].detail).toContain("sign match fail");
    } finally {
      vi.useRealTimers();
    }
  });

  it("send_notice 工具：成功/降级两种文案", async () => {
    const ctx = createCtx({ withWebhook: true });
    const ok = await toolSendNotice({ flow: "reimburse", title: "t", content: "c" }, ctx.env, true);
    expect(ok.content[0].text).toContain("✅ 已发送");
    const ctx2 = createCtx();
    const degraded = await toolSendNotice({ flow: "reimburse", title: "t", content: "c" }, ctx2.env, true);
    expect(degraded.content[0].text).toContain("通知未送达");
    await expect(toolSendNotice({ flow: "x", title: "", content: "c" }, ctx.env, true)).rejects.toThrow("title 不能为空");
    await expect(toolSendNotice({ flow: "x", title: "t", content: "c" }, ctx.env, false)).rejects.toThrow("MCP_TOKEN");
  });
});

// ---------- Phase 0 引擎泛化：自定义状态机 / participant 守卫 / 会签 / pendingStates / serial digits ----------

describe("serial digits（单号补零位数可配）", () => {
  it("默认 4 位不变；digits=3 → HT-2026-001", async () => {
    const year = new Date().getFullYear();
    expect(formatSerial("BX", year, 1)).toBe(`BX-${year}-0001`);
    expect(formatSerial("HT", year, 1, 3)).toBe(`HT-${year}-001`);
    const m = new Map<string, string>();
    const counter: SerialCounter = { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } };
    expect(await consumeNextSerial(counter, "HT", year, 3)).toBe(`HT-${year}-001`);
    expect(await consumeNextSerial(counter, "HT", year, 3)).toBe(`HT-${year}-002`);
  });
});

describe("getFlowsConfig 新字段深合并", () => {
  it("machine/countersign 对象级合并，pendingStates 数组整体替换", async () => {
    const ctx = createCtx();
    ctx.kv.set(KV_KEYS.flowsConfig, JSON.stringify({
      drawing_review: { machine: { transitions: [{ action: "x", from: "a", to: "b" }] } },
      contract: { countersign: { approversField: "会签名单" }, pendingStates: ["in_review"] },
    }));
    const cfg = await getFlowsConfig(ctx.env);
    // machine 只覆盖 transitions，initial 保留默认
    expect(cfg.drawing_review.machine?.initial).toBe("pending_review");
    expect(cfg.drawing_review.machine?.transitions).toHaveLength(1);
    // countersign 覆盖字段名
    expect(cfg.contract.countersign?.approversField).toBe("会签名单");
    // pendingStates 整体替换
    expect(cfg.contract.pendingStates).toEqual(["in_review"]);
    // 未覆盖流程取默认
    expect(cfg.contract.machine?.initial).toBe("pending_approval");
    expect(cfg.drawing_review.pendingStates).toEqual(["pending_review", "in_review"]);
  });
});

describe("flow.machine 自定义状态机（drawing_review 英文状态）", () => {
  function setupDr(ctx: Ctx) {
    ctx.kv.set(KV_KEYS.flowsConfig, JSON.stringify({ drawing_review: { tableId: "tblDR", base: BASE } }));
  }

  it("提交落初始状态 pending_review + DR 单号；必填按模块字段校验", async () => {
    const ctx = createCtx();
    setupDr(ctx);
    await expect(
      submitApprovalCore(ctx.env, { type: "drawing_review", fields: { 机型名称: "6014" }, user: MEMBER, role: MEMBER_ROLE, source: "portal" }),
    ).rejects.toThrow("项目编号");
    const res = await submitApprovalCore(ctx.env, {
      type: "drawing_review",
      fields: { 项目编号: "P-6014", 机型名称: "6014 底盘", 图纸文件: [{ name: "plate.pdf" }] },
      user: MEMBER,
      role: MEMBER_ROLE,
      source: "portal",
    });
    expect(res.application_id).toMatch(/^DR-\d{4}-0001$/);
    expect(res.status).toBe("pending_review");
    expect(ctx.tables["tblDR"][0].fields["状态"]).toBe("pending_review");
  });

  it("按流程机流转（guard any 放行队员）；complete 双分支按 from 分派；未知动作 400；前置不符 409", async () => {
    const ctx = createCtx();
    setupDr(ctx);
    const rec = ctx.seed("tblDR", {
      申请单号: "DR-2026-0001", 状态: "pending_review", 申请人: "张三", "申请人 open_id": "ou-member", 机型名称: "X",
    });
    // guard "any"：普通队员即可驱动
    const r1 = await runApprovalAction(ctx.env, { type: "drawing_review", appId: "DR-2026-0001", action: "start_meeting", user: MEMBER, role: MEMBER_ROLE });
    expect(r1.status).toBe("in_review");
    const r2 = await runApprovalAction(ctx.env, { type: "drawing_review", appId: "DR-2026-0001", action: "conclude_conditional", user: MEMBER, role: MEMBER_ROLE });
    expect(r2.status).toBe("rectifying");
    // complete 第一分支：rectifying → bom_generating
    const r3 = await runApprovalAction(ctx.env, { type: "drawing_review", appId: "DR-2026-0001", action: "complete", user: MEMBER, role: MEMBER_ROLE });
    expect(r3.status).toBe("bom_generating");
    // complete 第二分支：procuring → archived
    rec.fields["状态"] = "procuring";
    const r4 = await runApprovalAction(ctx.env, { type: "drawing_review", appId: "DR-2026-0001", action: "complete", user: MEMBER, role: MEMBER_ROLE });
    expect(r4.status).toBe("archived");
    // 幂等：已 archived 再 complete → already
    const again = await runApprovalAction(ctx.env, { type: "drawing_review", appId: "DR-2026-0001", action: "complete", user: MEMBER, role: MEMBER_ROLE });
    expect(again.status).toBe("archived");
    // 前置不符 → 409；全局机动作在本流程 → 400
    await expect(
      runApprovalAction(ctx.env, { type: "drawing_review", appId: "DR-2026-0001", action: "start_meeting", user: MEMBER, role: MEMBER_ROLE }),
    ).rejects.toThrow("不能执行 start_meeting");
    await expect(
      runApprovalAction(ctx.env, { type: "drawing_review", appId: "DR-2026-0001", action: "approve", user: CAPTAIN, role: CAPTAIN_ROLE }),
    ).rejects.toThrow("不支持动作 approve");
  });
});

describe("contract 会签（countersign + participant 守卫 + HT 三位单号）", () => {
  const APPROVERS = JSON.stringify([
    { approverId: "ou-a", name: "王审", status: "pending" },
    { approverId: "ou-b", name: "李审", status: "pending" },
  ]);
  const REVIEWER_A = { name: "王审", open_id: "ou-a" };
  const REVIEWER_B = { name: "李审", open_id: "ou-b" };

  function setupCt(ctx: Ctx) {
    ctx.kv.set(KV_KEYS.flowsConfig, JSON.stringify({ contract: { tableId: "tblCT", base: BASE } }));
  }
  async function seedInReview(ctx: Ctx): Promise<BitableRecord> {
    const rec = ctx.seed("tblCT", {
      申请单号: "HT-2026-001", 状态: "in_review", 申请人: "张三", "申请人 open_id": "ou-member",
      合同名称: "采购合同", 审批人: APPROVERS,
    });
    return rec;
  }

  it("提交：HT 三位单号 + 初始 pending_approval；缺审批人名单/金额非正数被拦", async () => {
    const ctx = createCtx();
    setupCt(ctx);
    await expect(
      submitApprovalCore(ctx.env, {
        type: "contract",
        fields: { 合同名称: "x", 合同金额: 100, 合同文件: "f.pdf" },
        user: MEMBER, role: MEMBER_ROLE, source: "portal",
      }),
    ).rejects.toThrow("审批人");
    await expect(
      submitApprovalCore(ctx.env, {
        type: "contract",
        fields: { 合同名称: "x", 合同金额: 0, 合同文件: "f.pdf", 审批人: APPROVERS },
        user: MEMBER, role: MEMBER_ROLE, source: "portal",
      }),
    ).rejects.toThrow("合同金额（须大于 0）");
    const res = await submitApprovalCore(ctx.env, {
      type: "contract",
      fields: { 合同名称: "采购合同", 合同金额: 5000, 合同文件: "c.pdf", 审批人: APPROVERS },
      user: MEMBER, role: MEMBER_ROLE, source: "portal",
    });
    expect(res.application_id).toMatch(/^HT-\d{4}-001$/);
    expect(res.status).toBe("pending_approval");
  });

  it("participant 守卫：非参与人 403；名单内审批人可 start_review", async () => {
    const ctx = createCtx();
    setupCt(ctx);
    ctx.seed("tblCT", {
      申请单号: "HT-2026-001", 状态: "pending_approval", 申请人: "张三", "申请人 open_id": "ou-member", 审批人: APPROVERS,
    });
    await expect(
      runApprovalAction(ctx.env, { type: "contract", appId: "HT-2026-001", action: "start_review", user: CAPTAIN, role: CAPTAIN_ROLE }),
    ).rejects.toThrow("仅该单参与人");
    const res = await runApprovalAction(ctx.env, { type: "contract", appId: "HT-2026-001", action: "start_review", user: REVIEWER_A, role: MEMBER_ROLE });
    expect(res.status).toBe("in_review");
  });

  it("会签：未全员通过状态不变（只写名单字段）；全员通过才流转；重复审批 409；非名单成员 403", async () => {
    const ctx = createCtx();
    setupCt(ctx);
    const rec = await seedInReview(ctx);
    // 第一人通过：状态不变，名单落个人意见
    const r1 = await runApprovalAction(ctx.env, { type: "contract", appId: "HT-2026-001", action: "approve", comment: "同意", user: REVIEWER_A, role: MEMBER_ROLE });
    expect(r1.status).toBe("in_review");
    expect(rec.fields["状态"]).toBe("in_review");
    const list1 = JSON.parse(String(rec.fields["审批人"])) as Array<{ approverId: string; status: string; comment?: string; actedAt?: string }>;
    expect(list1[0].status).toBe("approved");
    expect(list1[0].comment).toBe("同意");
    expect(list1[0].actedAt).toBeTruthy();
    expect(list1[1].status).toBe("pending");
    // 重复审批 → 409；非名单成员 → 403
    await expect(
      runApprovalAction(ctx.env, { type: "contract", appId: "HT-2026-001", action: "approve", user: REVIEWER_A, role: MEMBER_ROLE }),
    ).rejects.toThrow("已提交过审批意见");
    await expect(
      runApprovalAction(ctx.env, { type: "contract", appId: "HT-2026-001", action: "approve", user: MEMBER, role: MEMBER_ROLE }),
    ).rejects.toThrow(); // 申请人本人过 participant 守卫，但不是会签审批人
    // 第二人通过：全员通过 → 流转 approved；审批人字段仍是 JSON（未被姓名覆盖）
    const r2 = await runApprovalAction(ctx.env, { type: "contract", appId: "HT-2026-001", action: "approve", user: REVIEWER_B, role: MEMBER_ROLE });
    expect(r2.status).toBe("approved");
    expect(rec.fields["状态"]).toBe("approved");
    const list2 = JSON.parse(String(rec.fields["审批人"])) as Array<{ status: string }>;
    expect(list2.every((a) => a.status === "approved")).toBe(true);
  });

  it("会签 reject：名单成员驳回即流转 rejected 并落个人意见", async () => {
    const ctx = createCtx();
    setupCt(ctx);
    const rec = await seedInReview(ctx);
    const res = await runApprovalAction(ctx.env, { type: "contract", appId: "HT-2026-001", action: "reject", comment: "条款有误", user: REVIEWER_B, role: MEMBER_ROLE });
    expect(res.status).toBe("rejected");
    const list = JSON.parse(String(rec.fields["审批人"])) as Array<{ approverId: string; status: string; comment?: string }>;
    expect(list[1]).toMatchObject({ approverId: "ou-b", status: "rejected", comment: "条款有误" });
  });
});

describe("pendingStates（待办聚合 / SLA 判定）", () => {
  function setupDr(ctx: Ctx) {
    ctx.kv.set(KV_KEYS.flowsConfig, JSON.stringify({ drawing_review: { tableId: "tblDR", base: BASE } }));
  }

  it("aggregateTodos：pending_review + in_review 进待办，archived 不进", async () => {
    const ctx = createCtx();
    setupDr(ctx);
    // 预置 todo:tbl 缓存（等价于一次全表扫描后的待审批子集缓存），避免 search mock 单值限制
    const records = [
      { record_id: "r1", fields: { 申请单号: "DR-2026-0001", 状态: "pending_review", 机型名称: "A", 提交时间: 1000 } },
      { record_id: "r2", fields: { 申请单号: "DR-2026-0002", 状态: "in_review", 机型名称: "B", 提交时间: 2000 } },
      { record_id: "r3", fields: { 申请单号: "DR-2026-0003", 状态: "archived", 机型名称: "C", 提交时间: 3000 } },
    ];
    ctx.kv.set(KV_KEYS.todoTable("drawing_review"), JSON.stringify({ data: records, cachedAt: Date.now() }));
    const todos = (await aggregateTodos(ctx.env, CAPTAIN_ROLE)) as { by_type: Record<string, Array<{ application_id: string }>> };
    expect(todos.by_type.drawing_review?.map((r) => r.application_id)).toEqual(["DR-2026-0001", "DR-2026-0002"]);
  });

  it("fetchFlowRecordsCached：search 下推 filter 带完整 pendingStates", async () => {
    const ctx = createCtx();
    setupDr(ctx);
    ctx.seed("tblDR", { 申请单号: "DR-2026-0001", 状态: "pending_review", 机型名称: "A" });
    await fetchFlowRecordsCached(ctx.env, "drawing_review");
    const fetchMock = vi.mocked(fetch);
    const searchCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/records/search"));
    expect(searchCall).toBeTruthy();
    const body = JSON.parse(String((searchCall![1] as { body: string }).body)) as { filter: { conditions: Array<{ field_name: string; value: string[] }> } };
    expect(body.filter.conditions[0].field_name).toBe("状态");
    expect(body.filter.conditions[0].value).toEqual(["pending_review", "in_review"]);
  });

  it("SLA：pendingStates 状态超时升级提醒，其他状态不动", async () => {
    const ctx = createCtx({ withWebhook: true });
    ctx.kv.set(KV_KEYS.flowsConfig, JSON.stringify({
      drawing_review: { tableId: "tblDR", base: BASE, sla: { escalateHours: 1, autoCancelDays: 0, escalateTo: "队长" } },
    }));
    ctx.seed("tblDR", { 申请单号: "DR-2026-0001", 状态: "pending_review", 申请人: "张三", 提交时间: Date.now() - 2 * 3600e3 });
    ctx.seed("tblDR", { 申请单号: "DR-2026-0002", 状态: "archived", 申请人: "张三", 提交时间: Date.now() - 2 * 3600e3 });
    const summary = await runApprovalSla(ctx.env);
    expect(summary.escalated).toBe(1);
    const texts = ctx.webhookCalls.map((c) => String((c.body.content as { text?: string })?.text ?? ""));
    expect(texts.some((t) => t.includes("审批超时提醒 DR-2026-0001"))).toBe(true);
    expect(texts.some((t) => t.includes("DR-2026-0002"))).toBe(false);
  });
});

describe("config_flows 新字段校验", () => {
  it("machine/countersign/pendingStates/serialDigits 非法输入被拦，合法写入生效", async () => {
    const ctx = createCtx();
    await expect(
      toolConfigFlows({ action: "set", flows: { drawing_review: { machine: { transitions: [{ action: "a", from: "x" }] } } } }, ctx.env, true),
    ).rejects.toThrow("machine.transitions 项不合法");
    await expect(
      toolConfigFlows({ action: "set", flows: { contract: { machine: { transitions: [{ action: "a", from: "x", to: "y", guard: "root" }] } } } }, ctx.env, true),
    ).rejects.toThrow("guard 不合法");
    await expect(
      toolConfigFlows({ action: "set", flows: { contract: { countersign: {} } } }, ctx.env, true),
    ).rejects.toThrow("countersign 不合法");
    await expect(
      toolConfigFlows({ action: "set", flows: { contract: { pendingStates: ["ok", 1] } } }, ctx.env, true),
    ).rejects.toThrow("pendingStates 不合法");
    await expect(
      toolConfigFlows({ action: "set", flows: { contract: { serialDigits: 0 } } }, ctx.env, true),
    ).rejects.toThrow("serialDigits 不合法");
    const res = await toolConfigFlows({ action: "set", flows: { contract: { pendingStates: ["in_review"], serialDigits: 3 } } }, ctx.env, true);
    expect(res.content[0].text).toContain("✅");
    const saved = (await getFlowsConfig(ctx.env)).contract;
    expect(saved.pendingStates).toEqual(["in_review"]);
    expect(saved.serialDigits).toBe(3);
  });
});
