/**
 * G-03 审批时效治理（PRD V1.2 §5）：每小时 cron（"7 * * * *"）扫描四条流程底表
 *   - 审批中超 sla.escalateHours（默认 48h）→ 升级提醒（KV approval:esc:<appId> 幂等，TTL=距自动取消剩余秒数）
 *   - 审批中超 sla.autoCancelDays（默认 14 天）→ 状态直接改「已取消」（不走 ACTION_TARGET）+ 群通知 + 清升级标记
 * sla 全关（均为 0）或未配 tableId 的流程跳过；提交时间为空的脏数据行跳过并记日志（不误伤）。
 * 底表读取复用 todo:tbl:<type> 5 分钟缓存（与 engine.aggregateTodos 同键同 TTL），整轮失败只记日志，
 * 有动作时向主群（flow=default）发一条汇总。
 */

import {
  fieldNum,
  fieldText,
  findFieldKey,
  getTenantAccessToken,
  listBitableRecords,
  updateBitableRecord,
  type BitableRecord,
} from "../feishu/bitable";
import { notifyFeishu } from "../feishu/bot";
import { KV_KEYS } from "../shared/kv-keys";
import { buildRecordLink } from "../validation/service";
import { APPROVAL_TYPES, getFlowBase, getFlowsConfig, type FlowConfig } from "./flows";

/** 与 engine.aggregateTodos 一致的底表缓存 TTL（秒） */
const TABLE_CACHE_TTL_SEC = 300;

export interface SlaRunSummary {
  escalated: number;
  cancelled: number;
  skipped: number;
  errors: string[];
}

/** 读流程底表：先吃 todo:tbl:<type> 5 分钟缓存，miss 则拉飞书并回写；拉取失败回退过期缓存 */
async function readFlowRecords(env: Env, token: string, base: string, type: string, flow: FlowConfig): Promise<BitableRecord[]> {
  const cacheKey = KV_KEYS.todoTable(type);
  const cached = (await env.REGISTRY.get(cacheKey, "json")) as { data: BitableRecord[]; cachedAt: number } | null;
  if (cached && cached.cachedAt > Date.now() - TABLE_CACHE_TTL_SEC * 1000) return cached.data;
  try {
    const records = await listBitableRecords(token, base, flow.tableId);
    await env.REGISTRY.put(cacheKey, JSON.stringify({ data: records, cachedAt: Date.now() }), { expirationTtl: TABLE_CACHE_TTL_SEC });
    return records;
  } catch (err) {
    if (cached) return cached.data;
    throw err;
  }
}

export async function runApprovalSla(env: Env): Promise<SlaRunSummary> {
  const cfg = await getFlowsConfig(env);
  const summary: SlaRunSummary = { escalated: 0, cancelled: 0, skipped: 0, errors: [] };
  const token = await getTenantAccessToken(env).catch((err: unknown) => {
    console.error(`[sla] tenant_access_token 不可用，本轮跳过：${err instanceof Error ? err.message : String(err)}`);
    return "";
  });
  if (!token) return summary;
  const now = Date.now();

  for (const type of APPROVAL_TYPES) {
    const flow = cfg[type];
    const sla = flow.sla ?? {};
    const escalateMs = (sla.escalateHours ?? 0) * 3600e3;
    const cancelMs = (sla.autoCancelDays ?? 0) * 86400e3;
    if (!flow.tableId || (escalateMs <= 0 && cancelMs <= 0)) continue;
    const base = await getFlowBase(env, flow);
    if (!base) continue;

    let records: BitableRecord[];
    try {
      records = await readFlowRecords(env, token, base, type, flow);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(`${type}: ${msg}`);
      console.error(`[sla] 读取 ${type} 底表失败：${msg}`);
      continue;
    }

    const statusKey = findFieldKey(records, [/^状态$/, /状态/, /进度/]) ?? "状态";
    const idKey = findFieldKey(records, [/^申请单号$/, /申请单号/, /单号/]);
    const timeKey = findFieldKey(records, [/^提交时间$/, /提交时间/, /创建时间/]);
    const applicantKey = findFieldKey(records, [/^申请人$/, /申请人/, /报销人/]);
    let tableDirty = false;

    for (const r of records) {
      // 只动「审批中」：已通过/已驳回/已取消等任何其他状态不触碰
      if (fieldText(r.fields[statusKey]) !== "审批中") continue;
      const appId = (idKey ? fieldText(r.fields[idKey]) : "") || r.record_id;
      try {
        // 提交时间底表存 epoch ms；为空/非正数 = 历史脏数据，跳过不误伤
        const submitted = timeKey ? fieldNum(r.fields[timeKey]) : null;
        if (submitted === null || submitted <= 0) {
          summary.skipped++;
          console.error(`[sla] ${appId} 提交时间为空，跳过（脏数据）`);
          continue;
        }
        const age = now - submitted;
        const link = buildRecordLink(base, flow.tableId, r.record_id);
        const applicant = applicantKey ? fieldText(r.fields[applicantKey]).trim() : "";

        if (cancelMs > 0 && age > cancelMs) {
          await updateBitableRecord(token, base, flow.tableId, r.record_id, { [statusKey]: "已取消" });
          r.fields[statusKey] = "已取消";
          tableDirty = true;
          await notifyFeishu(
            env,
            type,
            `⏰ 已自动取消 ${appId}`,
            `提交超 ${Math.round(cancelMs / 86400e3)} 天未审批，已自动取消${applicant ? `（申请人：${applicant}）` : ""}；如需继续请重新提交`,
            link,
          );
          await env.REGISTRY.delete(KV_KEYS.approvalEscalation(appId));
          summary.cancelled++;
        } else if (escalateMs > 0 && age > escalateMs) {
          const escKey = KV_KEYS.approvalEscalation(appId);
          if (await env.REGISTRY.get(escKey)) continue;
          const hours = Math.floor(age / 3600e3);
          const escalateTo = (sla.escalateTo ?? "").trim();
          const targets = [flow.approvers.roles, escalateTo].filter(Boolean).join(" + ");
          const remain = cancelMs > 0 ? `；${Math.max(1, Math.ceil((cancelMs - age) / 86400e3))} 天后将自动取消` : "";
          await notifyFeishu(
            env,
            type,
            `⏰ 审批超时提醒 ${appId}`,
            `已等待 ${hours} 小时，请 ${targets} 尽快处理${remain}${applicant ? `\n申请人：${applicant}` : ""}`,
            link,
          );
          // TTL = 距自动取消的剩余秒数（自动取消关闭时给 30 天兜底），防重复提醒
          const ttl = cancelMs > 0 ? Math.max(3600, Math.floor((cancelMs - age) / 1000)) : 30 * 24 * 3600;
          await env.REGISTRY.put(escKey, JSON.stringify({ at: now, hours }), { expirationTtl: ttl });
          summary.escalated++;
        }
      } catch (err) {
        // 单条失败只记日志不影响其他单（与 alert.service 同策略）
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`${appId}: ${msg}`);
        console.error(`[sla] 处理 ${appId} 失败：${msg}`);
      }
    }
    // 有状态变更时回写缓存，避免 5 分钟缓存窗口内重复处理已取消的单
    if (tableDirty) {
      await env.REGISTRY.put(KV_KEYS.todoTable(type), JSON.stringify({ data: records, cachedAt: Date.now() }), { expirationTtl: TABLE_CACHE_TTL_SEC }).catch(() => {});
    }
  }

  if (summary.escalated + summary.cancelled > 0) {
    await notifyFeishu(env, "default", "🕐 时效巡检", `升级提醒 ${summary.escalated} 条，自动取消 ${summary.cancelled} 条`);
  }
  // 巡检摘要落 KV（7 天）：cron 无日志可观测性弱，这是排障与验收的证据点
  await env.REGISTRY.put(KV_KEYS.slaLastRun, JSON.stringify({ at: now, ...summary }), { expirationTtl: 7 * 86400 }).catch(() => {});
  console.log(
    `[sla] 时效巡检完成：升级提醒 ${summary.escalated}，自动取消 ${summary.cancelled}，脏数据跳过 ${summary.skipped}，失败 ${summary.errors.length}`,
  );
  return summary;
}
