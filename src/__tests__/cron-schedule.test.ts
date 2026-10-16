/**
 * Cron 调度（scheduled）时间窗 + guard 去重单测
 *
 * 断言的是调度决策本身（哪些 cron:guard:* / cron:last:* 落 KV），任务函数体在无配置 env 下均安全早退；
 * fetch 全部打桩，prewarmRepos 等不会触网。
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../index";

beforeAll(() => {
  vi.stubGlobal("fetch", async () => new Response("[]", { status: 200 }));
});

interface Harness {
  env: Env;
  kv: Map<string, string>;
  run: (cron: string, iso: string) => Promise<void>;
}

function makeHarness(): Harness {
  const kv = new Map<string, string>();
  const env = {
    REGISTRY: {
      get: async (key: string) => kv.get(key) ?? null,
      put: async (key: string, value: string) => void kv.set(key, value),
      delete: async (key: string) => void kv.delete(key),
    },
  } as unknown as Env;
  const run = async (cron: string, iso: string) => {
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => pending.push(Promise.resolve(p).catch(() => {})),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    const controller = { cron, scheduledTime: new Date(iso).getTime(), noRetry: () => {} } as unknown as ScheduledController;
    await worker.scheduled!(controller, env, ctx);
    await Promise.all(pending);
  };
  return { env, kv, run };
}

const FAST = "*/8 * * * *";
const FAST_LEGACY = "*/4 * * * *";
const HOURLY = "23 * * * *";
const WEEKLY = "0 0 * * 1";
// 2026-10-16 是周五；2026-10-19 是周一
const FRI = "2026-10-16";
const MON = "2026-10-19";

describe("cron 触发探针", () => {
  it("快触发器只在整点落 KV，小时/周级触发器每次都落", async () => {
    const h = makeHarness();
    await h.run(FAST, `${FRI}T10:08:00Z`);
    expect(h.kv.has(`cron:last:${FAST}`)).toBe(false);
    await h.run(FAST, `${FRI}T11:00:00Z`);
    expect(h.kv.has(`cron:last:${FAST}`)).toBe(true);
    await h.run(HOURLY, `${FRI}T10:23:00Z`);
    expect(h.kv.has(`cron:last:${HOURLY}`)).toBe(true);
  });
});

describe("SLA 时效巡检（每小时 :08 窗口）", () => {
  it("新旧快触发器在 :08 都触发，:16 不触发", async () => {
    const h = makeHarness();
    await h.run(FAST, `${FRI}T10:16:00Z`);
    expect(h.kv.has("cron:guard:sla")).toBe(false);
    await h.run(FAST, `${FRI}T10:08:00Z`);
    expect(h.kv.has("cron:guard:sla")).toBe(true);

    const legacy = makeHarness();
    await legacy.run(FAST_LEGACY, `${FRI}T10:08:00Z`);
    expect(legacy.kv.has("cron:guard:sla")).toBe(true);
  });

  it("30 分钟去重：并发命中同一窗口只执行一次", async () => {
    const h = makeHarness();
    await h.run(FAST, `${FRI}T10:08:00Z`);
    const first = h.kv.get("cron:guard:sla");
    await h.run(FAST_LEGACY, `${FRI}T10:08:00Z`); // 残留旧触发器并发命中
    expect(h.kv.get("cron:guard:sla")).toBe(first); // guard 未重写 = 被去重跳过
  });

  it("小时级触发器不承担 SLA（50 子请求上限错峰）", async () => {
    const h = makeHarness();
    await h.run(HOURLY, `${FRI}T10:23:00Z`);
    expect(h.kv.has("cron:guard:sla")).toBe(false);
  });
});

describe("仓库缓存 + 阻塞告警（每小时 :24 窗口）", () => {
  it("快触发器 :24 兜底触发", async () => {
    const h = makeHarness();
    await h.run(FAST, `${FRI}T10:16:00Z`);
    expect(h.kv.has("cron:guard:hourly")).toBe(false);
    await h.run(FAST, `${FRI}T10:24:00Z`);
    expect(h.kv.has("cron:guard:hourly")).toBe(true);
  });

  it("小时级触发器直接命中；与快触发器并发时去重", async () => {
    const h = makeHarness();
    await h.run(HOURLY, `${FRI}T10:23:00Z`);
    const first = h.kv.get("cron:guard:hourly");
    expect(first).toBeTruthy();
    await h.run(FAST, `${FRI}T10:24:00Z`); // 快触发器 :24 窗口并发命中
    expect(h.kv.get("cron:guard:hourly")).toBe(first);
  });
});

describe("数据校验周报（周一 00:00 窗口）", () => {
  it("周触发器与快触发器都能驱动，12 小时去重", async () => {
    const h = makeHarness();
    await h.run(WEEKLY, `${MON}T00:00:00Z`);
    const first = h.kv.get("cron:guard:weekly");
    expect(first).toBeTruthy();
    await h.run(FAST, `${MON}T00:00:00Z`);
    expect(h.kv.get("cron:guard:weekly")).toBe(first);
  });

  it("非周一的 00:00 不触发周报", async () => {
    const h = makeHarness();
    await h.run(FAST, `${FRI}T00:00:00Z`);
    expect(h.kv.has("cron:guard:weekly")).toBe(false);
  });
});

describe("团队周报（周一 00:16–00:20 窗口）", () => {
  it("周一 00:16 快触发器命中；00:08 与非周一同时刻不命中", async () => {
    const h = makeHarness();
    await h.run(FAST, `${FRI}T00:16:00Z`); // 非周一
    expect(h.kv.has("cron:guard:weekly-report")).toBe(false);
    await h.run(FAST, `${MON}T00:08:00Z`); // 周一但属于校验周报/SLA 窗口
    expect(h.kv.has("cron:guard:weekly-report")).toBe(false);
    await h.run(FAST, `${MON}T00:16:00Z`);
    expect(h.kv.has("cron:guard:weekly-report")).toBe(true);
  });

  it("12 小时去重：窗口内重复触发只执行一次", async () => {
    const h = makeHarness();
    await h.run(FAST, `${MON}T00:16:00Z`);
    const first = h.kv.get("cron:guard:weekly-report");
    expect(first).toBeTruthy();
    await h.run(FAST, `${MON}T00:16:00Z`); // 并发命中同一窗口
    expect(h.kv.get("cron:guard:weekly-report")).toBe(first);
  });
});
