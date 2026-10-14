/**
 * 一键拉会（schedule_meeting）：身份解析、飞书日程+视频会议创建、参会人姓名解析
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { toolScheduleMeeting } from "../meeting";
import { createMockEnv } from "./mock-env";

function kvBackedEnv() {
  const env = createMockEnv();
  const store = new Map<string, string>();
  env.REGISTRY.get.mockImplementation((key: string, type?: string) => {
    const v = store.get(key);
    if (v == null) return Promise.resolve(null);
    return Promise.resolve(type === "json" ? JSON.parse(v) : v);
  });
  env.REGISTRY.put.mockImplementation((key: string, value: string) => {
    store.set(key, value);
    return Promise.resolve();
  });
  env.REGISTRY.delete.mockImplementation((key: string) => {
    store.delete(key);
    return Promise.resolve();
  });
  return { env: env as unknown as Env, store };
}

/** 按 URL 片段路由的飞书 fetch mock（键按声明顺序匹配，长的片段放前面） */
function mockFeishu(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string | URL | Request) => {
      const u = String(url instanceof Request ? url.url : url);
      for (const [k, v] of Object.entries(routes)) {
        if (u.includes(k)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(v) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ code: 404, msg: "not mocked" }) });
    }),
  );
}

const ROUTES = {
  "/attendees": { code: 0, data: {} },
  "/calendar/v4/calendars/primary": { code: 0, data: { calendars: [{ calendar: { calendar_id: "cal_1" } }] } },
  "/events": {
    code: 0,
    data: { event: { event_id: "ev_1", vchat: { meeting_url: "https://vc.feishu.cn/j/123456" } } },
  },
  "/authen/v1/user_info": { code: 0, data: { open_id: "ou_zhangsan", name: "张三" } },
  "/auth/v3/tenant_access_token/internal": { code: 0, tenant_access_token: "t-tok", expire: 7200 },
  "/bitable/v1/apps/": {
    code: 0,
    data: {
      items: [
        { record_id: "r1", fields: { 姓名: "李四", 飞书ID: "ou_lisi" } },
        { record_id: "r2", fields: { 姓名: "王五", 飞书ID: "ou_wangwu" } },
      ],
      has_more: false,
    },
  },
};

function seedDashboard(store: Map<string, string>) {
  store.set(
    "dashboard:config",
    JSON.stringify({ base: "basex", tables: { members: "tblmembers" }, updatedAt: "" }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("schedule_meeting", () => {
  it("本人 user_token 拉会：建日程+视频会议，按姓名邀请参会人", async () => {
    const { env, store } = kvBackedEnv();
    seedDashboard(store);
    mockFeishu(ROUTES);
    const res = await toolScheduleMeeting(
      {
        title: "R1 底盘图纸评审会",
        start: "2026-10-15 19:00",
        duration_minutes: 90,
        attendees: ["李四", "ou_direct"],
        user_token: "u-tok",
      },
      env,
      false,
    );
    const text = res.content[0].text;
    expect(text).toContain("✅ 会议已创建：R1 底盘图纸评审会");
    expect(text).toContain("https://vc.feishu.cn/j/123456");
    expect(text).toContain("已邀请 2 人");
    expect(text).toContain("李四");
  });

  it("管理端 organizer 代拉会：用 KV 已绑定的用户授权", async () => {
    const { env, store } = kvBackedEnv();
    seedDashboard(store);
    store.set(
      "feishu:user_token:ou_lisi",
      JSON.stringify({
        user_access_token: "u-tok-lisi",
        refresh_token: "r-tok",
        expires_at: Date.now() + 3600e3,
        refresh_expires_at: Date.now() + 30 * 24 * 3600e3,
      }),
    );
    mockFeishu(ROUTES);
    const res = await toolScheduleMeeting(
      { title: "硬件选型会", start: "2026-10-16 10:00", organizer: "李四" },
      env,
      true,
    );
    expect(res.content[0].text).toContain("组织者：李四");
  });

  it("管理端 organizer 未登录过中台 → 明确报错", async () => {
    const { env, store } = kvBackedEnv();
    seedDashboard(store);
    mockFeishu(ROUTES);
    await expect(
      toolScheduleMeeting({ title: "t", start: "2026-10-16 10:00", organizer: "王五" }, env, true),
    ).rejects.toThrow("未登录过中台");
  });

  it("缺组织者身份 → 报错", async () => {
    const { env } = kvBackedEnv();
    mockFeishu(ROUTES);
    await expect(toolScheduleMeeting({ title: "t", start: "2026-10-16 10:00" }, env, false)).rejects.toThrow(
      "缺少组织者身份",
    );
  });

  it("姓名未匹配 → 会议照建，输出未邀请名单", async () => {
    const { env, store } = kvBackedEnv();
    seedDashboard(store);
    mockFeishu(ROUTES);
    const res = await toolScheduleMeeting(
      { title: "t", start: "2026-10-16 10:00", attendees: ["路人甲"], user_token: "u-tok" },
      env,
      false,
    );
    expect(res.content[0].text).toContain("未匹配到 open_id");
    expect(res.content[0].text).toContain("路人甲");
  });

  it("provider=tencent → 明确提示未接入", async () => {
    const { env } = kvBackedEnv();
    mockFeishu(ROUTES);
    await expect(
      toolScheduleMeeting({ title: "t", start: "2026-10-16 10:00", provider: "tencent", user_token: "u" }, env, false),
    ).rejects.toThrow("腾讯会议");
  });

  it("结束时间早于开始时间 → 报错", async () => {
    const { env } = kvBackedEnv();
    mockFeishu(ROUTES);
    await expect(
      toolScheduleMeeting(
        { title: "t", start: "2026-10-16 10:00", end: "2026-10-16 09:00", user_token: "u" },
        env,
        false,
      ),
    ).rejects.toThrow("结束时间必须晚于开始时间");
  });
});
