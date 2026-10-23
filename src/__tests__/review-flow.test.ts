import { describe, expect, it, vi } from "vitest";
import {
  TRANSITIONS as DRAWING_TRANSITIONS,
  ReviewFlowService as DrawingReviewFlowService,
  nextStatus as drawingNextStatus,
} from "../drawing-review/flow.service";
import type { DrawingReview, ReviewStatus as DrawingReviewStatus } from "../drawing-review/types";
import {
  TRANSITIONS as HARDWARE_TRANSITIONS,
  ReviewFlowService as HardwareReviewFlowService,
  nextStatus as hardwareNextStatus,
} from "../hardware-review/flow.service";
import type { HardwareReview, ReviewStatus as HardwareReviewStatus } from "../hardware-review/types";
import type { ReviewIssue } from "../shared/types";

function expectTransitions<S extends string>(
  transitions: Record<S, Partial<Record<string, S>>>,
  next: (current: S, event: string) => S | null,
) {
  for (const state of Object.keys(transitions) as S[]) {
    for (const [event, target] of Object.entries(transitions[state])) {
      expect(next(state, event)).toBe(target);
    }
    expect(next(state, "unknown_event")).toBeNull();
  }
}

function makeDrawingReview(status: DrawingReviewStatus): DrawingReview {
  return {
    reviewId: "DR-001",
    projectId: "PRJ-001",
    machineName: "R1 底盘",
    drawingVersion: "V1.0",
    designerId: "ou-designer",
    drawingFiles: [{ name: "drawing.pdf", token: "r2/drawing.pdf" }],
    designNotes: "设计说明",
    status,
    createdAt: "2026-10-24T00:00:00.000Z",
    updatedAt: "2026-10-24T00:00:00.000Z",
  };
}

function makeHardwareReview(status: HardwareReviewStatus): HardwareReview {
  return {
    reviewId: "HR-001",
    projectId: "PRJ-001",
    hardwareName: "主控板",
    hardwareType: "controller",
    hardwareVersion: "V1.0",
    designerId: "ou-designer",
    hardwareFiles: [{ name: "sch.pdf", token: "r2/sch.pdf" }],
    designNotes: "设计说明",
    specification: "24V",
    status,
    createdAt: "2026-10-24T00:00:00.000Z",
    updatedAt: "2026-10-24T00:00:00.000Z",
  };
}

function makeAdapter<R extends { reviewId: string }>(review: R) {
  const stored = { ...review, recordId: `rec-${review.reviewId}` };
  return {
    findReviewById: vi.fn().mockResolvedValue(stored),
    updateReview: vi.fn().mockImplementation(async (_recordId: string, patch: Partial<R>) => ({ ...stored, ...patch })),
    createRecord: vi.fn().mockResolvedValue({ record_id: "rec-event", fields: {} }),
  };
}

function makeEnv(): Env {
  return {
    REGISTRY: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Env;
}

function fieldsFor(adapter: ReturnType<typeof makeAdapter>, table: string): Record<string, unknown> {
  const call = adapter.createRecord.mock.calls.find(([name]) => name === table);
  expect(call).toBeDefined();
  return call![1] as Record<string, unknown>;
}

describe("共享评审流程行为对比", () => {
  it("TRANSITIONS 与 nextStatus 保留两模块各自状态表", () => {
    expect(DRAWING_TRANSITIONS).toEqual({
      draft: { submit: "pending_review" },
      pending_review: { start_meeting: "in_review" },
      in_review: {
        conclude_passed: "bom_generating",
        conclude_conditional: "rectifying",
        conclude_rejected: "draft",
      },
      rectifying: { complete: "bom_generating", re_review: "pending_review" },
      bom_generating: { generated: "assessing" },
      assessing: { pass: "scheduling", fail: "draft" },
      scheduling: { confirm: "procuring" },
      procuring: { complete: "archived" },
      archived: {},
    });
    expect(HARDWARE_TRANSITIONS).toEqual({
      draft: { submit: "pending_review" },
      pending_review: { start_meeting: "in_review" },
      in_review: {
        conclude_passed: "report_generating",
        conclude_conditional: "rectifying",
        conclude_rejected: "draft",
      },
      rectifying: { complete: "report_generating", re_review: "pending_review" },
      report_generating: { generated: "assessing" },
      assessing: { pass: "approved", fail: "draft" },
      approved: { archive: "archived" },
      archived: {},
    });
    expectTransitions(DRAWING_TRANSITIONS, drawingNextStatus);
    expectTransitions(HARDWARE_TRANSITIONS, hardwareNextStatus);
  });

  it("共享状态机支持同一事件在不同前置状态流向不同目标", async () => {
    const { createReviewStateMachine } = await import("../shared/review-flow");
    const machine = createReviewStateMachine<"a" | "b" | "c">({
      a: { complete: "b" },
      b: { complete: "c" },
      c: {},
    });

    expect(machine.next("a", "complete")).toBe("b");
    expect(machine.next("b", "complete")).toBe("c");
    expect(machine.next("c", "complete")).toBeNull();
    expect(machine.toTransitionMap()).toEqual({ a: { complete: "b" }, b: { complete: "c" }, c: {} });
  });

  it("conclude 对同输入产生同构更新、整改项和事件字段", async () => {
    const drawingAdapter = makeAdapter(makeDrawingReview("in_review"));
    const hardwareAdapter = makeAdapter(makeHardwareReview("in_review"));
    const drawing = new DrawingReviewFlowService(makeEnv(), drawingAdapter as any);
    const hardware = new HardwareReviewFlowService(makeEnv(), hardwareAdapter as any);
    const issue: ReviewIssue = {
      issueId: "ISS-001",
      description: "补充急停回路",
      raisedBy: { open_id: "ou-raiser" },
      owner: { open_id: "ou-owner" },
      dueDate: "2026-11-01",
      severity: "high",
      status: "open",
    };
    const input = { conclusion: "conditional" as const, notes: "整改后通过", issues: [issue] };

    const [drawingResult, hardwareResult] = await Promise.all([
      drawing.conclude("DR-001", input, "ou-lead"),
      hardware.conclude("HR-001", input, "ou-lead"),
    ]);

    expect(drawingResult.status).toBe("rectifying");
    expect(hardwareResult.status).toBe("rectifying");
    for (const [adapter, recordId] of [[drawingAdapter, "rec-DR-001"], [hardwareAdapter, "rec-HR-001"]] as const) {
      expect(adapter.updateReview).toHaveBeenCalledWith(
        recordId,
        expect.objectContaining({ status: "rectifying", conclusion: "conditional", conclusionNotes: "整改后通过" }),
      );
    }

    const commonRectification = {
      问题描述: "补充急停回路",
      提出人: "ou-raiser",
      责任人: "ou-owner",
      截止日期: "2026-11-01",
      完成状态: "未完成",
    };
    expect(fieldsFor(drawingAdapter, "rectifications")).toEqual({ 关联评审单: "DR-001", ...commonRectification });
    expect(fieldsFor(hardwareAdapter, "rectifications")).toEqual({ 关联评审单: "HR-001", ...commonRectification });

    for (const [adapter, reviewId] of [[drawingAdapter, "DR-001"], [hardwareAdapter, "HR-001"]] as const) {
      expect(fieldsFor(adapter, "events")).toEqual(
        expect.objectContaining({
          关联评审单: reviewId,
          操作人: "ou-lead",
          动作: "conclude",
          原状态: "in_review",
          新状态: "rectifying",
          附加信息: JSON.stringify({ conclusion: "conditional" }),
          操作时间: expect.any(String),
        }),
      );
    }
  });

  it("completeRectification 保留各自目标状态与同构事件映射", async () => {
    const drawingAdapter = makeAdapter(makeDrawingReview("rectifying"));
    const hardwareAdapter = makeAdapter(makeHardwareReview("rectifying"));
    const drawing = new DrawingReviewFlowService(makeEnv(), drawingAdapter as any);
    const hardware = new HardwareReviewFlowService(makeEnv(), hardwareAdapter as any);

    const [drawingResult, hardwareResult] = await Promise.all([
      drawing.completeRectification("DR-001", "ou-lead"),
      hardware.completeRectification("HR-001", "ou-lead"),
    ]);

    expect(drawingResult.status).toBe("bom_generating");
    expect(hardwareResult.status).toBe("report_generating");
    for (const [adapter, reviewId, recordId, next] of [
      [drawingAdapter, "DR-001", "rec-DR-001", "bom_generating"],
      [hardwareAdapter, "HR-001", "rec-HR-001", "report_generating"],
    ] as const) {
      expect(adapter.updateReview).toHaveBeenCalledWith(
        recordId,
        expect.objectContaining({ status: next, updatedAt: expect.any(String) }),
      );
      expect(adapter.createRecord).toHaveBeenCalledTimes(1);
      expect(fieldsFor(adapter, "events")).toEqual(
        expect.objectContaining({
          关联评审单: reviewId,
          操作人: "ou-lead",
          动作: "complete_rectification",
          原状态: "rectifying",
          新状态: next,
          附加信息: "",
          操作时间: expect.any(String),
        }),
      );
    }
  });
});
