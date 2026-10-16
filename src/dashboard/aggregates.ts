/**
 * 数据看板聚合：5 张表各一个纯函数，输入记录列表输出聚合结果（不含缓存元信息）
 */

import {
  BitableRecord,
  fieldNum,
  fieldText,
  fieldTs,
  firstFieldText,
} from "../feishu/bitable";
import {
  FINANCE_AMOUNT_PATTERNS,
  FINANCE_APPLICANT_PATTERNS,
  FINANCE_DATE_PATTERNS,
  FINANCE_ITEM_PATTERNS,
  GOAL_DEADLINE_PATTERNS,
  GOAL_GROUP_PATTERNS,
  GOAL_KR_PATTERNS,
  GOAL_PROGRESS_PATTERNS,
  GOAL_STATUS_PATTERNS,
  GOAL_TITLE_PATTERNS,
  INVENTORY_LOCATION_PATTERNS,
  INVENTORY_NAME_PATTERNS,
  INVENTORY_QTY_PATTERNS,
  MEMBER_GROUP_PATTERNS,
  TASK_DEADLINE_PATTERNS,
  TASK_LEVEL_PATTERNS,
  TASK_OWNER_PATTERNS,
  TASK_PRIORITY_PATTERNS,
  TASK_STATUS_PATTERNS,
  TASK_TITLE_PATTERNS,
  findFieldKey,
} from "../shared/bitable-fields";
import { buildRecordLink } from "../validation/service";

const TASK_DONE_RE = /完成|已完|完结|done|取消|cancel|关闭|close|drop/i;

/** 赛季目标完成状态判定（FE-04）：状态含完成/达成类词或完成度 100 即视为达标 */
const GOAL_DONE_RE = /完成|达成|达标|done|close/i;

/** 队员名单：总数 + 组别分布 */
export function aggregateMembers(records: BitableRecord[]): Record<string, unknown> {
  const groupKey = findFieldKey(records, MEMBER_GROUP_PATTERNS);
  const byGroup: Record<string, number> = {};
  for (const r of records) {
    const g = (groupKey ? fieldText(r.fields[groupKey]) : "") || "未分组";
    byGroup[g] = (byGroup[g] ?? 0) + 1;
  }
  return {
    total: records.length,
    byGroup: Object.entries(byGroup)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** 任务进度：状态分布 + 未完成任务（按截止升序）+ 逾期未完成数 */
export function aggregateTasks(records: BitableRecord[], base: string, tableId: string): Record<string, unknown> {
  const statusKey = findFieldKey(records, TASK_STATUS_PATTERNS);
  const ownerKey = findFieldKey(records, TASK_OWNER_PATTERNS);
  const titleKey = findFieldKey(records, TASK_TITLE_PATTERNS);
  const deadlineKey = findFieldKey(records, TASK_DEADLINE_PATTERNS);
  const priorityKey = findFieldKey(records, TASK_PRIORITY_PATTERNS);
  const levelKey = findFieldKey(records, TASK_LEVEL_PATTERNS);
  const byStatus: Record<string, number> = {};
  for (const r of records) {
    const s = (statusKey ? fieldText(r.fields[statusKey]) : "") || "未标注";
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }
  const pending = records.filter((r) => {
    const s = statusKey ? fieldText(r.fields[statusKey]) : "";
    return s ? !TASK_DONE_RE.test(s) : false;
  });
  const upcomingSrc = pending.length > 0 ? pending : records;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const upcoming = upcomingSrc
    .map((r) => ({
      title: (titleKey ? fieldText(r.fields[titleKey]) : "") || firstFieldText(r),
      owner: ownerKey ? fieldText(r.fields[ownerKey]) : "",
      status: statusKey ? fieldText(r.fields[statusKey]) : "",
      deadline: deadlineKey ? fieldNum(r.fields[deadlineKey]) : null,
      priority: priorityKey ? fieldText(r.fields[priorityKey]) : "",
      level: levelKey ? fieldText(r.fields[levelKey]) : "",
      link: buildRecordLink(base, tableId, r.record_id),
    }))
    .sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity))
    .slice(0, 8);
  // 逾期未完成任务数（全量统计，不限于 upcoming 前 8 条）
  const overdueCount = pending.filter((r) => {
    const dl = deadlineKey ? fieldNum(r.fields[deadlineKey]) : null;
    return dl !== null && dl < dayStart.getTime();
  }).length;
  return {
    total: records.length,
    byStatus: Object.entries(byStatus)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    upcoming,
    overdueCount,
  };
}

/** 物资台账：种类数 + 数量合计 + 明细 */
export function aggregateInventory(records: BitableRecord[]): Record<string, unknown> {
  const nameKey = findFieldKey(records, INVENTORY_NAME_PATTERNS);
  const qtyKey = findFieldKey(records, INVENTORY_QTY_PATTERNS);
  const locKey = findFieldKey(records, INVENTORY_LOCATION_PATTERNS);
  const items = records
    .map((r) => ({
      name: (nameKey ? fieldText(r.fields[nameKey]) : "") || firstFieldText(r),
      qty: qtyKey ? fieldNum(r.fields[qtyKey]) : null,
      location: locKey ? fieldText(r.fields[locKey]) : "",
    }))
    .filter((it) => it.name)
    .slice(0, 50);
  return {
    kinds: records.length,
    totalQty: items.reduce((sum, it) => sum + (it.qty ?? 0), 0),
    items,
  };
}

export interface FinanceAggregate {
  records: number;
  monthCount: number;
  totalAmount: number;
  monthAmount: number;
  prevMonthAmount: number;
  recent: {
    name: string;
    amount: number | null;
    date: number | null;
    applicant: string;
  }[];
}

/** 财务报销：笔数 + 金额合计 + 本月/上月环比 + 最近条目（按时间倒序） */
export function aggregateFinance(records: BitableRecord[]): FinanceAggregate {
  const amountKey = findFieldKey(records, FINANCE_AMOUNT_PATTERNS);
  const itemKey = findFieldKey(records, FINANCE_ITEM_PATTERNS);
  const dateKey = findFieldKey(records, FINANCE_DATE_PATTERNS);
  const applicantKey = findFieldKey(records, FINANCE_APPLICANT_PATTERNS);
  const recent = records
    .map((r) => ({
      name: (itemKey ? fieldText(r.fields[itemKey]) : "") || firstFieldText(r),
      amount: amountKey ? fieldNum(r.fields[amountKey]) : null,
      date: dateKey ? fieldTs(r.fields[dateKey]) : null,
      applicant: applicantKey ? fieldText(r.fields[applicantKey]) : "",
    }))
    .filter((it) => it.name)
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
    .slice(0, 8);
  const totalAmount = records.reduce(
    (sum, r) => sum + (amountKey ? (fieldNum(r.fields[amountKey]) ?? 0) : 0),
    0,
  );
  // 本月/上月金额与笔数：统计卡环比对比（本月 vs 上月）
  const nowDate = new Date();
  const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime();
  const prevMonthStart = new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, 1).getTime();
  let monthAmount = 0;
  let monthCount = 0;
  let prevMonthAmount = 0;
  for (const r of records) {
    const amt = amountKey ? (fieldNum(r.fields[amountKey]) ?? 0) : 0;
    const ts = dateKey ? fieldTs(r.fields[dateKey]) : null;
    if (ts === null) continue;
    if (ts >= monthStart) { monthAmount += amt; monthCount++; }
    else if (ts >= prevMonthStart) prevMonthAmount += amt;
  }
  return { records: records.length, monthCount, totalAmount, monthAmount, prevMonthAmount, recent };
}

/** 赛季目标（FE-04）：里程碑时间线 + 各组完成度 + 逾期未达标告警；未配置 goals 表时不展示 */
export function aggregateGoals(records: BitableRecord[], base: string, tableId: string | undefined): Record<string, unknown> {
  const agg: Record<string, unknown> = { configured: Boolean(tableId) };
  if (!tableId) return agg;
  const titleKey = findFieldKey(records, GOAL_TITLE_PATTERNS);
  const krKey = findFieldKey(records, GOAL_KR_PATTERNS);
  const groupKey = findFieldKey(records, GOAL_GROUP_PATTERNS);
  const deadlineKey = findFieldKey(records, GOAL_DEADLINE_PATTERNS);
  const progressKey = findFieldKey(records, GOAL_PROGRESS_PATTERNS);
  const statusKey = findFieldKey(records, GOAL_STATUS_PATTERNS);
  const now = Date.now();
  const items = records
    .map((r) => {
      let progress = progressKey ? fieldNum(r.fields[progressKey]) : null;
      // 飞书「进度」字段返回 0-1 小数，统一归一到 0-100
      if (progress !== null && progress > 0 && progress <= 1) progress = progress * 100;
      if (progress !== null) progress = Math.min(Math.max(progress, 0), 100);
      const status = statusKey ? fieldText(r.fields[statusKey]) : "";
      const deadline = deadlineKey ? fieldTs(r.fields[deadlineKey]) : null;
      const done = GOAL_DONE_RE.test(status) || progress === 100;
      return {
        title: (titleKey ? fieldText(r.fields[titleKey]) : "") || firstFieldText(r),
        kr: krKey ? fieldText(r.fields[krKey]) : "",
        group: (groupKey ? fieldText(r.fields[groupKey]) : "") || "未分组",
        deadline,
        progress,
        status,
        done,
        overdue: !done && deadline !== null && deadline < now,
        daysLeft: deadline !== null ? Math.ceil((deadline - now) / 86400000) : null,
        link: buildRecordLink(base, tableId, r.record_id),
      };
    })
    .filter((it) => it.title)
    .sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity));
  const byGroup: Record<string, { sum: number; count: number }> = {};
  for (const it of items) {
    const g0 = (byGroup[it.group] ??= { sum: 0, count: 0 });
    g0.sum += it.progress ?? 0;
    g0.count++;
  }
  Object.assign(agg, {
    total: items.length,
    items,
    byGroup: Object.entries(byGroup)
      .map(([name, v]) => ({ name, avg: Math.round(v.sum / v.count), count: v.count }))
      .sort((a, b) => a.avg - b.avg),
    overdueCount: items.filter((it) => it.overdue).length,
    upcomingCount: items.filter((it) => !it.done && it.daysLeft !== null && it.daysLeft >= 0 && it.daysLeft <= 7).length,
  });
  return agg;
}
