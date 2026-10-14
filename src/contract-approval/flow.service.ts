/**
 * 合同审批流程 — 主流程编排服务（状态机 + 会签审批）
 *
 * 权限模型：提交人（submittedBy）负责提交/重新提交；审批人（approvers）负责
 * 开始审批与审批操作；两类身份互斥，提交人不能兼任审批人。
 */

import type { ApprovalStore } from "./adapter";
import type {
  ApprovalLevel,
  Approver,
  Attachment,
  ContractApproval,
  ContractApprovalStatus,
  ContractType,
} from "./types";

export const TRANSITIONS: Record<ContractApprovalStatus, Partial<Record<string, ContractApprovalStatus>>> = {
  draft: { submit: "pending_approval" },
  pending_approval: { start_review: "in_review" },
  in_review: { approve: "approved", reject: "rejected", revise: "revised" },
  revised: { resubmit: "pending_approval" },
  approved: { archive: "archived" },
  rejected: { archive: "archived" },
  archived: {},
};

export function nextStatus(current: ContractApprovalStatus, event: string): ContractApprovalStatus | null {
  return TRANSITIONS[current]?.[event] ?? null;
}

export function generateApprovalId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(100 + Math.random() * 900);
  return `CA-${date}-${rand}`;
}

export interface SubmitApprovalInput {
  contractName: string;
  contractNumber?: string;
  contractType?: ContractType;
  parties?: string[];
  effectiveDate?: string;
  expirationDate?: string;
  contractFiles: Attachment[];
  summary?: string;
  /** 会签审批人，至少一名；不能包含提交人自己 */
  approvers: Array<{ level: ApprovalLevel; approverId: string; name?: string }>;
}

export interface ApprovalActionInput {
  action: "approve" | "reject" | "revise";
  comment?: string;
  attachments?: Attachment[];
}

export interface ResubmitInput {
  contractFiles?: Attachment[];
  summary?: string;
  approvers?: SubmitApprovalInput["approvers"];
}

const ACTION_EVENTS: Record<ApprovalActionInput["action"], string> = {
  approve: "approve",
  reject: "reject",
  revise: "revise",
};

const DECISION_BY_ACTION: Record<ApprovalActionInput["action"], Approver["status"]> = {
  approve: "approved",
  reject: "rejected",
  revise: "rejected",
};

export class ContractApprovalFlowService {
  constructor(private store: ApprovalStore) {}

  async submit(input: SubmitApprovalInput, actorId: string): Promise<ContractApproval & { recordId: string }> {
    if (!input.contractName?.trim()) throw new Error("合同名称为必填项");
    if (!input.contractFiles || input.contractFiles.length === 0) throw new Error("合同文件为必填项");
    const approvers = this.buildApprovers(input.approvers, actorId);

    const now = new Date().toISOString();
    const approval: ContractApproval = {
      approvalId: generateApprovalId(),
      contractName: input.contractName.trim(),
      contractNumber: input.contractNumber?.trim() ?? "",
      contractType: input.contractType ?? "service",
      parties: input.parties ?? [],
      effectiveDate: input.effectiveDate,
      expirationDate: input.expirationDate,
      contractFiles: input.contractFiles,
      summary: input.summary ?? "",
      status: "pending_approval",
      submittedBy: actorId,
      approvers,
      createdAt: now,
      updatedAt: now,
    };
    const saved = await this.store.createApproval(approval);
    await this.logEvent(saved.approvalId, actorId, "submit", "draft", "pending_approval", {
      recordId: saved.recordId,
    });
    return saved;
  }

  async startReview(approvalId: string, actorId: string): Promise<ContractApproval & { recordId: string }> {
    const approval = await this.requireApproval(approvalId);
    this.assertParticipant(approval, actorId);
    const next = nextStatus(approval.status, "start_review");
    if (!next) throw new Error(`当前状态 ${approval.status} 不允许开始审批`);
    const updated = await this.store.updateApproval(approval.recordId, {
      status: next,
      updatedAt: new Date().toISOString(),
    });
    await this.logEvent(approvalId, actorId, "start_review", approval.status, next);
    return updated;
  }

  async takeAction(
    approvalId: string,
    input: ApprovalActionInput,
    actorId: string,
  ): Promise<ContractApproval & { recordId: string }> {
    const approval = await this.requireApproval(approvalId);
    if (approval.status !== "in_review") throw new Error(`当前状态 ${approval.status} 不允许审批操作`);
    const approver = approval.approvers.find((a) => a.approverId === actorId);
    if (!approver) throw new Error("你不是该审批单的审批人");
    if (approver.status !== "pending") throw new Error("你已提交过审批意见");

    // 先落评论再改状态：评论写失败则整个操作中止，不留下半更新状态
    if (input.comment) {
      await this.store.createComment({
        commentId: `COM-${approvalId}-${Date.now()}`,
        approvalId,
        reviewerId: actorId,
        content: input.comment,
        timestamp: new Date().toISOString(),
        attachments: input.attachments,
      });
    }

    const approvers = approval.approvers.map((a) =>
      a.approverId === actorId
        ? { ...a, status: DECISION_BY_ACTION[input.action], comment: input.comment, actedAt: new Date().toISOString() }
        : a,
    );

    const event = ACTION_EVENTS[input.action];
    let next = nextStatus(approval.status, event);
    // 会签：approve 仅在全部审批人通过后生效，否则保持审批中
    if (input.action === "approve" && approvers.some((a) => a.status === "pending")) {
      next = approval.status;
    }
    if (!next) throw new Error(`操作 ${input.action} 无法驱动状态流转`);

    const updated = await this.store.updateApproval(approval.recordId, {
      status: next,
      approvers,
      updatedAt: new Date().toISOString(),
    });
    await this.logEvent(approvalId, actorId, event, approval.status, next, { comment: input.comment });
    return updated;
  }

  async resubmit(
    approvalId: string,
    input: ResubmitInput,
    actorId: string,
  ): Promise<ContractApproval & { recordId: string }> {
    const approval = await this.requireApproval(approvalId);
    if (actorId !== approval.submittedBy) throw new Error("只有提交人可以重新提交");
    const next = nextStatus(approval.status, "resubmit");
    if (!next) throw new Error(`当前状态 ${approval.status} 不允许重新提交`);

    // 重新提交后所有审批人重置为待审批；若换审批人则整表替换
    const approvers = input.approvers
      ? this.buildApprovers(input.approvers, actorId)
      : approval.approvers.map((a) => ({ ...a, status: "pending" as const, comment: undefined, actedAt: undefined }));

    const updated = await this.store.updateApproval(approval.recordId, {
      status: next,
      approvers,
      contractFiles: input.contractFiles ?? approval.contractFiles,
      summary: input.summary ?? approval.summary,
      updatedAt: new Date().toISOString(),
    });
    await this.logEvent(approvalId, actorId, "resubmit", approval.status, next);
    return updated;
  }

  async archive(approvalId: string, actorId: string): Promise<ContractApproval & { recordId: string }> {
    const approval = await this.requireApproval(approvalId);
    this.assertParticipant(approval, actorId);
    const next = nextStatus(approval.status, "archive");
    if (!next) throw new Error(`当前状态 ${approval.status} 不允许归档`);
    const updated = await this.store.updateApproval(approval.recordId, {
      status: next,
      updatedAt: new Date().toISOString(),
    });
    await this.logEvent(approvalId, actorId, "archive", approval.status, next);
    return updated;
  }

  async getApproval(approvalId: string): Promise<(ContractApproval & { recordId: string }) | null> {
    return this.store.findApprovalById(approvalId);
  }

  async listApprovals(): Promise<Array<ContractApproval & { recordId: string }>> {
    return this.store.listApprovals();
  }

  async listComments(approvalId: string) {
    await this.requireApproval(approvalId);
    return this.store.getCommentsByApproval(approvalId);
  }

  private buildApprovers(inputs: SubmitApprovalInput["approvers"], actorId: string): Approver[] {
    const valid = (inputs ?? []).filter((a) => a.approverId?.trim());
    if (valid.length === 0) throw new Error("至少指定一名审批人");
    if (valid.some((a) => a.approverId === actorId)) throw new Error("提交人不能兼任审批人");
    return valid.map((a) => ({
      level: a.level,
      approverId: a.approverId.trim(),
      name: a.name,
      status: "pending",
    }));
  }

  private assertParticipant(approval: ContractApproval, actorId: string): void {
    const isParticipant =
      actorId === approval.submittedBy || approval.approvers.some((a) => a.approverId === actorId);
    if (!isParticipant) throw new Error("你不是该审批单的参与人");
  }

  private async requireApproval(approvalId: string): Promise<ContractApproval & { recordId: string }> {
    const approval = await this.store.findApprovalById(approvalId);
    if (!approval) throw new Error(`审批单 ${approvalId} 不存在`);
    return approval;
  }

  private async logEvent(
    approvalId: string,
    actorId: string,
    action: string,
    fromStatus?: ContractApprovalStatus,
    toStatus?: ContractApprovalStatus,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.store.createRecord("events", {
        关联审批单: approvalId,
        操作人: actorId,
        动作: action,
        原状态: fromStatus,
        新状态: toStatus,
        附加信息: payload ? JSON.stringify(payload) : "",
        操作时间: new Date().toISOString(),
      });
    } catch (err) {
      // 事件日志失败不应阻断主流程
      console.error("[contract-approval] log event failed:", err);
    }
  }
}
