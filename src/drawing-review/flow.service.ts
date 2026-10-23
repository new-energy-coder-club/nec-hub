/**
 * 新增机图纸评审流程 — 流程差异配置与共享服务封装
 */

import type { DrawingReviewAdapter } from "./adapter";
import { notifyFeishuGroup } from "./notify";
import {
  createReviewStateMachine,
  generateReviewId as generatePrefixedReviewId,
  ReviewFlowService as SharedReviewFlowService,
  type ReviewFlowConfig,
} from "../shared/review-flow";
import type {
  DrawingReview,
  DrawingReviewTable,
  ReviewConclusion,
  ReviewIssue,
  ReviewStatus,
} from "./types";

const STATE_MACHINE = createReviewStateMachine<ReviewStatus>({
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
});

export const TRANSITIONS: Record<ReviewStatus, Partial<Record<string, ReviewStatus>>> = STATE_MACHINE.toTransitionMap();

export function nextStatus(current: ReviewStatus, event: string): ReviewStatus | null {
  return STATE_MACHINE.next(current, event);
}

export function generateReviewId(): string {
  return generatePrefixedReviewId("DR");
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

function defaultDesignNotesTemplate(template: string = "v1"): string {
  switch (template) {
    case "v2":
      return `【设计说明模板 - V2】\n\n1. 项目背景与目标：\n2. 技术规格与参数：\n3. 关键设计变更：\n4. 风险评估与应对：\n5. 测试验证计划：\n6. 相关文档与标准：\n`;
    default:
      return `【设计说明模板】\n\n1. 设计背景与目标：\n2. 关键技术参数：\n3. 主要变更点：\n4. 特殊要求与注意事项：\n5. 相关参考文件：\n`;
  }
}

const FLOW_CONFIG: ReviewFlowConfig<ReviewStatus, DrawingReview, SubmitReviewInput, UserPreferences, DrawingReviewTable> = {
  stateMachine: STATE_MACHINE,
  idPrefix: "DR",
  initialStatus: "pending_review",
  preferences: {
    module: "dr",
    legacyFallback: true,
    defaultNameKey: "defaultMachineName",
    defaults: (actorId) => ({
      defaultProjectId: "",
      defaultMachineName: "",
      defaultDesignerId: actorId,
      lastUsedVersion: "V1.0",
      preferredTemplate: "v1",
    }),
  },
  fields: {
    name: "machineName",
    version: "drawingVersion",
    files: "drawingFiles",
  },
  defaultDesignNotes: (prefs) => defaultDesignNotesTemplate(prefs.preferredTemplate),
  versionSeed: "V0.0",
  requiredError: "项目编号、机型名称和图纸文件为必填项",
  tables: {
    rectifications: "rectifications",
    events: "events",
  },
  eventReviewField: "关联评审单",
  rectificationReviewField: "关联评审单",
  notify: notifyFeishuGroup,
  submitTitle: "📐 新图纸评审单提交",
  transitionTitle: "📐 图纸评审状态变更",
  logTag: "drawing-review",
  logMessages: {
    latestVersion: "Failed to get latest version, using default:",
    readPreferences: "Failed to get user preferences:",
    writePreferences: "Failed to save user preferences:",
    afterSubmitPreferences: "Failed to save preferences after submission:",
  },
};

export class ReviewFlowService extends SharedReviewFlowService<
  ReviewStatus,
  DrawingReview,
  SubmitReviewInput,
  UserPreferences,
  DrawingReviewTable
> {
  constructor(env: Env, adapter: DrawingReviewAdapter) {
    super(env, adapter, FLOW_CONFIG);
  }
}
