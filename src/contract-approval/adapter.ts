/**
 * 合同审批流程 — 飞书 Base 数据适配器
 *
 * 负责把业务对象 ↔ Base 记录字段做双向映射。
 * 复杂字段（审批人列表、合同文件、签约方）以 JSON 文本落表，读取时解析回对象。
 */

import {
  BitableRecord,
  fieldText,
} from "../feishu/bitable";
import { FeishuTableAdapter } from "../shared/feishu-table-adapter";
import type {
  ApprovalComment,
  Approver,
  Attachment,
  ContractApproval,
  ContractApprovalConfig,
  ContractApprovalStatus,
  ContractApprovalTable,
  ContractType,
} from "./types";

/** flow.service 依赖的存储接口，便于测试时注入内存替身 */
export interface ApprovalStore {
  listApprovals(): Promise<Array<ContractApproval & { recordId: string }>>;
  findApprovalById(approvalId: string): Promise<(ContractApproval & { recordId: string }) | null>;
  createApproval(approval: ContractApproval): Promise<ContractApproval & { recordId: string }>;
  updateApproval(
    recordId: string,
    approval: Partial<ContractApproval>,
  ): Promise<ContractApproval & { recordId: string }>;
  createComment(comment: ApprovalComment): Promise<ApprovalComment & { recordId: string }>;
  getCommentsByApproval(approvalId: string): Promise<Array<ApprovalComment & { recordId: string }>>;
  createRecord(table: ContractApprovalTable, fields: Record<string, unknown>): Promise<unknown>;
}

const CONTRACT_TYPES: readonly ContractType[] = ["purchase", "sales", "service", "partnership", "nda"];

const STATUSES: readonly ContractApprovalStatus[] = [
  "draft",
  "pending_approval",
  "in_review",
  "approved",
  "rejected",
  "revised",
  "archived",
];

function parseJson<T>(raw: string, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 同义字段名取值：返回第一个非空字段的文本 */
function pickText(fields: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const v = fieldText(fields[name]);
    if (v) return v;
  }
  return "";
}

/** 兼容 JSON 数组与「、」分隔纯文本两种存储形式 */
function parseStringList(raw: string): string[] {
  if (!raw) return [];
  if (raw.startsWith("[")) {
    const arr = parseJson<unknown>(raw, []);
    return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
  }
  return raw
    .split(/[,、；;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export class ContractApprovalAdapter
  extends FeishuTableAdapter<ContractApprovalConfig, ContractApprovalTable>
  implements ApprovalStore
{
  constructor(env: Env, cfg: ContractApprovalConfig) {
    super(env, cfg, "合同审批流程");
  }

  // ---------- 合同审批单 ----------

  async listApprovals(): Promise<Array<ContractApproval & { recordId: string }>> {
    const records = await this.listRecords("approvals");
    return records.map((r) => this.recordToApproval(r));
  }

  async findApprovalById(approvalId: string): Promise<(ContractApproval & { recordId: string }) | null> {
    const records = await this.listRecords("approvals");
    const rec = records.find((r) => pickText(r.fields, ["审批单号", "approvalId"]) === approvalId);
    return rec ? this.recordToApproval(rec) : null;
  }

  async createApproval(approval: ContractApproval): Promise<ContractApproval & { recordId: string }> {
    const rec = await this.createRecord("approvals", this.approvalToFields(approval));
    return this.recordToApproval(rec);
  }

  async updateApproval(
    recordId: string,
    approval: Partial<ContractApproval>,
  ): Promise<ContractApproval & { recordId: string }> {
    const rec = await this.updateRecord("approvals", recordId, this.approvalToFields(approval, true));
    return this.recordToApproval(rec);
  }

  private recordToApproval(r: BitableRecord): ContractApproval & { recordId: string } {
    const f = r.fields;
    const rawType = pickText(f, ["合同类型", "contractType"]);
    const rawStatus = pickText(f, ["状态", "status"]);
    return {
      recordId: r.record_id,
      approvalId: pickText(f, ["审批单号", "approvalId"]),
      contractName: pickText(f, ["合同名称", "contractName", "合同标题"]),
      contractNumber: pickText(f, ["合同编号", "contractNumber"]),
      contractType: CONTRACT_TYPES.includes(rawType as ContractType) ? (rawType as ContractType) : "service",
      parties: parseStringList(pickText(f, ["签约方", "parties"])),
      effectiveDate: pickText(f, ["生效日期", "effectiveDate"]) || undefined,
      expirationDate: pickText(f, ["到期日期", "expirationDate"]) || undefined,
      contractFiles: parseJson<Attachment[]>(pickText(f, ["合同文件", "contractFiles"]), []),
      summary: pickText(f, ["合同摘要", "summary", "摘要"]),
      status: STATUSES.includes(rawStatus as ContractApprovalStatus)
        ? (rawStatus as ContractApprovalStatus)
        : "draft",
      submittedBy: pickText(f, ["提交人", "submittedBy"]),
      approvers: parseJson<Approver[]>(pickText(f, ["审批人", "approvers"]), []),
      createdAt: pickText(f, ["创建时间", "createdAt"]) || new Date().toISOString(),
      updatedAt: pickText(f, ["更新时间", "updatedAt"]) || new Date().toISOString(),
    };
  }

  private approvalToFields(approval: Partial<ContractApproval>, partial = false): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    const textMap = {
      审批单号: approval.approvalId,
      合同名称: approval.contractName,
      合同编号: approval.contractNumber,
      合同类型: approval.contractType,
      生效日期: approval.effectiveDate,
      到期日期: approval.expirationDate,
      合同摘要: approval.summary,
      状态: approval.status,
      提交人: approval.submittedBy,
    } as const;
    for (const [fieldName, v] of Object.entries(textMap)) {
      if (v !== undefined) fields[fieldName] = v;
    }
    if (approval.parties !== undefined) fields["签约方"] = approval.parties.join("、");
    if (approval.contractFiles !== undefined) fields["合同文件"] = JSON.stringify(approval.contractFiles);
    if (approval.approvers !== undefined) fields["审批人"] = JSON.stringify(approval.approvers);
    if (!partial && approval.createdAt !== undefined) fields["创建时间"] = approval.createdAt;
    fields["更新时间"] = approval.updatedAt ?? new Date().toISOString();
    return fields;
  }

  // ---------- 审批评论 ----------

  async createComment(comment: ApprovalComment): Promise<ApprovalComment & { recordId: string }> {
    const fields: Record<string, unknown> = {
      评论ID: comment.commentId,
      关联审批单: comment.approvalId,
      评论人: comment.reviewerId,
      评论内容: comment.content,
      评论时间: comment.timestamp,
      附件: JSON.stringify(comment.attachments ?? []),
    };
    const rec = await this.createRecord("comments", fields);
    return { ...comment, recordId: rec.record_id };
  }

  async getCommentsByApproval(approvalId: string): Promise<Array<ApprovalComment & { recordId: string }>> {
    const records = await this.listRecords("comments");
    return records
      .filter((r) => pickText(r.fields, ["关联审批单"]) === approvalId)
      .map((r) => ({
        commentId: pickText(r.fields, ["评论ID", "commentId"]) || r.record_id,
        approvalId,
        reviewerId: pickText(r.fields, ["评论人", "reviewerId"]),
        content: pickText(r.fields, ["评论内容", "content"]),
        timestamp: pickText(r.fields, ["评论时间", "timestamp"]),
        attachments: parseJson<Attachment[]>(pickText(r.fields, ["附件", "attachments"]), []),
        recordId: r.record_id,
      }));
  }
}
