/**
 * 飞书多维表格 API 通用封装（供 nec-hub 各模块共用）
 */

import { FEISHU_API, cachedToken, type CachedToken } from "./client";

export interface BitableRecord {
  record_id: string;
  fields: Record<string, unknown>;
}

export interface BitableFieldMeta {
  field_name: string;
  ui_type: string;
}

/** tenant_access_token 缓存（实例内存 + KV，均提前 5 分钟过期） */
export async function getTenantAccessToken(env: Env): Promise<string> {
  return cachedToken(env, "feishu:tenant_access_token", fetchTenantAccessToken);
}

async function fetchTenantAccessToken(env: Env): Promise<CachedToken> {
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    throw new Error("飞书自建应用未配置：请先配置 FEISHU_APP_ID / FEISHU_APP_SECRET");
  }

  const resp = await fetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const data = (await resp.json()) as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`获取 tenant_access_token 失败：${data.msg ?? "unknown"}`);
  }
  return { token: data.tenant_access_token, expireAt: Date.now() + ((data.expire ?? 7200) - 300) * 1000 };
}

/** 分页读取一张多维表格（最多 max 条） */
export async function listBitableRecords(
  token: string,
  appToken: string,
  tableId: string,
  max = 1000,
): Promise<BitableRecord[]> {
  const out: BitableRecord[] = [];
  let pageToken = "";
  do {
    const u = new URL(`${FEISHU_API}/bitable/v1/apps/${appToken}/tables/${tableId}/records`);
    u.searchParams.set("page_size", "100");
    if (pageToken) u.searchParams.set("page_token", pageToken);
    const resp = await fetch(u.toString(), { headers: { authorization: `Bearer ${token}` } });
    const data = (await resp.json()) as {
      code?: number;
      msg?: string;
      data?: { items?: BitableRecord[]; has_more?: boolean; page_token?: string };
    };
    if (data.code !== 0) {
      throw new Error(`飞书多维表格读取失败（${tableId}）：${data.msg ?? `code ${data.code}`}`);
    }
    out.push(...(data.data?.items ?? []));
    pageToken = data.data?.has_more ? (data.data?.page_token ?? "") : "";
  } while (pageToken && out.length < max);
  return out.slice(0, max);
}

/** search 接口结构化过滤条件（POST records/search 的 filter.conditions 元素） */
export interface BitableCondition {
  field_name: string;
  operator: "is" | "isNot" | "contains" | "doesNotContain" | "isEmpty" | "isNotEmpty";
  value?: string[];
}

/** 按条件搜索记录（POST /records/search，filter 下推；分页拉取，最多 max 条） */
export async function searchBitableRecords(
  token: string,
  appToken: string,
  tableId: string,
  conditions: BitableCondition[],
  opts: { conjunction?: "and" | "or"; max?: number } = {},
): Promise<BitableRecord[]> {
  const max = opts.max ?? 500;
  const out: BitableRecord[] = [];
  let pageToken = "";
  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (conditions.length) body.filter = { conjunction: opts.conjunction ?? "and", conditions };
    if (pageToken) body.page_token = pageToken;
    const resp = await fetch(`${FEISHU_API}/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await resp.json()) as {
      code?: number;
      msg?: string;
      data?: { items?: BitableRecord[]; has_more?: boolean; page_token?: string };
    };
    if (data.code !== 0) {
      throw new Error(`飞书多维表格搜索失败（${tableId}）：${data.msg ?? `code ${data.code}`}`);
    }
    out.push(...(data.data?.items ?? []));
    pageToken = data.data?.has_more ? (data.data?.page_token ?? "") : "";
  } while (pageToken && out.length < max);
  return out.slice(0, max);
}

/** 按 record_id 读单条（GET /records/:record_id）；记录不存在返回 null，其它错误抛出 */
export async function getBitableRecord(
  token: string,
  appToken: string,
  tableId: string,
  recordId: string,
): Promise<BitableRecord | null> {
  const resp = await fetch(`${FEISHU_API}/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = (await resp.json()) as { code?: number; msg?: string; data?: { record?: BitableRecord } };
  if (data.code !== 0) {
    if (data.code === 1254045 || /not[\s_-]*found/i.test(data.msg ?? "")) return null;
    throw new Error(`飞书多维表格读取记录失败（${tableId}/${recordId}）：${data.msg ?? `code ${data.code}`}`);
  }
  return data.data?.record ?? null;
}

/**
 * filter 下推 + 全表扫描兜底：
 * 先走 search 接口把条件下推到服务端；search 失败（如条件字段名在表里不存在）时
 * 回退 listBitableRecords 全量拉取 + match 内存过滤，行为与改造前完全一致。
 * match 同时作用于 search 结果（二次确认，保证与原有内存过滤语义一致，防 contains 大小写等差异）；
 * 第二个参数为当前批次记录（供 findFieldKey 类字段嗅探用）。
 * fallbackOnEmpty=true 时 search 命中 0 条也回退全表扫描（模式匹配类查询的大小写/字段名兜底）。
 */
export async function queryBitableRecords(
  token: string,
  appToken: string,
  tableId: string,
  conditions: BitableCondition[],
  match: (record: BitableRecord, records: BitableRecord[]) => boolean,
  opts: { conjunction?: "and" | "or"; max?: number; scanMax?: number; fallbackOnEmpty?: boolean } = {},
): Promise<BitableRecord[]> {
  if (conditions.length) {
    try {
      const found = await searchBitableRecords(token, appToken, tableId, conditions, opts);
      if (found.length || !opts.fallbackOnEmpty) return found.filter((r) => match(r, found));
    } catch {
      /* search 不可用（条件字段不存在/接口错误）→ 回退全表扫描 */
    }
  }
  const all = await listBitableRecords(token, appToken, tableId, opts.scanMax ?? 1000);
  return all.filter((r) => match(r, all));
}

/** 拉取表字段元数据（field_name + ui_type） */
export async function listBitableFields(token: string, appToken: string, tableId: string): Promise<BitableFieldMeta[]> {
  const out: BitableFieldMeta[] = [];
  let pageToken = "";
  do {
    const u = new URL(`${FEISHU_API}/bitable/v1/apps/${appToken}/tables/${tableId}/fields`);
    u.searchParams.set("page_size", "100");
    if (pageToken) u.searchParams.set("page_token", pageToken);
    const resp = await fetch(u.toString(), { headers: { authorization: `Bearer ${token}` } });
    const data = (await resp.json()) as {
      code?: number;
      msg?: string;
      data?: { items?: BitableFieldMeta[]; has_more?: boolean; page_token?: string };
    };
    if (data.code !== 0) throw new Error("读取表字段失败：" + (data.msg ?? ("code " + data.code)));
    out.push(...(data.data?.items ?? []));
    pageToken = data.data?.has_more ? (data.data?.page_token ?? "") : "";
  } while (pageToken);
  return out;
}

/** 创建一条记录 */
export async function createBitableRecord(
  token: string,
  appToken: string,
  tableId: string,
  fields: Record<string, unknown>,
): Promise<BitableRecord> {
  const resp = await fetch(`${FEISHU_API}/bitable/v1/apps/${appToken}/tables/${tableId}/records`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  const data = (await resp.json()) as {
    code?: number;
    msg?: string;
    data?: { record?: BitableRecord };
  };
  if (data.code !== 0 || !data.data?.record) {
    throw new Error(`创建记录失败：${data.msg ?? `code ${data.code}`}`);
  }
  return data.data.record;
}

/** 更新一条记录 */
export async function updateBitableRecord(
  token: string,
  appToken: string,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>,
): Promise<BitableRecord> {
  const resp = await fetch(`${FEISHU_API}/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  const data = (await resp.json()) as {
    code?: number;
    msg?: string;
    data?: { record?: BitableRecord };
  };
  if (data.code !== 0 || !data.data?.record) {
    throw new Error(`更新记录失败：${data.msg ?? `code ${data.code}`}`);
  }
  return data.data.record;
}

/** 在指定 base 里新建一张数据表（按字段 schema），返回 table_id */
export async function createBitableTable(
  token: string,
  appToken: string,
  name: string,
  fields: Array<{ field_name: string; type: number; property?: Record<string, unknown> }>,
): Promise<string> {
  const resp = await fetch(`${FEISHU_API}/bitable/v1/apps/${appToken}/tables`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ table: { name, fields } }),
  });
  const data = (await resp.json()) as { code?: number; msg?: string; data?: { table_id?: string } };
  if (data.code !== 0 || !data.data?.table_id) {
    throw new Error(`创建数据表失败（${name}）：${data.msg ?? `code ${data.code}`}`);
  }
  return data.data.table_id;
}

// ---------- 字段值工具函数 ----------

/** 多维表格记录直链（群通知「去处理」用） */
export function bitableRecordLink(base: string, tableId: string, recordId: string): string {
  return `https://www.feishu.cn/base/${base}?table=${tableId}&record=${recordId}`;
}
export function fieldText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(fieldText).filter(Boolean).join("、");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return fieldText(o.name ?? o.text ?? o.title ?? "");
  }
  return String(v);
}

export function fieldNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const m = fieldText(v).replace(/[,，\s]/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export function fieldTs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = fieldText(v).trim();
  if (!s) return null;
  const norm = s.replace(/[年月/.]/g, "-").replace(/日/g, "");
  const t = Date.parse(norm);
  return Number.isNaN(t) ? null : t;
}

export function firstFieldText(r: BitableRecord): string {
  for (const k of Object.keys(r.fields ?? {})) {
    const v = fieldText(r.fields[k]);
    if (v) return v;
  }
  return "";
}

/** 在记录样本里按正则找第一个匹配的字段名 */
export function findFieldKey(records: BitableRecord[], patterns: RegExp[]): string | null {
  const keys = new Set<string>();
  for (const r of records.slice(0, 50)) {
    for (const k of Object.keys(r.fields ?? {})) keys.add(k);
  }
  for (const re of patterns) {
    for (const k of keys) {
      if (re.test(k)) return k;
    }
  }
  return null;
}

/** 按字段名正则 + 可选 ui_type 正则挑字段 */
export function matchField(fields: BitableFieldMeta[], patterns: RegExp[], types?: RegExp): BitableFieldMeta | null {
  for (const re of patterns) {
    for (const f of fields) {
      if (re.test(f.field_name) && (!types || types.test(f.ui_type))) return f;
    }
  }
  return null;
}
