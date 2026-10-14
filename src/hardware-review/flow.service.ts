/**
 * 硬件评审流程 — 主流程编排服务（状态机）
 *
 * 状态机与 drawing-review 同构，末段简化：
 *   评审通过 → 生成评审报告 → 评估 → 通过（approved）→ 归档
 */

import type { HardwareReviewAdapter } from "./adapter";
import type {
  HardwareReview,
  HardwareType,
  ReviewConclusion,
  ReviewIssue,
  ReviewMinutes,
  ReviewStatus,
} from "./types";

export const TRANSITIONS: Record<ReviewStatus, Partial<Record<string, ReviewStatus>>> = {
  draft: { submit: "pending_review" },
  pending_review: { start_meeting: "in_review" },
  in_review: {
    conclude_passed: "report_generating",
    conclude_conditional: "rectifying",
    conclude_rejected: "draft",
  },
  rectifying: {
    complete: "report_generating",
    re_review: "pending_review",
  },
  report_generating: { generated: "assessing" },
  assessing: {
    pass: "approved",
    fail: "draft",
  },
  approved: { archive: "archived" },
  archived: {},
};

export function nextStatus(current: ReviewStatus, event: string): ReviewStatus | null {
  return TRANSITIONS[current]?.[event] ?? null;
}

export function generateReviewId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(100 + Math.random() * 900);
  return `HR-${date}-${rand}`;
}

/** 硬件版本号格式（V主.次），模块级共享避免循环内重复编译 */
const VERSION_RE = /^V(\d+)\.(\d+)$/;

export interface SubmitReviewInput {
  projectId?: string;
  hardwareName?: string;
  hardwareType?: HardwareType;
  hardwareVersion?: string;
  designerId?: string;
  hardwareFiles: HardwareReview["hardwareFiles"];
  designNotes?: string;
  specification?: string;
}

export interface ConclusionInput {
  conclusion: ReviewConclusion;
  notes?: string;
  issues?: ReviewIssue[];
}

export class ReviewFlowService {
  constructor(
    private env: Env,
    private adapter: HardwareReviewAdapter,
  ) {}

  /**
   * 提交前智能默认填充：缺省版本号按同项目同硬件递增，设计说明套用模板
   */
  async getDefaultSubmissionValues(input: SubmitReviewInput, actorId: string, prefs?: Record<string, unknown>): Promise<Partial<SubmitReviewInput>> {
    const resolvedPrefs = prefs ?? (await this.getUserPreferences(actorId));

    const designerId = input.designerId || (resolvedPrefs.defaultDesignerId as string) || actorId;

    let hardwareVersion = input.hardwareVersion;
    if (!hardwareVersion) {
      try {
        const reviews = await this.adapter.listReviews();
        if (input.projectId && input.hardwareName) {
          const sameHardware = reviews.filter(
            (r) => r.projectId === input.projectId && r.hardwareName === input.hardwareName,
          );
          const latest = sameHardware.reduce<(typeof sameHardware)[number] | null>((acc, cur) => {
            const m = cur.hardwareVersion?.match(VERSION_RE);
            if (!m) return acc;
            if (!acc) return cur;
            const am = acc.hardwareVersion?.match(VERSION_RE);
            if (!am) return cur;
            const curMajor = Number(m[1]);
            const curMinor = Number(m[2]);
            const accMajor = Number(am[1]);
            const accMinor = Number(am[2]);
            return curMajor > accMajor || (curMajor === accMajor && curMinor > accMinor) ? cur : acc;
          }, null);
          const m = latest?.hardwareVersion?.match(VERSION_RE);
          if (m) hardwareVersion = `V${Number(m[1])}.${Number(m[2]) + 1}`;
        }
      } catch (err) {
        console.warn("[hardware-review] failed to resolve latest version:", err);
      }
      if (!hardwareVersion) hardwareVersion = (resolvedPrefs.lastUsedVersion as string) || "V1.0";
    }

    return {
      projectId: input.projectId || (resolvedPrefs.defaultProjectId as string) || "",
      hardwareName: input.hardwareName || (resolvedPrefs.defaultHardwareName as string) || "",
      hardwareType: input.hardwareType || "other",
      hardwareVersion,
      designerId,
      designNotes: input.designNotes || this.defaultDesignNotesTemplate(),
      specification: input.specification || "",
    };
  }

  private defaultDesignNotesTemplate(): string {
    return `【硬件设计说明模板】\n\n1. 设计背景与目标：\n2. 关键规格参数（电压/电流/功率/接口/防护等级）：\n3. 选型理由与替代方案：\n4. 安全与可靠性考虑：\n5. 测试验证计划：\n6. 相关文档与标准：\n`;
  }

  private async getUserPreferences(actorId: string): Promise<Record<string, unknown>> {
    try {
      const prefs = await this.env.REGISTRY.get(`user-prefs:hw:${actorId}`);
      if (prefs) return JSON.parse(prefs) as Record<string, unknown>;
    } catch (err) {
      console.warn("[hardware-review] failed to get user preferences:", err);
    }
    return { defaultDesignerId: actorId, lastUsedVersion: "V1.0" };
  }

  private async saveUserPreferences(actorId: string, prefs: Record<string, unknown>): Promise<void> {
    try {
      await this.env.REGISTRY.put(`user-prefs:hw:${actorId}`, JSON.stringify(prefs));
    } catch (err) {
      console.warn("[hardware-review] failed to save user preferences:", err);
    }
  }

  async submit(input: SubmitReviewInput, actorId: string): Promise<HardwareReview & { recordId: string }> {
    // 偏好读取一次，供默认值填充与提交后回写共用（避免重复 KV 读）
    const prefs = await this.getUserPreferences(actorId);
    const defaults = await this.getDefaultSubmissionValues(input, actorId, prefs);

    const review: HardwareReview = {
      reviewId: generateReviewId(),
      projectId: defaults.projectId || "",
      hardwareName: defaults.hardwareName || "",
      hardwareType: defaults.hardwareType || "other",
      hardwareVersion: defaults.hardwareVersion || "V1.0",
      designerId: defaults.designerId || actorId,
      hardwareFiles: input.hardwareFiles,
      designNotes: defaults.designNotes || "",
      specification: defaults.specification || "",
      status: "pending_review",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (!review.projectId || !review.hardwareName || !review.hardwareFiles || review.hardwareFiles.length === 0) {
      throw new Error("项目编号、硬件名称和硬件资料为必填项");
    }

    const saved = await this.adapter.createReview(review);
    await this.logEvent(saved.reviewId, actorId, "submit", "draft", "pending_review", { recordId: saved.recordId });

    try {
      if (input.projectId) prefs.defaultProjectId = input.projectId;
      if (input.hardwareName) prefs.defaultHardwareName = input.hardwareName;
      if (input.hardwareVersion) prefs.lastUsedVersion = input.hardwareVersion;
      await this.saveUserPreferences(actorId, prefs);
    } catch (err) {
      console.warn("[hardware-review] failed to save preferences after submission:", err);
    }

    return saved;
  }

  async startMeeting(reviewId: string, actorId: string): Promise<HardwareReview & { recordId: string }> {
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

  async conclude(reviewId: string, input: ConclusionInput, actorId: string): Promise<HardwareReview & { recordId: string }> {
    const review = await this.requireReview(reviewId);
    if (review.status !== "in_review") throw new Error("只能在评审中状态下提交评审结论");

    const eventMap: Record<ReviewConclusion, string> = {
      passed: "conclude_passed",
      conditional: "conclude_conditional",
      rejected: "conclude_rejected",
    };
    const next = nextStatus(review.status, eventMap[input.conclusion]);
    if (!next) throw new Error(`结论 ${input.conclusion} 无法驱动状态流转`);

    const updated = await this.adapter.updateReview(review.recordId, {
      status: next,
      conclusion: input.conclusion,
      conclusionNotes: input.notes,
      updatedAt: new Date().toISOString(),
    });
    await this.logEvent(reviewId, actorId, "conclude", review.status, next, { conclusion: input.conclusion });

    // 有条件通过时创建整改项（相互独立，并行写入）
    if (input.conclusion === "conditional" && input.issues && input.issues.length > 0) {
      await Promise.all(
        input.issues.map((issue) =>
          this.adapter.createRecord("rectifications", {
            关联评审单: reviewId,
            问题描述: issue.description,
            提出人: issue.raisedBy.open_id,
            责任人: issue.owner?.open_id,
            截止日期: issue.dueDate,
            完成状态: "未完成",
          }),
        ),
      );
    }

    return updated;
  }

  async completeRectification(reviewId: string, actorId: string): Promise<HardwareReview & { recordId: string }> {
    const review = await this.requireReview(reviewId);
    const next = nextStatus(review.status, "complete");
    if (!next) throw new Error(`当前状态 ${review.status} 不允许完成整改`);
    const updated = await this.adapter.updateReview(review.recordId, { status: next, updatedAt: new Date().toISOString() });
    await this.logEvent(reviewId, actorId, "complete_rectification", review.status, next);
    return updated;
  }

  async transitionTo(reviewId: string, event: string, actorId: string, payload?: Record<string, unknown>): Promise<HardwareReview & { recordId: string }> {
    const review = await this.requireReview(reviewId);
    const next = nextStatus(review.status, event);
    if (!next) throw new Error(`当前状态 ${review.status} 不允许事件 ${event}`);
    const updated = await this.adapter.updateReview(review.recordId, { status: next, updatedAt: new Date().toISOString() });
    await this.logEvent(reviewId, actorId, event, review.status, next, payload);
    return updated;
  }

  async getReview(reviewId: string): Promise<(HardwareReview & { recordId: string }) | null> {
    return this.adapter.findReviewById(reviewId);
  }

  async listReviews(): Promise<Array<HardwareReview & { recordId: string }>> {
    return this.adapter.listReviews();
  }

  private async requireReview(reviewId: string): Promise<HardwareReview & { recordId: string }> {
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
        关联评审单: reviewId,
        操作人: actorId,
        动作: action,
        原状态: fromStatus,
        新状态: toStatus,
        附加信息: payload ? JSON.stringify(payload) : "",
        操作时间: new Date().toISOString(),
      });
    } catch (err) {
      // 事件日志失败不应阻断主流程
      console.error("[hardware-review] log event failed:", err);
    }
  }
}
