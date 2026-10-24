import { StateMachine, type TransitionRule } from "../approvals/core/state-machine";
import { KV_KEYS } from "./kv-keys";
import type { ReviewConclusion, ReviewIssue, ReviewMinutes } from "./types";

export interface ReviewStateMachine<S extends string> {
  next(current: S, event: string): S | null;
  toTransitionMap(): Record<S, Partial<Record<string, S>>>;
}

export function createReviewStateMachine<S extends string>(
  transitions: Record<S, Partial<Record<string, S>>>,
): ReviewStateMachine<S> {
  const machines = new Map<S, StateMachine<string, S>>();
  for (const state of Object.keys(transitions) as S[]) {
    const rules = (Object.entries(transitions[state]) as Array<[string, S]>).map(([action, to]) => ({
      action,
      from: state,
      to,
    })) satisfies Array<TransitionRule<string, S>>;
    machines.set(state, new StateMachine(rules, [state]));
  }

  return {
    next(current, event) {
      const machine = machines.get(current);
      if (!machine?.has(event)) return null;
      return machine.resolve(event, current)?.to ?? null;
    },
    toTransitionMap() {
      const out = {} as Record<S, Partial<Record<string, S>>>;
      for (const [state, machine] of machines) {
        out[state] = machine.toTransitionMap()[state];
      }
      return out;
    },
  };
}

export interface ConclusionInput {
  conclusion: ReviewConclusion;
  notes?: string;
  issues?: ReviewIssue[];
}

export interface ReviewFlowRecord<S extends string> {
  reviewId: string;
  projectId: string;
  designerId: string;
  designNotes: string;
  status: S;
  conclusion?: ReviewConclusion;
  conclusionNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewFlowSubmitInput {
  projectId?: string;
  designerId?: string;
  designNotes?: string;
}

export type StoredReview<R> = R & { recordId: string };

export interface ReviewFlowAdapter<R, T extends string> {
  listReviews(): Promise<Array<StoredReview<R>>>;
  findReviewById(reviewId: string): Promise<StoredReview<R> | null>;
  updateReview(recordId: string, patch: Partial<R>): Promise<StoredReview<R>>;
  createMinutes(minutes: ReviewMinutes): Promise<ReviewMinutes & { recordId: string }>;
  createRecord(table: T, fields: Record<string, unknown>): Promise<unknown>;
}

type SharedField<R, I> = Extract<keyof R & keyof I, string>;

export interface ReviewFlowConfig<
  S extends string,
  R extends ReviewFlowRecord<S>,
  I extends ReviewFlowSubmitInput,
  P extends object,
  T extends string,
> {
  preferences: {
    module: string;
    legacyFallback?: boolean;
    defaultNameKey: string;
    defaults(actorId: string): P;
  };
  fields: {
    name: SharedField<R, I>;
    version: SharedField<R, I>;
    files: SharedField<R, I>;
  };
  emptyStringDefaults?: boolean;
  defaultDesignNotes(prefs: P): string;
  extraDefaults?(input: I, prefs: P): Partial<I>;
  versionSeed?: string;
  requiredError: string;
  tables: {
    events: T;
  };
  eventReviewField: string;
  logTag: string;
  logMessages: {
    latestVersion: string;
    readPreferences: string;
    writePreferences: string;
    afterSubmitPreferences: string;
  };
}

const VERSION_RE = /^V(\d+)\.(\d+)$/;
/** 评审结论 → 引擎动作名（薄壳 conclude 路由用） */
export const CONCLUSION_EVENTS: Record<ReviewConclusion, string> = {
  passed: "conclude_passed",
  conditional: "conclude_conditional",
  rejected: "conclude_rejected",
};

function readField(value: object, key: string): unknown {
  return (value as Record<string, unknown>)[key];
}

function readString(value: object, key: string): string | undefined {
  return readField(value, key) as string | undefined;
}

function writeField(target: object, key: string, value: unknown): void {
  (target as Record<string, unknown>)[key] = value;
}

function incrementLatestVersion<R>(reviews: R[], readVersion: (review: R) => string | undefined, seed?: string): string | undefined {
  let latest = seed;
  for (const review of reviews) {
    const candidate = readVersion(review);
    if (!candidate) continue;
    const match = candidate.match(VERSION_RE);
    if (!match) continue;
    if (latest === undefined) {
      latest = candidate;
      continue;
    }
    const latestMatch = latest.match(VERSION_RE);
    if (!latestMatch) {
      latest = candidate;
      continue;
    }
    const currentMajor = Number(match[1]);
    const currentMinor = Number(match[2]);
    const latestMajor = Number(latestMatch[1]);
    const latestMinor = Number(latestMatch[2]);
    if (currentMajor > latestMajor || (currentMajor === latestMajor && currentMinor > latestMinor)) {
      latest = candidate;
    }
  }
  const match = latest?.match(VERSION_RE);
  return match ? `V${Number(match[1])}.${Number(match[2]) + 1}` : undefined;
}

/**
 * 评审流程共享服务（drawing-review / hardware-review 通用底座）。
 *
 * 迁移说明（审批引擎 Phase 1）：评审单本体/状态机/通知已迁入 src/approvals 引擎
 * （submitApprovalCore / runApprovalAction），本类只保留提交前处理与富业务读写：
 * 提交默认值（版本自增/用户偏好）、提交校验与偏好回写、会议纪要、评审单查询、事件日志。
 */

export class ReviewFlowService<
  S extends string,
  R extends ReviewFlowRecord<S>,
  I extends ReviewFlowSubmitInput,
  P extends object,
  T extends string,
> {
  constructor(
    private env: Env,
    private adapter: ReviewFlowAdapter<R, T>,
    private config: ReviewFlowConfig<S, R, I, P, T>,
  ) {}

  async getDefaultSubmissionValues(input: I, actorId: string, prefs?: P): Promise<Partial<I>> {
    const resolvedPrefs = prefs ?? (await this.getUserPreferences(actorId));
    const designerId = input.designerId || readString(resolvedPrefs, "defaultDesignerId") || actorId;
    const inputName = readString(input, this.config.fields.name);
    let version = readString(input, this.config.fields.version);

    if (!version) {
      try {
        const reviews = await this.adapter.listReviews();
        if (input.projectId && inputName) {
          const matching = reviews.filter(
            (review) => review.projectId === input.projectId && readString(review, this.config.fields.name) === inputName,
          );
          if (matching.length > 0) {
            version = incrementLatestVersion(
              matching,
              (review) => readString(review, this.config.fields.version),
              this.config.versionSeed,
            );
          }
        }
      } catch (err) {
        console.warn(`[${this.config.logTag}] ${this.config.logMessages.latestVersion}`, err);
      }
      if (!version) version = readString(resolvedPrefs, "lastUsedVersion") || "V1.0";
    }

    const projectId = input.projectId || readString(resolvedPrefs, "defaultProjectId");
    const name = inputName || readString(resolvedPrefs, this.config.preferences.defaultNameKey);
    const defaults = {
      ...(this.config.extraDefaults?.(input, resolvedPrefs) ?? {}),
      projectId: this.config.emptyStringDefaults ? projectId || "" : projectId,
      designerId,
      designNotes: input.designNotes || this.config.defaultDesignNotes(resolvedPrefs),
    } as Partial<I>;
    writeField(defaults, this.config.fields.name, this.config.emptyStringDefaults ? name || "" : name);
    writeField(defaults, this.config.fields.version, version);
    return defaults;
  }

  /** 提交前校验（沿用旧 submit 口径）：项目编号 / 名称 / 附件必填，缺失抛 requiredError */
  assertSubmitReady(input: I, defaults: Partial<I>): void {
    const files = readField(input, this.config.fields.files) as { length: number } | undefined;
    if (!defaults.projectId || !readString(defaults, this.config.fields.name) || !files || files.length === 0) {
      throw new Error(this.config.requiredError);
    }
  }

  /** 提交成功后的用户偏好回写（旧 submit 尾段；失败只记日志，不影响提交结果） */
  async saveSubmissionPreferences(input: I, actorId: string): Promise<void> {
    const prefs = await this.getUserPreferences(actorId);
    try {
      if (input.projectId) writeField(prefs, "defaultProjectId", input.projectId);
      const inputName = readString(input, this.config.fields.name);
      if (inputName) writeField(prefs, this.config.preferences.defaultNameKey, inputName);
      const inputVersion = readString(input, this.config.fields.version);
      if (inputVersion) writeField(prefs, "lastUsedVersion", inputVersion);
      await this.saveUserPreferences(actorId, prefs);
    } catch (err) {
      console.warn(`[${this.config.logTag}] ${this.config.logMessages.afterSubmitPreferences}`, err);
    }
  }

  private async getUserPreferences(actorId: string): Promise<P> {
    try {
      const prefs = await this.env.REGISTRY.get(KV_KEYS.userPrefs(this.config.preferences.module, actorId));
      if (prefs) return JSON.parse(prefs) as P;
      if (this.config.preferences.legacyFallback) {
        const legacyPrefs = await this.env.REGISTRY.get(KV_KEYS.legacyUserPrefs(actorId));
        if (legacyPrefs) return JSON.parse(legacyPrefs) as P;
      }
    } catch (err) {
      console.warn(`[${this.config.logTag}] ${this.config.logMessages.readPreferences}`, err);
    }
    return this.config.preferences.defaults(actorId);
  }

  private async saveUserPreferences(actorId: string, prefs: P): Promise<void> {
    try {
      await this.env.REGISTRY.put(KV_KEYS.userPrefs(this.config.preferences.module, actorId), JSON.stringify(prefs));
    } catch (err) {
      console.warn(`[${this.config.logTag}] ${this.config.logMessages.writePreferences}`, err);
    }
  }

  async saveMinutes(
    reviewId: string,
    minutes: Omit<ReviewMinutes, "minutesId" | "reviewId">,
    actorId: string,
  ): Promise<ReviewMinutes & { recordId: string }> {
    const review = await this.requireReview(reviewId);
    if (review.status !== "in_review" && review.status !== "pending_review") {
      throw new Error("只能在评审中或待评审状态下保存会议纪要");
    }
    const fullMinutes: ReviewMinutes = {
      minutesId: `MIN-${reviewId}-${Date.now()}`,
      reviewId,
      ...minutes,
    };
    const saved = await this.adapter.createMinutes(fullMinutes);
    await this.logEvent(reviewId, actorId, "save_minutes", review.status, review.status, { minutesId: saved.minutesId });
    return saved;
  }

  async getReview(reviewId: string): Promise<StoredReview<R> | null> {
    return this.adapter.findReviewById(reviewId);
  }

  async listReviews(): Promise<Array<StoredReview<R>>> {
    return this.adapter.listReviews();
  }

  private async requireReview(reviewId: string): Promise<StoredReview<R>> {
    const review = await this.adapter.findReviewById(reviewId);
    if (!review) throw new Error(`评审单 ${reviewId} 不存在`);
    return review;
  }

  /** 事件日志：写 events 子表；失败只记日志不阻断主流程（薄壳路由在引擎动作成功后调用） */
  async logEvent(
    reviewId: string,
    actorId: string,
    action: string,
    fromStatus?: S,
    toStatus?: S,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.adapter.createRecord(this.config.tables.events, {
        [this.config.eventReviewField]: reviewId,
        操作人: actorId,
        动作: action,
        原状态: fromStatus,
        新状态: toStatus,
        附加信息: payload ? JSON.stringify(payload) : "",
        操作时间: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[${this.config.logTag}] log event failed:`, err);
    }
  }
}
