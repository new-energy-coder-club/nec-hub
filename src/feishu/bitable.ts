/**
 * 飞书多维表格 API 通用封装（供 nec-hub 各模块共用）
 */

const FEISHU_API = "https://open.feishu.cn/open-apis";

export interface BitableRecord {
  record_id: string;
  fields: Record<string, unknown>;
}

export interface BitableFieldMeta {
  field_name: string;
  ui_type: string;
}

/** 实例内 token 缓存：命中时连 KV 都不用读 */
let tenantTokenMem: { token: string; expireAt: number } | null = null;
/** in-flight 去重：缓存过期瞬间的并发调用共享同一次飞书请求 */
let tenantTokenInflight: Promise<string> | null = null;

/** tenant_access_token 缓存（实例内存 + KV，均提前 5 分钟过期） */
export async function getTenantAccessToken(env: Env): Promise<string> {
  if (tenantTokenMem && tenantTokenMem.expireAt > Date.now()) return tenantTokenMem.token;
  tenantTokenInflight ??= fetchTenantAccessToken(env).finally(() => {
    tenantTokenInflight = null;
  });
  return tenantTokenInflight;
}

async function fetchTenantAccessToken(env: Env): Promise<string> {
  const cached = await env.REGISTRY.get("feishu:tenant_access_token", "json") as
    | { token: string; expireAt: number }
    | null;
  if (cached && cached.expireAt > Date.now()) {
    tenantTokenMem = cached;
    return cached.token;
  }

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
  const expireAt = Date.now() + ((data.expire ?? 7200) - 300) * 1000;
  tenantTokenMem = { token: data.tenant_access_token, expireAt };
  await env.REGISTRY.put("feishu:tenant_access_token", JSON.stringify(tenantTokenMem));
  return data.tenant_access_token;
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
