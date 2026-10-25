/**
 * 账号密码登录（/auth/password）+ 本地账号管理（/api/admin/accounts*）测试
 *
 * 覆盖：建号校验/自动生成密码、登录成功签发 nec_session、错误口令 401、10 次失败锁定 429、
 *       local 账号角色兜底"队员"（whoami）、管理端列表/建号/重置/删除与门禁。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAccount,
  deleteAccount,
  generatePassword,
  listAccounts,
  resetAccountPassword,
  verifyAccountPassword,
} from "../auth/password";
import { handlePasswordLogin } from "../auth/password";
import { handleWhoami } from "../auth/handlers";
import { handleAdmin } from "../admin";

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

interface Ctx { env: Env; kv: Map<string, string> }

function createCtx(adminOpenIds = ""): Ctx {
  const kv = new Map<string, string>();
  kv.set(
    "session:sid-admin",
    JSON.stringify({ name: "维护者", open_id: "ou-maint", createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3 }),
  );
  kv.set("role:ou-maint", JSON.stringify({ role: "维护者", group: "指导", matched: true }));
  const env = {
    REGISTRY: {
      get: async (key: string, format?: string) => {
        const v = kv.get(key);
        if (v == null) return null;
        return format === "json" ? (JSON.parse(v) as unknown) : v;
      },
      put: async (key: string, value: string) => void kv.set(key, value),
      delete: async (key: string) => void kv.delete(key),
      list: async ({ prefix }: { prefix: string }) => ({
        keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
        cursor: "",
      }),
    },
    HUB_NAME: "NEC 团队 AI 中台",
    ...(adminOpenIds ? { ADMIN_OPEN_IDS: adminOpenIds } : {}),
  } as unknown as Env;
  vi.stubGlobal("fetch", async () => jsonResp({}));
  return { env, kv };
}

function loginReq(username: string, password: string): Request {
  return new Request("https://hub.newenergycoder.club/auth/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

beforeEach(() => vi.unstubAllGlobals());

describe("本地账号：建号与校验", () => {
  it("自动生成 12 位密码且不含易混淆字符", () => {
    const pwd = generatePassword();
    expect(pwd).toHaveLength(12);
    expect(pwd).toMatch(/^[a-zA-Z2-9]+$/);
    expect(pwd).not.toMatch(/[01lI]/);
  });

  it("建号成功 → 可用该密码登录；重复建号报错", async () => {
    const { env } = createCtx();
    const { account, password } = await createAccount(env, { username: "shixi", name: "实习生" });
    expect(account.open_id).toBe("local:shixi");
    const ok = await verifyAccountPassword(env, "shixi", password);
    expect("account" in ok && ok.account.username).toBe("shixi");
    await expect(createAccount(env, { username: "shixi", name: "别人" })).rejects.toThrow("已存在");
  });

  it("用户名非法 / 密码太短 → 报错", async () => {
    const { env } = createCtx();
    await expect(createAccount(env, { username: "1abc", name: "x" })).rejects.toThrow("用户名");
    await expect(createAccount(env, { username: "abc", name: "x", password: "short" })).rejects.toThrow("至少 8 位");
  });

  it("错误口令 → 401；连续 10 次 → 429 锁定；正确口令也挡", async () => {
    const { env } = createCtx();
    const { password } = await createAccount(env, { username: "shixi", name: "实习生" });
    for (let i = 0; i < 9; i++) {
      const r = await verifyAccountPassword(env, "shixi", "wrong-pass");
      expect("error" in r && r.status).toBe(401);
    }
    const locked = await verifyAccountPassword(env, "shixi", "wrong-pass");
    expect("error" in locked && locked.status).toBe(429);
    const still = await verifyAccountPassword(env, "shixi", password);
    expect("error" in still && still.status).toBe(429);
  });
});

describe("POST /auth/password", () => {
  it("登录成功 → set-cookie 签发 nec_session，whoami 角色兜底队员", async () => {
    const { env } = createCtx();
    const { password } = await createAccount(env, { username: "shixi", name: "实习生" });
    const res = await handlePasswordLogin(loginReq("shixi", password), env);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("nec_session=");
    expect(setCookie).toContain("HttpOnly");
    const sid = /nec_session=([^;]+)/.exec(setCookie)?.[1];
    expect(sid).toBeTruthy();
    const who = await handleWhoami(
      new Request("https://hub.newenergycoder.club/api/whoami", { headers: { cookie: `nec_session=${sid}` } }),
      env,
    );
    const data = (await who.json()) as { authenticated: boolean; user: { role: string; name: string; open_id: string } };
    expect(data.authenticated).toBe(true);
    expect(data.user.name).toBe("实习生");
    expect(data.user.role).toBe("队员");
    expect(data.user.open_id).toBe("local:shixi");
  });

  it("密码错误 → 401；缺字段 → 400", async () => {
    const { env } = createCtx();
    await createAccount(env, { username: "shixi", name: "实习生" });
    expect((await handlePasswordLogin(loginReq("shixi", "bad-password"), env)).status).toBe(401);
    expect((await handlePasswordLogin(loginReq("", ""), env)).status).toBe(400);
  });
});

describe("管理端 /api/admin/accounts*", () => {
  function adminReq(path: string, opts: { method?: string; body?: unknown } = {}): Request {
    return new Request(`https://hub.newenergycoder.club${path}`, {
      method: opts.method ?? "GET",
      headers: {
        cookie: "nec_session=sid-admin",
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  }

  it("未登录 → 401", async () => {
    const { env } = createCtx();
    const res = await handleAdmin(new Request("https://hub.newenergycoder.club/api/admin/accounts"), env, "/api/admin/accounts");
    expect(res?.status).toBe(401);
  });

  it("建号 → 列表 → 重置 → 删除 全流程", async () => {
    const { env } = createCtx();
    const created = await handleAdmin(
      adminReq("/api/admin/accounts", { method: "POST", body: { username: "shixi", name: "实习生" } }),
      env,
      "/api/admin/accounts",
    );
    expect(created?.status).toBe(201);
    const createdData = (await created!.json()) as { password: string };
    expect(createdData.password).toHaveLength(12);

    const list = await handleAdmin(adminReq("/api/admin/accounts"), env, "/api/admin/accounts");
    const listData = (await list!.json()) as { accounts: Array<{ username: string; name: string }> };
    expect(listData.accounts).toHaveLength(1);
    expect(listData.accounts[0].username).toBe("shixi");
    // 列表不回显口令材料
    expect(JSON.stringify(listData)).not.toContain("salt");

    const reset = await handleAdmin(
      adminReq("/api/admin/accounts/reset", { method: "POST", body: { username: "shixi" } }),
      env,
      "/api/admin/accounts/reset",
    );
    const resetData = (await reset!.json()) as { password: string };
    expect(reset!.status).toBe(200);
    // 旧密码失效，新密码可登录
    expect((await handlePasswordLogin(loginReq("shixi", createdData.password), env)).status).toBe(401);
    expect((await handlePasswordLogin(loginReq("shixi", resetData.password), env)).status).toBe(200);

    const del = await handleAdmin(
      adminReq("/api/admin/accounts/delete", { method: "POST", body: { username: "shixi" } }),
      env,
      "/api/admin/accounts/delete",
    );
    expect(((await del!.json()) as { deleted: boolean }).deleted).toBe(true);
    expect(await listAccounts(env)).toHaveLength(0);
  });

  it("ADMIN_OPEN_IDS 兜底管理员也能管理账号", async () => {
    const { env, kv } = createCtx("ou-root");
    kv.set(
      "session:sid-root",
      JSON.stringify({ name: "兜底", open_id: "ou-root", createdAt: new Date().toISOString(), expiresAt: Date.now() + 6 * 24 * 3600e3 }),
    );
    const res = await handleAdmin(
      new Request("https://hub.newenergycoder.club/api/admin/accounts", { headers: { cookie: "nec_session=sid-root" } }),
      env,
      "/api/admin/accounts",
    );
    expect(res?.status).toBe(200);
  });
});
