/**
 * 新增机图纸评审流程 — 主流程编排服务（状态机）
 */

import type { DrawingReviewAdapter } from "./adapter";
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
  projectId?: string;
  machineName?: string;
  drawingVersion?: string;
  designerId?: string;
  drawingFiles: DrawingReview["drawingFiles"];
  designNotes?: string;
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

export interface UserPreferences {
  defaultProjectId?: string;
  defaultMachineName?: string;
  defaultDesignerId?: string;
  lastUsedVersion?: string;
  preferredTemplate?: string;
}

export class ReviewFlowService {
  constructor(
    private env: Env,
    private adapter: DrawingReviewAdapter,
  ) {}

  /**
   * Generate intelligent defaults for drawing review submission
   */
  async getDefaultSubmissionValues(input: SubmitReviewInput, actorId: string): Promise<Partial<SubmitReviewInput>> {
    const now = new Date();
    
    // Get user preferences for smarter defaults
    const prefs = await this.getUserPreferences(actorId);
    
    // Default to current user as designer if not specified
    const designerId = input.designerId || prefs.defaultDesignerId || actorId;
    
    // Generate default drawing version (V1.0, V1.1, etc.)
    let drawingVersion = input.drawingVersion;
    if (!drawingVersion) {
      // Try to get latest version for this project/machine
      try {
        const reviews = await this.adapter.listReviews();
        if (input.projectId && input.machineName) {
          // Find latest version for this project and machine
          const projectMachineReviews = reviews.filter(r => 
            r.projectId === input.projectId && 
            r.machineName === input.machineName
          );
          if (projectMachineReviews.length > 0) {
            // Get latest version and increment
            const latestVersion = projectMachineReviews.reduce((latest, current) => {
              if (!current.drawingVersion) return latest;
              // Simple version parsing: V1.0, V1.1, V2.0
              const match = current.drawingVersion.match(/^V(\d+)\.(\d+)$/);
              if (!match) return latest;
              const [_, major, minor] = match;
              const currentMajor = parseInt(major, 10);
              const currentMinor = parseInt(minor, 10);
              
              const latestMatch = latest.drawingVersion?.match(/^V(\d+)\.(\d+)$/);
              if (!latestMatch) return current;
              
              const [__, latestMajor, latestMinor] = latestMatch;
              const latestMajorNum = parseInt(latestMajor, 10);
              const latestMinorNum = parseInt(latestMinor, 10);
              
              if (currentMajor > latestMajorNum) return current;
              if (currentMajor === latestMajorNum && currentMinor > latestMinorNum) return current;
              return latest;
            }, { drawingVersion: "V0.0" } as DrawingReview);
            
            if (latestVersion.drawingVersion) {
              const match = latestVersion.drawingVersion.match(/^V(\d+)\.(\d+)$/);
              if (match) {
                const [_, major, minor] = match;
                const currentMajor = parseInt(major, 10);
                const currentMinor = parseInt(minor, 10);
                // Increment minor version
                drawingVersion = `V${currentMajor}.${currentMinor + 1}`;
              }
            }
          }
        }
      } catch (err) {
        console.warn("[drawing-review] Failed to get latest version, using default:", err);
      }
      
      if (!drawingVersion) {
        drawingVersion = prefs.lastUsedVersion || "V1.0";
      }
    }
    
    // Default design notes template
    const designNotes = input.designNotes || this.getDefaultDesignNotesTemplate(prefs.preferredTemplate as string);
    
    return {
      projectId: input.projectId || prefs.defaultProjectId,
      machineName: input.machineName || prefs.defaultMachineName,
      drawingVersion,
      designerId,
      designNotes,
    };
  }
  
  private getDefaultDesignNotesTemplate(template: string = "v1"): string {
    switch (template) {
      case "v2":
        return `【设计说明模板 - V2】\n\n1. 项目背景与目标：\n2. 技术规格与参数：\n3. 关键设计变更：\n4. 风险评估与应对：\n5. 测试验证计划：\n6. 相关文档与标准：\n`;
      default:
        return `【设计说明模板】\n\n1. 设计背景与目标：\n2. 关键技术参数：\n3. 主要变更点：\n4. 特殊要求与注意事项：\n5. 相关参考文件：\n`;
    }
  }
  
  /**
   * Get user-specific preferences for easier filling
   */
  private async getUserPreferences(actorId: string): Promise<UserPreferences> {
    try {
      // Try to get user preferences from registry
      const prefs = await this.env.REGISTRY.get(`user-prefs:${actorId}`);
      if (prefs) {
        return JSON.parse(prefs) as UserPreferences;
      }
    } catch (err) {
      console.warn("[drawing-review] Failed to get user preferences:", err);
    }
    
    // Return default preferences
    return {
      defaultProjectId: "",
      defaultMachineName: "",
      defaultDesignerId: actorId,
      lastUsedVersion: "V1.0",
      preferredTemplate: "v1",
    };
  }
  
  /**
   * Save user preferences for future easy filling
   */
  private async saveUserPreferences(actorId: string, prefs: UserPreferences): Promise<void> {
    try {
      await this.env.REGISTRY.put(`user-prefs:${actorId}`, JSON.stringify(prefs));
    } catch (err) {
      console.warn("[drawing-review] Failed to save user preferences:", err);
    }
  }

  async submit(input: SubmitReviewInput, actorId: string): Promise<DrawingReview & { recordId: string }> {
    // Apply intelligent defaults for missing fields
    const defaults = await this.getDefaultSubmissionValues(input, actorId);
    
    const review: DrawingReview = {
      reviewId: generateReviewId(),
      projectId: defaults.projectId || "",
      machineName: defaults.machineName || "",
      drawingVersion: defaults.drawingVersion || "V1.0",
      designerId: defaults.designerId || actorId,
      drawingFiles: input.drawingFiles,
      designNotes: defaults.designNotes || "",
      status: "pending_review",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    // Validate required fields
    if (!review.projectId || !review.machineName || !review.drawingFiles || review.drawingFiles.length === 0) {
      throw new Error("项目编号、机型名称和图纸文件为必填项");
    }
    
    const saved = await this.adapter.createReview(review);
    await this.logEvent(saved.reviewId, actorId, "submit", "draft", "pending_review", { recordId: saved.recordId });
    
    // Save user preferences based on this submission
    try {
      const prefs = await this.getUserPreferences(actorId);
      if (input.projectId) prefs.defaultProjectId = input.projectId;
      if (input.machineName) prefs.defaultMachineName = input.machineName;
      if (input.drawingVersion) prefs.lastUsedVersion = input.drawingVersion;
      await this.saveUserPreferences(actorId, prefs);
    } catch (err) {
      console.warn("[drawing-review] Failed to save preferences after submission:", err);
    }
    
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
