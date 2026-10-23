/**
 * 新增机图纸评审流程 — 阻塞告警推送（cron 定时调用）
 *
 * 复用看板阻塞规则（BoardService.build），把命中的阻塞项推送到飞书群机器人。
 * KV 去重：同一 reviewId+ruleId 在持续阻塞期间只推一次；清除后再次出现会重新告警。
 * 任何一步失败只记日志，不影响 cron 上的其他任务。
 */

import { DrawingReviewAdapter } from "./adapter";
import { BoardService } from "./board.service";
import { getDrawingReviewConfig } from "./config";
import { notifyFeishuGroup } from "./notify";
import { resolveFlowWebhook } from "../feishu/bot";
import { KV_KEYS } from "../shared/kv-keys";

const ALERT_STATE_KEY = KV_KEYS.drawingReviewAlertBlockers;

export async function pushBlockerAlerts(env: Env): Promise<void> {
  if (!resolveFlowWebhook(env, "drawing").url) return;
  try {
    const cfg = await getDrawingReviewConfig(env);
    if (!cfg) return;
    const board = await new BoardService(new DrawingReviewAdapter(env, cfg)).build();

    const keys = board.blockers.map((b) => `${b.reviewId}:${b.ruleId}`);
    const prev = (await env.REGISTRY.get(ALERT_STATE_KEY, "json")) as { keys?: string[] } | null;
    const prevKeys = new Set(prev?.keys ?? []);
    const fresh = board.blockers.filter((b) => !prevKeys.has(`${b.reviewId}:${b.ruleId}`));
    await env.REGISTRY.put(ALERT_STATE_KEY, JSON.stringify({ keys, at: new Date().toISOString() }));
    if (fresh.length === 0) return;

    const lines = fresh.map((b) => `· ${b.reviewId}${b.machineName ? `（${b.machineName}）` : ""}：${b.message}`);
    await notifyFeishuGroup(
      env,
      [`🚨 图纸评审阻塞告警（新增 ${fresh.length} 项）`, ...lines, "看板：https://hub.newenergycoder.club/"].join("\n"),
    );
  } catch (err) {
    console.error("[drawing-review] blocker alert failed:", err);
  }
}
