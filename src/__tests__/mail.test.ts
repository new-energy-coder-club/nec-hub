/**
 * 飞书邮箱发信通道测试（PRD N-02 邮件通道）：
 * EML 构造（RFC 2047 主题 / base64 正文 / 头字段）、profile→草稿→发送三步链路、失败降级
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPlainEml, sendMailWithToken, sendFeishuMail, toBase64Url, utf8ToB64 } from "../feishu/mail";
import { getUserAccessToken } from "../feishu/user-token";
import { createMockEnv } from "./mock-env";

vi.mock("../feishu/user-token", () => ({
  getUserAccessToken: vi.fn(),
}));

function jsonFetch(data: unknown, ok = true, status = 200): Response {
  return new Response(JSON.stringify(data), { status: ok ? status : 500, headers: { "content-type": "application/json" } });
}

/** base64url（含右侧去 padding）→ 标准 base64 → UTF-8 解码 */
function decodeBase64UrlToUtf8(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

describe("EML 构造", () => {
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
    expect(decodeBase64UrlToUtf8(toBase64Url(body64))).toBe("你的报销已通过");
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
    expect(decodeBase64UrlToUtf8(toBase64Url(body64))).toBe("<p>hi</p>");
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
      .mockResolvedValueOnce(jsonFetch({ code: 0, data: { primary_email_address: "me@nec.club" } }))
      .mockResolvedValueOnce(jsonFetch({ code: 0, data: { draft: { id: "draft-1" } } }))
      .mockResolvedValueOnce(jsonFetch({ code: 0, data: {} }));
    const r = await sendMailWithToken("utok", { to: ["a@x.com"], subject: "通知", text: "正文" });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("draft-1");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [draftUrl, draftInit] = fetchMock.mock.calls[1] as [string, { body: string }];
    expect(draftUrl).toBe("https://open.feishu.cn/open-apis/mail/v1/user_mailboxes/me/drafts");
    const payload = JSON.parse(draftInit.body) as { raw: string };
    const eml = decodeBase64UrlToUtf8(payload.raw);
    expect(eml).toContain("Subject: ");
    expect(eml).toContain("To: <a@x.com>");
    expect(eml).toContain("From: <me@nec.club>");

    const [sendUrl, sendInit] = fetchMock.mock.calls[2] as [string, { method: string }];
    expect(sendUrl).toBe("https://open.feishu.cn/open-apis/mail/v1/user_mailboxes/me/drafts/draft-1/send");
    expect(sendInit.method).toBe("POST");
  });

  it("profile 拿不到发件地址 → 省略 From 头继续发送（服务端按 me 补主地址）", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonFetch({ code: 99999, msg: "no permission" }))
      .mockResolvedValueOnce(jsonFetch({ code: 0, data: { draft: { id: "draft-f1" } } }))
      .mockResolvedValueOnce(jsonFetch({ code: 0, data: {} }));
    const r = await sendMailWithToken("utok", { to: ["a@x.com"], subject: "s", text: "t" });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("draft-f1");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [, draftInit] = fetchMock.mock.calls[1] as [string, { body: string }];
    const payload = JSON.parse(draftInit.body) as { raw: string };
    const eml = decodeBase64UrlToUtf8(payload.raw);
    expect(eml).not.toContain("From:");
    expect(eml).toContain("To: <a@x.com>");
  });

  it("草稿创建失败 → 返回错误且不带 draftId", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonFetch({ code: 0, data: { primary_email_address: "me@nec.club" } }))
      .mockResolvedValueOnce(jsonFetch({ code: 1254001, msg: "内容超限" }));
    const r = await sendMailWithToken("utok", { to: ["a@x.com"], subject: "s", text: "t" });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("草稿创建失败");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fromAddress 显式指定 → 跳过 profile，直接用指定地址发 From", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonFetch({ code: 0, data: { draft: { id: "draft-af" } } }))
      .mockResolvedValueOnce(jsonFetch({ code: 0, data: {} }));
    const r = await sendMailWithToken("utok", { to: ["a@x.com"], subject: "s", text: "t", fromAddress: "alias@nec.club" });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, draftInit] = fetchMock.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(draftInit.body) as { raw: string };
    expect(decodeBase64UrlToUtf8(payload.raw)).toContain("From: <alias@nec.club>");
  });

  it("发送失败 → 提示草稿保留可手动补发", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonFetch({ code: 0, data: { primary_email_address: "me@nec.club" } }))
      .mockResolvedValueOnce(jsonFetch({ code: 0, data: { draft: { id: "draft-9" } } }))
      .mockResolvedValueOnce(jsonFetch({ code: 1254100, msg: "发送失败" }));
    const r = await sendMailWithToken("utok", { to: ["a@x.com"], subject: "s", text: "t" });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("草稿 draft-9 已保留");
  });
});

describe("sendFeishuMail（授权 token 门禁）", () => {
  const env = createMockEnv() as unknown as Env;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(getUserAccessToken).mockReset();
  });

  it("未绑定授权 → 失败并提示先登录授权", async () => {
    vi.mocked(getUserAccessToken).mockResolvedValue(null);
    const r = await sendFeishuMail(env as unknown as Env, "ou_1", { to: ["a@x.com"], subject: "s", text: "t" });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("未登录过中台或授权已过期");
  });

  it("已绑定授权 → 走发信链路成功", async () => {
    vi.mocked(getUserAccessToken).mockResolvedValue("utok");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonFetch({ code: 0, data: { primary_email_address: "me@nec.club" } }))
      .mockResolvedValueOnce(jsonFetch({ code: 0, data: { draft: { id: "draft-2" } } }))
      .mockResolvedValueOnce(jsonFetch({ code: 0, data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendFeishuMail(env as unknown as Env, "ou_1", { to: ["a@x.com"], subject: "s", text: "t" });
    expect(r.ok).toBe(true);
  });
});