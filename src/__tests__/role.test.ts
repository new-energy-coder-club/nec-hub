/**
 * FE-01 角色解析测试：resolveUserRole 的 open_id / 姓名精确匹配与 external 降级。
 * 姓名双向包含兜底已移除（误配风险）：显示名带前缀/后缀的用户须补录 open_id。
 * mock 风格沿用 dr-test-utils.ts：内存 KV + fetch 路由。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BitableRecord } from "../feishu/bitable";
import { resolveUserRole } from "../auth/role";
import { KV_KEYS } from "../shared/kv-keys";

const MEMBERS_TABLE = "tblMembers";

function member(name: string, openId: string | null, role = "队员", group = "机械"): BitableRecord {
  return {
    record_id: `rec-${name}`,
    fields: { 姓名: name, 权限角色: role, 组别: group, 飞书ID: openId },
  };
}

interface Ctx {
  env: Env;
  kv: Map<string, string>;
  members: BitableRecord[];
}

function makeCtx(): Ctx {
  const kv = new Map<string, string>();
  const members: BitableRecord[] = [];
  kv.set(
    KV_KEYS.dashboardConfig,
    JSON.stringify({ base: "appMockBase", tables: { members: MEMBERS_TABLE }, updatedAt: new Date().toISOString() }),
  );
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.includes("/auth/v3/tenant_access_token/internal")) {
      return new Response(JSON.stringify({ code: 0, tenant_access_token: "mock-token", expire: 7200 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes(`/tables/${MEMBERS_TABLE}/records`)) {
      return new Response(JSON.stringify({ code: 0, data: { items: members, has_more: false } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ code: 404, msg: `not mocked: ${url}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const env = {
    REGISTRY: {
      get: vi.fn(async (key: string, type?: string) => {
        if (key === KV_KEYS.feishuTenantAccessToken) return { token: "mock-token", expireAt: Date.now() + 3600e3 };
        const v = kv.get(key);
        if (v == null) return null;
        return type === "json" ? JSON.parse(v) : v;
      }),
      put: vi.fn(async (key: string, value: string) => void kv.set(key, value)),
      delete: vi.fn(async (key: string) => void kv.delete(key)),
    },
    FEISHU_APP_ID: "test-app-id",
    FEISHU_APP_SECRET: "test-app-secret",
  } as unknown as Env;
  return { env, kv, members };
}

describe("resolveUserRole", () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = makeCtx();
    ctx.members.push(
      member("朱佩韦", "ou-hub-zhu", "维护者", "指导"),
      member("张三", null, "队长", "运营"),
    );
  });

  it("open_id 精确匹配优先", async () => {
    const r = await resolveUserRole(ctx.env, { open_id: "ou-hub-zhu", name: "随便什么名字" });
    expect(r).toEqual({ role: "维护者", group: "指导", matched: true });
  });

  it("姓名精确匹配兜底", async () => {
    const r = await resolveUserRole(ctx.env, { open_id: "ou-other-app", name: "张三" });
    expect(r.role).toBe("队长");
    expect(r.matched).toBe(true);
  });

  it("飞书显示名带前缀且未录 open_id → external（包含匹配已移除，须补录 open_id）", async () => {
    const r = await resolveUserRole(ctx.env, { open_id: "ou-other-app", name: "DarrenPig 朱佩韦" });
    expect(r.matched).toBe(false);
    expect(r.role).toBe("external");
  });

  it("显示名包含名单姓名（大小写/顺序差异）同样不再命中", async () => {
    ctx.members.push(member("王", null));
    const r = await resolveUserRole(ctx.env, { open_id: "ou-x", name: "王大锤" });
    expect(r.matched).toBe(false);
    expect(r.role).toBe("external");
  });

  it("完全不匹配 → external", async () => {
    const r = await resolveUserRole(ctx.env, { open_id: "ou-stranger", name: "路人甲" });
    expect(r).toEqual({ role: "external", group: "", matched: false });
  });
});
