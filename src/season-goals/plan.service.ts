/**
 * 赛季目标管理 — 自动规划服务
 *
 * 按「负责组」聚合未完成任务生成目标建议；任务表优先取模块配置，
 * 未配置时回退到数据看板（dashboard:config）的 tasks 表。
 */

import { getDashboardConfig } from "../dashboard";
import { getTenantAccessToken, listBitableRecords } from "../feishu/bitable";
import { mapTaskRecords, tsToDateStr, type SeasonGoalsAdapter } from "./adapter";
import type { PlanPreview, PlanSuggestion, SeasonGoalsConfig, TaskLite } from "./types";

/** 任务/目标完成状态判定（与 dashboard.ts 口径一致） */
const TASK_DONE_RE = /完成|已完|完结|done|取消|cancel|关闭|close|drop/i;
const GOAL_DONE_RE = /完成|达成|达标|done|close/i;

const KR_LIMIT = 8;

export class PlanService {
  constructor(
    private env: Env,
    private adapter: SeasonGoalsAdapter,
    private cfg: SeasonGoalsConfig,
  ) {}

  private async loadTasks(): Promise<TaskLite[]> {
    if (this.cfg.tables.tasks) return this.adapter.listTasks();
    const dash = await getDashboardConfig(this.env);
    if (!dash?.tables.tasks) return [];
    const token = await getTenantAccessToken(this.env);
    const records = await listBitableRecords(token, dash.base, dash.tables.tasks);
    return mapTaskRecords(records);
  }

  /** 预览：只读，不落库 */
  async preview(): Promise<PlanPreview> {
    const tasks = (await this.loadTasks()).filter((t) => !TASK_DONE_RE.test(t.status || ""));
    const goals = await this.adapter.listGoals();
    const coveredGroups = new Set(
      goals.filter((g) => g.group && !GOAL_DONE_RE.test(g.status)).map((g) => g.group),
    );

    const byGroup = new Map<string, TaskLite[]>();
    for (const t of tasks) {
      const list = byGroup.get(t.group) ?? [];
      list.push(t);
      byGroup.set(t.group, list);
    }

    const suggestions: PlanSuggestion[] = [];
    const skipped: Array<{ group: string; reason: string }> = [];
    for (const [group, items] of byGroup) {
      if (coveredGroups.has(group)) {
        skipped.push({ group, reason: "该组已有进行中的目标，跳过" });
        continue;
      }
      const sorted = [...items].sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
      const top = sorted.slice(0, KR_LIMIT);
      const krs = top.map((t) => `• ${t.title}${t.deadline ? `（截止 ${t.deadline}）` : ""}`).join("\n");
      const deadlines = items.map((t) => t.deadline).filter(Boolean).sort();
      const deadline = deadlines.length
        ? deadlines[deadlines.length - 1]
        : tsToDateStr(Date.now() + 90 * 86400_000);
      suggestions.push({
        group,
        title: `${group.replace(/组$/, "")}组 赛季目标（自动规划）`,
        krs,
        deadline,
        basedOnTasks: top.map((t) => t.title),
      });
    }

    return { suggestions, skipped, taskCount: tasks.length, generatedAt: new Date().toISOString() };
  }

  /** 应用：把每条建议写入收集单表（状态=待评审，来源=自动规划） */
  async apply(): Promise<{ created: number; recordIds: string[] }> {
    const { suggestions } = await this.preview();
    const recordIds: string[] = [];
    for (const s of suggestions) {
      const rec = await this.adapter.createSubmission({
        title: s.title,
        krs: s.krs,
        group: s.group,
        deadline: s.deadline,
        status: "待评审",
        source: "自动规划",
        submitter: "系统自动规划",
      });
      recordIds.push(rec.record_id);
    }
    return { created: recordIds.length, recordIds };
  }
}
