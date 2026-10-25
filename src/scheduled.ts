/**
 * Cron 调度入口（从 index.ts 拆出）：时间窗驱动 + guard 去重，与"实际生效的是哪条触发器"解耦。
 *
 * 设计背景（2026-10-15/16 实测）：
 * ① 本账户触发器变更疑似不生效——曾配置的 7 * 从未触发，已下线两天的 23 * 却持续每小时触发；
 *    故 handler 不依赖触发器表达式路由任务，全部按 UTC 时间窗判定，任意触发器组合都能驱动全部任务；
 * ② 免费档单次 cron 50 子请求上限：SLA（重）独占 :08 窗口，仓库预热/阻塞告警在 :24 窗口，看板预热 TTL 过期才写，互不叠加超限；
 * ③ 多触发器可能并发命中同一窗口（新 8 分钟档 + 残留的 4 分钟档 / 23 *），每任务带 cron:guard:<name> 时间戳去重，防双重执行/重复推送；
 * ④ 窗口选取：旧 4 分钟档与新 8 分钟档的共同 tick 必为 8 的倍数，宽 4 分钟的窗口恰含一个 tick——
 *    :08 G-03 审批时效巡检 · :24 仓库缓存+图纸评审阻塞告警 · 周一 00:00–00:04 数据校验周报 · 周一 00:16–00:20 团队周报。
 * 配额治理（2026-10-15）：快触发器 360→180 次/日；看板缓存 TTL 900→1800s（过期才重写，≤240 写/日），
 * 探针整点才落 KV，给登录会话等用户写入留出免费档 1,000 写/日的余量。
 */

import { prewarmDashboard } from "./dashboard";
import { prewarmRepos } from "./repos";
import { KV_KEYS } from "./shared/kv-keys";
import { runWeeklyValidation } from "./validation/handlers";

/** cron 任务去重守卫：guardSec 秒内已执行过返回 false（多触发器并存/旧触发器残留时防双重执行与重复推送） */
async function cronDue(env: Env, name: string, guardSec: number): Promise<boolean> {
  try {
    const raw = await env.REGISTRY.get(KV_KEYS.cronGuard(name));
    if (raw) {
      const at = (JSON.parse(raw) as { at?: number }).at ?? 0;
      if (Date.now() - at < guardSec * 1000) return false;
    }
  } catch { /* 读失败视为可执行，任务内部另有幂等保护 */ }
  return true;
}

/** 标记 cron 任务已执行（30 天 TTL；写失败不影响本次执行） */
function cronMark(env: Env, ctx: ExecutionContext, name: string): void {
  ctx.waitUntil(
    env.REGISTRY.put(KV_KEYS.cronGuard(name), JSON.stringify({ at: Date.now() }), { expirationTtl: 30 * 86400 }).catch(() => {}),
  );
}

export async function scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  const t = new Date(controller.scheduledTime);
  const minute = t.getUTCMinutes();
  const isFastCron = controller.cron === "*/4 * * * *" || controller.cron === "*/8 * * * *";
  const isHourlyCron = controller.cron === "7 * * * *" || controller.cron === "23 * * * *";
  const isWeeklyCron = controller.cron === "0 0 * * 1";

  // 触发探针：每个 cron 事件落 KV（30 天），确认触发器真实到达（排障手段，勿删）。
  // 快触发器每天 180–360 次，全量落 KV 会吃掉免费档写配额大头，故只在整点写一次。
  if (!isFastCron || minute === 0) {
    ctx.waitUntil(
      env.REGISTRY.put(KV_KEYS.cronLast(controller.cron), JSON.stringify({ at: Date.now() }), { expirationTtl: 30 * 86400 }).catch(() => {}),
    );
  }

  // ① 看板缓存预热：快触发器每 tick；TTL（30 分钟）过期才重写
  if (isFastCron) ctx.waitUntil(prewarmDashboard(env, ctx));

  // ② G-03 审批时效巡检：每小时 :08 窗口（只挂快触发器，与 ③ 错峰；30 分钟去重防并发双跑）
  if (isFastCron && minute >= 6 && minute < 10 && (await cronDue(env, "sla", 1800))) {
    cronMark(env, ctx, "sla");
    ctx.waitUntil(import("./approvals/sla").then((m) => m.runApprovalSla(env)));
  }

  // ③ 仓库缓存 + 图纸评审阻塞告警：每小时 :24 窗口（小时级触发器 :23 直接命中；其不触发时由快触发器兜底）
  if ((isHourlyCron || (isFastCron && minute >= 22 && minute < 26)) && (await cronDue(env, "hourly", 2700))) {
    cronMark(env, ctx, "hourly");
    ctx.waitUntil(prewarmRepos(env));
    ctx.waitUntil(import("./drawing-review/alert.service").then((m) => m.pushBlockerAlerts(env)));
  }

  // ④ 数据校验周报：周一 00:00（UTC）窗口（周触发器与快触发器谁先到谁跑，12 小时去重）
  const isWeeklyWindow = t.getUTCDay() === 1 && t.getUTCHours() === 0 && minute < 4;
  if ((isWeeklyCron || isFastCron) && isWeeklyWindow && (await cronDue(env, "weekly", 12 * 3600))) {
    cronMark(env, ctx, "weekly");
    ctx.waitUntil(runWeeklyValidation(env));
  }

  // ⑤ 团队周报：周一 00:16–00:20（UTC）窗口（与 00:00 校验周报、00:08 SLA 错峰；实际由快触发器 00:16 tick 驱动，12 小时去重）
  const isWeeklyReportWindow = t.getUTCDay() === 1 && t.getUTCHours() === 0 && minute >= 16 && minute < 20;
  if ((isWeeklyCron || isFastCron) && isWeeklyReportWindow && (await cronDue(env, "weekly-report", 12 * 3600))) {
    cronMark(env, ctx, "weekly-report");
    ctx.waitUntil(import("./reports/weekly").then((m) => m.runWeeklyReport(env)));
  }
}
