/**
 * G-05 邮件通道测试（飞书邮箱 OpenAPI）
 *
 * 覆盖：buildEml 编码（RFC 2047 中文主题 / base64url 正文 / From 可选）
 * sendFeishuMail 启停（未配置 disabled、发信人未授权 disabled）· 草稿两段式发送
 * 失败留痕 notify:failed · toolSendNotice channel=mail/both · notifyApprovalResult 收件人选择
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalResultMailHtml, buildEml, defaultMailRecipients, sendFeishuMail } from "../feishu/mail";
import { notifyApprovalResult } from "../notify";
import { toolSendNotice } from "../approvals/handlers";

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

interface Ctx {
  env: Env;
  kv: Map<string, string>;
  mailCalls: Array<{ url: string; body: Record<string, unknown> }>;
  webhookCalls: Array<{ url: string; body: Record<string, unknown> }>;
  /** 草稿创建失败次数（用于失败留痕用例） */
  draftFailTimes: number;
}

function createCtx(opts: { withSender?: boolean; mailTo?: string; draftFailTimes?: number } = {}): Ctx {
  const kv = new Map<string, string>();
  const ctx: Ctx = {
    env: undefined as unknown as Env,
    kv,
    mailCalls: [],
    webhookCalls: [],
    draftFailTimes: opts.draftFailTimes ?? 0,
  };

  if (opts.withSender) {
    kv.set(
      "feishu:user_token:ou-sender",
      JSON.stringify({
        user_access_token: "u-token",
        refresh_token: "r-token",
        expires_at: Date.now() + 3600e3,
        refresh_expires_at: Date.now() + 30 * 24 * 3600e3,
      }),
    );
  }
  kv.set("flows:config", JSON.stringify({ reimburse: { tableId: "tblR", base: "appB", mailTo: ["flow@nec.com"] } }));

  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.includes("/bot/v2/hook/")) {
      ctx.webhookCalls.push({ url, body: JSON.parse(init?.body ?? "{}") });
      return jsonResp({ code: 0, msg: "ok" });
    }
    if (/\/mail\/v1\/user_mailboxes\/[^/]+\/drafts\/[^/]+\/send/.test(url)) {
      ctx.mailCalls.push({ url, body: init?.body ? JSON.parse(init.body) : {} });
      return jsonResp({ code: 0, data: { message_id: "msg-1" } });
    }
    if (/\/mail\/v1\/user_mailboxes\/[^/]+\/drafts$/.test(url)) {
      ctx.mailCalls.push({ url, body: JSON.parse(init?.body ?? "{}") });
      if (ctx.draftFailTimes > 0) {
        ctx.draftFailTimes--;
        return jsonResp({ code: 1234001, msg: "no permission" });
      }
      // 飞书真实响应形状：data.draft.id（验收实测纠正，见 mail.ts 取值处的兼容注释）
      return jsonResp({ code: 0, data: { draft: { id: "draft-1" } } });
    }
    return jsonResp({ code: 404, msg: `not mocked: ${url}` });
  }));

  ctx.env = {
    REGISTRY: {
      get: vi.fn(async (key: string, type?: string) => {
        const v = kv.get(key);
        return v == null ? null : type === "json" ? JSON.parse(v) : v;
      }),
      put: vi.fn(async (key: string, value: string) => { kv.set(key, value); }),
      delete: vi.fn(async (key: string) => { kv.delete(key); }),
    },
    FEISHU_APP_ID: "mock-app-id",
    FEISHU_APP_SECRET: "mock-app-secret",
    FEISHU_BOT_WEBHOOK: "https://open.feishu.cn/open-apis/bot/v2/hook/abc",
    ...(opts.withSender ? { MAIL_SENDER_OPEN_ID: "ou-sender" } : {}),
    ...(opts.mailTo ? { MAIL_TO: opts.mailTo } : {}),
  } as unknown as Env;
  return ctx;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

/** 解码 base64url → utf8 文本（校验 EML 内容用） */
function decodeRaw(raw: string): string {
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

describe("buildEml（EML 构建）", () => {
  const ctx = { env: {} as Env };

  it("中文主题转 RFC 2047 encoded-word，正文 base64 折行", () => {
    const eml = buildEml(ctx.env, { to: ["a@nec.com"], subject: "✅ 已通过 BX-2026-0001", html: "<p>正文</p>" });
    expect(eml).toContain("To: a@nec.com");
    expect(eml).toMatch(/Subject: =\?UTF-8\?B\?.+\?=/);
    expect(eml).toContain('Content-Type: text/html; charset="utf-8"');
    expect(eml).toContain("Content-Transfer-Encoding: base64");
    expect(eml).not.toContain("From:");
  });

  it("ASCII 主题不编码；配置 MAIL_FROM 时带 From 头", () => {
    const env = { MAIL_FROM: "hub@nec.com" } as unknown as Env;
    const eml = buildEml(env, { to: ["a@nec.com", "b@nec.com"], subject: "Weekly Report", html: "<p>x</p>" });
    expect(eml).toContain("Subject: Weekly Report");
    expect(eml.startsWith("From: hub@nec.com")).toBe(true);
    expect(eml).toContain("To: a@nec.com, b@nec.com");
  });
});

describe("sendFeishuMail（发信通道）", () => {
  it("未配置 MAIL_SENDER_OPEN_ID → disabled，不发请求", async () => {
    const ctx = createCtx();
    const res = await sendFeishuMail(ctx.env, { to: ["a@nec.com"], subject: "s", html: "<p>x</p>" });
    expect(res.ok).toBe(false);
    expect(res.disabled).toBe(true);
    expect(ctx.mailCalls.length).toBe(0);
  });

  it("发信人未授权（无 user_token）→ disabled", async () => {
    const ctx = createCtx();
    (ctx.env as unknown as Record<string, string>).MAIL_SENDER_OPEN_ID = "ou-nobody";
    const res = await sendFeishuMail(ctx.env, { to: ["a@nec.com"], subject: "s", html: "<p>x</p>" });
    expect(res.disabled).toBe(true);
    expect(res.detail).toContain("授权");
  });

  it("草稿两段式：create → send，EML 可还原", async () => {
    const ctx = createCtx({ withSender: true });
    const res = await sendFeishuMail(ctx.env, { to: ["a@nec.com"], subject: "审批结果", html: "<p>通过</p>" });
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("msg-1");
    expect(ctx.mailCalls.length).toBe(2);
    expect(ctx.mailCalls[0].url).toMatch(/\/user_mailboxes\/me\/drafts$/);
    expect(ctx.mailCalls[1].url).toContain("/drafts/draft-1/send");
    const eml = decodeRaw(String(ctx.mailCalls[0].body.raw));
    expect(eml).toContain("To: a@nec.com");
  });

  it("创建草稿失败 → ok:false 且写 notify:failed 留痕", async () => {
    const ctx = createCtx({ withSender: true, draftFailTimes: 1 });
    const res = await sendFeishuMail(ctx.env, { to: ["a@nec.com"], subject: "s", html: "<p>x</p>" });
    expect(res.ok).toBe(false);
    expect(res.disabled).toBeUndefined();
    const failed = JSON.parse(ctx.kv.get("notify:failed") ?? "[]");
    expect(failed.length).toBe(1);
    expect(failed[0].flow).toBe("mail");
    expect(failed[0].detail).toContain("no permission");
  });

  it("无收件人 → disabled", async () => {
    const ctx = createCtx({ withSender: true });
    const res = await sendFeishuMail(ctx.env, { to: [], subject: "s", html: "<p>x</p>" });
    expect(res.disabled).toBe(true);
  });
});

describe("toolSendNotice（channel 参数）", () => {
  it("channel=mail 发邮件；缺收件人时报错", async () => {
    const ctx = createCtx({ withSender: true });
    const ok = await toolSendNotice({ flow: "reimburse", title: "t", content: "c", channel: "mail", to: "a@nec.com, b@nec.com" }, ctx.env, true);
    expect(ok.content[0].text).toContain("2 个收件人");
    expect(ctx.mailCalls.length).toBe(2);

    await expect(toolSendNotice({ flow: "reimburse", title: "t", content: "c", channel: "mail" }, ctx.env, true)).rejects.toThrow("MAIL_TO");
  });

  it("channel=mail 未启用时返回降级说明而非报错", async () => {
    const ctx = createCtx();
    const res = await toolSendNotice({ flow: "reimburse", title: "t", content: "c", channel: "mail", to: "a@nec.com" }, ctx.env, true);
    expect(res.content[0].text).toContain("未启用");
  });

  it("channel=both 双通道各自报告", async () => {
    const ctx = createCtx({ withSender: true, mailTo: "team@nec.com" });
    const res = await toolSendNotice({ flow: "reimburse", title: "t", content: "c", channel: "both" }, ctx.env, true);
    expect(res.content[0].text).toContain("群机器人已送达");
    expect(res.content[0].text).toContain("邮件已发送");
    expect(ctx.webhookCalls.length).toBe(1);
    expect(ctx.mailCalls.length).toBe(2);
  });

  it("缺省 channel=bot 行为不变；非法 channel 报错", async () => {
    const ctx = createCtx();
    const res = await toolSendNotice({ flow: "reimburse", title: "t", content: "c" }, ctx.env, true);
    expect(res.content[0].text).toContain("✅ 已发送");
    expect(ctx.mailCalls.length).toBe(0);
    await expect(toolSendNotice({ flow: "reimburse", title: "t", content: "c", channel: "sms" }, ctx.env, true)).rejects.toThrow("channel");
  });
});

describe("notifyApprovalResult（审批结果双通道）", () => {
  it("flow.mailTo 优先于 env MAIL_TO；群机器人始终发送", async () => {
    const ctx = createCtx({ withSender: true, mailTo: "env@nec.com" });
    const res = await notifyApprovalResult(ctx.env, "reimburse", "✅ 已通过 BX-1", "审批人：张队", "https://link", {
      applicant: "张三",
      typeLabel: "报销申请",
    });
    expect(res.bot.ok).toBe(true);
    expect(res.mail?.ok).toBe(true);
    const eml = decodeRaw(String(ctx.mailCalls[0].body.raw));
    expect(eml).toContain("To: flow@nec.com");
    expect(eml).not.toContain("env@nec.com");
  });

  it("flow 未配 mailTo 时 fallback env MAIL_TO；全空则不发邮件", async () => {
    const ctx = createCtx({ withSender: true, mailTo: "env@nec.com" });
    const res = await notifyApprovalResult(ctx.env, "drawing", "❌ 已驳回 MECH-1", "驳回原因：图号重复", undefined);
    expect(res.mail?.ok).toBe(true);
    const eml = decodeRaw(String(ctx.mailCalls[0].body.raw));
    expect(eml).toContain("To: env@nec.com");

    const ctx2 = createCtx({ withSender: true });
    const res2 = await notifyApprovalResult(ctx2.env, "drawing", "t", "c", undefined);
    expect(res2.mail).toBeUndefined();
    expect(ctx2.mailCalls.length).toBe(0);
  });

  it("邮件通道未启用不影响群机器人送达", async () => {
    const ctx = createCtx({ mailTo: "env@nec.com" });
    const res = await notifyApprovalResult(ctx.env, "reimburse", "t", "c", undefined);
    expect(res.bot.ok).toBe(true);
    expect(res.mail?.disabled).toBe(true);
  });
});

describe("approvalResultMailHtml（结果邮件模板）", () => {
  it("含申请人/类型/摘要/链接按钮", () => {
    const html = approvalResultMailHtml({
      title: "✅ 已通过 BX-2026-0001",
      applicant: "张三",
      typeLabel: "报销申请",
      summary: "审批人：张队",
      link: "https://example.com/rec",
    });
    expect(html).toContain("张三");
    expect(html).toContain("报销申请");
    expect(html).toContain("审批人：张队");
    expect(html).toContain('href="https://example.com/rec"');
  });
});

describe("defaultMailRecipients", () => {
  it("解析 MAIL_TO 逗号/分号分隔", () => {
    const env = { MAIL_TO: " a@nec.com , b@nec.com;c@nec.com " } as unknown as Env;
    expect(defaultMailRecipients(env)).toEqual(["a@nec.com", "b@nec.com", "c@nec.com"]);
  });
});
