/**
 * 赛季目标管理 — 飞书 Base 数据适配器
 *
 * 读取侧按记录样本正则匹配字段名（findFieldKey，同 dashboard 风格）；
 * 写入侧先拉字段元数据再按正则 + ui_type 匹配（matchField，同 reimburse 风格），
 * 日期字段为 DateTime 类型时转毫秒时间戳。字段名不做硬编码假设。
 */

import {
  BitableFieldMeta,
  BitableRecord,
  fieldNum,
  fieldText,
  fieldTs,
  findFieldKey,
  listBitableFields,
  matchField,
} from "../feishu/bitable";
import { FeishuTableAdapter } from "../shared/feishu-table-adapter";
import type { CollectRecord, GoalRecord, SeasonGoalsConfig, SeasonGoalsTable, TaskLite } from "./types";

const TITLE_PATTERNS = [/^目标$/, /^目标/, /目标/, /^标题/, /标题/, /title/i];
const KRS_PATTERNS = [/关键结果/, /^KR/i, /KR/];
const GROUP_PATTERNS = [/负责组/, /组别/, /小组/, /group/i];
const DEADLINE_PATTERNS = [/截止/, /deadline/i, /日期/];
const PROGRESS_PATTERNS = [/完成度/, /进度/, /progress/i];
const STATUS_PATTERNS = [/^状态/, /状态/, /status/i];
const SOURCE_PATTERNS = [/来源/, /source/i];
const NOTE_PATTERNS = [/备注/, /说明/, /note/i, /remark/i];
const SUBMITTER_PATTERNS = [/提交人/, /提交者/, /submitter/i];

const TASK_TITLE_PATTERNS = [/^任务/, /任务/, /事项/, /^标题/, /标题/, /title/i];

/** 写入字段入参（目标表与收集单表共用形状） */
export interface GoalWriteFields {
  title?: string;
  krs?: string;
  group?: string;
  deadline?: string;
  progress?: number;
  status?: string;
  source?: string;
  note?: string;
  submitter?: string;
}

export class SeasonGoalsAdapter extends FeishuTableAdapter<SeasonGoalsConfig, SeasonGoalsTable> {
  private metaCache = new Map<SeasonGoalsTable, BitableFieldMeta[]>();

  constructor(env: Env, cfg: SeasonGoalsConfig) {
    super(env, cfg, "赛季目标管理");
  }

  private async metas(table: SeasonGoalsTable): Promise<BitableFieldMeta[]> {
    const cached = this.metaCache.get(table);
    if (cached) return cached;
    const token = await this.token();
    const metas = await listBitableFields(token, this.cfg.base, this.tableId(table));
    this.metaCache.set(table, metas);
    return metas;
  }

  /** 按字段元数据把业务字段映射为可写 record；日期遇 DateTime 字段转毫秒时间戳 */
  private async buildFields(table: SeasonGoalsTable, input: GoalWriteFields): Promise<Record<string, unknown>> {
    const metas = await this.metas(table);
    const out: Record<string, unknown> = {};
    const put = (patterns: RegExp[], value: string | number | undefined) => {
      if (value === undefined || value === "") return;
      const m = matchField(metas, patterns);
      if (!m) return;
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && /DateTime/i.test(m.ui_type)) {
        out[m.field_name] = Date.parse(value + "T00:00:00+08:00");
      } else {
        out[m.field_name] = value;
      }
    };
    put(TITLE_PATTERNS, input.title);
    put(KRS_PATTERNS, input.krs);
    put(GROUP_PATTERNS, input.group);
    put(DEADLINE_PATTERNS, input.deadline);
    put(PROGRESS_PATTERNS, input.progress);
    put(STATUS_PATTERNS, input.status);
    put(SOURCE_PATTERNS, input.source);
    put(NOTE_PATTERNS, input.note);
    put(SUBMITTER_PATTERNS, input.submitter);
    return out;
  }

  // ---------- 目标表 ----------

  async listGoals(): Promise<GoalRecord[]> {
    const records = await this.listRecords("goals");
    return records.map((r) => recordToGoal(r)).filter((g) => g.title);
  }

  async createGoal(input: GoalWriteFields): Promise<BitableRecord> {
    const fields = await this.buildFields("goals", input);
    return this.createRecord("goals", fields);
  }

  // ---------- 收集单表 ----------

  async listSubmissions(): Promise<CollectRecord[]> {
    const records = await this.listRecords("collect");
    return records.map((r) => recordToSubmission(r)).filter((s) => s.title);
  }

  async getSubmission(recordId: string): Promise<CollectRecord | null> {
    const records = await this.listRecords("collect");
    const rec = records.find((r) => r.record_id === recordId);
    return rec ? recordToSubmission(rec) : null;
  }

  async createSubmission(input: GoalWriteFields): Promise<BitableRecord> {
    const fields = await this.buildFields("collect", input);
    return this.createRecord("collect", fields);
  }

  async updateSubmission(recordId: string, input: GoalWriteFields): Promise<BitableRecord> {
    const fields = await this.buildFields("collect", input);
    return this.updateRecord("collect", recordId, fields);
  }

  // ---------- 任务表（自动规划输入） ----------

  async listTasks(): Promise<TaskLite[]> {
    const records = await this.listRecords("tasks");
    return mapTaskRecords(records);
  }
}

/** 毫秒时间戳 → YYYY-MM-DD（按 UTC+8） */
export function tsToDateStr(ts: number): string {
  return new Date(ts + 8 * 3600_000).toISOString().slice(0, 10);
}

/** 把记录中的日期字段（时间戳或文本）归一化为 YYYY-MM-DD */
function deadlineText(v: unknown): string {
  const ts = fieldTs(v);
  return ts !== null ? tsToDateStr(ts) : "";
}

/** 飞书「进度」字段返回 0-1 小数时归一到 0-100 */
export function normalizeProgress(v: unknown): number {
  let p = fieldNum(v);
  if (p === null) return 0;
  if (p > 0 && p <= 1) p = p * 100;
  return Math.min(Math.max(Math.round(p), 0), 100);
}

function recordToGoal(r: BitableRecord): GoalRecord {
  const f = r.fields;
  const get = (patterns: RegExp[]) => {
    const k = findFieldKey([r], patterns);
    return k ? f[k] : undefined;
  };
  return {
    recordId: r.record_id,
    title: fieldText(get(TITLE_PATTERNS)),
    krs: fieldText(get(KRS_PATTERNS)),
    group: fieldText(get(GROUP_PATTERNS)) || "未分组",
    deadline: deadlineText(get(DEADLINE_PATTERNS)),
    progress: normalizeProgress(get(PROGRESS_PATTERNS)),
    status: fieldText(get(STATUS_PATTERNS)),
    source: fieldText(get(SOURCE_PATTERNS)),
    note: fieldText(get(NOTE_PATTERNS)),
  };
}

function recordToSubmission(r: BitableRecord): CollectRecord {
  const f = r.fields;
  const get = (patterns: RegExp[]) => {
    const k = findFieldKey([r], patterns);
    return k ? f[k] : undefined;
  };
  return {
    recordId: r.record_id,
    title: fieldText(get(TITLE_PATTERNS)),
    krs: fieldText(get(KRS_PATTERNS)),
    group: fieldText(get(GROUP_PATTERNS)) || "未分组",
    deadline: deadlineText(get(DEADLINE_PATTERNS)),
    note: fieldText(get(NOTE_PATTERNS)),
    source: fieldText(get(SOURCE_PATTERNS)) || "手工",
    submitter: fieldText(get(SUBMITTER_PATTERNS)),
    status: fieldText(get(STATUS_PATTERNS)) || "待评审",
  };
}

/** 任务表记录 → TaskLite（模块 tasks 表与看板 tasks 表共用映射） */
export function mapTaskRecords(records: BitableRecord[]): TaskLite[] {
  const titleKey = findFieldKey(records, TASK_TITLE_PATTERNS);
  const groupKey = findFieldKey(records, GROUP_PATTERNS);
  const deadlineKey = findFieldKey(records, DEADLINE_PATTERNS);
  const statusKey = findFieldKey(records, STATUS_PATTERNS);
  return records
    .map((r) => ({
      recordId: r.record_id,
      title: titleKey ? fieldText(r.fields[titleKey]) : "",
      group: (groupKey ? fieldText(r.fields[groupKey]) : "") || "未分组",
      deadline: deadlineKey ? deadlineText(r.fields[deadlineKey]) : "",
      status: statusKey ? fieldText(r.fields[statusKey]) : "",
    }))
    .filter((t) => t.title);
}
