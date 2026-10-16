/**
 * 审批 REST 处理器 + 审批相关 MCP 工具（submit_approval / list_todos / send_notice / config_flows）
 *
 * REST：
 *   POST /api/approvals                        → 发起审批（需登录；external 403；流程限组校验）
 *   POST /api/approvals/<type>/<单号>/<action> → 状态机动作（approve/reject/pay/start/archive/arrive/issue/publish，幂等）
 *   GET  /api/approvals/mine?type=             → 我的申请列表（按 open_id 过滤，提交时间降序 20 条）
 */

import { ROLES, resolveUserRole } from "../auth/role";
import { syncReimburseDocStatus } from "../erp/reimburse";
import { fieldNum, fieldText, findFieldKey, firstFieldText, getTenantAccessToken, queryBitableRecords } from "../feishu/bitable";
import { notifyFeishu } from "../feishu/bot";
import { approvalResultMailHtml, defaultMailRecipients, sendFeishuMail } from "../feishu/mail";
import { json } from "../shared/http";
import { resolveSession } from "../shared/session";
import { buildRecordLink } from "../validation/service";
import {
  APPROVAL_TYPES,
  ApprovalError,
  getFlowBase,
  getFlowsConfig,
  isApprover,
  type ApprovalType,
  type FlowConfig,
} from "./flows";
import {
  APPROVAL_ACTIONS,
  aggregateTodos,
  runApprovalAction,
  submitApprovalCore,
  type ApprovalAction,
} from "./engine";

export async function handleApprovalSubmit(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "unauthorized" }, 401);
  const role = await resolveUserRole(env, session.user, ctx);
  if (role.role === "external") return json({ error: "forbidden", role: role.role }, 403);
  const body = (await request.json().catch(() => ({}))) as { type?: string; fields?: Record<string, unknown> };
  const type = String(body.type ?? "") as ApprovalType;
  if (!APPROVAL_TYPES.includes(type)) {
    return json({ error: `type 必须是：${APPROVAL_TYPES.join(" | ")}` }, 400);
  }
  const cfg = await getFlowsConfig(env);
  const flow = cfg[type];
  if (!flow.tableId) {
    return json({ error: `流程未配置：先用 MCP config_flows 配置 ${type} 的 tableId` }, 400);
  }
  if (flow.group && role.group !== flow.group && !ROLES.CAPTAIN.test(role.role)) {
    return json({ error: "forbidden", role: role.role, hint: `该流程仅限 ${flow.group} 提交` }, 403);
  }
  try {
    return json(await submitApprovalCore(env, { type, fields: body.fields ?? {}, user: session.user, role, source: "portal" }));
  } catch (err) {
    if (err instanceof ApprovalError) return json({ error: err.message }, err.status);
    throw err;
  }
}

export async function handleApprovalAction(
  request: Request,
  env: Env,
  type: string,
  appId: string,
  action: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "unauthorized" }, 401);
  if (!APPROVAL_TYPES.includes(type as ApprovalType)) return json({ error: `未知流程 type：${type}` }, 400);
  if (!APPROVAL_ACTIONS.includes(action as ApprovalAction)) return json({ error: `未知动作：${action}` }, 400);
  const body = (await request.json().catch(() => ({}))) as { comment?: string; link?: string; reason?: string };
  try {
    return json(
      await runApprovalAction(env, {
        type: type as ApprovalType,
        appId,
        action: action as ApprovalAction,
        comment: body.comment,
        link: body.link,
        reason: body.reason,
        onStatusChange: syncReimburseDocStatus,
        user: session.user,
        role: await resolveUserRole(env, session.user, ctx),
      }),
    );
  } catch (err) {
    if (err instanceof ApprovalError) return json({ error: err.message }, err.status);
    throw err;
  }
}

/**
 * 凭证上传（R-01 报销助手应用页）：multipart 文件 → R2 receipts/ 存档，返回 key 供
 * POST /api/approvals 的 fields（如「发票照片」）引用。≤10MB，与 /api/reimburse 同一存档前缀。
 */
export async function handleApprovalUpload(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "请先登录后再上传凭证" }, 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "请求必须是 multipart/form-data" }, 400);
  }

  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const files: Array<{ field: string; key: string; name: string; size: number }> = [];
  for (const [field, value] of form.entries()) {
    if (!(value instanceof File) || value.size === 0) continue;
    if (value.size > 10 * 1024 * 1024) {
      return json({ error: `文件超过 10MB 上限（${value.name || field}）` }, 400);
    }
    const safe = (value.name || field).replace(/[^\w.\-一-龥]+/g, "_").slice(-60);
    const key = `receipts/${day}/${crypto.randomUUID()}-${safe}`;
    await env.APPS_BUCKET.put(key, await value.arrayBuffer(), {
      httpMetadata: { contentType: value.type || "application/octet-stream" },
    });
    files.push({ field, key, name: value.name || field, size: value.size });
  }
  if (!files.length) return json({ error: "未收到文件" }, 400);
  return json({ ok: true, files });
}

/**
 * 待我审批列表（G-02 各流程申请页「待我审批」数据源）：当前角色可审（isApprover）且状态=审批中的行，
 * 提交时间升序（先提交先审）。非审批人返回空列表（不 403，前端据此只显示空态）。
 */
export async function handleApprovalPending(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const type = (url.searchParams.get("type") ?? "") as ApprovalType;
  if (!APPROVAL_TYPES.includes(type)) {
    return json({ error: `type 必须是：${APPROVAL_TYPES.join(" | ")}` }, 400);
  }
  const role = await resolveUserRole(env, session.user, ctx);
  const cfg = await getFlowsConfig(env);
  const flow = cfg[type];
  if (!flow.tableId || !isApprover(role, flow.approvers)) {
    return json({ records: [] });
  }
  const base = await getFlowBase(env, flow);
  if (!base) return json({ records: [] });
  const token = await getTenantAccessToken(env);
  // filter 下推只拉「审批中」行；search 失败回退全表扫描（match 保留字段名模糊匹配，语义不变）
  const records = await queryBitableRecords(
    token,
    base,
    flow.tableId,
    [{ field_name: "状态", operator: "is", value: ["审批中"] }],
    (r, rs) => {
      const k = findFieldKey(rs, [/^状态$/, /状态/, /进度/]) ?? "状态";
      return fieldText(r.fields[k]) === "审批中";
    },
  );
  const statusKey = findFieldKey(records, [/^状态$/, /状态/, /进度/]) ?? "状态";
  const pending = records
    .filter((r) => fieldText(r.fields[statusKey]) === "审批中")
    .sort((a, b) => (fieldNum(a.fields["提交时间"]) ?? 0) - (fieldNum(b.fields["提交时间"]) ?? 0))
    .slice(0, 20);
  return json({
    records: pending.map((r) => ({
      application_id: fieldText(r.fields["申请单号"]),
      title: firstFieldText(r),
      applicant: fieldText(r.fields["申请人"]),
      record_id: r.record_id,
      url: buildRecordLink(base, flow.tableId, r.record_id),
      submitted_at: fieldNum(r.fields["提交时间"]) ?? null,
    })),
  });
}

/** 我的申请列表（各流程申请页「我的申请」数据源）：按 open_id 过滤 → 提交时间降序 → 前 20 条 */
export async function handleApprovalMine(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const type = (url.searchParams.get("type") ?? "reimburse") as ApprovalType;
  if (!APPROVAL_TYPES.includes(type)) {
    return json({ error: `type 必须是：${APPROVAL_TYPES.join(" | ")}` }, 400);
  }
  const cfg = await getFlowsConfig(env);
  const flow = cfg[type];
  if (!flow.tableId) return json({ records: [], hint: "流程未配置" });
  const base = await getFlowBase(env, flow);
  if (!base) return json({ records: [], hint: "流程未配置" });
  const token = await getTenantAccessToken(env);
  // filter 下推按 open_id 只拉本人的单；search 失败回退全表扫描 + 内存过滤（match 与原逻辑一致）
  const records = await queryBitableRecords(
    token,
    base,
    flow.tableId,
    [{ field_name: "申请人 open_id", operator: "is", value: [session.user.open_id] }],
    (r) => fieldText(r.fields["申请人 open_id"]) === session.user.open_id,
  );
  const mine = records
    .filter((r) => fieldText(r.fields["申请人 open_id"]) === session.user.open_id)
    .sort((a, b) => (fieldNum(b.fields["提交时间"]) ?? 0) - (fieldNum(a.fields["提交时间"]) ?? 0))
    .slice(0, 20);
  return json({
    records: mine.map((r) => {
      const f = r.fields;
      // 全量字段透传（数字保持 number，其余转文本），各流程申请页按各自字段名取用
      const fields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(f)) {
        fields[k] = typeof v === "number" ? v : fieldText(v);
      }
      return {
        application_id: fieldText(f["申请单号"]),
        status: fieldText(f["状态"]),
        record_id: r.record_id,
        url: buildRecordLink(base, flow.tableId, r.record_id),
        fields,
      };
    }),
  });
}

// ---------- 审批相关 MCP 工具实现 ----------

/** submit_approval：代发起审批（需 MCP_TOKEN） */
export async function toolSubmitApproval(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) throw new Error("submit_approval 仅管理端可用（需 MCP_TOKEN）");
  const type = String(args.type ?? "") as ApprovalType;
  if (!APPROVAL_TYPES.includes(type)) {
    throw new Error(`type 必须是：${APPROVAL_TYPES.join(" | ")}`);
  }
  const fields = (args.fields ?? {}) as Record<string, unknown>;
  if (typeof fields !== "object" || Array.isArray(fields)) throw new Error("fields 必须是对象");
  const result = await submitApprovalCore(env, {
    type,
    fields,
    user: null,
    role: null,
    applicantName: String(args.applicant_name ?? ""),
    source: "mcp",
  });
  return {
    content: [
      { type: "text", text: `✅ 已代提交：${result.application_id}（${result.status}）` },
    ],
  };
}

/** list_todos：按 open_id 聚合待办（需 MCP_TOKEN） */
export async function toolListTodos(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) throw new Error("list_todos 仅管理端可用（需 MCP_TOKEN）");
  const openId = String(args.open_id ?? "").trim();
  if (!openId) throw new Error("open_id 不能为空");
  const role = await resolveUserRole(env, { name: "", open_id: openId });
  const todos = await aggregateTodos(env, role);
  return {
    content: [
      {
        type: "text",
        text:
          `待办聚合（角色：${role.role}${role.group ? " · " + role.group : ""}${role.matched ? "" : "，未匹配名单"}）：\n` +
          JSON.stringify(todos, null, 2),
      },
    ],
  };
}

/** send_notice：向流程群发通知（需 MCP_TOKEN）；channel=bot|mail|both，mail 走飞书邮箱 */
export async function toolSendNotice(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) throw new Error("send_notice 仅管理端可用（需 MCP_TOKEN）");
  const flow = String(args.flow ?? "").trim();
  const title = String(args.title ?? "").trim();
  const content = String(args.content ?? "").trim();
  if (!title) throw new Error("title 不能为空");
  if (!content) throw new Error("content 不能为空");
  const link = String(args.link ?? "").trim();
  const channel = String(args.channel ?? "bot").trim();

  if (channel === "mail") {
    const to = parseRecipients(args.to) ?? defaultMailRecipients(env);
    if (!to.length) throw new Error("channel=mail 需传 to（逗号分隔）或配置 env MAIL_TO");
    const result = await sendFeishuMail(env, {
      to,
      subject: title,
      html: approvalResultMailHtml({ title, summary: content, link: link || undefined }),
    });
    if (!result.ok) {
      const prefix = result.disabled ? "⚠️ 邮件通道未启用" : "⚠️ 邮件未送达";
      return { content: [{ type: "text", text: `${prefix}：${result.detail}（已按降级处理，业务不受影响）` }] };
    }
    return { content: [{ type: "text", text: `✅ 邮件已发送（${to.length} 个收件人）` }] };
  }

  if (channel === "both") {
    const to = parseRecipients(args.to) ?? defaultMailRecipients(env);
    const bot = await notifyFeishu(env, flow, title, content, link || undefined);
    const mail = to.length
      ? await sendFeishuMail(env, {
          to,
          subject: title,
          html: approvalResultMailHtml({ title, summary: content, link: link || undefined }),
        })
      : { ok: false, disabled: true, detail: "无收件人（未传 to 且未配置 MAIL_TO）" };
    const lines = [
      bot.ok ? "✅ 群机器人已送达" : `⚠️ 群机器人未送达：${bot.detail}`,
      mail.ok ? `✅ 邮件已发送（${to.length} 个收件人）` : `⚠️ 邮件${mail.disabled ? "通道未启用" : "未送达"}：${mail.detail}`,
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  if (channel !== "bot") throw new Error("channel 必须是 bot | mail | both");
  const result = await notifyFeishu(env, flow, title, content, link || undefined);
  if (!result.ok) {
    return { content: [{ type: "text", text: `⚠️ 通知未送达：${result.detail}（已按降级处理，业务不受影响）` }] };
  }
  return { content: [{ type: "text", text: `✅ 已发送（flow=${flow || "default"}）` }] };
}

/** 解析 send_notice 的 to 参数：字符串（逗号/分号分隔）或字符串数组 */
function parseRecipients(v: unknown): string[] | null {
  if (v == null) return null;
  const list = Array.isArray(v) ? v : [v];
  const out = list
    .flatMap((s) => String(s).split(/[,;]/))
    .map((s) => s.trim())
    .filter(Boolean);
  return out.length ? out : null;
}

/** config_flows：查看/修改 flows:config（需 MCP_TOKEN）；set 时深合并 + 校验 */
export async function toolConfigFlows(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) throw new Error("config_flows 仅管理端可用（需 MCP_TOKEN）");
  const action = String(args.action ?? "get");
  if (action === "get") {
    const cfg = await getFlowsConfig(env);
    return {
      content: [
        { type: "text", text: `当前 flows:config：\n${JSON.stringify(cfg, null, 2)}` },
      ],
    };
  }
  if (action !== "set") throw new Error("action 必须是 get | set");
  const raw = (args.flows ?? {}) as Record<string, unknown>;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("flows 必须是对象");
  const current = await getFlowsConfig(env);
  for (const t of APPROVAL_TYPES) {
    const patch = raw[t] as Record<string, unknown> | undefined;
    if (!patch) continue;
    if (typeof patch !== "object" || Array.isArray(patch)) throw new Error(`flows.${t} 必须是对象`);
    if (patch.approvers !== undefined &&
        (typeof patch.approvers !== "object" ||
         typeof (patch.approvers as FlowConfig["approvers"]).roles !== "string")) {
      throw new Error(`approvers 不合法（${t}）：应为 { roles: "队长|财务", groupLeaders?: [...] }`);
    }
    if (patch.thresholds !== undefined && (typeof patch.thresholds !== "object" || Array.isArray(patch.thresholds))) {
      throw new Error(`thresholds 不合法（${t}）：应为 { notifyRoles?, amountField?, coSign? }`);
    }
    if (patch.sla !== undefined) {
      const sla = patch.sla as Record<string, unknown> | null;
      if (typeof sla !== "object" || sla === null || Array.isArray(sla)) {
        throw new Error(`sla 不合法（${t}）：应为 { escalateHours?, autoCancelDays?, escalateTo? }`);
      }
      for (const k of ["escalateHours", "autoCancelDays"] as const) {
        const v = sla[k];
        if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
          throw new Error(`sla.${k} 不合法（${t}）：应为 ≥0 的数字（0 = 关闭）`);
        }
      }
      if (sla.escalateTo !== undefined && typeof sla.escalateTo !== "string") {
        throw new Error(`sla.escalateTo 不合法（${t}）：应为角色正则串`);
      }
    }
    if (patch.required !== undefined && !Array.isArray(patch.required)) {
      throw new Error(`required 不合法（${t}）：应为字段名数组`);
    }
    if (patch.conditional !== undefined && !Array.isArray(patch.conditional)) {
      throw new Error(`conditional 不合法（${t}）：应为 [{ when: { field, equals }, require: [...] }]`);
    }
    const merged = { ...current[t], ...patch } as FlowConfig;
    if (merged.tableId && !/^tbl[A-Za-z0-9]+$/.test(merged.tableId)) {
      throw new Error(`table_id 不合法（${t}）：应以 tbl 开头或留空`);
    }
    if (merged.base && !/^[A-Za-z0-9]{10,}$/.test(merged.base)) {
      throw new Error(`base 不合法（${t}）：应为多维表格 URL 中 /base/ 后的 app_token`);
    }
    try {
      new RegExp(merged.approvers?.roles ?? "");
    } catch {
      throw new Error(`approvers.roles 不是合法正则（${t}）`);
    }
    current[t] = merged;
  }
  await env.REGISTRY.put("flows:config", JSON.stringify(current));
  // 配置变更后清待办缓存，下一次拉取按新配置走
  await Promise.all(APPROVAL_TYPES.map((t) => env.REGISTRY.delete(`todo:tbl:${t}`)));
  return {
    content: [
      {
        type: "text",
        text:
          `✅ flows:config 已保存（${APPROVAL_TYPES.join(" / ")}）。\n` +
          `tableId/base 为空的流程会在发起与待办时提示先配置（config_flows set 或 config_dashboard）。`,
      },
    ],
  };
}
