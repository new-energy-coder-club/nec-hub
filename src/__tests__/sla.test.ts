/**
 * G-03 审批时效治理测试（PRD V1.2 §5）
 *
 * 覆盖：48h 升级提醒（KV 幂等）· 14 天自动取消（状态机外直接改「已取消」+ 清升级标记 + 缓存回写）
 * sla 配 0 关闭 · 提交时间为空的脏数据跳过 · config_flows 非法 sla 校验拦截 · sla 默认值深合并
 *
 * mock 风格沿用 approvals.test.ts：内存 KV + fetch 路由（bitable records CRUD + 群机器人 webhook）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BitableRecord } from "../feishu/bitable";
import { getFlowsConfig } from "../approvals/flows";
import { runApprovalSla } from "../approvals/sla";
import { toolConfigFlows } from "../approvals/handlers";

const BASE = "appMockBase";
const TBL = "tblReimburse";

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

interface Ctx {
  env: Env;
  kv: Map<string, string>;
  tables: Record<string, BitableRecord[]>;
  webhookCalls: Array<{ url: string; body: Record<string, unknown> }>;
  seed(fields: Record<string, unknown>, recordId?: string): BitableRecord;
  webhookTexts(): string[];
}

function createCtx(flowsPatch?: Record<string, unknown>): Ctx {
  const kv = new Map<string, string>();
  const tables: Record<string, BitableRecord[]> = {};
  const webhookCalls: Ctx["webhookCalls"] = [];
  let seq = 0;

  kv.set("flows:config", JSON.stringify({ reimburse: { tableId: TBL, base: BASE, ...(flowsPatch ?? {}) } }));

  const ctx: Ctx = {
    kv,
    tables,
    webhookCalls,
    env: undefined as unknown as Env,
    seed(fields, recordId) {
      const rec: BitableRecord = { record_id: recordId ?? `rec-${++seq}`, fields };
      (tables[TBL] ??= []).push(rec);
      return rec;
    },
    webhookTexts() {
      return webhookCalls.map((c) => String((c.body.content as { text?: string })?.text ?? ""));
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
    const method = (init?.method ?? "GET").toUpperCase();
    const items = (tables[tableId] ??= []);
    if (method === "GET") return jsonResp({ code: 0, data: { items, has_more: false } });
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
        if (key === "feishu:tenant_access_token") return { token: "mock-token", expireAt: Date.now() + 3600e3 };
        const v = kv.get(key);
        return v == null ? null : type === "json" ? JSON.parse(v) : v;
      }),
      put: vi.fn(async (key: string, value: string) => { kv.set(key, value); }),
      delete: vi.fn(async (key: string) => { kv.delete(key); }),
    },
    FEISHU_APP_ID: "mock-app-id",
    FEISHU_APP_SECRET: "mock-app-secret",
    FEISHU_BOT_WEBHOOK: "https://open.feishu.cn/open-apis/bot/v2/hook/abc",
  } as unknown as Env;
  return ctx;
}

function pendingRecord(appId: string, ageMs: number): Record<string, unknown> {
  return {
    申请单号: appId,
    申请人: "张三",
    状态: "审批中",
    提交时间: Date.now() - ageMs,
    事项: "测试事项",
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("G-03 时效巡检 runApprovalSla", () => {
  it("超 48h 审批中 → 升级提醒 + KV 标记；再触发不重复提醒", async () => {
    const ctx = createCtx();
    ctx.seed(pendingRecord("BX-2026-0001", 49 * 3600e3));

    const s1 = await runApprovalSla(ctx.env);
    expect(s1.escalated).toBe(1);
    expect(s1.cancelled).toBe(0);
    const texts = ctx.webhookTexts();
    expect(texts.some((t) => t.includes("审批超时提醒 BX-2026-0001"))).toBe(true);
    expect(texts.some((t) => t.includes("已等待 49 小时"))).toBe(true);
    expect(texts.some((t) => t.includes("队长|财务 + 队长"))).toBe(true);
    expect(texts.some((t) => t.includes("天后将自动取消"))).toBe(true);
    // 有动作 → 主群汇总
    expect(texts.some((t) => t.includes("时效巡检") && t.includes("升级提醒 1 条"))).toBe(true);
    expect(ctx.kv.has("approval:esc:BX-2026-0001")).toBe(true);

    // 再触发：KV 标记在 → 不重复提醒
    const before = ctx.webhookCalls.length;
    const s2 = await runApprovalSla(ctx.env);
    expect(s2.escalated).toBe(0);
    expect(ctx.webhookCalls.length).toBe(before);
  });

  it("超 14 天审批中 → 状态改「已取消」+ 通知 + 清升级标记；再扫描不重复处理", async () => {
    const ctx = createCtx();
    const rec = ctx.seed(pendingRecord("BX-2026-0002", 15 * 86400e3));
    ctx.kv.set("approval:esc:BX-2026-0002", "{}");

    const s1 = await runApprovalSla(ctx.env);
    expect(s1.cancelled).toBe(1);
    expect(rec.fields["状态"]).toBe("已取消");
    const texts = ctx.webhookTexts();
    expect(texts.some((t) => t.includes("已自动取消 BX-2026-0002"))).toBe(true);
    expect(texts.some((t) => t.includes("申请人：张三"))).toBe(true);
    expect(ctx.kv.has("approval:esc:BX-2026-0002")).toBe(false);

    // 再扫描：状态已变且缓存已回写 → 无任何动作
    const before = ctx.webhookCalls.length;
    const s2 = await runApprovalSla(ctx.env);
    expect(s2.cancelled).toBe(0);
    expect(ctx.webhookCalls.length).toBe(before);
  });

  it("sla.escalateHours=0 不升级提醒；autoCancelDays=0 不自动取消", async () => {
    const ctx = createCtx({ sla: { escalateHours: 0, autoCancelDays: 0 } });
    ctx.seed(pendingRecord("BX-2026-0003", 30 * 86400e3));
    const s = await runApprovalSla(ctx.env);
    expect(s.escalated).toBe(0);
    expect(s.cancelled).toBe(0);
    expect(ctx.webhookCalls.length).toBe(0);
  });

  it("提交时间为空的脏数据行跳过且不动状态", async () => {
    const ctx = createCtx();
    const rec = ctx.seed({ 申请单号: "BX-2026-0004", 申请人: "张三", 状态: "审批中", 事项: "脏数据" });
    const s = await runApprovalSla(ctx.env);
    expect(s.skipped).toBe(1);
    expect(s.escalated + s.cancelled).toBe(0);
    expect(rec.fields["状态"]).toBe("审批中");
    expect(ctx.webhookCalls.length).toBe(0);
  });

  it("已通过/已驳回的单不触碰", async () => {
    const ctx = createCtx();
    const done = ctx.seed({ ...pendingRecord("BX-2026-0005", 30 * 86400e3), 状态: "已通过" });
    const s = await runApprovalSla(ctx.env);
    expect(s.escalated + s.cancelled + s.skipped).toBe(0);
    expect(done.fields["状态"]).toBe("已通过");
    expect(ctx.webhookCalls.length).toBe(0);
  });
});

describe("G-03 sla 配置", () => {
  it("flows:config 无 sla 段时深合并出默认值（48h / 14 天 / 队长）", async () => {
    const ctx = createCtx();
    const cfg = await getFlowsConfig(ctx.env);
    expect(cfg.reimburse.sla).toEqual({ escalateHours: 48, autoCancelDays: 14, escalateTo: "队长" });
    expect(cfg.compliance.sla?.autoCancelDays).toBe(14);
  });

  it("config_flows set 带非法 sla（负数 / 非对象）被校验拦截", async () => {
    const ctx = createCtx();
    await expect(
      toolConfigFlows({ action: "set", flows: { reimburse: { sla: { escalateHours: -1 } } } }, ctx.env, true),
    ).rejects.toThrow(/sla\.escalateHours 不合法/);
    await expect(
      toolConfigFlows({ action: "set", flows: { reimburse: { sla: 48 } } }, ctx.env, true),
    ).rejects.toThrow(/sla 不合法/);
    // 合法 sla（含 0 关闭）可通过
    const res = await toolConfigFlows(
      { action: "set", flows: { reimburse: { sla: { escalateHours: 0, autoCancelDays: 7, escalateTo: "队长" } } } },
      ctx.env,
      true,
    );
    expect(String(res.content[0].text)).toContain("已保存");
    const saved = JSON.parse(ctx.kv.get("flows:config")!) as { reimburse: { sla: Record<string, unknown> } };
    expect(saved.reimburse.sla).toEqual({ escalateHours: 0, autoCancelDays: 7, escalateTo: "队长" });
  });
});
