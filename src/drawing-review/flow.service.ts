/**
 * 新增机图纸评审流程 — 主流程编排服务（状态机）
 */

import type { BaseAdapter } from "./adapter";
import type {
  Assessment,
  BOM,
  BOMItem,
  DrawingReview,
  Inquiry,
  ReviewConclusion,
  ReviewIssue,
  ReviewMinutes,
  ReviewStatus,
} from "./types";

export const TRANSITIONS: Record<ReviewStatus, Partial<Record<string, ReviewStatus>>> = {
  draft: { submit: "pending_review" },
  pending_review: { start_meeting: "in_review" },
  in_review: {
    conclude_passed: "bom_generating",
    conclude_conditional: "rectifying",
    conclude_rejected: "draft",
  },
  rectifying: {
    complete: "bom_generating",
    re_review: "pending_review",
  },
  bom_generating: { generated: "assessing" },
  assessing: {
    pass: "scheduling",
    fail: "draft",
  },
  scheduling: { confirm: "procuring" },
  procuring: { complete: "archived" },
  archived: {},
};

export function nextStatus(current: ReviewStatus, event: string): ReviewStatus | null {
  return TRANSITIONS[current]?.[event] ?? null;
}

export function generateReviewId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(100 + Math.random() * 900);
  return `DR-${date}-${rand}`;
}

export interface SubmitReviewInput {
  projectId: string;
  machineName: string;
  drawingVersion: string;
  designerId: string;
  drawingFiles: DrawingReview["drawingFiles"];
  designNotes: string;
}

export interface MeetingInput {
  topic?: string;
  startTime: string;
  durationMinutes?: number;
  attendeeOpenIds: string[];
}

export interface ConclusionInput {
  conclusion: ReviewConclusion;
  notes?: string;
  issues?: ReviewIssue[];
}

export class ReviewFlowService {
  constructor(
    private env: Env,
    private adapter: BaseAdapter,
  ) {}

  async submit(input: SubmitReviewInput, actorId: string): Promise<DrawingReview & { recordId: string }> {
    const review: DrawingReview = {
      reviewId: generateReviewId(),
      projectId: input.projectId,
      machineName: input.machineName,
      drawingVersion: input.drawingVersion,
      designerId: input.designerId,
      drawingFiles: input.drawingFiles,
      designNotes: input.designNotes,
      status: "pending_review",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const saved = await this.adapter.createReview(review);
    await this.logEvent(saved.reviewId, actorId, "submit", "draft", "pending_review", { recordId: saved.recordId });
    return saved;
  }

  async startMeeting(reviewId: string, actorId: string): Promise<DrawingReview & { recordId: string }> {
    const review = await this.requireReview(reviewId);
    const next = nextStatus(review.status, "start_meeting");
    if (!next) throw new Error(`当前状态 ${review.status} 不允许开始会议`);
    const updated = await this.adapter.updateReview(review.recordId, { status: next, updatedAt: new Date().toISOString() });
    await this.logEvent(reviewId, actorId, "start_meeting", review.status, next);
    return updated;
  }

  async saveMinutes(
    reviewId: string,
    minutes: Omit<ReviewMinutes, "minutesId" | "reviewId">,
    actorId: string,
  ): Promise<ReviewMinutes & { recordId: string }> {
    const review = await this.requireReview(reviewId);
    if (review.status !== "in_review" && review.status !== "pending_review") {
      throw new Error("只能在评审中或待评审状态下保存会议纪要");
    }
    const fullMinutes: ReviewMinutes = {
      minutesId: `MIN-${reviewId}-${Date.now()}`,
      reviewId,
      ...minutes,
    };
    const saved = await this.adapter.createMinutes(fullMinutes);
    await this.logEvent(reviewId, actorId, "save_minutes", review.status, review.status, { minutesId: saved.minutesId });
    return saved;
  }

  async conclude(reviewId: string, input: ConclusionInput, actorId: string): Promise<DrawingReview & { recordId: string }> {
    const review = await this.requireReview(reviewId);
    if (review.status !== "in_review") throw new Error("只能在评审中状态下提交评审结论");

    const eventMap: Record<ReviewConclusion, string> = {
      passed: "conclude_passed",
      conditional: "conclude_conditional",
      rejected: "conclude_rejected",
    };
    const next = nextStatus(review.status, eventMap[input.conclusion]);
    if (!next) throw new Error(`结论 ${input.conclusion} 无法驱动状态流转`);

    const update: Partial<DrawingReview> = {
      status: next,
      conclusion: input.conclusion,
      conclusionNotes: input.notes,
      updatedAt: new Date().toISOString(),
    };
    const updated = await this.adapter.updateReview(review.recordId, update);
    await this.logEvent(reviewId, actorId, "conclude", review.status, next, { conclusion: input.conclusion });

    // 有条件通过时创建整改项
    if (input.conclusion === "conditional" && input.issues && input.issues.length > 0) {
      for (const issue of input.issues) {
        await this.adapter.createRecord("rectifications", {
          关联评审单: [reviewId],
          问题描述: issue.description,
          提出人: issue.raisedBy.open_id,
          责任人: issue.owner?.open_id,
          截止日期: issue.dueDate,
          完成状态: "未完成",
        });
      }
    }

    return updated;
  }

  async completeRectification(reviewId: string, actorId: string): Promise<DrawingReview & { recordId: string }> {
    const review = await this.requireReview(reviewId);
    const next = nextStatus(review.status, "complete");
    if (!next) throw new Error(`当前状态 ${review.status} 不允许完成整改`);
    // TODO: 校验所有整改项已关闭
    const updated = await this.adapter.updateReview(review.recordId, { status: next, updatedAt: new Date().toISOString() });
    await this.logEvent(reviewId, actorId, "complete_rectification", review.status, next);
    return updated;
  }

  async transitionTo(reviewId: string, event: string, actorId: string, payload?: Record<string, unknown>): Promise<DrawingReview & { recordId: string }> {
    const review = await this.requireReview(reviewId);
    const next = nextStatus(review.status, event);
    if (!next) throw new Error(`当前状态 ${review.status} 不允许事件 ${event}`);
    const updated = await this.adapter.updateReview(review.recordId, { status: next, updatedAt: new Date().toISOString() });
    await this.logEvent(reviewId, actorId, event, review.status, next, payload);
    return updated;
  }

  async getReview(reviewId: string): Promise<(DrawingReview & { recordId: string }) | null> {
    return this.adapter.findReviewById(reviewId);
  }

  async listReviews(): Promise<Array<DrawingReview & { recordId: string }>> {
    return this.adapter.listReviews();
  }

  private async requireReview(reviewId: string): Promise<DrawingReview & { recordId: string }> {
    const review = await this.adapter.findReviewById(reviewId);
    if (!review) throw new Error(`评审单 ${reviewId} 不存在`);
    return review;
  }

  private async logEvent(
    reviewId: string,
    actorId: string,
    action: string,
    fromStatus?: ReviewStatus,
    toStatus?: ReviewStatus,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.adapter.createRecord("events", {
        关联评审单: [reviewId],
        操作人: actorId,
        动作: action,
        原状态: fromStatus,
        新状态: toStatus,
        附加信息: payload ? JSON.stringify(payload) : "",
        操作时间: new Date().toISOString(),
      });
    } catch (err) {
      // 事件日志失败不应阻断主流程
      console.error("[drawing-review] log event failed:", err);
    }
  }
}
