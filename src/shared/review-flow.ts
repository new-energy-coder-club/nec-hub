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
  createReview(review: R): Promise<StoredReview<R>>;
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
  stateMachine: ReviewStateMachine<S>;
  idPrefix: string;
  initialStatus: S;
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
    rectifications: T;
    events: T;
  };
  eventReviewField: string;
  rectificationReviewField: string;
  notify(env: Env, text: string): Promise<void>;
  submitTitle: string;
  transitionTitle: string;
  logTag: string;
  logMessages: {
    latestVersion: string;
    readPreferences: string;
    writePreferences: string;
    afterSubmitPreferences: string;
  };
}

const VERSION_RE = /^V(\d+)\.(\d+)$/;
const CONCLUSION_EVENTS: Record<ReviewConclusion, string> = {
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

export function generateReviewId(prefix: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(100 + Math.random() * 900);
  return `${prefix}-${date}-${rand}`;
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

  async submit(input: I, actorId: string): Promise<StoredReview<R>> {
    const prefs = await this.getUserPreferences(actorId);
    const defaults = await this.getDefaultSubmissionValues(input, actorId, prefs);
    const review = {
      ...defaults,
      reviewId: generateReviewId(this.config.idPrefix),
      projectId: defaults.projectId || "",
      designerId: defaults.designerId || actorId,
      designNotes: defaults.designNotes || "",
      status: this.config.initialStatus,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      [this.config.fields.name]: readString(defaults, this.config.fields.name) || "",
      [this.config.fields.version]: readString(defaults, this.config.fields.version) || "V1.0",
      [this.config.fields.files]: readField(input, this.config.fields.files),
    } as unknown as R;

    const files = readField(review, this.config.fields.files) as { length: number } | undefined;
    if (!review.projectId || !readString(review, this.config.fields.name) || !files || files.length === 0) {
      throw new Error(this.config.requiredError);
    }

    const saved = await this.adapter.createReview(review);
    await this.logEvent(saved.reviewId, actorId, "submit", "draft" as S, this.config.initialStatus, { recordId: saved.recordId });
    await this.config.notify(
      this.env,
      `${this.config.submitTitle}\n评审单 ${saved.reviewId}（${readString(saved, this.config.fields.name)}，${readString(saved, this.config.fields.version)}）\n设计负责人：${saved.designerId}\n请及时安排评审会议`,
    );

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

    return saved;
  }

  async startMeeting(reviewId: string, actorId: string, payload?: Record<string, unknown>): Promise<StoredReview<R>> {
    const review = await this.requireReview(reviewId);
    const next = this.config.stateMachine.next(review.status, "start_meeting");
    if (!next) throw new Error(`当前状态 ${review.status} 不允许开始会议`);
    const updated = await this.adapter.updateReview(review.recordId, { status: next, updatedAt: new Date().toISOString() } as Partial<R>);
    await this.logEvent(reviewId, actorId, "start_meeting", review.status, next, payload);
    return updated;
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

  async conclude(reviewId: string, input: ConclusionInput, actorId: string): Promise<StoredReview<R>> {
    const review = await this.requireReview(reviewId);
    if (review.status !== "in_review") throw new Error("只能在评审中状态下提交评审结论");
    const next = this.config.stateMachine.next(review.status, CONCLUSION_EVENTS[input.conclusion]);
    if (!next) throw new Error(`结论 ${input.conclusion} 无法驱动状态流转`);

    const updated = await this.adapter.updateReview(review.recordId, {
      status: next,
      conclusion: input.conclusion,
      conclusionNotes: input.notes,
      updatedAt: new Date().toISOString(),
    } as Partial<R>);
    await this.logEvent(reviewId, actorId, "conclude", review.status, next, { conclusion: input.conclusion });

    if (input.conclusion === "conditional" && input.issues && input.issues.length > 0) {
      await Promise.all(
        input.issues.map((issue) =>
          this.adapter.createRecord(this.config.tables.rectifications, {
            [this.config.rectificationReviewField]: reviewId,
            问题描述: issue.description,
            提出人: issue.raisedBy.open_id,
            责任人: issue.owner?.open_id,
            截止日期: issue.dueDate,
            完成状态: "未完成",
          }),
        ),
      );
    }

    return updated;
  }

  async completeRectification(reviewId: string, actorId: string): Promise<StoredReview<R>> {
    const review = await this.requireReview(reviewId);
    const next = this.config.stateMachine.next(review.status, "complete");
    if (!next) throw new Error(`当前状态 ${review.status} 不允许完成整改`);
    const updated = await this.adapter.updateReview(review.recordId, { status: next, updatedAt: new Date().toISOString() } as Partial<R>);
    await this.logEvent(reviewId, actorId, "complete_rectification", review.status, next);
    return updated;
  }

  async transitionTo(reviewId: string, event: string, actorId: string, payload?: Record<string, unknown>): Promise<StoredReview<R>> {
    const review = await this.requireReview(reviewId);
    const next = this.config.stateMachine.next(review.status, event);
    if (!next) throw new Error(`当前状态 ${review.status} 不允许事件 ${event}`);
    const updated = await this.adapter.updateReview(review.recordId, { status: next, updatedAt: new Date().toISOString() } as Partial<R>);
    await this.logEvent(reviewId, actorId, event, review.status, next, payload);
    await this.config.notify(
      this.env,
      `${this.config.transitionTitle}\n评审单 ${reviewId}（${readString(review, this.config.fields.name)}）\n${review.status} → ${next}\n操作人：${actorId}`,
    );
    return updated;
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

  private async logEvent(
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
