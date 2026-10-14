/**
 * 流程看板（PRD §3.12）
 * 覆盖：状态计数、阻塞预警规则（超时阈值 / 询价未报价 / 缺料）、甘特图组装、降级。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrawingReviewAdapter } from "../drawing-review/adapter";
import { handleDrawingReview } from "../drawing-review";
import { BoardService } from "../drawing-review/board.service";
import { createDrMock, DR_TABLES, hoursAgo, type DrMockCtx } from "./dr-test-utils";

const NOW = Date.parse("2026-10-14T08:00:00.000Z");

function makeService(ctx: DrMockCtx, tables?: Record<string, string>) {
  return new BoardService(new DrawingReviewAdapter(ctx.env, {
    base: "appMockBase",
    tables: tables ?? { ...DR_TABLES },
    updatedAt: new Date().toISOString(),
  }));
}

function seedReviews(ctx: DrMockCtx) {
  ctx.seed(DR_TABLES.reviews, { 评审单号: "DR-1", 机型名称: "机A", 状态: "pending_review", 创建时间: hoursAgo(200, NOW), 更新时间: hoursAgo(100, NOW) });
  ctx.seed(DR_TABLES.reviews, { 评审单号: "DR-2", 机型名称: "机B", 状态: "rectifying", 创建时间: hoursAgo(60, NOW), 更新时间: hoursAgo(50, NOW) });
  ctx.seed(DR_TABLES.reviews, { 评审单号: "DR-3", 机型名称: "机C", 状态: "rectifying", 创建时间: hoursAgo(90, NOW), 更新时间: hoursAgo(80, NOW) });
  ctx.seed(DR_TABLES.reviews, { 评审单号: "DR-4", 机型名称: "机D", 状态: "in_review", 创建时间: hoursAgo(300, NOW), 更新时间: hoursAgo(10, NOW) });
  ctx.seed(DR_TABLES.reviews, { 评审单号: "DR-5", 机型名称: "机E", 状态: "archived", 创建时间: hoursAgo(400, NOW), 更新时间: hoursAgo(1, NOW) });
}

function seedEvents(ctx: DrMockCtx) {
  const ev = (reviewId: string, action: string, hours: number, toStatus?: string) =>
    ctx.seed(DR_TABLES.events, { 关联评审单: [reviewId], 操作人: "ou-x", 动作: action, 新状态: toStatus, 操作时间: hoursAgo(hours, NOW) });
  ev("DR-4", "submit", 300);
  ev("DR-4", "start_meeting", 200);
  ev("DR-4", "conclude", 100);
  ev("DR-4", "generated", 50);
  ev("DR-5", "submit", 400);
  ev("DR-5", "complete", 1, "archived");
}

function seedInquiries(ctx: DrMockCtx) {
  ctx.seed(DR_TABLES.inquiries, { 询价单号: "INQ-OLD", 关联评审单: ["DR-4"], 关联物料: "item-1", 物料名称: "伺服电机", 供应商: "甲", 需求数量: 2, 状态: "sent", 创建时间: hoursAgo(100, NOW) });
  ctx.seed(DR_TABLES.inquiries, { 询价单号: "INQ-NEW", 关联评审单: ["DR-4"], 关联物料: "item-2", 物料名称: "联轴器", 供应商: "乙", 需求数量: 4, 状态: "sent", 创建时间: hoursAgo(10, NOW) });
  ctx.seed(DR_TABLES.inquiries, { 询价单号: "INQ-QUOTED", 关联评审单: ["DR-4"], 关联物料: "item-1", 物料名称: "伺服电机", 供应商: "丙", 需求数量: 2, 状态: "quoted", 报价: 99, 创建时间: hoursAgo(100, NOW) });
}

function seedInventory(ctx: DrMockCtx) {
  ctx.seed(DR_TABLES.inventory, { 关联评审单: ["DR-4"], 库存状态: "无库存", 物料名称: "轴承" });
  ctx.seed(DR_TABLES.inventory, { 关联评审单: ["DR-2"], 库存状态: "充足", 物料名称: "螺丝" });
}

describe("BoardService.build", () => {
  let ctx: DrMockCtx;

  beforeEach(() => {
    ctx = createDrMock();
    seedReviews(ctx);
    seedEvents(ctx);
    seedInquiries(ctx);
    seedInventory(ctx);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("状态计数正确", async () => {
    const data = await makeService(ctx).build(NOW);
    expect(data.statusCounts).toEqual({
      pending_review: 1,
      rectifying: 2,
      in_review: 1,
      archived: 1,
    });
    expect(data.warnings).toEqual([]);
  });

  it("待评审超 48h 触发预警，未超时不触发", async () => {
    const data = await makeService(ctx).build(NOW);
    const hit = data.blockers.filter((b) => b.ruleId === "pending_review_timeout");
    expect(hit).toHaveLength(1);
    expect(hit[0].reviewId).toBe("DR-1");
    expect(hit[0].hoursBlocked).toBe(100);
  });

  it("待整改以 72h 为阈值：80h 触发、50h 不触发", async () => {
    const data = await makeService(ctx).build(NOW);
    const hits = data.blockers.filter((b) => b.ruleId === "rectifying_timeout");
    expect(hits.map((b) => b.reviewId)).toEqual(["DR-3"]);
  });

  it("询价发出超 72h 未报价触发预警；已报价与新发出的不触发", async () => {
    const data = await makeService(ctx).build(NOW);
    const hits = data.blockers.filter((b) => b.ruleId === "inquiry_no_quote");
    expect(hits).toHaveLength(1);
    expect(hits[0].reviewId).toBe("DR-4");
    expect(hits[0].message).toContain("INQ-OLD");
    expect(hits[0].message).toContain("伺服电机");
  });

  it("库存状态=无库存/不足 的评审单触发缺料预警", async () => {
    const data = await makeService(ctx).build(NOW);
    const hits = data.blockers.filter((b) => b.ruleId === "material_shortage");
    expect(hits).toHaveLength(1);
    expect(hits[0].reviewId).toBe("DR-4");
    expect(hits[0].message).toContain("轴承");
  });

  it("甘特图：进行中评审单的关键节点来自 events 时间戳，已归档不出现", async () => {
    const data = await makeService(ctx).build(NOW);
    const ids = data.gantt.map((g) => g.reviewId);
    expect(ids).not.toContain("DR-5");
    expect(ids).toEqual(expect.arrayContaining(["DR-1", "DR-2", "DR-3", "DR-4"]));

    const dr4 = data.gantt.find((g) => g.reviewId === "DR-4")!;
    expect(dr4.milestones.submit).toBe(hoursAgo(300, NOW));
    expect(dr4.milestones.meeting).toBe(hoursAgo(200, NOW));
    expect(dr4.milestones.conclusion).toBe(hoursAgo(100, NOW));
    expect(dr4.milestones.bom).toBe(hoursAgo(50, NOW));
    expect(dr4.milestones.archived).toBeUndefined();

    // 无事件的评审单回退用创建时间作为提交节点
    const dr1 = data.gantt.find((g) => g.reviewId === "DR-1")!;
    expect(dr1.milestones.submit).toBe(hoursAgo(200, NOW));
  });

  it("飞书读取失败时降级：返回空区块 + warnings，不抛错", async () => {
    const broken = createDrMock({ failTables: [DR_TABLES.reviews, DR_TABLES.inquiries] });
    seedEvents(broken);
    const data = await makeService(broken).build(NOW);
    expect(data.statusCounts).toEqual({});
    expect(data.blockers).toEqual([]);
    expect(data.warnings.join()).toContain("评审单读取失败");
    expect(data.warnings.join()).toContain("询价单读取失败");
  });

  it("库存表未配置时仅告警不阻断", async () => {
    const noInv = createDrMock({ omitTables: ["inventory"] });
    seedReviews(noInv);
    const tablesNoInv = Object.fromEntries(Object.entries(DR_TABLES).filter(([k]) => k !== "inventory"));
    const data = await makeService(noInv, tablesNoInv).build(NOW);
    expect(data.statusCounts.pending_review).toBe(1);
    expect(data.warnings.join()).toContain("库存表读取失败");
  });
});

describe("GET /api/drawing-review/board 路由", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("登录后返回看板聚合（board 不会被当作评审单号）", async () => {
    const ctx = createDrMock({ session: { sid: "sid-board", openId: "ou-1", name: "用户" } });
    seedReviews(ctx);
    const res = await handleDrawingReview(
      new Request("http://localhost/api/drawing-review/board", { headers: { cookie: "nec_session=sid-board" } }),
      ctx.env,
      "/api/drawing-review/board",
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { statusCounts: Record<string, number>; gantt: unknown[] };
    expect(body.statusCounts.pending_review).toBe(1);
    expect(Array.isArray(body.gantt)).toBe(true);
  });

  it("未登录返回 401", async () => {
    const ctx = createDrMock();
    const res = await handleDrawingReview(
      new Request("http://localhost/api/drawing-review/board"),
      ctx.env,
      "/api/drawing-review/board",
    );
    expect(res!.status).toBe(401);
  });
});
