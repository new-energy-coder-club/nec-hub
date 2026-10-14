/**
 * MCP (JSON-RPC over streamable HTTP) — 端点与 tools/call 分发
 *
 * 鉴权决策点保持在 handleMcp 入口：配置 MCP_TOKEN 时所有方法（含 tools/list）
 * 都需 Authorization: Bearer 通过 timingSafeEqual 比对；未配置时放行（写操作本就对全网开放）。
 */

import { json } from "../shared/http";
import { toolSetHomeLayout } from "../home/handlers";
import { toolConfigValidateRules, toolValidateBitable } from "../validation/handlers";
import { toolConfigFlows, toolListTodos, toolSendNotice, toolSubmitApproval } from "../approvals/handlers";
import { toolUpdatePrd } from "../prd";
import {
  toolAddRecords,
  toolConfigDashboard,
  toolDeployApp,
  toolImportSkills,
  toolPublishDoc,
  toolPublishSkill,
  toolQueryBitable,
  toolRegisterApp,
  toolRemoveDocs,
  toolRemoveSkills,
  toolSetupBitable,
  toolSyncVercel,
  toolUpdateProgress,
} from "./implementations";
import {
  toolConfigContractApproval,
  toolConfigDrawingReview,
  toolConfigHardwareReview,
} from "./module-config-tools";
import { toolScheduleMeeting } from "../meeting";
import { TOOLS } from "./tools";

function rpc(id: string | number | null, result: unknown): Response {
  return json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: string | number | null, code: number, message: string): Response {
  return json({ jsonrpc: "2.0", id, error: { code, message } }, 200);
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  let hasMcpToken = false;
  if (env.MCP_TOKEN) {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    hasMcpToken = await timingSafeEqual(token, env.MCP_TOKEN);
    if (!hasMcpToken) {
      return json({ error: "unauthorized" }, 401);
    }
  } else {
    // 未配置 MCP_TOKEN 时写操作本就对全网开放，财务门禁随之放行（生产环境建议配置 MCP_TOKEN）
    hasMcpToken = true;
  }
  const msg = (await request.json()) as {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
  };
  const id = msg.id ?? null;
  switch (msg.method) {
    case "initialize":
      return rpc(id, {
        protocolVersion: (msg.params?.protocolVersion as string) ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "NEC-MCP", version: "0.4.0" },
        instructions:
          "NEC-MCP — NEC 团队 AI 中台智能协作中枢。应用广场发布：deploy_app 上传静态文件部署（name 用小写字母/数字/连字符且以字母或数字开头，files 须含 index.html，文本用 text、二进制用 base64，同名重复部署即覆盖更新），register_app 登记外部链接应用，sync_vercel 从 Vercel 批量发现登记；Skill 中心：publish_skill 上架、import_skills 批量导入、remove_skills 下架；数据看板：config_dashboard 配置飞书多维表格（含 goals 赛季目标表），query_bitable 查询（finance 表需 user_token 且角色为队长/财务，或管理端 MCP_TOKEN），update_progress 回写赛季目标完成度/状态，validate_bitable 校验 4 张底表脏数据（scope=mine 校验自己 / scope=all 全量仅队长/组长），config_validate_rules 管理校验规则；数据基建：setup_bitable 一键建标准四表，add_records 批量追加记录（均仅管理端）；首页布局：set_home_layout 配置「我的首页」（白名单组件 my-apps/my-tasks/my-reimburse/docs/goals/inventory，scope=user 绑本人、scope=group 组默认需组长/队长，action=get 查看 / set 写入 / reset 恢复默认）；一键拉会：schedule_meeting 创建飞书日历日程+视频会议（attendees 传姓名或 ou_ open_id，本人拉会传 user_token，管理端可 organizer 代拉会）；审批与通知（Plan B）：submit_approval 代发起审批、list_todos 按 open_id 查待办、send_notice 发群通知、config_flows 配置审批流程（状态机落多维表格 + 群机器人 webhook 通知）；PRD 看板：update_prd 更新需求状态（状态变化推飞书群）；资料页：publish_doc 上架、remove_docs 下架。支持自然语言指令，如「把我的应用发布到应用广场」「明晚 7 点拉个评审会叫上张三」。",
      });
    case "ping":
      return rpc(id, {});
    case "notifications/initialized":
      return new Response(null, { status: 202 });
    case "tools/list":
      return rpc(id, { tools: TOOLS });
    case "tools/call":
      return await callTool(id, msg.params ?? {}, env, request, hasMcpToken);
    default:
      return rpcError(id, -32601, `Method not found: ${String(msg.method)}`);
  }
}

async function callTool(
  id: string | number | null,
  params: Record<string, unknown>,
  env: Env,
  request: Request,
  hasMcpToken: boolean,
): Promise<Response> {
  const name = params.name as string;
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "deploy_app":
        return rpc(id, await toolDeployApp(args, env, request));
      case "register_app":
        return rpc(id, await toolRegisterApp(args, env));
      case "sync_vercel":
        return rpc(id, await toolSyncVercel(args, env));
      case "import_skills":
        return rpc(id, await toolImportSkills(args, env));
      case "remove_skills":
        return rpc(id, await toolRemoveSkills(args, env));
      case "publish_skill":
        return rpc(id, await toolPublishSkill(args, env, request));
      case "query_bitable":
        return rpc(id, await toolQueryBitable(args, env, hasMcpToken));
      case "config_dashboard":
        return rpc(id, await toolConfigDashboard(args, env));
      case "config_drawing_review":
        return rpc(id, await toolConfigDrawingReview(args, env));
      case "config_hardware_review":
        return rpc(id, await toolConfigHardwareReview(args, env));
      case "config_contract_approval":
        return rpc(id, await toolConfigContractApproval(args, env));
      case "publish_doc":
        return rpc(id, await toolPublishDoc(args, env));
      case "remove_docs":
        return rpc(id, await toolRemoveDocs(args, env));
      case "setup_bitable":
        return rpc(id, await toolSetupBitable(args, env, hasMcpToken));
      case "add_records":
        return rpc(id, await toolAddRecords(args, env, hasMcpToken));
      case "update_prd":
        return rpc(id, await toolUpdatePrd(args, env, hasMcpToken));
      case "submit_approval":
        return rpc(id, await toolSubmitApproval(args, env, hasMcpToken));
      case "list_todos":
        return rpc(id, await toolListTodos(args, env, hasMcpToken));
      case "send_notice":
        return rpc(id, await toolSendNotice(args, env, hasMcpToken));
      case "config_flows":
        return rpc(id, await toolConfigFlows(args, env, hasMcpToken));
      case "update_progress":
        return rpc(id, await toolUpdateProgress(args, env, hasMcpToken));
      case "validate_bitable":
        return rpc(id, await toolValidateBitable(args, env, hasMcpToken));
      case "config_validate_rules":
        return rpc(id, await toolConfigValidateRules(args, env));
      case "set_home_layout":
        return rpc(id, await toolSetHomeLayout(args, env, hasMcpToken));
      case "schedule_meeting":
        return rpc(id, await toolScheduleMeeting(args, env, hasMcpToken));
      default:
        return rpcError(id, -32602, `Unknown tool: ${name}`);
    }
  } catch (err) {
    return rpc(id, {
      content: [{ type: "text", text: `执行失败：${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    });
  }
}
