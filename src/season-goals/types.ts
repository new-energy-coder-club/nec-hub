/**
 * 赛季目标管理 — 核心类型定义
 */

export interface SeasonGoalsConfig {
  base: string;
  tables: Partial<Record<SeasonGoalsTable, string>>;
  updatedAt: string;
}

export type SeasonGoalsTable = "goals" | "collect" | "tasks";

export type SubmissionSource = "手工" | "自动规划";

/** 收集单提交（前端表单 → POST /api/season-goals/submit） */
export interface GoalSubmission {
  title: string;
  krs: string;
  group: string;
  /** YYYY-MM-DD */
  deadline: string;
  note?: string;
  source: SubmissionSource;
}

/** 目标表记录视图 */
export interface GoalRecord {
  recordId: string;
  title: string;
  krs: string;
  group: string;
  deadline: string;
  progress: number;
  status: string;
  source: string;
  note: string;
}

/** 收集单表记录视图 */
export interface CollectRecord {
  recordId: string;
  title: string;
  krs: string;
  group: string;
  deadline: string;
  note: string;
  source: string;
  submitter: string;
  status: string;
}

/** 任务表记录视图（自动规划输入） */
export interface TaskLite {
  recordId: string;
  title: string;
  group: string;
  /** 归一化为 YYYY-MM-DD，无则为空串 */
  deadline: string;
  status: string;
}

/** 自动规划建议 */
export interface PlanSuggestion {
  group: string;
  title: string;
  krs: string;
  deadline: string;
  basedOnTasks: string[];
}

export interface PlanPreview {
  suggestions: PlanSuggestion[];
  skipped: Array<{ group: string; reason: string }>;
  taskCount: number;
  generatedAt: string;
}
