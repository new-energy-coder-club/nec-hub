/**
 * 审批 REST 处理器 + 审批相关 MCP 工具（submit_approval / list_todos / send_notice / config_flows）
 *
 * REST：
 *   POST /api/approvals                        → 发起审批（需登录；external 403；流程限组校验）
 *   POST /api/approvals/<type>/<单号>/<action> → 状态机动作（approve/reject/pay/start/archive/arrive/issue/publish，幂等）
 *   GET  /api/approvals/mine?type=             → 我的申请列表（按 open_id 过滤，提交时间降序 20 条）
 */

import { resolveUserRole } from "../auth/role";
import { fieldNum, fieldText, getTenantAccessToken, listBitableRecords } from "../feishu/bitable";
import { notifyFeishu } from "../feishu/bot";
import { json } from "../shared/http";
import { applyRenewedSession, resolveSession } from "../shared/session";
import {
  APPROVAL_TYPES,
  ApprovalError,
  getFlowBase,
  getFlowsConfig,
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
  if (role.role === "external") return applyRenewedSession(json({ error: "forbidden", role: role.role }, 403), session.renewed);
  const body = (await request.json().catch(() => ({}))) as { type?: string; fields?: Record<string, unknown> };
  const type = String(body.type ?? "") as ApprovalType;
  if (!APPROVAL_TYPES.includes(type)) {
    return applyRenewedSession(json({ error: `type 必须是：${APPROVAL_TYPES.join(" | ")}` }, 400), session.renewed);
  }
  const cfg = await getFlowsConfig(env);
  const flow = cfg[type];
  if (!flow.tableId) {
    return applyRenewedSession(json({ error: `流程未配置：先用 MCP config_flows 配置 ${type} 的 tableId` }, 400), session.renewed);
  }
  if (flow.group && role.group !== flow.group && !/队长/.test(role.role)) {
    return applyRenewedSession(json({ error: "forbidden", role: role.role, hint: `该流程仅限 ${flow.group} 提交` }, 403), session.renewed);
  }
  try {
    return applyRenewedSession(json(await submitApprovalCore(env, { type, fields: body.fields ?? {}, user: session.user, role, source: "portal" })), session.renewed);
  } catch (err) {
    if (err instanceof ApprovalError) return applyRenewedSession(json({ error: err.message }, err.status), session.renewed);
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
  if (!APPROVAL_TYPES.includes(type as ApprovalType)) return applyRenewedSession(json({ error: `未知流程 type：${type}` }, 400), session.renewed);
  if (!APPROVAL_ACTIONS.includes(action as ApprovalAction)) return applyRenewedSession(json({ error: `未知动作：${action}` }, 400), session.renewed);
  const body = (await request.json().catch(() => ({}))) as { comment?: string; link?: string };
  try {
    return applyRenewedSession(json(
      await runApprovalAction(env, {
        type: type as ApprovalType,
        appId,
        action: action as ApprovalAction,
        comment: body.comment,
        link: body.link,
        user: session.user,
        role: await resolveUserRole(env, session.user, ctx),
      }),
    ), session.renewed);
  } catch (err) {
    if (err instanceof ApprovalError) return applyRenewedSession(json({ error: err.message }, err.status), session.renewed);
    throw err;
  }
}

/** 我的申请列表（R-01「我的报销」数据源）：按 open_id 过滤 → 提交时间降序 → 前 20 条 */
export async function handleApprovalMine(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const type = (url.searchParams.get("type") ?? "reimburse") as ApprovalType;
  if (!APPROVAL_TYPES.includes(type)) {
    return applyRenewedSession(json({ error: `type 必须是：${APPROVAL_TYPES.join(" | ")}` }, 400), session.renewed);
  }
  const cfg = await getFlowsConfig(env);
  const flow = cfg[type];
  if (!flow.tableId) return applyRenewedSession(json({ records: [], hint: "流程未配置" }), session.renewed);
  const base = await getFlowBase(env, flow);
  if (!base) return applyRenewedSession(json({ records: [], hint: "流程未配置" }), session.renewed);
  const token = await getTenantAccessToken(env);
  const records = await listBitableRecords(token, base, flow.tableId);
  const mine = records
    .filter((r) => fieldText(r.fields["申请人 open_id"]) === session.user.open_id)
    .sort((a, b) => (fieldNum(b.fields["提交时间"]) ?? 0) - (fieldNum(a.fields["提交时间"]) ?? 0))
    .slice(0, 20);
  return applyRenewedSession(json({
    records: mine.map((r) => {
      const f = r.fields;
      return {
        application_id: fieldText(f["申请单号"]),
        status: fieldText(f["状态"]),
        fields: {
          申请单号: fieldText(f["申请单号"]),
          事项: fieldText(f["事项"]),
          金额: fieldNum(f["金额"]),
          状态: fieldText(f["状态"]),
          提交时间: fieldNum(f["提交时间"]),
          审批人: fieldText(f["审批人"]),
          审批意见: fieldText(f["审批意见"]),
        },
      };
    }),
  }), session.renewed);
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

/** send_notice：向流程群发机器人通知（需 MCP_TOKEN） */
export async function toolSendNotice(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) throw new Error("send_notice 仅管理端可用（需 MCP_TOKEN）");
  const flow = String(args.flow ?? "").trim();
  const title = String(args.title ?? "").trim();
  const content = String(args.content ?? "").trim();
  if (!title) throw new Error("title 不能为空");
  if (!content) throw new Error("content 不能为空");
  const link = String(args.link ?? "").trim();
  const result = await notifyFeishu(env, flow, title, content, link || undefined);
  if (!result.ok) {
    return { content: [{ type: "text", text: `⚠️ 通知未送达：${result.detail}（已按降级处理，业务不受影响）` }] };
  }
  return { content: [{ type: "text", text: `✅ 已发送（flow=${flow || "default"}）` }] };
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
