/**
 * 审批单号 KV 计数器：替代"记录数+1"（并发撞号），key 按 前缀+年 分桶，跨年度自动归零。
 * 计数模式与合同编号 consumeNextContractNumber 一致（get → +1 → put，接受 last-write）。
 */

/** 单号计数的 KV 最小接口（生产传 env.REGISTRY，测试注入 Map 实现） */
export interface SerialCounter {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export function serialKey(prefix: string, year: string | number): string {
  return `serial:${prefix}:${year}`;
}

/** 拼申请单号：<prefix>-<YYYY>-<4 位补零序号> */
export function formatSerial(prefix: string, year: string | number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
}

function parseCounterValue(raw: string | null): number {
  const n = Number.parseInt(raw ?? "0", 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** 占用下一个单号（get → +1 → put，并发冲突接受 last-write，与合同编号一致） */
export async function consumeNextSerial(
  counter: SerialCounter,
  prefix: string,
  year: string | number = new Date().getFullYear(),
): Promise<string> {
  const key = serialKey(prefix, year);
  const seq = parseCounterValue(await counter.get(key)) + 1;
  await counter.put(key, String(seq));
  return formatSerial(prefix, year, seq);
}
