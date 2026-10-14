import { describe, it, expect, beforeEach } from "vitest";
import {
  ContractApprovalFlowService,
  generateApprovalId,
  nextStatus,
  type SubmitApprovalInput,
} from "../flow.service";
import type { ApprovalStore } from "../adapter";
import type { ApprovalComment, ContractApproval } from "../types";

type StoredApproval = ContractApproval & { recordId: string };

/** 内存版 ApprovalStore，用于不依赖飞书的流程测试 */
class FakeStore implements ApprovalStore {
  approvals: StoredApproval[] = [];
  comments: Array<ApprovalComment & { recordId: string }> = [];
  events: Record<string, unknown>[] = [];
  failNextComment = false;
  private seq = 0;

  async listApprovals(): Promise<StoredApproval[]> {
    return this.approvals.map((a) => ({ ...a }));
  }

  async findApprovalById(approvalId: string): Promise<StoredApproval | null> {
    const found = this.approvals.find((a) => a.approvalId === approvalId);
    return found ? { ...found, approvers: found.approvers.map((a) => ({ ...a })) } : null;
  }

  async createApproval(approval: ContractApproval): Promise<StoredApproval> {
    const stored: StoredApproval = {
      ...approval,
      approvers: approval.approvers.map((a) => ({ ...a })),
      recordId: `rec-${++this.seq}`,
    };
    this.approvals.push(stored);
    return { ...stored };
  }

  async updateApproval(recordId: string, patch: Partial<ContractApproval>): Promise<StoredApproval> {
    const stored = this.approvals.find((a) => a.recordId === recordId);
    if (!stored) throw new Error(`record ${recordId} not found`);
    Object.assign(stored, patch);
    return { ...stored, approvers: stored.approvers.map((a) => ({ ...a })) };
  }

  async createComment(comment: ApprovalComment): Promise<ApprovalComment & { recordId: string }> {
    if (this.failNextComment) {
      this.failNextComment = false;
      throw new Error("评论写入失败（模拟）");
    }
    const saved = { ...comment, recordId: `com-${this.comments.length + 1}` };
    this.comments.push(saved);
    return saved;
  }

  async getCommentsByApproval(approvalId: string) {
    return this.comments.filter((c) => c.approvalId === approvalId);
  }

  async createRecord(_table: string, fields: Record<string, unknown>): Promise<unknown> {
    this.events.push(fields);
    return { record_id: `evt-${this.events.length}` };
  }
}

const SUBMITTER = "ou_submitter";
const APPROVER_A = "ou_approver_a";
const APPROVER_B = "ou_approver_b";
const OUTSIDER = "ou_outsider";

function validInput(overrides: Partial<SubmitApprovalInput> = {}): SubmitApprovalInput {
  return {
    contractName: "测试采购合同",
    contractFiles: [{ name: "contract.pdf", token: "tok-1" }],
    approvers: [
      { level: "team_lead", approverId: APPROVER_A },
      { level: "finance", approverId: APPROVER_B },
    ],
    ...overrides,
  };
}

/** 提交并由审批人 A 开始审批，返回审批单 ID */
async function submitAndStart(flow: ContractApprovalFlowService): Promise<string> {
  const created = await flow.submit(validInput(), SUBMITTER);
  await flow.startReview(created.approvalId, APPROVER_A);
  return created.approvalId;
}

describe("contract-approval 状态机", () => {
  it("nextStatus 覆盖全部流转", () => {
    expect(nextStatus("draft", "submit")).toBe("pending_approval");
    expect(nextStatus("pending_approval", "start_review")).toBe("in_review");
    expect(nextStatus("in_review", "approve")).toBe("approved");
    expect(nextStatus("in_review", "reject")).toBe("rejected");
    expect(nextStatus("in_review", "revise")).toBe("revised");
    expect(nextStatus("revised", "resubmit")).toBe("pending_approval");
    expect(nextStatus("approved", "archive")).toBe("archived");
    expect(nextStatus("rejected", "archive")).toBe("archived");
    expect(nextStatus("archived", "submit")).toBeNull();
  });

  it("generateApprovalId 生成 CA-日期-序号 格式", () => {
    expect(generateApprovalId()).toMatch(/^CA-\d{8}-\d{3}$/);
  });
});

describe("contract-approval 提交", () => {
  let store: FakeStore;
  let flow: ContractApprovalFlowService;

  beforeEach(() => {
    store = new FakeStore();
    flow = new ContractApprovalFlowService(store);
  });

  it("缺少合同名称 / 合同文件 / 审批人时拒绝提交", async () => {
    await expect(flow.submit(validInput({ contractName: "" }), SUBMITTER)).rejects.toThrow("合同名称为必填项");
    await expect(flow.submit(validInput({ contractFiles: [] }), SUBMITTER)).rejects.toThrow("合同文件为必填项");
    await expect(flow.submit(validInput({ approvers: [] }), SUBMITTER)).rejects.toThrow("至少指定一名审批人");
  });

  it("提交人不能兼任审批人", async () => {
    const input = validInput({ approvers: [{ level: "team_lead", approverId: SUBMITTER }] });
    await expect(flow.submit(input, SUBMITTER)).rejects.toThrow("提交人不能兼任审批人");
  });

  it("提交成功：记录提交人，审批人全部待审批", async () => {
    const created = await flow.submit(validInput(), SUBMITTER);
    expect(created.status).toBe("pending_approval");
    expect(created.submittedBy).toBe(SUBMITTER);
    expect(created.approvers).toHaveLength(2);
    expect(created.approvers.every((a) => a.status === "pending")).toBe(true);
    expect(created.approvers.some((a) => a.approverId === SUBMITTER)).toBe(false);
  });
});

describe("contract-approval 审批权限与会签", () => {
  let store: FakeStore;
  let flow: ContractApprovalFlowService;

  beforeEach(() => {
    store = new FakeStore();
    flow = new ContractApprovalFlowService(store);
  });

  it("非参与人不能开始审批", async () => {
    const created = await flow.submit(validInput(), SUBMITTER);
    await expect(flow.startReview(created.approvalId, OUTSIDER)).rejects.toThrow("参与人");
  });

  it("非审批人不能执行审批操作", async () => {
    const id = await submitAndStart(flow);
    await expect(flow.takeAction(id, { action: "approve" }, OUTSIDER)).rejects.toThrow("审批人");
    await expect(flow.takeAction(id, { action: "approve" }, SUBMITTER)).rejects.toThrow("审批人");
  });

  it("会签：第一人通过保持审批中，全部通过才生效", async () => {
    const id = await submitAndStart(flow);
    const afterA = await flow.takeAction(id, { action: "approve", comment: "同意" }, APPROVER_A);
    expect(afterA.status).toBe("in_review");
    expect(afterA.approvers.find((a) => a.approverId === APPROVER_A)?.status).toBe("approved");

    const afterB = await flow.takeAction(id, { action: "approve" }, APPROVER_B);
    expect(afterB.status).toBe("approved");
    expect(afterB.approvers.every((a) => a.status === "approved")).toBe(true);
  });

  it("同一审批人不能重复审批", async () => {
    const id = await submitAndStart(flow);
    await flow.takeAction(id, { action: "approve" }, APPROVER_A);
    await expect(flow.takeAction(id, { action: "approve" }, APPROVER_A)).rejects.toThrow("已提交过审批意见");
  });

  it("任一审批人拒绝即整体拒绝", async () => {
    const id = await submitAndStart(flow);
    const after = await flow.takeAction(id, { action: "reject", comment: "条款有问题" }, APPROVER_A);
    expect(after.status).toBe("rejected");
    await expect(flow.takeAction(id, { action: "approve" }, APPROVER_B)).rejects.toThrow();
  });

  it("评论写入失败时状态不被半更新", async () => {
    const id = await submitAndStart(flow);
    store.failNextComment = true;
    await expect(flow.takeAction(id, { action: "approve", comment: "x" }, APPROVER_A)).rejects.toThrow("评论写入失败");
    const approval = await flow.getApproval(id);
    expect(approval?.status).toBe("in_review");
    expect(approval?.approvers.every((a) => a.status === "pending")).toBe(true);
  });

  it("带评论的审批会写入评论记录", async () => {
    const id = await submitAndStart(flow);
    await flow.takeAction(id, { action: "approve", comment: "没问题" }, APPROVER_A);
    const comments = await flow.listComments(id);
    expect(comments).toHaveLength(1);
    expect(comments[0].reviewerId).toBe(APPROVER_A);
    expect(comments[0].content).toBe("没问题");
  });
});

describe("contract-approval 重新提交与归档", () => {
  let store: FakeStore;
  let flow: ContractApprovalFlowService;

  beforeEach(() => {
    store = new FakeStore();
    flow = new ContractApprovalFlowService(store);
  });

  it("revise 后仅提交人可重新提交，且审批人重置", async () => {
    const id = await submitAndStart(flow);
    await flow.takeAction(id, { action: "revise", comment: "金额条款需修改" }, APPROVER_A);
    expect((await flow.getApproval(id))?.status).toBe("revised");

    await expect(flow.resubmit(id, {}, APPROVER_B)).rejects.toThrow("提交人");

    const resubmitted = await flow.resubmit(id, {}, SUBMITTER);
    expect(resubmitted.status).toBe("pending_approval");
    expect(resubmitted.approvers.every((a) => a.status === "pending" && !a.comment && !a.actedAt)).toBe(true);
  });

  it("归档：仅终态可归档，非参与人不可归档", async () => {
    const id = await submitAndStart(flow);
    await expect(flow.archive(id, APPROVER_A)).rejects.toThrow("不允许归档");

    await flow.takeAction(id, { action: "approve" }, APPROVER_A);
    await flow.takeAction(id, { action: "approve" }, APPROVER_B);
    await expect(flow.archive(id, OUTSIDER)).rejects.toThrow("参与人");

    const archived = await flow.archive(id, SUBMITTER);
    expect(archived.status).toBe("archived");
  });
});
