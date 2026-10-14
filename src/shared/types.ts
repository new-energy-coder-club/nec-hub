/**
 * 跨模块共用的业务类型
 *
 * Attachment / UserRef / ReviewConclusion / ReviewIssue / ActionItem / ReviewMinutes
 * 在 drawing-review 与 hardware-review（Attachment 含 contract-approval）中逐字重复，统一收敛于此；
 * 各模块 types.ts 继续 re-export，既有 import 路径不变。
 * 注意：ReviewStatus / ProcessEvent 各模块取值域不同（如图纸评审有 procuring、硬件评审有 approved），保留在各自模块。
 */

export interface Attachment {
  name: string;
  token: string;
  url?: string;
  size?: number;
}

export interface UserRef {
  open_id: string;
  name?: string;
}

export type ReviewConclusion = "passed" | "conditional" | "rejected";

export interface ReviewIssue {
  issueId: string;
  description: string;
  raisedBy: UserRef;
  owner?: UserRef;
  dueDate?: string;
  severity?: "low" | "medium" | "high";
  status: "open" | "closed";
}

export interface ActionItem {
  action: string;
  owner: UserRef;
  dueDate?: string;
}

export interface ReviewMinutes {
  minutesId: string;
  reviewId: string;
  meetingTime: string;
  attendees: UserRef[];
  topics: string[];
  discussion: string;
  issues: ReviewIssue[];
  conclusion: ReviewConclusion;
  nextActions: ActionItem[];
  attachments: Attachment[];
}

/** 模块配置的可选特性开关（drawing-review / hardware-review 共用） */
export interface ModuleConfigFeatures {
  autoDefaultFilling?: boolean;
  versionIncrement?: "minor" | "major";
  designNotesTemplate?: string;
}
