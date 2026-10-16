/**
 * 团队周报（reports/weekly）单测
 *
 * 只测纯函数：字段提取、快照 diff（新增/完成/逾期边界）、快照生成、文案生成（零数据/首周无快照）。
 * cron 窗口判定见 cron-schedule.test.ts「团队周报」一节。
 */
import { describe, expect, it } from "vitest";
import type { BitableRecord } from "../feishu/bitable";
import {
  buildSnapshot,
  buildWeeklyText,
  computeWeeklyData,
  extractFinanceItems,
  extractTaskItems,
  type FinanceItem,
  type TaskItem,
  type WeeklyInput,
  type WeeklySnapshot,
} from "../reports/weekly";

// 固定「现在」：2026-10-19 周一 08:16（UTC+8）= 2026-10-19T00:16:00Z
const NOW = new Date("2026-10-19T00:16:00Z").getTime();
const DAY = 86400000;

const rec = (id: string, fields: Record<string, unknown>): BitableRecord => ({ record_id: id, fields });

const task = (id: string, title: string, status: string, deadline: number | null, owner = "张三"): TaskItem => ({
  id,
  title,
  owner,
  done: /完成|已完|完结|done|取消|cancel|关闭|close|drop/i.test(status),
  deadline,
});

function makeInput(partial: Partial<WeeklyInput> = {}): WeeklyInput {
  return {
    taskItems: [],
    financeItems: [],
    inventoryCount: 0,
    goalsCount: 0,
    membersCount: 0,
    repoCommits: [],
    reposChecked: 0,
    reposSkipped: 0,
    errors: {},
    generatedAt: new Date(NOW).toISOString(),
    ...partial,
  };
}

function makePrev(partial: Partial<WeeklySnapshot> = {}): WeeklySnapshot {
  return {
    at: new Date(NOW - 7 * DAY).toISOString(),
    tasks: {},
    financeIds: [],
    financeCount: 0,
    financeTotal: 0,
    inventoryCount: 0,
    goalsCount: 0,
    membersCount: 0,
    ...partial,
  };
}

describe("字段提取", () => {
  it("任务表按看板同款正则模糊匹配字段名", () => {
    const items = extractTaskItems([
      rec("r1", { 任务名称: "编写周报模块", 当前状态: "进行中", 负责人: "张三", 截止时间: NOW + DAY }),
      rec("r2", { 任务名称: "图纸整改", 当前状态: "已完成", 负责人: "李四", 截止时间: NOW - DAY }),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "r1", title: "编写周报模块", owner: "张三", done: false, deadline: NOW + DAY });
    expect(items[1]).toMatchObject({ id: "r2", done: true });
  });

  it("报销表金额解析失败记 0", () => {
    const items = extractFinanceItems([rec("f1", { 报销金额: 356.5 }), rec("f2", { 报销金额: "无" })]);
    expect(items).toEqual([
      { id: "f1", amount: 356.5 },
      { id: "f2", amount: 0 },
    ]);
  });
});

describe("快照 diff（computeWeeklyData）", () => {
  it("首周无快照：新增/完成/报销新增均为 0，物资变动为 null", () => {
    const data = computeWeeklyData(
      makeInput({
        taskItems: [task("t1", "任务一", "进行中", null), task("t2", "任务二", "已完成", null)],
        financeItems: [{ id: "f1", amount: 100 }],
        inventoryCount: 45,
      }),
      null,
      NOW,
    );
    expect(data.tasksTotal).toBe(2);
    expect(data.tasksNew).toBe(0);
    expect(data.tasksDone).toBe(0);
    expect(data.financeNewCount).toBe(0);
    expect(data.financeNewAmount).toBe(0);
    expect(data.inventoryDelta).toBeNull();
    expect(data.prev).toBeNull();
  });

  it("新增任务：不在上周快照里的计新增；新增即完成的同时计入完成", () => {
    const prev = makePrev({ tasks: { t1: false } });
    const data = computeWeeklyData(
      makeInput({
        taskItems: [
          task("t1", "老任务", "进行中", null),
          task("t2", "新任务", "进行中", null),
          task("t3", "新任务速通", "已完成", null),
        ],
      }),
      prev,
      NOW,
    );
    expect(data.tasksNew).toBe(2);
    expect(data.tasksDone).toBe(1); // t3 新增即完成
  });

  it("完成任务：上周未完成本周翻转为完成才计数；上周已完成不重复计", () => {
    const prev = makePrev({ tasks: { t1: false, t2: true } });
    const data = computeWeeklyData(
      makeInput({ taskItems: [task("t1", "翻转完成", "已完成", null), task("t2", "早已完成", "已完成", null)] }),
      prev,
      NOW,
    );
    expect(data.tasksDone).toBe(1);
    expect(data.tasksOpen).toBe(0);
  });

  it("逾期边界：截止昨天未完成=逾期；截止今天/无截止/已完成=不算逾期", () => {
    const yesterday = NOW - DAY;
    const today = new Date(NOW);
    today.setHours(12, 0, 0, 0); // 今天白天，不在「今天 0 点」之前
    const data = computeWeeklyData(
      makeInput({
        taskItems: [
          task("t1", "已逾期", "进行中", yesterday),
          task("t2", "今天截止", "进行中", today.getTime()),
          task("t3", "无截止", "进行中", null),
          task("t4", "逾期但已完成", "已完成", yesterday),
        ],
      }),
      null,
      NOW,
    );
    expect(data.overdueCount).toBe(1);
    expect(data.overdueTop[0].title).toBe("已逾期");
    expect(data.overdueTop[0].days).toBeGreaterThanOrEqual(1);
  });

  it("逾期清单按截止升序且最多展示 5 条", () => {
    const items = Array.from({ length: 7 }, (_, i) => task(`t${i}`, `逾期任务${i}`, "进行中", NOW - (i + 1) * DAY));
    const data = computeWeeklyData(makeInput({ taskItems: items }), null, NOW);
    expect(data.overdueCount).toBe(7);
    expect(data.overdueTop).toHaveLength(5);
    expect(data.overdueTop[0].title).toBe("逾期任务6"); // 截止最早的排最前
  });

  it("报销新增按 record_id diff，金额求和", () => {
    const prev = makePrev({ financeIds: ["f1"], financeCount: 1, financeTotal: 100 });
    const data = computeWeeklyData(
      makeInput({ financeItems: [{ id: "f1", amount: 100 }, { id: "f2", amount: 200.5 }, { id: "f3", amount: 50 }] }),
      prev,
      NOW,
    );
    expect(data.financeCount).toBe(3);
    expect(data.financeTotal).toBe(350.5);
    expect(data.financeNewCount).toBe(2);
    expect(data.financeNewAmount).toBe(250.5);
  });

  it("物资条数变动与仓库提交汇总", () => {
    const prev = makePrev({ inventoryCount: 40 });
    const data = computeWeeklyData(
      makeInput({
        inventoryCount: 45,
        repoCommits: [
          { name: "b", url: "", count: 3 },
          { name: "a", url: "", count: 9 },
        ],
        reposChecked: 2,
        reposSkipped: 5,
      }),
      prev,
      NOW,
    );
    expect(data.inventoryDelta).toBe(5);
    expect(data.commitsTotal).toBe(12);
    expect(data.repoCommits[0].name).toBe("a"); // 按提交数降序
  });
});

describe("快照生成（buildSnapshot）", () => {
  it("只保留 diff 所需的最小信息", () => {
    const input = makeInput({
      taskItems: [task("t1", "x", "已完成", null), task("t2", "y", "进行中", null)],
      financeItems: [{ id: "f1", amount: 88 }],
      inventoryCount: 45,
      goalsCount: 6,
      membersCount: 28,
    });
    const s = buildSnapshot(input);
    expect(s.tasks).toEqual({ t1: true, t2: false });
    expect(s.financeIds).toEqual(["f1"]);
    expect(s.financeTotal).toBe(88);
    expect(s.inventoryCount).toBe(45);
    expect(s.goalsCount).toBe(6);
    expect(s.membersCount).toBe(28);
    // 快照可直接作为下周的 prev 参与 diff
    const data = computeWeeklyData(input, s, NOW);
    expect(data.tasksNew).toBe(0);
    expect(data.tasksDone).toBe(0);
  });
});

describe("文案生成（buildWeeklyText）", () => {
  it("零数据 + 首周：各项为 0，含首次运行提示与无逾期/无提交措辞", () => {
    const data = computeWeeklyData(makeInput(), null, NOW);
    const text = buildWeeklyText(data, null);
    expect(text).toContain("NEC 团队周报");
    expect(text).toContain("完成 0 · 新增 0 · 在办 0");
    expect(text).toContain("无逾期任务");
    expect(text).toContain("本周 +0 笔 ¥0");
    expect(text).toContain("本周仓库无新提交");
    expect(text).toContain("首次运行");
    expect(text).not.toContain("较上周");
  });

  it("常规周：包含完成/新增/逾期明细/报销/物资环比/活跃仓库 top", () => {
    const prev = makePrev({ tasks: { t1: false }, financeIds: ["f0"], inventoryCount: 40 });
    const data = computeWeeklyData(
      makeInput({
        taskItems: [
          task("t1", "图纸评审整改", "已完成", null, "李四"),
          task("t2", "编写周报模块", "进行中", NOW - 2 * DAY, "张三"),
        ],
        financeItems: [{ id: "f0", amount: 100 }, { id: "f1", amount: 356.5 }],
        inventoryCount: 45,
        goalsCount: 6,
        membersCount: 28,
        repoCommits: [{ name: "nec-hub", url: "", count: 9 }],
        reposChecked: 3,
        reposSkipped: 10,
      }),
      prev,
      NOW,
    );
    const text = buildWeeklyText(data, prev);
    expect(text).toContain("完成 1 · 新增 1 · 在办 1");
    expect(text).toContain("逾期 1 项");
    expect(text).toContain("编写周报模块（张三）");
    expect(text).toContain("+1 笔 ¥356.5");
    expect(text).toContain("累计 2 笔 ¥456.5");
    expect(text).toContain("台账 45 条（较上周 +5）");
    expect(text).toContain("赛季目标 6 项 · 👥 队员 28 人");
    expect(text).toContain("本周 9 次提交（检查 3 个活跃仓库）");
    expect(text).toContain("nec-hub ×9");
    expect(text).not.toContain("首次运行");
  });

  it("数据源失败时在文案末尾留提示", () => {
    const data = computeWeeklyData(makeInput({ errors: { finance: "HTTP 500" } }), null, NOW);
    expect(buildWeeklyText(data, null)).toContain("部分数据源拉取失败：finance");
  });
});
