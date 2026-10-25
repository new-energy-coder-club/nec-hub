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
    listReviews: vi.fn().mockResolvedValue([stored]),
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

  it("历史版本全部非法时保留 drawing 的 V0.1 与 hardware 的 V1.0 回退差异", async () => {
    const drawingAdapter = makeAdapter({ ...makeDrawingReview("archived"), drawingVersion: "invalid" });
    const hardwareAdapter = makeAdapter({ ...makeHardwareReview("archived"), hardwareVersion: "invalid" });
    const drawing = new DrawingReviewFlowService(makeEnv(), drawingAdapter as any);
    const hardware = new HardwareReviewFlowService(makeEnv(), hardwareAdapter as any);

    const [drawingDefaults, hardwareDefaults] = await Promise.all([
      drawing.getDefaultSubmissionValues(
        { projectId: "PRJ-001", machineName: "R1 底盘", drawingFiles: [] },
        "ou-designer",
      ),
      hardware.getDefaultSubmissionValues(
        { projectId: "PRJ-001", hardwareName: "主控板", hardwareFiles: [] },
        "ou-designer",
      ),
    ]);

    expect(drawingDefaults.drawingVersion).toBe("V0.1");
    expect(hardwareDefaults.hardwareVersion).toBe("V1.0");
  });
});
