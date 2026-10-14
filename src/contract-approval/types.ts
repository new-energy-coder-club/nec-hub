/**
 * 合同审批流程 — 核心类型定义
 */

import type { Attachment } from "../shared/types";

// 通用附件类型统一由 ../shared/types 提供，此处 re-export 保持既有 import 路径
export type { Attachment } from "../shared/types";

export type ContractApprovalStatus =
  | "draft" // 草稿（预留，当前提交即进入待审批）
  | "pending_approval" // 待审批
  | "in_review" // 审批中
  | "approved" // 已批准
  | "rejected" // 已拒绝
  | "revised" // 待修改（审批人要求修改）
  | "archived"; // 已归档

export type ApprovalLevel = "team_lead" | "department_head" | "finance" | "legal";

export type ContractType = "purchase" | "sales" | "service" | "partnership" | "nda";

export type ApproverDecision = "pending" | "approved" | "rejected" | "not_required";

export interface Approver {
  level: ApprovalLevel;
  approverId: string;
  name?: string;
  status: ApproverDecision;
  comment?: string;
  actedAt?: string;
}

export interface ContractApproval {
  approvalId: string;
  contractName: string;
  contractNumber: string;
  contractType: ContractType;
  parties: string[]; // 合同各方名称
  effectiveDate?: string;
  expirationDate?: string;
  contractFiles: Attachment[];
  summary: string;
  status: ContractApprovalStatus;
  /** 提交人 open_id；重新提交仅限提交人本人 */
  submittedBy: string;
  /** 会签审批人列表；全部 approved 才流转为 approved */
  approvers: Approver[];
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalComment {
  commentId: string;
  approvalId: string;
  reviewerId: string;
  content: string;
  timestamp: string;
  attachments?: Attachment[];
}

export interface ContractApprovalConfig {
  base: string;
  tables: Partial<Record<ContractApprovalTable, string>>;
  updatedAt: string;
}

export type ContractApprovalTable = "approvals" | "comments" | "events";
