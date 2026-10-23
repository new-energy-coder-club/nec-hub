/**
 * 询价单流转与比价（PRD §3.11）
 * 覆盖：generate 幂等、quote 状态流转、compare 比价规则与 select 联动、compare 权限。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrawingReviewAdapter } from "../drawing-review/adapter";
import { handleDrawingReview } from "../drawing-review";
import { COMPARE_RULES, InquiryService } from "../drawing-review/inquiry.service";
import { KV_KEYS } from "../shared/kv-keys";
import { createDrMock, DR_TABLES, type DrMockCtx } from "./dr-test-utils";

const NOW = Date.parse("2026-10-14T08:00:00.000Z");

function seedBom(ctx: DrMockCtx) {
  ctx.seed(DR_TABLES.bom, { 关联评审单: ["DR-1"], BOM编号: "BOM-DR-1", 版本: "1.0", 状态: "draft" }, "rec-bom-head");
  ctx.seed(DR_TABLES.bom, { 关联BOM: ["BOM-DR-1"], 物料编码: "M-001", 物料名称: "伺服电机", 规格型号: "AK10-9", 数量: 2, 单位: "台", 来源: "purchased" }, "rec-item-1");
  ctx.seed(DR_TABLES.bom, { 关联BOM: ["BOM-DR-1"], 物料编码: "M-002", 物料名称: "联轴器", 规格型号: "LK-20", 数量: 4, 单位: "个", 来源: "standard" }, "rec-item-2");
  ctx.seed(DR_TABLES.bom, { 关联BOM: ["BOM-DR-1"], 物料编码: "M-003", 物料名称: "安装支架", 规格型号: "", 数量: 1, 单位: "件", 来源: "self-made" }, "rec-item-3");
}

describe("InquiryService.generate", () => {
  let ctx: DrMockCtx;
  let svc: InquiryService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    ctx = createDrMock();
    seedBom(ctx);
    svc = new InquiryService(ctx.env, new DrawingReviewAdapter(ctx.env, {
      base: "appMockBase",
      tables: { ...DR_TABLES },
      updatedAt: new Date().toISOString(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("只为外购/标准件物料生成询价单，自制件跳过", async () => {
    const { created, skipped } = await svc.generate("DR-1", { requiredDate: "2026-11-01" }, "ou-user");
    expect(created).toHaveLength(2);
    expect(skipped).toHaveLength(0);
    for (const inq of created) {
      expect(inq.status).toBe("sent");
      expect(inq.inquiryId).toMatch(/^INQ-\d{8}-\d{3}$/);
      expect(inq.requiredDate).toBe("2026-11-01");
      expect(inq.reviewId).toBe("DR-1");
    }
    const names = created.map((c) => c.materialName).sort();
    expect(names).toEqual(["伺服电机", "联轴器"].sort());
  });

  it("未传需求日期时默认取当天", async () => {
    const { created } = await svc.generate("DR-1", {}, "ou-user");
    const d = new Date(NOW);
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(expected).toBe("2026-10-14");
    for (const inq of created) {
      expect(inq.requiredDate).toBe(expected);
    }
  });

  it("按推荐供应商列表为同一物料生成多张询价单", async () => {
    const { created } = await svc.generate(
      "DR-1",
      { requiredDate: "2026-11-01", suppliers: { "M-001": ["甲供应商", "乙供应商", "丙供应商"] } },
      "ou-user",
    );
    expect(created).toHaveLength(4);
    const m1 = created.filter((c) => c.materialCode === "M-001");
    expect(m1.map((c) => c.supplierName).sort()).toEqual(["丙供应商", "甲供应商", "乙供应商"].sort());
  });

  it("重复生成幂等：已存在的物料被跳过", async () => {
    const first = await svc.generate("DR-1", {}, "ou-user");
    expect(first.created).toHaveLength(2);
    const second = await svc.generate("DR-1", {}, "ou-user");
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toHaveLength(2);
    const all = ctx.tables[DR_TABLES.inquiries] ?? [];
    expect(all).toHaveLength(2);
  });

  it("BOM 不存在时报错", async () => {
    await expect(svc.generate("DR-404", {}, "ou-user")).rejects.toThrow(/尚无 BOM/);
  });

  it("生成动作写入事件日志", async () => {
    await svc.generate("DR-1", {}, "ou-user");
    const events = (ctx.tables[DR_TABLES.events] ?? []).map((r) => r.fields["动作"]);
    expect(events).toContain("inquiry_generate");
  });
});

describe("InquiryService.quote", () => {
  let ctx: DrMockCtx;
  let svc: InquiryService;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    ctx = createDrMock();
    seedBom(ctx);
    svc = new InquiryService(ctx.env, new DrawingReviewAdapter(ctx.env, {
      base: "appMockBase",
      tables: { ...DR_TABLES },
      updatedAt: new Date().toISOString(),
    }));
    await svc.generate("DR-1", { requiredDate: "2026-11-01" }, "ou-user");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("报价回填：sent → quoted，写入供应商/报价/交期", async () => {
    const list = await svc.compare("DR-1", undefined, "ou-user");
    const target = list.materials.flatMap((m) => m.quotes)[0];
    const updated = await svc.quote(target.inquiryId, { supplier: "甲供应商", price: 100, deliveryDate: "2026-10-20" }, "ou-supplier");
    expect(updated.status).toBe("quoted");
    expect(updated.supplierName).toBe("甲供应商");
    expect(updated.price).toBe(100);
    expect(updated.deliveryDate).toBe("2026-10-20");
    const events = (ctx.tables[DR_TABLES.events] ?? []).map((r) => r.fields["动作"]);
    expect(events).toContain("inquiry_quote");
  });

  it("非 sent 状态不允许重复报价", async () => {
    const list = await svc.compare("DR-1", undefined, "ou-user");
    const target = list.materials.flatMap((m) => m.quotes)[0];
    await svc.quote(target.inquiryId, { supplier: "甲", price: 100 }, "ou-a");
    await expect(svc.quote(target.inquiryId, { supplier: "乙", price: 90 }, "ou-b")).rejects.toThrow(/不允许报价/);
  });

  it("询价单不存在 / 报价非法时报错", async () => {
    await expect(svc.quote("INQ-00000000-000", { supplier: "甲", price: 100 }, "ou-a")).rejects.toThrow(/不存在/);
    const list = await svc.compare("DR-1", undefined, "ou-user");
    const target = list.materials.flatMap((m) => m.quotes)[0];
    await expect(svc.quote(target.inquiryId, { supplier: "甲", price: 0 }, "ou-a")).rejects.toThrow(/大于 0/);
    await expect(svc.quote(target.inquiryId, { supplier: "", price: 100 }, "ou-a")).rejects.toThrow(/供应商名称必填/);
  });
});

describe("InquiryService.compare", () => {
  let ctx: DrMockCtx;
  let svc: InquiryService;
  let idsBySupplier: Record<string, string>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    ctx = createDrMock();
    seedBom(ctx);
    svc = new InquiryService(ctx.env, new DrawingReviewAdapter(ctx.env, {
      base: "appMockBase",
      tables: { ...DR_TABLES },
      updatedAt: new Date().toISOString(),
    }));
    const { created } = await svc.generate(
      "DR-1",
      { requiredDate: "2026-11-01", suppliers: { "M-001": ["甲", "乙", "丙"] } },
      "ou-user",
    );
    idsBySupplier = Object.fromEntries(created.filter((c) => c.materialCode === "M-001").map((c) => [c.supplierName, c.inquiryId]));
    // 甲：价 100、交期满足；乙：价 90 但交期超需求日期；丙：价 110、交期最短
    await svc.quote(idsBySupplier["甲"], { supplier: "甲", price: 100, deliveryDate: "2026-10-20" }, "ou-a");
    await svc.quote(idsBySupplier["乙"], { supplier: "乙", price: 90, deliveryDate: "2026-11-05" }, "ou-b");
    await svc.quote(idsBySupplier["丙"], { supplier: "丙", price: 110, deliveryDate: "2026-10-15" }, "ou-c");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("比价规则：价格优先，超期报价按惩罚系数折算", async () => {
    const result = await svc.compare("DR-1", undefined, "ou-user");
    const m1 = result.materials.find((m) => m.materialCode === "M-001");
    expect(m1).toBeDefined();
    // 乙最低价、丙最短交期；但乙折算价 90×1.2=108 > 甲 100 → 推荐甲
    expect(m1!.lowestPriceInquiryId).toBe(idsBySupplier["乙"]);
    expect(m1!.shortestDeliveryInquiryId).toBe(idsBySupplier["丙"]);
    expect(m1!.recommendedInquiryId).toBe(idsBySupplier["甲"]);
    const quoteYi = m1!.quotes.find((q) => q.inquiryId === idsBySupplier["乙"]);
    expect(quoteYi!.late).toBe(true);
    expect(quoteYi!.score).toBeCloseTo(90 * COMPARE_RULES.lateDeliveryPenalty);
  });

  it("select 联动：选中置 selected，同物料其余报价置 rejected", async () => {
    const result = await svc.compare("DR-1", { "M-001": idsBySupplier["甲"] }, "ou-pm");
    expect(result.selected).toEqual([idsBySupplier["甲"]]);

    const adapter = new DrawingReviewAdapter(ctx.env, { base: "appMockBase", tables: { ...DR_TABLES }, updatedAt: "" });
    const all = await adapter.listInquiries("DR-1");
    const byId = Object.fromEntries(all.map((i) => [i.inquiryId, i.status]));
    expect(byId[idsBySupplier["甲"]]).toBe("selected");
    expect(byId[idsBySupplier["乙"]]).toBe("rejected");
    expect(byId[idsBySupplier["丙"]]).toBe("rejected");

    const events = (ctx.tables[DR_TABLES.events] ?? []).map((r) => r.fields["动作"]);
    expect(events).toContain("inquiry_select");
  });

  it("选定未报价或不存在物料的询价单时报错", async () => {
    const adapter = new DrawingReviewAdapter(ctx.env, { base: "appMockBase", tables: { ...DR_TABLES }, updatedAt: "" });
    const all = await adapter.listInquiries("DR-1");
    const sentOne = all.find((i) => i.materialCode === "M-002")!; // 未报价
    await expect(svc.compare("DR-1", { "M-002": sentOne.inquiryId }, "ou-pm")).rejects.toThrow(/尚未报价/);
    await expect(svc.compare("DR-1", { "M-999": idsBySupplier["甲"] }, "ou-pm")).rejects.toThrow(/没有询价单/);
    await expect(svc.compare("DR-1", { "M-002": idsBySupplier["甲"] }, "ou-pm")).rejects.toThrow(/不属于物料/);
  });
});

describe("询价路由权限（compare/select 需 队长/采购/项目经理）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function seedQuotedInquiry(ctx: DrMockCtx) {
    ctx.seed(DR_TABLES.inquiries, {
      询价单号: "INQ-A", 关联评审单: ["DR-1"], 关联物料: "item-1", 物料编码: "M-001",
      物料名称: "伺服电机", 供应商: "甲", 需求数量: 2, 报价: 100, 交期: "2026-10-20", 状态: "quoted",
      创建时间: new Date(NOW - 10 * 3600e3).toISOString(),
    }, "rec-inq-a");
  }

  function seedMembers(ctx: DrMockCtx, openId: string, role: string) {
    ctx.kv.set(KV_KEYS.dashboardConfig, JSON.stringify({ base: "appMockBase", tables: { members: "tblMembers" }, updatedAt: "" }));
    ctx.seed("tblMembers", { open_id: openId, 姓名: "测试用户", 权限角色: role }, "rec-member-1");
  }

  function compareRequest(body: unknown, sid: string) {
    return new Request("http://localhost/api/drawing-review/DR-1/inquiries/compare", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `nec_session=${sid}` },
      body: JSON.stringify(body),
    });
  }

  it("普通队员执行 select 被 403 拒绝，且数据未被修改", async () => {
    const ctx = createDrMock({ session: { sid: "sid-member", openId: "ou-member", name: "测试用户" } });
    seedQuotedInquiry(ctx);
    seedMembers(ctx, "ou-member", "队员");

    const res = await handleDrawingReview(compareRequest({ selections: { "M-001": "INQ-A" } }, "sid-member"), ctx.env, "/api/drawing-review/DR-1/inquiries/compare");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const rec = ctx.tables[DR_TABLES.inquiries][0];
    expect(rec.fields["状态"]).toBe("quoted");
  });

  it("队长执行 select 成功", async () => {
    const ctx = createDrMock({ session: { sid: "sid-lead", openId: "ou-lead", name: "测试用户" } });
    seedQuotedInquiry(ctx);
    seedMembers(ctx, "ou-lead", "队长");

    const res = await handleDrawingReview(compareRequest({ selections: { "M-001": "INQ-A" } }, "sid-lead"), ctx.env, "/api/drawing-review/DR-1/inquiries/compare");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { selected: string[] };
    expect(body.selected).toEqual(["INQ-A"]);
    expect(ctx.tables[DR_TABLES.inquiries][0].fields["状态"]).toBe("selected");
  });

  it("未登录访问询价接口返回 401", async () => {
    const ctx = createDrMock();
    const res = await handleDrawingReview(
      new Request("http://localhost/api/drawing-review/DR-1/inquiries"),
      ctx.env,
      "/api/drawing-review/DR-1/inquiries",
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("名单表未配置/未匹配时不再降级，select 一律 403", async () => {
    const ctx = createDrMock({ session: { sid: "sid-any", openId: "ou-any", name: "任意用户" } });
    seedQuotedInquiry(ctx);
    const res = await handleDrawingReview(compareRequest({ selections: { "M-001": "INQ-A" } }, "sid-any"), ctx.env, "/api/drawing-review/DR-1/inquiries/compare");
    expect(res!.status).toBe(403);
    expect(ctx.tables[DR_TABLES.inquiries][0].fields["状态"]).toBe("quoted");
  });
});

describe("询价路由权限（quote 报价回填需 队长/采购/项目经理）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function seedSentInquiry(ctx: DrMockCtx) {
    ctx.seed(DR_TABLES.inquiries, {
      询价单号: "INQ-A", 关联评审单: ["DR-1"], 关联物料: "item-1", 物料编码: "M-001",
      物料名称: "伺服电机", 需求数量: 2, 状态: "sent",
      创建时间: new Date(NOW - 10 * 3600e3).toISOString(),
    }, "rec-inq-a");
  }

  function seedMembers(ctx: DrMockCtx, openId: string, role: string) {
    ctx.kv.set(KV_KEYS.dashboardConfig, JSON.stringify({ base: "appMockBase", tables: { members: "tblMembers" }, updatedAt: "" }));
    ctx.seed("tblMembers", { open_id: openId, 姓名: "测试用户", 权限角色: role }, "rec-member-1");
  }

  function quoteRequest(sid: string) {
    return new Request("http://localhost/api/drawing-review/inquiries/INQ-A/quote", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `nec_session=${sid}` },
      body: JSON.stringify({ supplier: "甲供应商", price: 100, deliveryDate: "2026-10-20" }),
    });
  }

  it("普通队员报价回填被 403 拒绝，且数据未被修改", async () => {
    const ctx = createDrMock({ session: { sid: "sid-member", openId: "ou-member", name: "测试用户" } });
    seedSentInquiry(ctx);
    seedMembers(ctx, "ou-member", "队员");

    const res = await handleDrawingReview(quoteRequest("sid-member"), ctx.env, "/api/drawing-review/inquiries/INQ-A/quote");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const rec = ctx.tables[DR_TABLES.inquiries][0];
    expect(rec.fields["状态"]).toBe("sent");
    expect(rec.fields["报价"]).toBeUndefined();
  });

  it("名单表未配置/未匹配时报价回填同样 403", async () => {
    const ctx = createDrMock({ session: { sid: "sid-any", openId: "ou-any", name: "任意用户" } });
    seedSentInquiry(ctx);
    const res = await handleDrawingReview(quoteRequest("sid-any"), ctx.env, "/api/drawing-review/inquiries/INQ-A/quote");
    expect(res!.status).toBe(403);
    expect(ctx.tables[DR_TABLES.inquiries][0].fields["状态"]).toBe("sent");
  });

  it("采购角色报价回填成功", async () => {
    const ctx = createDrMock({ session: { sid: "sid-buyer", openId: "ou-buyer", name: "测试用户" } });
    seedSentInquiry(ctx);
    seedMembers(ctx, "ou-buyer", "采购");

    const res = await handleDrawingReview(quoteRequest("sid-buyer"), ctx.env, "/api/drawing-review/inquiries/INQ-A/quote");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const rec = ctx.tables[DR_TABLES.inquiries][0];
    expect(rec.fields["状态"]).toBe("quoted");
    expect(rec.fields["报价"]).toBe(100);
  });
});
