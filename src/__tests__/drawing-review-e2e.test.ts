/**
 * 图纸评审全链路 e2e（路由级，内存 Base mock）
 *
 * 走通：submit → meeting → conclusion(passed) → bom/generate → inquiries/generate
 *       → quote → compare/select，并覆盖两个曾阻断流程的坑：
 *   1. 无 BOM 时 inquiries/generate 报「尚无 BOM」；
 *   2. bom/generate 幂等（重复调用返回 existed，不产生重复 BOM、不因状态机报错）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleDrawingReview } from "../drawing-review";
import { KV_KEYS } from "../shared/kv-keys";
import { createDrMock, DR_TABLES, type DrMockCtx } from "./dr-test-utils";

const SID = "sid-e2e";
// mock 会话有效期 1h < 7 天的一半，每次请求都会滑动续期轮换 sid，需跟随 set-cookie
let currentSid = SID;

function api(pathname: string, method = "GET", body?: unknown): Promise<Response | null> {
  const ctx = currentCtx();
  return handleDrawingReview(
    new Request(`http://localhost${pathname}`, {
      method,
      headers: { "content-type": "application/json", cookie: `nec_session=${currentSid}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    ctx.env,
    pathname,
  );
}

let ctx: DrMockCtx;
function currentCtx(): DrMockCtx {
  return ctx;
}

async function apiJson(pathname: string, method = "GET", body?: unknown): Promise<{ status: number; data: any }> {
  const res = await api(pathname, method, body);
  expect(res).not.toBeNull();
  const setCookie = res!.headers.get("set-cookie");
  const m = setCookie?.match(/nec_session=([^;]+)/);
  if (m) currentSid = m[1];
  return { status: res!.status, data: await res!.json() };
}

describe("图纸评审全链路 e2e", () => {
  beforeEach(() => {
    currentSid = SID;
    ctx = createDrMock({ session: { sid: SID, openId: "ou-e2e", name: "链路测试" } });
    // 报价回填与选定供应商需管理角色：把 e2e 用户登记为队长
    ctx.kv.set(KV_KEYS.dashboardConfig, JSON.stringify({ base: "appMockBase", tables: { members: "tblMembers" }, updatedAt: "" }));
    ctx.seed("tblMembers", { open_id: "ou-e2e", 姓名: "链路测试", 权限角色: "队长" }, "rec-member-e2e");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("提交 → 会议 → 结论 → BOM → 询价 → 报价 → 比价选定 全程跑通", async () => {
    // 1. 提交评审单 → pending_review
    const submit = await apiJson("/api/drawing-review/submit", "POST", {
      projectId: "PRJ-E2E",
      machineName: "E2E 测试机型",
      drawingVersion: "V1.0",
      drawingFiles: [{ name: "drawing.pdf", token: "tok" }],
      designNotes: "全链路测试",
    });
    expect(submit.status).toBe(200);
    const reviewId: string = submit.data.reviewId;
    // 迁移后单号走引擎年计数器（DR-2026-0001）
    expect(reviewId).toMatch(/^DR-\d{4}-\d{4}$/);
    expect(submit.data.status).toBe("pending_review");
    // 附件落库：写入「图纸文件」文本字段（JSON 序列化），提交响应即读回
    expect(submit.data.drawingFiles).toEqual([{ name: "drawing.pdf", token: "tok" }]);
    const stored = (ctx.tables[DR_TABLES.reviews] ?? [])[0];
    expect(typeof stored.fields["图纸文件"]).toBe("string");
    expect(JSON.parse(stored.fields["图纸文件"] as string)).toEqual([{ name: "drawing.pdf", token: "tok" }]);

    // 2. 无 BOM 时生成询价单 → 明确报错（修复前用户即卡在这一步）
    const earlyGen = await apiJson(`/api/drawing-review/${reviewId}/inquiries/generate`, "POST", {});
    expect(earlyGen.status).toBe(500);
    expect(earlyGen.data.error).toMatch(/尚无 BOM/);

    // 3. 预约会议（飞书 vc 接口在 mock 下 404，自动降级 mock 会议）→ in_review
    const meeting = await apiJson(`/api/drawing-review/${reviewId}/meeting`, "POST", {});
    expect(meeting.status).toBe(200);
    expect(meeting.data.review.status).toBe("in_review");
    expect(meeting.data.meeting.meetingId).toBeTruthy();

    // 4. 提交评审结论 passed → bom_generating
    const conclusion = await apiJson(`/api/drawing-review/${reviewId}/conclusion`, "POST", { conclusion: "passed" });
    expect(conclusion.status).toBe(200);
    expect(conclusion.data.status).toBe("bom_generating");

    // 5. 生成 BOM → assessing
    const bomItems = [
      { materialName: "伺服电机", materialCode: "M-001", specification: "AK10-9", quantity: 2, unit: "台", source: "purchased" },
      { materialName: "联轴器", materialCode: "M-002", specification: "LK-20", quantity: 4, unit: "个", source: "standard" },
      { materialName: "安装支架", quantity: 1, unit: "件", source: "self-made", process: "machining" },
    ];
    const bom = await apiJson(`/api/drawing-review/${reviewId}/bom/generate`, "POST", { items: bomItems });
    expect(bom.status).toBe(200);
    expect(bom.data.items).toHaveLength(3);
    const afterBom = await apiJson(`/api/drawing-review/${reviewId}`);
    expect(afterBom.data.status).toBe("assessing");
    // 详情读回：附件从「图纸文件」文本字段反序列化
    expect(afterBom.data.drawingFiles).toEqual([{ name: "drawing.pdf", token: "tok" }]);

    // 5b. 重复生成 BOM → 幂等返回 existed，不产生重复数据
    const bomAgain = await apiJson(`/api/drawing-review/${reviewId}/bom/generate`, "POST", { items: bomItems });
    expect(bomAgain.status).toBe(200);
    expect(bomAgain.data.existed).toBe(true);
    const bomRows = (ctx.tables[DR_TABLES.bom] ?? []).filter((r) => r.fields["BOM编号"]);
    expect(bomRows).toHaveLength(1);

    // 5c. 空物料清单 → 400
    const bomEmpty = await apiJson(`/api/drawing-review/${reviewId}/bom/generate`, "POST", { items: [] });
    expect(bomEmpty.status).toBe(400);

    // 6. 生成询价单：外购 M-001 两家供应商、标准件 M-002 一家，自制件不生成
    const gen = await apiJson(`/api/drawing-review/${reviewId}/inquiries/generate`, "POST", {
      requiredDate: "2026-11-01",
      suppliers: { "M-001": ["甲供应商", "乙供应商"] },
    });
    expect(gen.status).toBe(200);
    expect(gen.data.created).toHaveLength(3);
    const inqs: any[] = gen.data.created;
    const m1 = inqs.filter((i) => i.materialCode === "M-001");
    expect(m1.map((i) => i.supplierName).sort()).toEqual(["乙供应商", "甲供应商"].sort());
    const m2 = inqs.find((i) => i.materialCode === "M-002");
    expect(m2.supplierName).toBe("待定");

    // 7. 供应商报价回填
    const quoteA = await apiJson(`/api/drawing-review/inquiries/${m1[0].inquiryId}/quote`, "POST", {
      supplier: "甲供应商", price: 100, deliveryDate: "2026-10-20",
    });
    expect(quoteA.status).toBe(200);
    expect(quoteA.data.status).toBe("quoted");
    await apiJson(`/api/drawing-review/inquiries/${m1[1].inquiryId}/quote`, "POST", {
      supplier: "乙供应商", price: 90, deliveryDate: "2026-11-05", // 价低但超需求日期
    });
    await apiJson(`/api/drawing-review/inquiries/${m2.inquiryId}/quote`, "POST", {
      supplier: "丙供应商", price: 15, deliveryDate: "2026-10-18",
    });

    // 8. 比价建议书：乙 90×1.2=108 > 甲 100 → 推荐甲
    const cmp = await apiJson(`/api/drawing-review/${reviewId}/inquiries/compare`, "POST", {});
    expect(cmp.status).toBe(200);
    const mat1 = cmp.data.materials.find((m: any) => m.materialCode === "M-001");
    const quoteJia = m1[0].supplierName === "甲供应商" ? m1[0] : m1[1];
    expect(mat1.recommendedInquiryId).toBe(quoteJia.inquiryId);

    // 9. 选定甲：selected / 其余 rejected
    const sel = await apiJson(`/api/drawing-review/${reviewId}/inquiries/compare`, "POST", {
      selections: { "M-001": quoteJia.inquiryId },
    });
    expect(sel.status).toBe(200);
    expect(sel.data.selected).toEqual([quoteJia.inquiryId]);
    const finalList = await apiJson(`/api/drawing-review/${reviewId}/inquiries`);
    const byId = Object.fromEntries(finalList.data.map((i: any) => [i.inquiryId, i.status]));
    expect(byId[quoteJia.inquiryId]).toBe("selected");
    const quoteYi = m1.find((i) => i.inquiryId !== quoteJia.inquiryId);
    expect(byId[quoteYi.inquiryId]).toBe("rejected");

    // 10. 事件日志覆盖关键动作
    const actions = (ctx.tables[DR_TABLES.events] ?? []).map((r) => r.fields["动作"]);
    for (const a of ["submit", "start_meeting", "conclude", "generated", "inquiry_generate", "inquiry_quote", "inquiry_select"]) {
      expect(actions).toContain(a);
    }
  });

  it("非 bom_generating 状态补录 BOM：只写数据不强行流转", async () => {
    // 直接造一个 assessing 状态但无 BOM 的评审单（模拟历史数据/补录场景）
    ctx.seed(DR_TABLES.reviews, {
      评审单号: "DR-20261014-T01", 项目编号: "PRJ-T", 机型名称: "补录机型",
      图纸版本: "V1.0", 设计负责人: "ou-e2e", 状态: "assessing",
      创建时间: new Date().toISOString(), 更新时间: new Date().toISOString(),
    }, "rec-t01");

    const bom = await apiJson("/api/drawing-review/DR-20261014-T01/bom/generate", "POST", {
      items: [{ materialName: "轴承", materialCode: "M-100", quantity: 8, unit: "个", source: "purchased" }],
    });
    expect(bom.status).toBe(200);
    // 状态保持 assessing，不因 transitionTo 报错
    const review = await apiJson("/api/drawing-review/DR-20261014-T01");
    expect(review.data.status).toBe("assessing");

    // 补录后询价链路立即可用
    const gen = await apiJson("/api/drawing-review/DR-20261014-T01/inquiries/generate", "POST", {});
    expect(gen.status).toBe(200);
    expect(gen.data.created).toHaveLength(1);
    expect(gen.data.created[0].materialCode).toBe("M-100");
  });
});
