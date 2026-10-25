import { validateUserToken } from "../../auth/feishu-auth";
import { getDashboardConfig } from "../../dashboard";
import { KV_KEYS } from "../../shared/kv-keys";
import {
  fieldNum,
  fieldText,
  findFieldKey,
  getTenantAccessToken,
  listBitableFields,
  listBitableRecords,
  matchField,
  updateBitableRecord,
} from "../../feishu/bitable";
import type { McpToolDef } from "./shared";

export async function toolUpdateProgress(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) {
    const userToken = String(args.user_token ?? "").trim();
    if (!userToken) {
      throw new Error("update_progress 需要鉴权：请提供 user_token（飞书 user_access_token），或由配置了 MCP_TOKEN 的管理端调用");
    }
    await validateUserToken(userToken);
  }
  let recordId = String(args.record_id ?? "").trim();
  const goalKw = String(args.goal ?? "").trim();
  if (!recordId && !goalKw) {
    throw new Error("record_id 与 goal 至少填一个（goal 支持目标名称/记录关键词模糊匹配）");
  }
  const hasProgress = args.progress !== undefined && args.progress !== null && args.progress !== "";
  const status = String(args.status ?? "").trim();
  const note = String(args.note ?? "").trim();
  if (!hasProgress && !status && !note) throw new Error("progress / status / note 至少填一个");
  let progress: number | null = null;
  if (hasProgress) {
    progress = Number(args.progress);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error("progress 必须是 0-100 的数字");
  }
  const cfg = await getDashboardConfig(env);
  const tableId = cfg?.tables.goals;
  if (!cfg || !tableId) {
    throw new Error("赛季目标表未配置：请先调用 config_dashboard（action=set）写入 tables.goals");
  }
  const token = await getTenantAccessToken(env);
  // 字段元数据与记录定位互不依赖，提前启动并行拉取；错误仍在下方 await 处抛出
  const metasPromise = listBitableFields(token, cfg.base, tableId);
  metasPromise.catch(() => {});

  // goal 关键词定位记录：整条记录 JSON 不区分大小写包含匹配，或 record_id 精确命中；
  // 唯一匹配才写，多匹配返回候选列表让调用方用 record_id 精确指定
  if (!recordId) {
    const records = await listBitableRecords(token, cfg.base, tableId);
    const kw = goalKw.toLowerCase();
    const matched = records.filter(
      (r) => r.record_id === goalKw || JSON.stringify(r.fields).toLowerCase().includes(kw),
    );
    if (matched.length === 0) {
      throw new Error(`赛季目标表未找到匹配「${goalKw}」的记录（可用 query_bitable table=goals 核对目标名称）`);
    }
    if (matched.length > 1) {
      const titleKey = findFieldKey(matched, [/^目标/, /目标/, /title/i]);
      const progressKey = findFieldKey(matched, [/完成度/, /进度/, /progress/i]);
      const lines = matched.map((r) => {
        const title = (titleKey ? fieldText(r.fields[titleKey]) : "") || JSON.stringify(r.fields).slice(0, 60);
        const p = progressKey ? fieldNum(r.fields[progressKey]) : null;
        return `- record_id=${r.record_id} · ${title}${p !== null ? `（当前完成度 ${p}%）` : ""}`;
      });
      return {
        content: [
          {
            type: "text",
            text: `⚠️ 关键词「${goalKw}」匹配到 ${matched.length} 条赛季目标，未写入。请用 record_id 精确指定后重试：\n${lines.join("\n")}`,
          },
        ],
      };
    }
    recordId = matched[0].record_id;
  }

  const metas = await metasPromise;
  const record: Record<string, unknown> = {};
  if (progress !== null) {
    const f =
      matchField(metas, [/完成度/, /进度/, /progress/i], /Number|Progress|Percent/i) ??
      matchField(metas, [/完成度/, /进度/, /progress/i]);
    if (!f) throw new Error("赛季目标表未匹配到「完成度」字段");
    // 飞书「进度」字段取值 0-1，普通数字字段按 0-100 写入
    record[f.field_name] = /Progress/i.test(f.ui_type) && progress > 1 ? progress / 100 : progress;
  }
  if (status) {
    const f = matchField(metas, [/^状态/, /状态/, /status/i]);
    if (!f) throw new Error("赛季目标表未匹配到「状态」字段");
    record[f.field_name] = status;
  }
  let noteSkipped = false;
  if (note) {
    const f = matchField(metas, [/备注/, /进展/, /说明/, /note/i, /remark/i], /Text/i);
    if (f) record[f.field_name] = note;
    else noteSkipped = true;
  }
  const updated = await updateBitableRecord(token, cfg.base, tableId, recordId, record);
  // 回写后清看板缓存，门户面板下一次请求即拉最新数据（≤1 分钟）
  await env.REGISTRY.delete(KV_KEYS.dashboardCache("goals"));
  const parts = [
    progress !== null ? `完成度=${progress}%` : "",
    status ? `状态=${status}` : "",
    note ? (noteSkipped ? "备注未写入（表内无备注/进展类文本字段）" : "备注已写入") : "",
  ].filter(Boolean);
  return {
    content: [
      {
        type: "text",
        text:
          `✅ 赛季目标已回写（record_id=${recordId}）：${parts.join("，")}。\n` +
          `updated=${JSON.stringify({ record_id: updated.record_id, fields: updated.fields })}\n` +
          `看板缓存已清，门户「数据看板 → 赛季目标」1 分钟内刷新。`,
      },
    ],
  };
}

export const updateProgressTool: McpToolDef = {
  name: "update_progress",
  description:
    "回写赛季目标表某条记录的完成度%/状态（FE-04）。需先用 config_dashboard 配置 tables.goals。定位方式二选一：record_id 精确指定，或 goal 传目标名称/关键词模糊匹配（唯一匹配才写入，多匹配返回候选列表）。鉴权：管理端 MCP_TOKEN，或提供有效 user_token 的登录用户。回写后自动清看板缓存，门户面板 ≤1 分钟刷新。",
  inputSchema: {
    type: "object",
    properties: {
      record_id: { type: "string", description: "赛季目标表的 record_id（与 goal 二选一；可用 query_bitable table=goals 查到）" },
      goal: { type: "string", description: "目标名称或记录关键词（模糊匹配；唯一匹配才写入，多匹配返回候选 record_id 列表）" },
      progress: { type: "number", description: "完成度 0-100（与 status / note 至少填一个）" },
      status: { type: "string", description: "状态文本，如 进行中 / 已完成 / 已逾期" },
      note: { type: "string", description: "可选：进展备注，写入表内 备注/进展/说明 类文本字段（无该字段则跳过并在结果中说明）" },
      user_token: { type: "string", description: "可选：飞书 user_access_token；无 MCP_TOKEN 时必填" },
    },
  },
  impl: (args, env, ctx) => toolUpdateProgress(args, env, ctx.hasMcpToken),
};

export const tools: McpToolDef[] = [updateProgressTool];
