import { describe, it, expect } from "vitest";
import {
  DEFAULT_RULES,
  ValidateRule,
  diffViolationKeys,
  groupViolations,
  parseValidateRules,
  runRules,
  splitNames,
  violationKey,
} from "../validation/rules";
import { buildRecordLink, filterViolationsForUser, ValidateReport } from "../validation/service";
import { BitableRecord } from "../feishu/bitable";

function rec(record_id: string, fields: Record<string, unknown>): BitableRecord {
  return { record_id, fields };
}

function rule(partial: Partial<ValidateRule> & Pick<ValidateRule, "id" | "table" | "check" | "fieldPatterns">): ValidateRule {
  return {
    type: "测试类型",
    description: "测试规则",
    suggestion: "修复它",
    ...partial,
  };
}

const NO_MEMBERS = { memberNames: new Set<string>() };

describe("validation rules engine", () => {
  it("empty：字段缺失或为空命中，有值不命中", () => {
    const rules = [rule({ id: "r1", table: "tasks", check: "empty", fieldPatterns: ["负责人"] })];
    const records = [rec("a", { 任务: "X" }), rec("b", { 任务: "Y", 负责人: "张三" })];
    const out = runRules("tasks", records, rules, NO_MEMBERS);
    expect(out).toHaveLength(1);
    expect(out[0].recordId).toBe("a");
  });

  it("format：空值与非 ou_ 开头均命中，合法 open_id 不命中", () => {
    const rules = [rule({ id: "r2", table: "members", check: "format", fieldPatterns: ["飞书ID"], pattern: "^ou_[A-Za-z0-9_-]{8,}$" })];
    const records = [
      rec("a", { 飞书ID: "" }),
      rec("b", { 飞书ID: "not-an-open-id" }),
      rec("c", { 飞书ID: "ou_abc123def456" }),
    ];
    const out = runRules("members", records, rules, NO_MEMBERS);
    expect(out.map((v) => v.recordId).sort()).toEqual(["a", "b"]);
  });

  it("enum：非枚举值命中；空值不命中（空值由 empty 规则负责）", () => {
    const rules = [rule({ id: "r3", table: "members", check: "enum", fieldPatterns: ["组别"], values: ["机械组", "电控组"] })];
    const records = [rec("a", { 组别: "不存在的组" }), rec("b", { 组别: "机械组" }), rec("c", { 姓名: "无组别" })];
    const out = runRules("members", records, rules, NO_MEMBERS);
    expect(out).toHaveLength(1);
    expect(out[0].recordId).toBe("a");
  });

  it("negative：负数命中，零与正数不命中", () => {
    const rules = [rule({ id: "r4", table: "inventory", check: "negative", fieldPatterns: ["数量"] })];
    const records = [rec("a", { 数量: -2 }), rec("b", { 数量: 0 }), rec("c", { 数量: 5 })];
    const out = runRules("inventory", records, rules, NO_MEMBERS);
    expect(out.map((v) => v.recordId)).toEqual(["a"]);
  });

  it("date-before：截止早于创建命中，晚于不命中，缺字段不误报", () => {
    const rules = [
      rule({ id: "r5", table: "tasks", check: "date-before", fieldPatterns: ["截止"], field2Patterns: ["创建日期"] }),
    ];
    const records = [
      rec("a", { 截止: "2026-01-01", 创建日期: "2026-02-01" }),
      rec("b", { 截止: "2026-03-01", 创建日期: "2026-02-01" }),
      rec("c", { 截止: "2026-01-01" }),
    ];
    const out = runRules("tasks", records, rules, NO_MEMBERS);
    expect(out.map((v) => v.recordId)).toEqual(["a"]);
  });

  it("progress-done-mismatch：100% 未标完成命中，已标完成或未满 100% 不命中", () => {
    const rules = [
      rule({
        id: "r6",
        table: "tasks",
        check: "progress-done-mismatch",
        fieldPatterns: ["完成度"],
        field2Patterns: ["状态"],
        pattern: "完成|done",
        threshold: 100,
      }),
    ];
    const records = [
      rec("a", { 完成度: 100, 状态: "进行中" }),
      rec("b", { 完成度: 100, 状态: "已完成" }),
      rec("c", { 完成度: 80, 状态: "进行中" }),
    ];
    const out = runRules("tasks", records, rules, NO_MEMBERS);
    expect(out.map((v) => v.recordId)).toEqual(["a"]);
  });

  it("conflict：发票已收但流程未提交命中；流程已推进不命中", () => {
    const rules = [
      rule({
        id: "r7",
        table: "finance",
        check: "conflict",
        fieldPatterns: ["发票"],
        field2Patterns: ["状态"],
        pattern: "已收|已交",
        pattern2: "未提交|草稿",
      }),
    ];
    const records = [
      rec("a", { 发票: "已收票", 状态: "未提交" }),
      rec("b", { 发票: "已收票", 状态: "已打款" }),
    ];
    const out = runRules("finance", records, rules, NO_MEMBERS);
    expect(out.map((v) => v.recordId)).toEqual(["a"]);
  });

  it("not-in-members：领用人不在名单命中，多人逗号分隔逐一检查", () => {
    const ctx = { memberNames: new Set(["张三", "李四"]) };
    const rules = [rule({ id: "r8", table: "inventory", check: "not-in-members", fieldPatterns: ["领用人"] })];
    const records = [
      rec("a", { 领用人: "王五" }),
      rec("b", { 领用人: "张三" }),
      rec("c", { 领用人: "张三、赵六" }),
    ];
    const out = runRules("inventory", records, rules, ctx);
    expect(out.map((v) => v.recordId).sort()).toEqual(["a", "c"]);
  });

  it("字段名在表中不存在时跳过该规则（避免误报）；enabled=false 跳过", () => {
    const rules = [
      rule({ id: "r9", table: "tasks", check: "empty", fieldPatterns: ["不存在的字段"] }),
      rule({ id: "r10", table: "tasks", check: "empty", fieldPatterns: ["负责人"], enabled: false }),
    ];
    const out = runRules("tasks", [rec("a", { 任务: "X" })], rules, NO_MEMBERS);
    expect(out).toHaveLength(0);
  });

  it("默认规则集自身合法且覆盖 4 张底表", () => {
    expect(() => parseValidateRules(DEFAULT_RULES)).not.toThrow();
    const tables = new Set(DEFAULT_RULES.map((r) => r.table));
    expect(tables).toEqual(new Set(["members", "tasks", "inventory", "finance"]));
  });
});

describe("groupViolations / violationKey / diffViolationKeys", () => {
  const mk = (type: string, recordId: string) =>
    ({ ruleId: "r", table: "tasks", type, description: "", recordId, field: "f", value: "", suggestion: "" }) as const;

  it("按类型分组并按数量降序", () => {
    const groups = groupViolations([mk("A", "1"), mk("B", "2"), mk("A", "3")]);
    expect(groups[0]).toMatchObject({ type: "A", count: 2 });
    expect(groups[1]).toMatchObject({ type: "B", count: 1 });
  });

  it("violationKey 由规则/表/记录/字段组成", () => {
    expect(violationKey(mk("A", "rec1"))).toBe("r:tasks:rec1:f");
  });

  it("diff：首周全部计新增；次周区分新增/清零/持续", () => {
    expect(diffViolationKeys(null, ["a", "b"])).toEqual({ added: 2, cleared: 0, ongoing: 0 });
    expect(diffViolationKeys(["a", "b"], ["b", "c"])).toEqual({ added: 1, cleared: 1, ongoing: 1 });
    expect(diffViolationKeys(["a"], [])).toEqual({ added: 0, cleared: 1, ongoing: 0 });
  });
});

describe("parseValidateRules", () => {
  it("拒绝非数组 / 非法 id / 未知表 / 未知 check / 缺 fieldPatterns / 非法正则", () => {
    expect(() => parseValidateRules({})).toThrow("数组");
    expect(() => parseValidateRules([{ id: "Bad ID" }])).toThrow("id");
    expect(() => parseValidateRules([{ id: "x", table: "nope", check: "empty", fieldPatterns: ["a"] }])).toThrow("table");
    expect(() => parseValidateRules([{ id: "x", table: "tasks", check: "nope", fieldPatterns: ["a"] }])).toThrow("check");
    expect(() => parseValidateRules([{ id: "x", table: "tasks", check: "empty", fieldPatterns: [] }])).toThrow("fieldPatterns");
    expect(() => parseValidateRules([{ id: "x", table: "tasks", check: "empty", fieldPatterns: ["(["] }])).toThrow("正则");
    expect(() => parseValidateRules([{ id: "x", table: "tasks", check: "format", fieldPatterns: ["a"] }])).toThrow("pattern");
    expect(() => parseValidateRules([{ id: "x", table: "tasks", check: "enum", fieldPatterns: ["a"] }])).toThrow("values");
  });

  it("合法规则清洗后返回（缺省 type/suggestion 有兜底）", () => {
    const rules = parseValidateRules([{ id: "x", table: "tasks", check: "empty", fieldPatterns: ["负责人"] }]);
    expect(rules).toHaveLength(1);
    expect(rules[0].type).toBe("未分类");
    expect(rules[0].suggestion).toBeTruthy();
  });
});

describe("service helpers", () => {
  it("buildRecordLink 拼多维表格记录直链", () => {
    expect(buildRecordLink("bascnABC", "tblXYZ", "rec123")).toBe(
      "https://feishu.cn/base/bascnABC?table=tblXYZ&record=rec123",
    );
  });

  it("splitNames 支持顿号/逗号/斜杠分隔", () => {
    expect(splitNames("张三、李四，王五/赵六")).toEqual(["张三", "李四", "王五", "赵六"]);
  });

  it("filterViolationsForUser：按记录归属人过滤（姓名或 open_id 命中）", () => {
    const report: ValidateReport = {
      generatedAt: "2026-10-14T00:00:00.000Z",
      scope: "all",
      base: "bascnABC",
      total: 3,
      byType: [],
      violations: [
        { ...mkV("v1"), persons: ["张三"], link: "" },
        { ...mkV("v2"), persons: ["ou_user1"], link: "" },
        { ...mkV("v3"), persons: ["李四、王五"], link: "" },
      ],
    };
    function mkV(recordId: string) {
      return { ruleId: "r", table: "tasks" as const, type: "T", description: "", recordId, field: "负责人", value: "", suggestion: "" };
    }
    const mine = filterViolationsForUser(report, { name: "张三", open_id: "ou_user1" });
    expect(mine.scope).toBe("mine");
    expect(mine.total).toBe(2);
    expect(mine.violations.map((v) => v.recordId).sort()).toEqual(["v1", "v2"]);
    expect(mine.byType).toEqual([{ type: "T", count: 2 }]);
  });
});
