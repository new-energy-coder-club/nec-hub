/**
 * 合同审批流程 — 提交前校验与状态表
 *
 * 迁移说明（审批引擎 Phase 2，选项 A 兼容迁移）：审批单本体/状态机/会签/单号/通知
 * 由 src/approvals 引擎承担（flows:config 的 contract：HT 三位单号、countersign 会签、
 * participant/owner 守卫）；本文件只保留提交前纯校验（金额/币种/日期/审批人名单）、
 * 状态表导出（TRANSITIONS/nextStatus，供薄壳预检保留旧错误文案）与事件日志 helper。
 *
 * 权限模型：提交人（submittedBy）负责提交/重新提交；审批人（approvers）负责
 * 开始审批与审批操作；两类身份互斥，提交人不能兼任审批人。
 */

import type { ApprovalStore } from "./adapter";
import type {
  ApprovalLevel,
  Approver,
  Attachment,
  ContractApprovalStatus,
  ContractType,
} from "./types";
import { StateMachine, type TransitionRule } from "../approvals/core/state-machine";

/** 合同审批事件（动作名） */
type ContractEvent = "submit" | "start_review" | "approve" | "reject" | "revise" | "resubmit" | "archive";

const CONTRACT_STATUSES: readonly ContractApprovalStatus[] = [
  "draft",
  "pending_approval",
  "in_review",
  "revised",
  "approved",
  "rejected",
  "archived",
];

/** 合同审批流转规则（统一状态机核心；archive 双前置用 from 数组表达）。
 *  与引擎 flows:config 的 contract.machine.transitions 保持一致，此处仅供薄壳预检与测试。 */
const CONTRACT_TRANSITIONS: ReadonlyArray<TransitionRule<ContractEvent, ContractApprovalStatus>> = [
  { action: "submit", from: "draft", to: "pending_approval" },
  { action: "start_review", from: "pending_approval", to: "in_review" },
  { action: "approve", from: "in_review", to: "approved" },
  { action: "reject", from: "in_review", to: "rejected" },
  { action: "revise", from: "in_review", to: "revised" },
  { action: "resubmit", from: "revised", to: "pending_approval" },
  { action: "archive", from: ["approved", "rejected"], to: "archived" },
];

/** 合同审批状态机实例（与 approvals 引擎共享核心） */
export const CONTRACT_STATE_MACHINE = new StateMachine<ContractEvent, ContractApprovalStatus>(
  CONTRACT_TRANSITIONS,
  CONTRACT_STATUSES,
);

export const TRANSITIONS: Record<ContractApprovalStatus, Partial<Record<string, ContractApprovalStatus>>> =
  CONTRACT_STATE_MACHINE.toTransitionMap();

export function nextStatus(current: ContractApprovalStatus, event: string): ContractApprovalStatus | null {
  return TRANSITIONS[current]?.[event] ?? null;
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
  /** 合同金额（元），>0 且 ≤ 9,999,999.99，最多两位小数 */
  amount?: number;
  /** 币种，默认 CNY */
  currency?: string;
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

/** 金额上限（元） */
export const MAX_CONTRACT_AMOUNT = 9_999_999.99;
/** 币种白名单（默认 CNY） */
export const CURRENCIES: readonly string[] = ["CNY", "USD", "EUR", "JPY", "GBP", "HKD"];

/** 提交时金额校验：>0、≤ 上限、最多两位小数，返回原值 */
export function validateContractAmount(amount: unknown): number {
  if (typeof amount !== "number" || !Number.isFinite(amount)) throw new Error("金额为必填项");
  if (amount <= 0) throw new Error("金额必须大于 0");
  if (amount > MAX_CONTRACT_AMOUNT) throw new Error("金额不能超过 9,999,999.99");
  const frac = String(amount).split(".")[1];
  if (frac && frac.length > 2) throw new Error("金额最多两位小数");
  return amount;
}

/** 提交时币种校验：默认 CNY，白名单外拒绝，返回规范化大写值 */
export function validateCurrency(currency: unknown): string {
  const normalized = String(currency ?? "CNY").trim().toUpperCase();
  if (!CURRENCIES.includes(normalized)) {
    throw new Error(`币种不合法：${normalized}（仅支持 ${CURRENCIES.join("/")}）`);
  }
  return normalized;
}

/** 构建会签审批人名单（提交前校验：至少一名、提交人不能自审；初始全部 pending） */
export function buildContractApprovers(inputs: SubmitApprovalInput["approvers"], actorId: string): Approver[] {
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

/** 事件日志（薄壳用）：写 events 子表，失败只记日志不阻断主流程 */
export async function logApprovalEvent(
  store: Pick<ApprovalStore, "createRecord">,
  approvalId: string,
  actorId: string,
  action: string,
  fromStatus?: ContractApprovalStatus | string,
  toStatus?: ContractApprovalStatus | string,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await store.createRecord("events", {
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
