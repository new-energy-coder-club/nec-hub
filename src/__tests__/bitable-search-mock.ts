/**
 * 飞书 records/search 与 GET /records/:record_id 的内存表模拟（各测试文件 fetch mock 共用）。
 *
 * search：按 filter.conditions 求值（支持 is/isNot/contains/doesNotContain，contains 大小写不敏感
 * 取超集，调用方 match 二次确认）；条件字段在表样本中不存在时返回 1254607，模拟真实 API 的
 * FieldNotFound 错误，触发调用方回退全表扫描路径。
 */

import type { BitableRecord } from "../feishu/bitable";

export function mockJsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

interface MockCondition {
  field_name?: string;
  operator?: string;
  value?: string[];
}

function textOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join("、");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return textOf(o.name ?? o.text ?? o.title ?? "");
  }
  return String(v);
}

/** 模拟 POST /records/search：按 filter.conditions 过滤内存表 */
export function mockSearchResponse(items: BitableRecord[], body: string): Response {
  let filter: { conjunction?: string; conditions?: MockCondition[] } | undefined;
  try {
    filter = (JSON.parse(body) as { filter?: { conjunction?: string; conditions?: MockCondition[] } }).filter;
  } catch {
    filter = undefined;
  }
  const conditions = filter?.conditions ?? [];
  if (conditions.length && items.length) {
    const keys = new Set<string>();
    for (const r of items) for (const k of Object.keys(r.fields ?? {})) keys.add(k);
    for (const c of conditions) {
      if (c.field_name && !keys.has(c.field_name)) {
        return mockJsonResp({ code: 1254607, msg: `field not found: ${c.field_name}` });
      }
    }
  }
  const conj = filter?.conjunction === "or" ? "or" : "and";
  const matchOne = (r: BitableRecord, c: MockCondition): boolean => {
    const v = textOf(r.fields[c.field_name ?? ""]);
    const target = String(c.value?.[0] ?? "");
    if (c.operator === "is") return v === target;
    if (c.operator === "isNot") return v !== target;
    if (c.operator === "contains") return v.toLowerCase().includes(target.toLowerCase());
    if (c.operator === "doesNotContain") return !v.toLowerCase().includes(target.toLowerCase());
    return true;
  };
  const out = conditions.length
    ? items.filter((r) => (conj === "or" ? conditions.some((c) => matchOne(r, c)) : conditions.every((c) => matchOne(r, c))))
    : items;
  return mockJsonResp({ code: 0, data: { items: out, has_more: false } });
}

/** 模拟 GET /records/:record_id：命中返回单条，未命中 1254045 */
export function mockGetRecordResponse(items: BitableRecord[], recordId: string): Response {
  const rec = items.find((r) => r.record_id === recordId);
  if (!rec) return mockJsonResp({ code: 1254045, msg: "record not found" });
  return mockJsonResp({ code: 0, data: { record: rec } });
}
