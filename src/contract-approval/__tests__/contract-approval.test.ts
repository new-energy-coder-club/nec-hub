import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ContractApprovalFlowService,
  formatContractNumber,
  generateApprovalId,
  nextStatus,
  peekNextContractNumber,
  type SubmitApprovalInput,
} from "../flow.service";
import { handleContractApproval } from "../index";
import { loadMemberDirectory } from "../../feishu/member-directory";
import type { ApprovalStore } from "../adapter";
import type { ApprovalComment, ContractApproval } from "../types";
import { KV_KEYS } from "../../shared/kv-keys";

vi.mock("../../feishu/member-directory", () => ({ loadMemberDirectory: vi.fn() }));

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
    amount: 100,
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

/** 内存版合同编号计数器（模拟 REGISTRY KV 的 get/put） */
class FakeCounter {
  map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
}

describe("contract-approval 金额/币种/日期校验", () => {
  let store: FakeStore;
  let flow: ContractApprovalFlowService;

  beforeEach(() => {
    store = new FakeStore();
    flow = new ContractApprovalFlowService(store);
  });

  it("金额缺失 / 为 0 / 负数 / 超上限 / 超两位小数 → 错误", async () => {
    await expect(flow.submit(validInput({ amount: undefined }), SUBMITTER)).rejects.toThrow("金额为必填项");
    await expect(flow.submit(validInput({ amount: 0 }), SUBMITTER)).rejects.toThrow("金额必须大于 0");
    await expect(flow.submit(validInput({ amount: -1 }), SUBMITTER)).rejects.toThrow("金额必须大于 0");
    await expect(flow.submit(validInput({ amount: 10_000_000 }), SUBMITTER)).rejects.toThrow("金额不能超过 9,999,999.99");
    await expect(flow.submit(validInput({ amount: 100.123 }), SUBMITTER)).rejects.toThrow("金额最多两位小数");
  });

  it("金额上限恰好 9,999,999.99 可提交并写入单据", async () => {
    const created = await flow.submit(validInput({ amount: 9_999_999.99 }), SUBMITTER);
    expect(created.amount).toBe(9_999_999.99);
    expect(created.currency).toBe("CNY");
  });

  it("非法币种 → 错误；缺省默认 CNY；大小写规范化", async () => {
    await expect(flow.submit(validInput({ currency: "RMB" }), SUBMITTER)).rejects.toThrow(/币种不合法/);
    await expect(flow.submit(validInput({ currency: "cny" }), SUBMITTER)).resolves.toMatchObject({ currency: "CNY" });
    const usd = await flow.submit(validInput({ currency: "usd" }), SUBMITTER);
    expect(usd.currency).toBe("USD");
  });

  it("到期日期必须晚于生效日期；缺一则跳过", async () => {
    await expect(
      flow.submit(validInput({ effectiveDate: "2026-01-01", expirationDate: "2026-01-01" }), SUBMITTER),
    ).rejects.toThrow("到期日期必须晚于生效日期");
    await expect(
      flow.submit(validInput({ effectiveDate: "2026-01-01", expirationDate: "2025-12-31" }), SUBMITTER),
    ).rejects.toThrow("到期日期必须晚于生效日期");
    await flow.submit(validInput({ effectiveDate: "2026-01-01", expirationDate: "2026-02-01" }), SUBMITTER);
    await flow.submit(validInput({ effectiveDate: "2026-01-01" }), SUBMITTER);
    await flow.submit(validInput({ expirationDate: "2026-02-01" }), SUBMITTER);
  });
});

describe("contract-approval 合同编号生成", () => {
  let store: FakeStore;
  let counter: FakeCounter;
  let flow: ContractApprovalFlowService;

  beforeEach(() => {
    store = new FakeStore();
    counter = new FakeCounter();
    flow = new ContractApprovalFlowService(store, counter);
  });

  it("留空自动生成：首次 HT-2026-001、再次 HT-2026-002，KV 计数累加", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T04:00:00Z"));
    try {
      const first = await flow.submit(validInput(), SUBMITTER);
      const second = await flow.submit(validInput(), SUBMITTER);
      expect(first.contractNumber).toBe("HT-2026-001");
      expect(second.contractNumber).toBe("HT-2026-002");
      expect(counter.map.get(KV_KEYS.contractNumber(2026))).toBe("2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("计数缺失或损坏时从 HT-2026-001 开始", async () => {
    counter.map.set(KV_KEYS.contractNumber(2026), "abc");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T04:00:00Z"));
    try {
      const created = await flow.submit(validInput(), SUBMITTER);
      expect(created.contractNumber).toBe("HT-2026-001");
    } finally {
      vi.useRealTimers();
    }
  });

  it("手动编号重复 → 合同编号已存在（编号）", async () => {
    await flow.submit(validInput({ contractNumber: "HT-2026-001" }), SUBMITTER);
    await expect(
      flow.submit(validInput({ contractNumber: "HT-2026-001" }), SUBMITTER),
    ).rejects.toThrow("合同编号已存在（HT-2026-001）");
    expect(counter.map.has(KV_KEYS.contractNumber(2026))).toBe(false);
  });

  it("手动编号唯一时直接采用，不占用 KV 计数", async () => {
    const created = await flow.submit(validInput({ contractNumber: "CT-USR-9" }), SUBMITTER);
    expect(created.contractNumber).toBe("CT-USR-9");
    expect(counter.map.has(KV_KEYS.contractNumber(2026))).toBe(false);
  });

  it("预览编号 helper：HT-2026-042 且不写入计数", async () => {
    counter.map.set(KV_KEYS.contractNumber(2026), "41");
    expect(await peekNextContractNumber(counter, 2026)).toBe("HT-2026-042");
    expect(counter.map.get(KV_KEYS.contractNumber(2026))).toBe("41");
    expect(formatContractNumber(2026, 7)).toBe("HT-2026-007");
  });
});

// ---------- HTTP 层（index.ts 端点，经 module-gateway 全链路） ----------

interface HttpCtx {
  env: Env;
  kv: Map<string, string>;
  objects: Map<string, { body: string; contentType?: string }>;
}

function createHttpCtx(): HttpCtx {
  const kv = new Map<string, string>();
  kv.set(
    KV_KEYS.contractApprovalConfig,
    JSON.stringify({
      base: "neuBase0123456789",
      tables: { approvals: "tblApprovals1", comments: "tblComments1", events: "tblEvents1" },
      updatedAt: new Date().toISOString(),
    }),
  );
  kv.set(
    KV_KEYS.session("sid-1"),
    JSON.stringify({
      name: "提交人",
      open_id: "ou_submitter",
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + 4 * 24 * 3600e3,
    }),
  );
  const objects = new Map<string, { body: string; contentType?: string }>();
  const env = {
    REGISTRY: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
      list: async () => ({ keys: [] }),
    },
    APPS_BUCKET: {
      get: async (k: string) => {
        const o = objects.get(k);
        return o ? { body: o.body, httpMetadata: { contentType: o.contentType } } : null;
      },
      put: async (k: string, v: string) => void objects.set(k, v as never),
      delete: async (k: string) => void objects.delete(k),
    },
  } as unknown as Env;
  return { env, kv, objects };
}

async function httpGet(ctx: HttpCtx, fullPath: string): Promise<Response> {
  // 与实际路由一致：pathname 不带 query，query 保留在 request.url
  const url = new URL(`https://hub.test${fullPath}`);
  const res = await handleContractApproval(
    new Request(url.toString(), { headers: { cookie: "nec_session=sid-1" } }),
    ctx.env,
    url.pathname,
  );
  if (!res) throw new Error(`no handler matched ${url.pathname}`);
  return res;
}

describe("contract-approval HTTP 端点", () => {
  let ctx: HttpCtx;

  beforeEach(() => {
    ctx = createHttpCtx();
    vi.mocked(loadMemberDirectory).mockReset();
  });

  it("GET /next-number：预览不占用计数", async () => {
    const year = new Date().getFullYear();
    ctx.kv.set(KV_KEYS.contractNumber(year), "41");
    const res = await httpGet(ctx, "/api/contract-approval/next-number");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ number: `HT-${year}-042` });
    expect(ctx.kv.get(KV_KEYS.contractNumber(year))).toBe("41");
  });

  it("GET /next-number：计数为空时预览 001 且不创建键", async () => {
    const year = new Date().getFullYear();
    const res = await httpGet(ctx, "/api/contract-approval/next-number");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ number: `HT-${year}-001` });
    expect(ctx.kv.has(KV_KEYS.contractNumber(year))).toBe(false);
  });

  it("GET /members：q 命中姓名与 ou_ 子串；无匹配返回空数组", async () => {
    vi.mocked(loadMemberDirectory).mockResolvedValue(
      new Map([
        ["张三", "ou_zhangsan"],
        ["李四", "ou_lisi"],
      ]),
    );
    const byName = await httpGet(ctx, "/api/contract-approval/members?q=%E5%BC%A0");
    expect(byName.status).toBe(200);
    expect(await byName.json()).toEqual({ members: [{ name: "张三", open_id: "ou_zhangsan" }] });

    const byOid = await httpGet(ctx, "/api/contract-approval/members?q=ou_li");
    const byOidData = (await byOid.json()) as { members: Array<{ name: string; open_id: string }> };
    expect(byOidData.members).toEqual([{ name: "李四", open_id: "ou_lisi" }]);

    const miss = await httpGet(ctx, "/api/contract-approval/members?q=%E7%8E%8B");
    expect(await miss.json()).toEqual({ members: [] });
  });

  it("GET /members：目录未配置或为空 → 空数组 + hint 队员名单未配置", async () => {
    vi.mocked(loadMemberDirectory).mockResolvedValue(null);
    const res = await httpGet(ctx, "/api/contract-approval/members?q=%E5%BC%A0");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ members: [], hint: "队员名单未配置" });

    vi.mocked(loadMemberDirectory).mockResolvedValue(new Map());
    const empty = await httpGet(ctx, "/api/contract-approval/members?q=%E5%BC%A0");
    expect(await empty.json()).toEqual({ members: [], hint: "队员名单未配置" });
  });

  it("GET /file：200 流式返回 R2 对象，Content-Type 与 inline filename 正确", async () => {
    ctx.objects.set("receipts/20261015/uuid-x.pdf", { body: "%PDF-1.4 fake", contentType: "application/pdf" });
    const res = await httpGet(
      ctx,
      `/api/contract-approval/file?key=${encodeURIComponent("receipts/20261015/uuid-x.pdf")}&name=${encodeURIComponent("采购合同.pdf")}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toContain("inline");
    expect(cd).toContain(encodeURIComponent("采购合同.pdf"));
    expect(await res.text()).toBe("%PDF-1.4 fake");
  });

  it("GET /file：对象不存在 404；无 metadata 默认 octet-stream 并以 key 尾部兜底文件名", async () => {
    const miss = await httpGet(ctx, "/api/contract-approval/file?key=receipts%2Fnope.pdf");
    expect(miss.status).toBe(404);
    expect(await miss.json()).toEqual({ error: "文件不存在" });

    ctx.objects.set("receipts/x/no-meta.bin", { body: "0101" });
    const res = await httpGet(ctx, "/api/contract-approval/file?key=receipts%2Fx%2Fno-meta.bin");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toContain("no-meta.bin");
    expect(await res.text()).toBe("0101");
  });

  it("GET /start：required 含 amount，rules 含金额/币种/日期校验描述", async () => {
    const res = await httpGet(ctx, "/api/contract-approval/start");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { required: string[]; rules: string[] };
    expect(data.required).toContain("amount");
    expect(data.rules.join(" ")).toContain("金额必须大于 0");
    expect(data.rules.join(" ")).toContain("币种仅支持");
    expect(data.rules.join(" ")).toContain("到期日期必须晚于生效日期");
  });
});
