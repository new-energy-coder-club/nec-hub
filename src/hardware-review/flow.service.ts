/**
 * 硬件评审流程 — 流程差异配置与共享服务封装
 *
 * 迁移说明（审批引擎 Phase 1）：评审单本体/状态机/通知由 src/approvals 引擎承担
 * （flows:config 的 hardware_review：HR 前缀单号、英文状态机、初始 pending_review）；
 * 本文件只保留状态表导出（TRANSITIONS/nextStatus）与提交默认值/偏好/纪要等
 * 提交前后处理（ReviewFlowService，共享底座在 shared/review-flow.ts）。
 */

import type { HardwareReviewAdapter } from "./adapter";
import {
  createReviewStateMachine,
  ReviewFlowService as SharedReviewFlowService,
  type ReviewFlowConfig,
} from "../shared/review-flow";
import type {
  HardwareReview,
  HardwareReviewTable,
  HardwareType,
  ReviewConclusion,
  ReviewIssue,
  ReviewStatus,
} from "./types";

const STATE_MACHINE = createReviewStateMachine<ReviewStatus>({
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
});

export const TRANSITIONS: Record<ReviewStatus, Partial<Record<string, ReviewStatus>>> = STATE_MACHINE.toTransitionMap();

export function nextStatus(current: ReviewStatus, event: string): ReviewStatus | null {
  return STATE_MACHINE.next(current, event);
}

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

const HARDWARE_DESIGN_NOTES = `【硬件设计说明模板】\n\n1. 设计背景与目标：\n2. 关键规格参数（电压/电流/功率/接口/防护等级）：\n3. 选型理由与替代方案：\n4. 安全与可靠性考虑：\n5. 测试验证计划：\n6. 相关文档与标准：\n`;

const FLOW_CONFIG: ReviewFlowConfig<ReviewStatus, HardwareReview, SubmitReviewInput, Record<string, unknown>, HardwareReviewTable> = {
  preferences: {
    module: "hw",
    defaultNameKey: "defaultHardwareName",
    defaults: (actorId) => ({ defaultDesignerId: actorId, lastUsedVersion: "V1.0" }),
  },
  fields: {
    name: "hardwareName",
    version: "hardwareVersion",
    files: "hardwareFiles",
  },
  emptyStringDefaults: true,
  defaultDesignNotes: () => HARDWARE_DESIGN_NOTES,
  extraDefaults: (input) => ({
    hardwareType: input.hardwareType || "other",
    specification: input.specification || "",
  }),
  requiredError: "项目编号、硬件名称和硬件资料为必填项",
  tables: {
    events: "events",
  },
  eventReviewField: "关联评审单",
  logTag: "hardware-review",
  logMessages: {
    latestVersion: "failed to resolve latest version:",
    readPreferences: "failed to get user preferences:",
    writePreferences: "failed to save user preferences:",
    afterSubmitPreferences: "failed to save preferences after submission:",
  },
};

export class ReviewFlowService extends SharedReviewFlowService<
  ReviewStatus,
  HardwareReview,
  SubmitReviewInput,
  Record<string, unknown>,
  HardwareReviewTable
> {
  constructor(env: Env, adapter: HardwareReviewAdapter) {
    super(env, adapter, FLOW_CONFIG);
  }
}
