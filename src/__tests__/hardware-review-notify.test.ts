import { afterEach, describe, expect, it, vi } from "vitest";
import type { HardwareReviewAdapter } from "../hardware-review/adapter";
import { ReviewFlowService } from "../hardware-review/flow.service";
import type { HardwareReview } from "../hardware-review/types";

function makeEnv(extra: Record<string, string> = {}): Env {
  return {
    REGISTRY: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    },
    ...extra,
  } as unknown as Env;
}

function makeReview(overrides: Partial<HardwareReview> = {}): HardwareReview {
  return {
    reviewId: "HR-20261024-001",
    projectId: "PRJ-HW",
    hardwareName: "主控板",
    hardwareType: "controller",
    hardwareVersion: "V1.0",
    designerId: "ou-designer",
    hardwareFiles: [{ name: "sch.pdf", token: "r2/sch.pdf" }],
    designNotes: "",
    specification: "",
    status: "pending_review",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeFlow(env: Env, review?: HardwareReview) {
  const adapter = {
    createReview: vi.fn(async (input: HardwareReview) => ({ ...input, recordId: "rec-hw-1" })),
    findReviewById: vi.fn(async () => (review ? { ...review, recordId: "rec-hw-1" } : null)),
    updateReview: vi.fn(async (_recordId: string, update: Partial<HardwareReview>) => ({
      ...review!,
      ...update,
      recordId: "rec-hw-1",
    })),
    createRecord: vi.fn(async () => ({ record_id: "rec-event-1", fields: {} })),
  } as unknown as HardwareReviewAdapter;
  return new ReviewFlowService(env, adapter);
}

function mockWebhook() {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ code: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function webhookMessage(fetchMock: ReturnType<typeof vi.fn>) {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
  return { url, body: JSON.parse(init.body) as { content: { text: string }; sign?: string } };
}

describe("硬件评审群通知", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submit 提交后向 hardware 专属 webhook 推送 HR 单通知", async () => {
    const fetchMock = mockWebhook();
    const env = makeEnv({
      FEISHU_BOT_WEBHOOK_HARDWARE: "https://hardware.example/hook",
      FEISHU_BOT_WEBHOOK_HARDWARE_SECRET: "hardware-secret",
    });
    const flow = makeFlow(env);

    const saved = await flow.submit(
      {
        projectId: "PRJ-HW",
        hardwareName: "主控板",
        hardwareVersion: "V1.0",
        hardwareFiles: [{ name: "sch.pdf", token: "r2/sch.pdf" }],
      },
      "ou-designer",
    );

    expect(saved.reviewId).toMatch(/^HR-\d{8}-\d{3}$/);
    const { url, body } = webhookMessage(fetchMock);
    expect(url).toBe("https://hardware.example/hook");
    expect(body.content.text).toBe(
      `🔧 新硬件评审单提交\n评审单 ${saved.reviewId}（主控板，V1.0）\n设计负责人：ou-designer\n请及时安排评审会议`,
    );
    expect(body.sign).toEqual(expect.any(String));
  });

  it("transitionTo 状态流转后回退主群 webhook 推送状态变更", async () => {
    const fetchMock = mockWebhook();
    const env = makeEnv({
      FEISHU_BOT_WEBHOOK: "https://main.example/hook",
      FEISHU_BOT_WEBHOOK_SECRET: "main-secret",
    });
    const flow = makeFlow(env, makeReview({ status: "assessing" }));

    const updated = await flow.transitionTo("HR-20261024-001", "pass", "ou-lead");

    expect(updated.status).toBe("approved");
    const { url, body } = webhookMessage(fetchMock);
    expect(url).toBe("https://main.example/hook");
    expect(body.content.text).toBe(
      "🔧 硬件评审状态变更\n评审单 HR-20261024-001（主控板）\nassessing → approved\n操作人：ou-lead",
    );
    expect(body.sign).toEqual(expect.any(String));
  });
});
