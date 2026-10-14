/**
 * 赛季目标管理 — 收集单服务（提交 / 列表 / 采纳 / 拒绝）
 */

import type { SeasonGoalsAdapter } from "./adapter";
import type { CollectRecord } from "./types";

export interface SubmitBody {
  title?: string;
  krs?: string;
  group?: string;
  deadline?: string;
  note?: string;
}

/** 入参校验失败：路由层按 400 返回（其余异常走网关 500 兜底） */
export class UserInputError extends Error {}

export class CollectService {
  constructor(private adapter: SeasonGoalsAdapter) {}

  async submit(userName: string, body: SubmitBody): Promise<{ recordId: string }> {
    const title = String(body.title ?? "").trim();
    const krs = String(body.krs ?? "").trim();
    const group = String(body.group ?? "").trim();
    const deadline = String(body.deadline ?? "").trim();
    const note = String(body.note ?? "").trim();
    if (!title) throw new UserInputError("请填写目标");
    if (!krs) throw new UserInputError("请填写关键结果");
    if (!group) throw new UserInputError("请填写负责组");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) throw new UserInputError("请选择截止日期（YYYY-MM-DD）");

    const rec = await this.adapter.createSubmission({
      title,
      krs,
      group,
      deadline,
      note,
      status: "待评审",
      source: "手工",
      submitter: userName,
    });
    return { recordId: rec.record_id };
  }

  async list(): Promise<CollectRecord[]> {
    return this.adapter.listSubmissions();
  }

  /** 采纳：收集单 → 目标表新建进行中目标，收集单状态置为已采纳 */
  async approve(recordId: string): Promise<{ goalRecordId: string }> {
    const sub = await this.adapter.getSubmission(recordId);
    if (!sub) throw new UserInputError(`收集单 ${recordId} 不存在`);
    if (sub.status !== "待评审") throw new UserInputError(`收集单当前状态为「${sub.status}」，不能重复采纳`);

    const goal = await this.adapter.createGoal({
      title: sub.title,
      krs: sub.krs,
      group: sub.group,
      deadline: sub.deadline,
      status: "进行中",
      progress: 0,
      source: sub.source,
    });
    await this.adapter.updateSubmission(recordId, { status: "已采纳" });
    return { goalRecordId: goal.record_id };
  }

  async reject(recordId: string): Promise<{ recordId: string }> {
    const sub = await this.adapter.getSubmission(recordId);
    if (!sub) throw new UserInputError(`收集单 ${recordId} 不存在`);
    if (sub.status !== "待评审") throw new UserInputError(`收集单当前状态为「${sub.status}」，不能拒绝`);
    await this.adapter.updateSubmission(recordId, { status: "已拒绝" });
    return { recordId };
  }
}
