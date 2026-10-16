/**
 * 通知域测试（PRD 审批与通知中心 N-01 / 对照清单 A4）：
 * 加签向量、未配置降级、消息体形状与按流程分流、失败重试后写 notify:failed
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { feishuBotSign, notifyFeishu } from "../feishu/bot";
import { createMockEnv } from "./mock-env";

function makeEnv(extra: Record<string, string> = {}): Env {
  return { ...createMockEnv(), ...extra } as unknown as Env;
}

function jsonFetch(data: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }),
  );
}

describe("feishuBotSign（对齐飞书官方示例）", () => {
  it("已知向量：timestamp=1700000000, secret=test-secret", async () => {
    // 向量由 Node crypto（独立实现）预计算：HMAC-SHA256(key=`${ts}\n${secret}`, msg="") → base64
    expect(await feishuBotSign("test-secret", 1700000000)).toBe("mbm4Y4oluIPQ00qlBIhX8vAZ0EKv3nw0LuTb91jPL84=");
  });

  it("同 secret 不同 timestamp 输出不同", async () => {
    const a = await feishuBotSign("s", 1700000000);
    const b = await feishuBotSign("s", 1700000001);
    expect(a).not.toBe(b);
  });
});

describe("notifyFeishu", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("未配置 webhook → 静默降级，不发请求", async () => {
    const fetchMock = jsonFetch({ code: 0 });
    vi.stubGlobal("fetch", fetchMock);
    const r = await notifyFeishu(makeEnv(), "reimburse", "标题", "正文");
    expect(r.ok).toBe(false);
    expect(r.detail).toBe("未配置 webhook");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("成功路径：msg_type/text 嵌套、按流程分流 webhook、附时间戳与签名", async () => {
    const fetchMock = jsonFetch({ code: 0 });
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv({
      FEISHU_BOT_WEBHOOK: "https://main.example/hook",
      FEISHU_BOT_WEBHOOK_SECRET: "main-s3cret",
      FEISHU_BOT_WEBHOOK_REIMBURSE: "https://rb.example/hook",
    });
    const r = await notifyFeishu(env, "reimburse", "📋 新报销申请", "事项：打印纸", "https://link");
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("https://rb.example/hook");
    const body = JSON.parse(init.body) as { msg_type: string; content: { text: string }; timestamp: number; sign: string };
    expect(body.msg_type).toBe("text");
    expect(body.content.text).toBe("📋 新报销申请\n事项：打印纸\n去处理：https://link");
    expect(typeof body.timestamp).toBe("number");
    expect(body.sign).toBe(await feishuBotSign("main-s3cret", body.timestamp));
  });

  it("未配 SECRET 时不带签名（timestamp/sign 缺席）", async () => {
    const fetchMock = jsonFetch({ code: 0 });
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv({ FEISHU_BOT_WEBHOOK: "https://main.example/hook" });
    const r = await notifyFeishu(env, "reimburse", "t", "c");
    expect(r.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body);
    expect(body.timestamp ?? null).toBeNull();
    expect(body.sign ?? null).toBeNull();
  });

  it("连续 3 次失败（重试 1s/4s）→ 记录 KV notify:failed，不抛错", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => {
        return new Response(JSON.stringify({ code: 19001, msg: "boom" }), { status: 200, headers: { "content-type": "application/json" } });
      });
      vi.stubGlobal("fetch", fetchMock);
      const env = createMockEnv() as unknown as Env;
      Object.assign(env, { FEISHU_BOT_WEBHOOK: "https://main.example/hook" });
      const p = notifyFeishu(env, "reimburse", "t", "c");
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(4000);
      const r = await p;
      expect(r.ok).toBe(false);
      expect(r.detail).toContain("发送失败（重试 2 次）");
      expect(fetchMock).toHaveBeenCalledTimes(3);
      const putMock = (env as unknown as ReturnType<typeof createMockEnv>).REGISTRY.put;
      const putCall = putMock.mock.calls.find((c) => c[0] === "notify:failed");
      expect(putCall).toBeDefined();
      const list = JSON.parse(putCall![1]) as Array<{ flow: string; title: string; detail: string; at: string }>;
      expect(list).toHaveLength(1);
      expect(list[0].flow).toBe("reimburse");
      expect(list[0].title).toBe("t");
      expect(list[0].detail).toContain("boom");
    } finally {
      vi.useRealTimers();
    }
  });

  it("第 1 次网络异常、第 2 次成功 → 重试后 ok 且不记录失败", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fetchMock = vi.fn(async () => {
        calls++;
        if (calls === 1) throw new Error("network down");
        return new Response(JSON.stringify({ code: 0 }), { status: 200, headers: { "content-type": "application/json" } });
      });
      vi.stubGlobal("fetch", fetchMock);
      const env = createMockEnv() as unknown as Env;
      Object.assign(env, { FEISHU_BOT_WEBHOOK: "https://main.example/hook" });
      const p = notifyFeishu(env, "reimburse", "t", "c");
      await vi.advanceTimersByTimeAsync(1000);
      const r = await p;
      expect(r.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const putMock = (env as unknown as ReturnType<typeof createMockEnv>).REGISTRY.put;
      expect(putMock.mock.calls.some((c) => c[0] === "notify:failed")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});