/**
 * 统一状态机核心（src/approvals/core/state-machine.ts）单元测试。
 *
 * 覆盖：matchState（精确/正则）· resolve 裁决（ok/already/invalid/未知动作）
 * from 数组多前置 · 重复动作拒绝 · checkGuard 权限钩子 · toTransitionMap 映射视图。
 */
import { describe, expect, it } from "vitest";
import { StateMachine, matchState, type TransitionRule } from "./state-machine";

describe("matchState", () => {
  it("精确状态串与正则两种匹配器", () => {
    expect(matchState("审批中", "审批中")).toBe(true);
    expect(matchState("审批中", "已通过")).toBe(false);
    expect(matchState(/^审批中$/, "审批中")).toBe(true);
    expect(matchState(/^审批中$/, "审批中（会签）")).toBe(false);
  });
});

describe("StateMachine.resolve", () => {
  const rules: ReadonlyArray<TransitionRule<string, string>> = [
    { action: "approve", from: /^审批中$/, to: "已通过" },
    { action: "archive", from: ["approved", "rejected"], to: "archived" },
  ];
  const sm = new StateMachine(rules);

  it("前置满足 → ok；已是目标 → already（幂等优先）；前置不符 → invalid", () => {
    expect(sm.resolve("approve", "审批中")).toEqual({ kind: "ok", to: "已通过" });
    expect(sm.resolve("approve", "已通过")).toEqual({ kind: "already", to: "已通过" });
    expect(sm.resolve("approve", "已驳回")).toEqual({ kind: "invalid", to: "已通过" });
  });

  it("from 数组：任一前置命中即可", () => {
    expect(sm.resolve("archive", "approved")).toEqual({ kind: "ok", to: "archived" });
    expect(sm.resolve("archive", "rejected")).toEqual({ kind: "ok", to: "archived" });
    expect(sm.resolve("archive", "in_review")).toEqual({ kind: "invalid", to: "archived" });
  });

  it("未知动作 → resolve 返回 null，has/targetOf 为假", () => {
    expect(sm.resolve("noop", "审批中")).toBeNull();
    expect(sm.has("noop")).toBe(false);
    expect(sm.has("approve")).toBe(true);
    expect(sm.targetOf("noop")).toBeUndefined();
    expect(sm.actions()).toEqual(["approve", "archive"]);
  });

  it("重复动作定义 → 构造即抛错", () => {
    expect(
      () =>
        new StateMachine([
          { action: "approve", from: "a", to: "b" },
          { action: "approve", from: "c", to: "d" },
        ]),
    ).toThrow("重复定义");
  });
});

describe("StateMachine.checkGuard（权限钩子）", () => {
  const sm = new StateMachine([
    { action: "approve", from: "审批中", to: "已通过", guard: "approver" },
    { action: "start", from: "已通过", to: "加工中" },
  ]);

  it("规则无 guard 或 guard 未注册实现 → 放行", () => {
    expect(sm.checkGuard("start", {}, null)).toBe(true);
    expect(sm.checkGuard("approve", {}, null)).toBe(true);
  });

  it("guard 实现返回 true 放行、返回字符串为拒绝原因", () => {
    const guards = { approver: (role: string) => role === "队长" || `当前角色（${role}）无权执行 approve` };
    expect(sm.checkGuard("approve", guards, "队长")).toBe(true);
    expect(sm.checkGuard("approve", guards, "队员")).toBe("当前角色（队员）无权执行 approve");
  });
});

describe("StateMachine.toTransitionMap", () => {
  it("字符串前置直接落键；allStates 补齐无出边终态", () => {
    const sm = new StateMachine(
      [
        { action: "submit", from: "draft", to: "pending" },
        { action: "archive", from: ["approved", "rejected"], to: "archived" },
      ],
      ["draft", "pending", "approved", "rejected", "archived"],
    );
    expect(sm.toTransitionMap()).toEqual({
      draft: { submit: "pending" },
      pending: {},
      approved: { archive: "archived" },
      rejected: { archive: "archived" },
      archived: {},
    });
  });

  it("正则前置按 allStates 展开；未提供 allStates 时正则前置不落键", () => {
    const withStates = new StateMachine([{ action: "approve", from: /^审批中$/, to: "已通过" }], ["审批中", "已通过"]);
    expect(withStates.toTransitionMap()).toEqual({ 审批中: { approve: "已通过" }, 已通过: {} });
    const noStates = new StateMachine([{ action: "approve", from: /^审批中$/, to: "已通过" }]);
    expect(noStates.toTransitionMap()).toEqual({ 已通过: {} });
  });
});
