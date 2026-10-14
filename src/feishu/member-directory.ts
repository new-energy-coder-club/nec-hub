/**
 * 队员名单姓名 → open_id 目录（meeting / mail 等"按姓名找人"的域共用）
 *
 * 数据源：数据看板配置的 members 表（config_dashboard）。未配置或字段缺失返回 null。
 */

import { getDashboardConfig } from "../dashboard";
import { fieldText, findFieldKey, getTenantAccessToken, listBitableRecords } from "./bitable";

export async function loadMemberDirectory(env: Env): Promise<Map<string, string> | null> {
  const cfg = await getDashboardConfig(env);
  const tableId = cfg?.tables.members;
  if (!cfg?.base || !tableId) return null;
  const token = await getTenantAccessToken(env);
  const records = await listBitableRecords(token, cfg.base, tableId, 500);
  const nameKey = findFieldKey(records, [/^姓名$/, /姓名|name/i]);
  const idKey = findFieldKey(records, [/open_?id/i, /飞书.*id/i]);
  if (!nameKey || !idKey) return null;
  const map = new Map<string, string>();
  for (const r of records) {
    const name = fieldText(r.fields[nameKey]).trim();
    const oid = fieldText(r.fields[idKey]).trim();
    if (name && oid.startsWith("ou_")) map.set(name, oid);
  }
  return map;
}

/** 名字或 open_id → open_id；返回已解析列表与未命中名单 */
export async function resolveOpenIds(
  env: Env,
  inputs: string[],
): Promise<{ resolved: Array<{ name: string; openId: string }>; missing: string[] }> {
  const resolved: Array<{ name: string; openId: string }> = [];
  const missing: string[] = [];
  let directory: Map<string, string> | null = null;
  let directoryTried = false;
  for (const raw of inputs) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    if (v.startsWith("ou_")) {
      resolved.push({ name: v, openId: v });
      continue;
    }
    if (!directoryTried) {
      directoryTried = true;
      directory = await loadMemberDirectory(env).catch(() => null);
    }
    const oid = directory?.get(v);
    if (oid) resolved.push({ name: v, openId: oid });
    else missing.push(v);
  }
  return { resolved, missing };
}