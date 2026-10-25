/**
 * 飞书邮箱发信通道测试：
 * - 指定发信人形态：EML 构造（RFC 2047 主题 / base64 正文 / 头字段）、profile→草稿→发送三步链路、失败降级
 * - 团队通道形态（G-05）：buildEml 编码（中文主题 / 正文折行 / From 可选）、sendFeishuMail 启停
 *   （未配置 disabled、发信人未授权 disabled）、草稿两段式发送、失败留痕 notify:failed、
 *   toolSendNotice channel=mail/both、notifyApprovalResult 收件人选择、defaultMailRecipients 解析
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approvalResultMailHtml,
  buildEml,
  buildPlainEml,
  defaultMailRecipients,
  sendFeishuMail,
  sendMailWithToken,
  toBase64Url,
  utf8ToB64,
} from "../feishu/mail";
import { notifyApprovalResult } from "../notify";
import { toolSendNotice } from "../approvals/handlers";
import { KV_KEYS } from "../shared/kv-keys";

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

/** base64url（含折行）→ 标准 base64 → UTF-8 解码 */
function decodeRaw(raw: string): string {
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** 内存 KV + 最小 env（REGISTRY 走真实 user-token 模块可读的 KV 形态） */
function makeEnv(kv: Map<string, string>, extra: Record<string, string> = {}): Env {
  return {
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
    ...extra,
  } as unknown as Env;
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
      KV_KEYS.feishuUserToken("ou-sender"),
      JSON.stringify({
        user_access_token: "u-token",
        refresh_token: "r-token",
        expires_at: Date.now() + 3600e3,
        refresh_expires_at: Date.now() + 30 * 24 * 3600e3,
      }),
    );
  }
  kv.set(KV_KEYS.flowsConfig, JSON.stringify({ reimburse: { tableId: "tblR", base: "appB", mailTo: ["flow@nec.com"] } }));

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

  ctx.env = makeEnv(kv, {
    FEISHU_BOT_WEBHOOK: "https://open.feishu.cn/open-apis/bot/v2/hook/abc",
    ...(opts.withSender ? { MAIL_SENDER_OPEN_ID: "ou-sender" } : {}),
    ...(opts.mailTo ? { MAIL_TO: opts.mailTo } : {}),
  });
  return ctx;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

// ============ 指定发信人形态 ============

describe("EML 构造（buildPlainEml）", () => {
  it("中文主题走 RFC 2047 encoded-word，正文 base64 可还原", () => {
    const eml = buildPlainEml({
      from: { address: "me@nec.club", name: "张三" },
      to: ["a@x.com", "b@x.com"],
      cc: ["c@x.com"],
      subject: "报销审批通知",
      text: "你的报销已通过",
    });
    expect(eml).toContain("From: =?UTF-8?B?".concat(utf8ToB64("张三")).concat("?= <me@nec.club>"));
    expect(eml).toContain("To: <a@x.com>, <b@x.com>");
    expect(eml).toContain("Cc: <c@x.com>");
    expect(eml).toContain(`Subject: =?UTF-8?B?${utf8ToB64("报销审批通知")}?=`);
    expect(eml).toContain('Content-Type: text/plain; charset="UTF-8"');
    const body64 = eml.split("\r\n\r\n")[1].replace(/\r?\n/g, "");
    expect(decodeRaw(toBase64Url(body64))).toBe("你的报销已通过");
  });

  it("html 与 text 同时给定时用 html", () => {
    const eml = buildPlainEml({
      from: { address: "me@nec.club" },
      to: ["a@x.com"],
      subject: "s",
      text: "t",
      html: "<p>hi</p>",
    });
    expect(eml).toContain('Content-Type: text/html; charset="UTF-8"');
    const body64 = eml.split("\r\n\r\n")[1].replace(/\r?\n/g, "");
    expect(decodeRaw(toBase64Url(body64))).toBe("<p>hi</p>");
  });

  it("无 cc/bcc 时不产生对应头", () => {
    const eml = buildPlainEml({ from: { address: "me@nec.club" }, to: ["a@x.com"], subject: "s", text: "t" });
    expect(eml).not.toContain("Cc:");
    expect(eml).not.toContain("Bcc:");
  });
});

describe("sendMailWithToken（profile → 草稿 → 发送）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("三步链路成功：返回 ok 且草稿 raw 解码后是完整 EML", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResp({ code: 0, data: { primary_email_address: "me@nec.club" } }))
      .mockResolvedValueOnce(jsonResp({ code: 0, data: { draft: { id: "draft-1" } } }))
      .mockResolvedValueOnce(jsonResp({ code: 0, data: {} }));
    const r = await sendMailWithToken("utok", { to: ["a@x.com"], subject: "通知", text: "正文" });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("draft-1");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [draftUrl, draftInit] = fetchMock.mock.calls[1] as [string, { body: string }];
    expect(draftUrl).toBe("https://open.feishu.cn/open-apis/mail/v1/user_mailboxes/me/drafts");
    const payload = JSON.parse(draftInit.body) as { raw: string };
    const eml = decodeRaw(payload.raw);
    expect(eml).toContain("Subject: ");
    expect(eml).toContain("To: <a@x.com>");
    expect(eml).toContain("From: <me@nec.club>");

    const [sendUrl, sendInit] = fetchMock.mock.calls[2] as [string, { method: string }];
    expect(sendUrl).toBe("https://open.feishu.cn/open-apis/mail/v1/user_mailboxes/me/drafts/draft-1/send");
    expect(sendInit.method).toBe("POST");
  });

  it("profile 拿不到发件地址 → 省略 From 头继续发送（服务端按 me 补主地址）", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResp({ code: 99999, msg: "no permission" }))
      .mockResolvedValueOnce(jsonResp({ code: 0, data: { draft: { id: "draft-f1" } } }))
      .mockResolvedValueOnce(jsonResp({ code: 0, data: {} }));
    const r = await sendMailWithToken("utok", { to: ["a@x.com"], subject: "s", text: "t" });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("draft-f1");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [, draftInit] = fetchMock.mock.calls[1] as [string, { body: string }];
    const payload = JSON.parse(draftInit.body) as { raw: string };
    const eml = decodeRaw(payload.raw);
    expect(eml).not.toContain("From:");
    expect(eml).toContain("To: <a@x.com>");
  });

  it("草稿创建失败 → 返回错误且不带 draftId", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResp({ code: 0, data: { primary_email_address: "me@nec.club" } }))
      .mockResolvedValueOnce(jsonResp({ code: 1254001, msg: "内容超限" }));
    const r = await sendMailWithToken("utok", { to: ["a@x.com"], subject: "s", text: "t" });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("草稿创建失败");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fromAddress 显式指定 → 跳过 profile，直接用指定地址发 From", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResp({ code: 0, data: { draft: { id: "draft-af" } } }))
      .mockResolvedValueOnce(jsonResp({ code: 0, data: {} }));
    const r = await sendMailWithToken("utok", { to: ["a@x.com"], subject: "s", text: "t", fromAddress: "alias@nec.club" });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, draftInit] = fetchMock.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(draftInit.body) as { raw: string };
    expect(decodeRaw(payload.raw)).toContain("From: <alias@nec.club>");
  });

  it("发送失败 → 提示草稿保留可手动补发", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResp({ code: 0, data: { primary_email_address: "me@nec.club" } }))
      .mockResolvedValueOnce(jsonResp({ code: 0, data: { draft: { id: "draft-9" } } }))
      .mockResolvedValueOnce(jsonResp({ code: 1254100, msg: "发送失败" }));
    const r = await sendMailWithToken("utok", { to: ["a@x.com"], subject: "s", text: "t" });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("草稿 draft-9 已保留");
  });
});

describe("sendFeishuMail（指定发信人 openId 代发）", () => {
  it("发信人未授权 → 失败并提示先登录授权", async () => {
    const kv = new Map<string, string>();
    const env = makeEnv(kv);
    const r = await sendFeishuMail(env, "ou_1", { to: ["a@x.com"], subject: "s", text: "t" });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("未登录过中台或授权已过期");
  });

  it("发信人已授权 → 走 profile→草稿→发送链路成功", async () => {
    const kv = new Map<string, string>([
      [KV_KEYS.feishuUserToken("ou_1"), JSON.stringify({
        user_access_token: "utok",
        refresh_token: "r-token",
        expires_at: Date.now() + 3600e3,
        refresh_expires_at: Date.now() + 30 * 24 * 3600e3,
      })],
    ]);
    const env = makeEnv(kv);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResp({ code: 0, data: { primary_email_address: "me@nec.club" } }))
      .mockResolvedValueOnce(jsonResp({ code: 0, data: { draft: { id: "draft-2" } } }))
      .mockResolvedValueOnce(jsonResp({ code: 0, data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendFeishuMail(env, "ou_1", { to: ["a@x.com"], subject: "s", text: "t" });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("draft-2");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

// ============ 团队通道形态（G-05） ============

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

describe("sendFeishuMail（团队发信通道）", () => {
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
    const failed = JSON.parse(ctx.kv.get(KV_KEYS.notifyFailed) ?? "[]");
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