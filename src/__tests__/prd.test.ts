/**
 * PRD 看板 + GitHub push webhook + update_prd 测试
 *
 * mock 风格沿用 fe04-fe09.test.ts：内存 KV + fetch 路由（群机器人 webhook 端点）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPrdBoard, DEFAULT_PRD_ITEMS, handleGithubPush, toolUpdatePrd } from "../prd";
import { KV_KEYS } from "../shared/kv-keys";

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

interface Ctx {
  env: Env;
  kv: Map<string, string>;
  webhookCalls: Array<{ url: string; body: Record<string, unknown> }>;
}

function createCtx(extraEnv: Record<string, string> = {}): Ctx {
  const kv = new Map<string, string>();
  const webhookCalls: Ctx["webhookCalls"] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { body?: string }) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.includes("/bot/v2/hook/")) {
      webhookCalls.push({ url, body: JSON.parse(init?.body ?? "{}") });
      return jsonResp({ code: 0, msg: "ok" });
    }
    return jsonResp({ code: 404, msg: `not mocked: ${url}` });
  }));
  const env = {
    REGISTRY: {
      get: vi.fn(async (key: string, type?: string) => {
        const v = kv.get(key);
        return v == null ? null : type === "json" ? JSON.parse(v) : v;
      }),
      put: vi.fn(async (key: string, value: string) => { kv.set(key, value); }),
      delete: vi.fn(async (key: string) => { kv.delete(key); }),
    },
    ...extraEnv,
  } as unknown as Env;
  return { env, kv, webhookCalls };
}

async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("buildPrdBoard", () => {
  it("无 KV 覆盖时返回基线：16 项、M1~M4 四里程碑、lastCommit 为 null", async () => {
    const ctx = createCtx();
    const board = (await buildPrdBoard(ctx.env)) as {
      progress: { done: number; total: number };
      milestones: Array<{ id: string; done: number; total: number; cards: Array<{ id: string }> }>;
      lastCommit: unknown;
    };
    expect(board.progress.total).toBe(Object.keys(DEFAULT_PRD_ITEMS).length);
    expect(board.milestones.map((m) => m.id)).toEqual(["M1", "M2", "M3", "M4"]);
    expect(board.lastCommit).toBeNull();
    // 基线 done 共 9 项（FE-03/04/05/06/07/10/12/13/14），M3 内 4 项 done
    expect(board.progress.done).toBe(9);
    expect(board.milestones[2].done).toBe(4);
  });

  it("KV prd:status 覆盖合并到基线；prd:last_commit 透传", async () => {
    const ctx = createCtx();
    ctx.kv.set(KV_KEYS.prdStatus, JSON.stringify({
      items: { "FE-04": { ...DEFAULT_PRD_ITEMS["FE-04"], status: "done", note: "面板上线" } },
      updatedAt: "2026-10-14T00:00:00.000Z",
    }));
    ctx.kv.set(KV_KEYS.prdLastCommit, JSON.stringify({ repo: "nec-hub", branch: "main", message: "feat: x", author: "a", url: "https://x", at: "2026-10-14T00:00:00.000Z" }));
    const board = (await buildPrdBoard(ctx.env)) as {
      updatedAt: string;
      progress: { done: number };
      milestones: Array<{ id: string; cards: Array<{ id: string; status: string; note?: string }> }>;
      lastCommit: { message: string };
    };
    expect(board.updatedAt).toBe("2026-10-14T00:00:00.000Z");
    expect(board.progress.done).toBe(9);
    const fe04 = board.milestones[1].cards.find((c) => c.id === "FE-04");
    expect(fe04?.status).toBe("done");
    expect(fe04?.note).toBe("面板上线");
    expect(board.lastCommit.message).toBe("feat: x");
  });

  it("KV 损坏时回退基线", async () => {
    const ctx = createCtx();
    ctx.kv.set(KV_KEYS.prdStatus, "{not json");
    ctx.kv.set(KV_KEYS.prdLastCommit, "{broken");
    const board = (await buildPrdBoard(ctx.env)) as { progress: { total: number }; lastCommit: unknown };
    expect(board.progress.total).toBe(16);
    expect(board.lastCommit).toBeNull();
  });
});

describe("update_prd（MCP 工具）", () => {
  it("无 MCP_TOKEN 拒绝；未知 id / 非法 status 报错", async () => {
    const ctx = createCtx();
    await expect(toolUpdatePrd({ id: "FE-01", status: "done" }, ctx.env, false)).rejects.toThrow("MCP_TOKEN");
    await expect(toolUpdatePrd({ id: "FE-99", status: "done" }, ctx.env, true)).rejects.toThrow("未知需求 id");
    await expect(toolUpdatePrd({ id: "FE-01", status: "bad" }, ctx.env, true)).rejects.toThrow("status 必须是");
  });

  it("状态变更写 KV 并推群（带加签字段）；状态不变不推", async () => {
    const ctx = createCtx({
      FEISHU_BOT_WEBHOOK: "https://open.feishu.cn/open-apis/bot/v2/hook/abc",
      FEISHU_BOT_WEBHOOK_SECRET: "sec",
    });
    const res = await toolUpdatePrd({ id: "fe-04", status: "done", note: "搞定" }, ctx.env, true);
    expect(res.content[0].text).toContain("FE-04");
    expect(res.content[0].text).toContain("done");
    const saved = JSON.parse(ctx.kv.get(KV_KEYS.prdStatus)!);
    expect(saved.items["FE-04"].status).toBe("done");
    expect(saved.items["FE-04"].note).toBe("搞定");
    // 状态变化 → 推群一次，消息体 msg_type + 加签字段
    expect(ctx.webhookCalls).toHaveLength(1);
    expect(ctx.webhookCalls[0].body.msg_type).toBe("text");
    expect(ctx.webhookCalls[0].body.timestamp).toBeTypeOf("number");
    expect(ctx.webhookCalls[0].body.sign).toBeTypeOf("string");

    // 再调一次同状态 → 不推
    await toolUpdatePrd({ id: "FE-04", status: "done" }, ctx.env, true);
    expect(ctx.webhookCalls).toHaveLength(1);
  });

  it("未配置 webhook 时静默降级（不报错、记录不影响）", async () => {
    const ctx = createCtx();
    const res = await toolUpdatePrd({ id: "FE-05", status: "done" }, ctx.env, true);
    expect(res.content[0].text).toContain("✅");
    expect(ctx.webhookCalls).toHaveLength(0);
  });
});

describe("POST /api/hooks/github", () => {
  const payload = JSON.stringify({
    ref: "refs/heads/main",
    repository: { full_name: "new-energy-coder-club/nec-hub", html_url: "https://github.com/x" },
    head_commit: { message: "feat: 测试提交\n\n详情", author: { name: "张三" }, url: "https://github.com/x/commit/1" },
  });

  function pushReq(sig: string, event = "push"): Request {
    return new Request("https://hub.test/api/hooks/github", {
      method: "POST",
      headers: { "x-hub-signature-256": sig, "x-github-event": event, "content-type": "application/json" },
      body: payload,
    });
  }

  it("未配置 GITHUB_WEBHOOK_SECRET → 500 并提示配置步骤", async () => {
    const ctx = createCtx();
    const res = await handleGithubPush(pushReq("sha256=whatever"), ctx.env);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toContain("GITHUB_WEBHOOK_SECRET");
  });

  it("签名不匹配 → 401；匹配 → 记录最近提交并推群", async () => {
    const ctx = createCtx({
      GITHUB_WEBHOOK_SECRET: "ghs",
      FEISHU_BOT_WEBHOOK: "https://open.feishu.cn/open-apis/bot/v2/hook/abc",
    });
    const bad = await handleGithubPush(pushReq("sha256=deadbeef"), ctx.env);
    expect(bad.status).toBe(401);

    const good = await handleGithubPush(pushReq("sha256=" + (await hmacHex("ghs", payload))), ctx.env);
    expect(good.status).toBe(200);
    const data = (await good.json()) as { ok: boolean; commit: { message: string; branch: string; author: string }; notified: boolean };
    expect(data.ok).toBe(true);
    expect(data.commit.message).toBe("feat: 测试提交"); // 只取首行
    expect(data.commit.branch).toBe("main");
    expect(data.commit.author).toBe("张三");
    expect(data.notified).toBe(true);
    expect(JSON.parse(ctx.kv.get(KV_KEYS.prdLastCommit)!).message).toBe("feat: 测试提交");
    expect(ctx.webhookCalls).toHaveLength(1);
  });

  it("非 push 事件忽略；无 commit 忽略", async () => {
    const ctx = createCtx({ GITHUB_WEBHOOK_SECRET: "ghs" });
    const sig = "sha256=" + (await hmacHex("ghs", payload));
    const ping = await handleGithubPush(pushReq(sig, "ping"), ctx.env);
    expect(((await ping.json()) as { ignored?: string }).ignored).toBe("not a push event");

    const empty = JSON.stringify({ ref: "refs/heads/main", repository: {}, commits: [] });
    const res = await handleGithubPush(
      new Request("https://hub.test/api/hooks/github", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=" + (await hmacHex("ghs", empty)), "x-github-event": "push" },
        body: empty,
      }),
      ctx.env,
    );
    expect(((await res.json()) as { ignored?: string }).ignored).toBe("no commit");
    expect(ctx.kv.has(KV_KEYS.prdLastCommit)).toBe(false);
  });

  it("连续 push 累积 prd:recent_commits（最新在前，最多 10 条），buildPrdBoard 透传", async () => {
    const ctx = createCtx({ GITHUB_WEBHOOK_SECRET: "ghs" });
    for (let i = 1; i <= 3; i++) {
      const p = JSON.stringify({
        ref: "refs/heads/main",
        repository: { full_name: "new-energy-coder-club/nec-hub" },
        head_commit: { message: `commit ${i}`, author: { name: "张三" }, url: `https://github.com/x/commit/${i}` },
      });
      const res = await handleGithubPush(
        new Request("https://hub.test/api/hooks/github", {
          method: "POST",
          headers: { "x-hub-signature-256": "sha256=" + (await hmacHex("ghs", p)), "x-github-event": "push" },
          body: p,
        }),
        ctx.env,
      );
      expect(res.status).toBe(200);
    }
    const list = JSON.parse(ctx.kv.get(KV_KEYS.prdRecentCommits)!) as Array<{ message: string }>;
    expect(list.map(c => c.message)).toEqual(["commit 3", "commit 2", "commit 1"]);

    const board = (await buildPrdBoard(ctx.env)) as { recentCommits: Array<{ message: string }>; lastCommit: { message: string } };
    expect(board.recentCommits.map(c => c.message)).toEqual(["commit 3", "commit 2", "commit 1"]);
    expect(board.lastCommit.message).toBe("commit 3");
  });

  it("只有存量 prd:last_commit（无列表）时 recentCommits 回落为单条", async () => {
    const ctx = createCtx();
    ctx.kv.set(KV_KEYS.prdLastCommit, JSON.stringify({ repo: "nec-hub", branch: "main", message: "feat: 存量", author: "a", url: "https://x", at: "2026-10-14T00:00:00.000Z" }));
    const board = (await buildPrdBoard(ctx.env)) as { recentCommits: Array<{ message: string }> };
    expect(board.recentCommits.map(c => c.message)).toEqual(["feat: 存量"]);
  });
});
