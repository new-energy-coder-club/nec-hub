/**
 * 审批单号 KV 计数器：替代"记录数+1"（并发撞号），key 按 前缀+年 分桶，跨年度自动归零。
 * 计数模式与合同编号 consumeNextContractNumber 一致（get → +1 → put，接受 last-write）。
 */

import { KV_KEYS } from "../../shared/kv-keys";

/** 单号计数的 KV 最小接口（生产传 env.REGISTRY，测试注入 Map 实现） */
export interface SerialCounter {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export function serialKey(prefix: string, year: string | number): string {
  return KV_KEYS.serial(prefix, year);
}

/** 拼申请单号：<prefix>-<YYYY>-<digits 位补零序号>（默认 4 位；合同 HT 用 3 位） */
export function formatSerial(prefix: string, year: string | number, seq: number, digits = 4): string {
  return `${prefix}-${year}-${String(seq).padStart(digits, "0")}`;
}

function parseCounterValue(raw: string | null): number {
  const n = Number.parseInt(raw ?? "0", 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** 预览下一个单号（只读，不占用计数；合同 next-number 路由用） */
export async function peekNextSerial(
  counter: SerialCounter,
  prefix: string,
  year: string | number = new Date().getFullYear(),
  digits = 4,
): Promise<string> {
  const raw = await counter.get(serialKey(prefix, year));
  return formatSerial(prefix, year, parseCounterValue(raw) + 1, digits);
}

/** 占用下一个单号（get → +1 → put，并发冲突接受 last-write，与合同编号一致） */
export async function consumeNextSerial(
  counter: SerialCounter,
  prefix: string,
  year: string | number = new Date().getFullYear(),
  digits = 4,
): Promise<string> {
  const key = serialKey(prefix, year);
  const seq = parseCounterValue(await counter.get(key)) + 1;
  await counter.put(key, String(seq));
  return formatSerial(prefix, year, seq, digits);
}
