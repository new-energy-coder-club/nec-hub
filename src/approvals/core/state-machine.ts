/**
 * 审批域统一状态机核心：状态表（动作 → 前置状态/目标状态）+ 幂等裁决 + 权限钩子。
 *
 * approvals 引擎（中文业务状态、正则前置、角色门禁）与 contract-approval
 * （英文状态、state→event 映射、参与人门禁）共用本核心，各自只声明流转规则：
 *
 *   - 规则表：action + from（精确状态 / 正则 / 数组）+ to + 可选 guard（权限钩子名）
 *   - resolve：幂等优先（当前已是目标状态 → already），再校验前置（invalid/ok）
 *   - checkGuard：规则声明 guard 时调用使用方提供的钩子实现，返回 true 放行、字符串为拒绝原因
 *   - toTransitionMap：state→event→state 映射视图（合同审批风格，含无出边的终态）
 */

/** 前置状态匹配器：精确状态串或正则 */
export type StateMatcher<S extends string = string> = S | RegExp;

export interface TransitionRule<A extends string = string, S extends string = string> {
  /** 动作/事件名（approve / reject / submit / …） */
  action: A;
  /** 前置状态：精确状态、正则，或二者的数组（任一命中即满足） */
  from: StateMatcher<S> | ReadonlyArray<StateMatcher<S>>;
  /** 目标状态 */
  to: S;
  /** 权限钩子名：由使用方在 checkGuard 时提供实现；缺省 = 无额外权限要求 */
  guard?: string;
}

/** 流转裁决：already = 已在目标状态（幂等放行）；ok = 可流转；invalid = 前置状态不符 */
export type TransitionVerdict<S extends string = string> =
  | { kind: "already"; to: S }
  | { kind: "ok"; to: S }
  | { kind: "invalid"; to: S };

/** 权限钩子实现：放行返回 true，拒绝返回错误消息 */
export type GuardFn<C> = (ctx: C) => true | string;

export function matchState<S extends string>(matcher: StateMatcher<S>, current: string): boolean {
  return typeof matcher === "string" ? current === matcher : matcher.test(current);
}

export class StateMachine<A extends string = string, S extends string = string> {
  private readonly rules = new Map<A, TransitionRule<A, S>>();

  /**
   * @param rules 流转规则表（action 唯一；同一动作多个前置用 from 数组表达）
   * @param allStates 全部状态名（可选）：toTransitionMap 据此补齐无出边的终态、展开正则前置
   */
  constructor(
    rules: ReadonlyArray<TransitionRule<A, S>>,
    private readonly allStates: ReadonlyArray<S> = [],
  ) {
    for (const rule of rules) {
      if (this.rules.has(rule.action)) throw new Error(`状态机动作重复定义：${rule.action}`);
      this.rules.set(rule.action, rule);
    }
  }

  /** 已定义的动作列表（声明顺序） */
  actions(): A[] {
    return [...this.rules.keys()];
  }

  has(action: string): action is A {
    return this.rules.has(action as A);
  }

  /** 动作的目标状态（不校验前置）；未定义返回 undefined */
  targetOf(action: A): S | undefined {
    return this.rules.get(action)?.to;
  }

  /** 当前状态是否满足动作的前置状态 */
  matchesFrom(action: A, current: string): boolean {
    const rule = this.rules.get(action);
    if (!rule) return false;
    const froms = Array.isArray(rule.from) ? rule.from : [rule.from];
    return froms.some((f) => matchState(f, current));
  }

  /** 流转裁决：未定义的动作返回 null；幂等（already）优先于前置校验 */
  resolve(action: A, current: string): TransitionVerdict<S> | null {
    const to = this.targetOf(action);
    if (to === undefined) return null;
    if (current === to) return { kind: "already", to };
    return this.matchesFrom(action, current) ? { kind: "ok", to } : { kind: "invalid", to };
  }

  /** 权限钩子：规则声明 guard 时调用 guards[guard]；规则未声明或钩子未注册均放行 */
  checkGuard<C>(action: A, guards: Record<string, GuardFn<C>>, ctx: C): true | string {
    const guard = this.rules.get(action)?.guard;
    if (!guard) return true;
    const fn = guards[guard];
    return fn ? fn(ctx) : true;
  }

  /**
   * state → event → state 映射视图。键集合 = allStates ∪ 字符串前置 ∪ 目标状态；
   * 正则前置按 allStates 展开（未提供 allStates 时正则前置不出现在映射里）。
   */
  toTransitionMap(): Record<S, Partial<Record<A, S>>> {
    const out: Record<string, Partial<Record<A, S>>> = {};
    const ensure = (s: string) => (out[s] ??= {});
    for (const s of this.allStates) ensure(s);
    for (const rule of this.rules.values()) {
      const froms = Array.isArray(rule.from) ? rule.from : [rule.from];
      for (const f of froms) {
        if (typeof f === "string") {
          ensure(f)[rule.action] = rule.to;
        } else {
          for (const s of this.allStates) {
            if (f.test(s)) ensure(s)[rule.action] = rule.to;
          }
        }
      }
      ensure(rule.to);
    }
    return out as Record<S, Partial<Record<A, S>>>;
  }
}
