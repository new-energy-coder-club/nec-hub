/**
 * POST /api/admin/announce 管理员一键公告测试。
 * mock 风格沿用 admin.test.ts：内存 KV（Map）+ fetch 路由（飞书 webhook / tenant token）。
 * 覆盖：401 未登录 / 403 角色不足 / 400 参数校验 / dry_run 预览 / 正常发送+审计 / flow 分流 / 发送失败留痕。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAdminAnnounce } from "../admin/announce";
import { KV_KEYS } from "../shared/kv-keys";

interface Ctx {
  env: Env;
  kv: Map<string, string>;
  hookCalls: Array<{ url: string; text: string }>;
  webhookCode: number;
}

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

const BOT_URL = "https://open.feishu.cn/open-apis/bot/v2/hook/bot-main";
const ANNOUNCE_URL = "https://open.feishu.cn/open-apis/bot/v2/hook/bot-announce";

function makeCtx(opts: { withBot?: boolean; withAnnounceHook?: boolean } = {}): Ctx {
  const kv = new Map<string, string>();
  const hookCalls: Array<{ url: string; text: string }> = [];
  const ctx: Ctx = { env: {} as Env, kv, hookCalls, webhookCode: 0 };

  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.includes("/bot/v2/hook/")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { content?: { text?: string } };
      hookCalls.push({ url, text: body.content?.text ?? "" });
      return jsonResp({ code: ctx.webhookCode, msg: ctx.webhookCode === 0 ? "ok" : "bad webhook" });
    }
    if (url.includes("/auth/v3/tenant_access_token/internal")) {
      return jsonResp({ code: 0, tenant_access_token: "mock-token", expire: 7200 });
    }
    return jsonResp({ code: 404, msg: `not mocked: ${url}` });
  });
  vi.stubGlobal("fetch", fetchMock);

  const env = {
    REGISTRY: {
      get: vi.fn(async (key: string, type?: string) => {
        const v = kv.get(key);
        if (v == null) return null;
        return type === "json" ? JSON.parse(v) : v;
      }),
      put: vi.fn(async (key: string, value: string) => void kv.set(key, value)),
      delete: vi.fn(async (key: string) => void kv.delete(key)),
      list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: "" })),
    },
    FEISHU_APP_ID: "cli_test123456",
    FEISHU_APP_SECRET: "mock-app-secret",
    HUB_NAME: "NEC 团队 AI 中台",
    ...(opts.withBot ? { FEISHU_BOT_WEBHOOK: BOT_URL } : {}),
    ...(opts.withAnnounceHook ? { FEISHU_BOT_WEBHOOK_ANNOUNCE: ANNOUNCE_URL } : {}),
  } as unknown as Env;
  ctx.env = env;
  return ctx;
}

function seed(kv: Map<string, string>, sid: string, openId: string, name: string, role: string) {
  kv.set(
    KV_KEYS.session(sid),
    JSON.stringify({ name, open_id: openId, createdAt: new Date().toISOString(), expiresAt: Date.now() + 3600e3 }),
  );
  kv.set(KV_KEYS.role(openId), JSON.stringify({ role, group: "电控", matched: true }));
}

function post(sid: string | null, body: unknown): Request {
  return new Request("https://hub.test/api/admin/announce", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sid ? { cookie: `nec_session=${sid}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("POST /api/admin/announce", () => {
  it("未登录 → 401", async () => {
    const { env } = makeCtx({ withBot: true });
    const r = await handleAdminAnnounce(post(null, { title: "t", content: "c" }), env);
    expect(r.status).toBe(401);
  });

  it("队员角色 → 403", async () => {
    const { env, kv } = makeCtx({ withBot: true });
    seed(kv, "sid-m", "ou-member", "队员乙", "队员");
    const r = await handleAdminAnnounce(post("sid-m", { title: "t", content: "c" }), env);
    expect(r.status).toBe(403);
  });

  it("缺 title / content → 400；link 非法 → 400", async () => {
    const { env, kv } = makeCtx({ withBot: true });
    seed(kv, "sid-a", "ou-admin", "管理员甲", "队长");
    expect((await handleAdminAnnounce(post("sid-a", { content: "c" }), env)).status).toBe(400);
    expect((await handleAdminAnnounce(post("sid-a", { title: "t" }), env)).status).toBe(400);
    expect((await handleAdminAnnounce(post("sid-a", { title: "t", content: "c", link: "ftp://x" }), env)).status).toBe(400);
    expect((await handleAdminAnnounce(post("sid-a", { title: "t", content: "c", flow: "bad flow!" }), env)).status).toBe(400);
  });

  it("dry_run 只预览不发送、不写审计", async () => {
    const { env, kv, hookCalls } = makeCtx({ withBot: true });
    seed(kv, "sid-a", "ou-admin", "管理员甲", "队长");
    const r = await handleAdminAnnounce(post("sid-a", { title: "标题", content: "正文", dry_run: true }), env);
    expect(r.status).toBe(200);
    const data = (await r.json()) as { dry_run: boolean; channel: string };
    expect(data.dry_run).toBe(true);
    expect(data.channel).toBe("bot");
    expect(hookCalls.length).toBe(0);
    expect(kv.get(KV_KEYS.announceLog)).toBeUndefined();
  });

  it("队长正常发送 → 200 + 审计留痕", async () => {
    const { env, kv, hookCalls } = makeCtx({ withBot: true });
    seed(kv, "sid-a", "ou-admin", "管理员甲", "队长");
    const r = await handleAdminAnnounce(
      post("sid-a", { title: "手册上线", content: "docs.newenergycoder.club/handbook", link: "https://docs.newenergycoder.club/handbook" }),
      env,
    );
    expect(r.status).toBe(200);
    const data = (await r.json()) as { ok: boolean; channel: string };
    expect(data.ok).toBe(true);
    expect(data.channel).toBe("bot");
    expect(hookCalls.length).toBe(1);
    expect(hookCalls[0].url).toBe(BOT_URL);
    expect(hookCalls[0].text).toContain("手册上线");
    const log = JSON.parse(kv.get(KV_KEYS.announceLog) ?? "[]") as Array<{ actor: string; ok: boolean; title: string }>;
    expect(log.length).toBe(1);
    expect(log[0].actor).toBe("管理员甲");
    expect(log[0].ok).toBe(true);
  });

  it("flow=announce 配置专属 webhook 时走分流渠道", async () => {
    const { env, kv, hookCalls } = makeCtx({ withBot: true, withAnnounceHook: true });
    seed(kv, "sid-a", "ou-admin", "管理员甲", "队长");
    const r = await handleAdminAnnounce(post("sid-a", { title: "t", content: "c" }), env);
    expect(r.status).toBe(200);
    expect(hookCalls[0].url).toBe(ANNOUNCE_URL);
  });

  it("未配置任何 webhook → 502 且审计 ok:false", async () => {
    const { env, kv } = makeCtx({});
    seed(kv, "sid-a", "ou-admin", "管理员甲", "队长");
    const r = await handleAdminAnnounce(post("sid-a", { title: "t", content: "c" }), env);
    expect(r.status).toBe(502);
    const log = JSON.parse(kv.get(KV_KEYS.announceLog) ?? "[]") as Array<{ ok: boolean }>;
    expect(log[0].ok).toBe(false);
  });

  it("GET 方法 → 405", async () => {
    const { env } = makeCtx({ withBot: true });
    const r = await handleAdminAnnounce(new Request("https://hub.test/api/admin/announce"), env);
    expect(r.status).toBe(405);
  });
});
