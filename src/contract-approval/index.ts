/**
 * 合同审批流程 — 路由注册
 */

import { ContractApprovalAdapter } from "./adapter";
import { getContractApprovalConfig, setContractApprovalConfig } from "./config";
import {
  ContractApprovalFlowService,
  type ApprovalActionInput,
  type ResubmitInput,
  type SubmitApprovalInput,
} from "./flow.service";
import { resolveSession } from "../session";
import type { Attachment, ContractApprovalConfig, ContractType } from "./types";

interface SubmitBody {
  contractName?: string;
  contractNumber?: string;
  contractType?: ContractType;
  parties?: string[];
  effectiveDate?: string;
  expirationDate?: string;
  contractFiles?: Attachment[];
  summary?: string;
  approvers?: SubmitApprovalInput["approvers"];
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function handleContractApproval(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  const cfg = await getContractApprovalConfig(env);

  // 配置接口无需登录
  if (pathname === "/api/contract-approval/config") {
    if (request.method === "GET") {
      return json({ configured: !!cfg, base: cfg?.base ?? null, tables: cfg?.tables ?? {} });
    }
    if (request.method === "POST") return handleConfig(request, env);
    return json({ error: "method not allowed" }, 405);
  }

  // 未配置时返回友好提示
  if (!cfg) {
    return json(
      {
        error: "合同审批流程尚未配置",
        hint: "请先调用 POST /api/contract-approval/config 设置 base 与 tables",
      },
      503,
    );
  }

  // 后续接口要求登录态
  const session = await resolveSession(request, env);
  if (!session) return json({ error: "请先登录" }, 401);

  const store = new ContractApprovalAdapter(env, cfg);
  const flow = new ContractApprovalFlowService(store);

  try {
    // 提交审批单
    if (pathname === "/api/contract-approval/submit" && request.method === "POST") {
      const body = (await request.json()) as SubmitBody;
      const input: SubmitApprovalInput = {
        contractName: body.contractName ?? "",
        contractNumber: body.contractNumber,
        contractType: body.contractType,
        parties: body.parties,
        effectiveDate: body.effectiveDate,
        expirationDate: body.expirationDate,
        contractFiles: body.contractFiles ?? [],
        summary: body.summary,
        approvers: body.approvers ?? [],
      };
      return json(await flow.submit(input, session.open_id));
    }

    // 审批单列表
    if (pathname === "/api/contract-approval" && request.method === "GET") {
      return json(await flow.listApprovals());
    }

    // 填写指引（提交所需字段说明）
    if (pathname === "/api/contract-approval/start" && request.method === "GET") {
      return json({
        ok: true,
        required: ["contractName", "contractFiles", "approvers"],
        contractTypes: ["purchase", "sales", "service", "partnership", "nda"],
        approvalLevels: ["team_lead", "department_head", "finance", "legal"],
        rules: ["至少指定一名审批人", "提交人不能兼任审批人", "全部审批人通过后单据生效"],
      });
    }

    const detailMatch = pathname.match(/^\/api\/contract-approval\/([^/]+)$/);
    if (detailMatch && request.method === "GET") {
      const approval = await flow.getApproval(detailMatch[1]);
      if (!approval) return json({ error: "审批单不存在" }, 404);
      return json(approval);
    }

    // 开始审批（提交人或审批人）
    const startMatch = pathname.match(/^\/api\/contract-approval\/([^/]+)\/start-review$/);
    if (startMatch && request.method === "POST") {
      return json(await flow.startReview(startMatch[1], session.open_id));
    }

    // 审批操作（approve / reject / revise）
    const actionMatch = pathname.match(/^\/api\/contract-approval\/([^/]+)\/action$/);
    if (actionMatch && request.method === "POST") {
      const body = (await request.json()) as ApprovalActionInput;
      return json(await flow.takeAction(actionMatch[1], body, session.open_id));
    }

    // 重新提交（仅提交人，从 revised 状态）
    const resubmitMatch = pathname.match(/^\/api\/contract-approval\/([^/]+)\/resubmit$/);
    if (resubmitMatch && request.method === "POST") {
      const body = (await request.json()) as ResubmitInput;
      return json(await flow.resubmit(resubmitMatch[1], body, session.open_id));
    }

    // 归档（approved / rejected 状态，提交人或审批人）
    const archiveMatch = pathname.match(/^\/api\/contract-approval\/([^/]+)\/archive$/);
    if (archiveMatch && request.method === "POST") {
      return json(await flow.archive(archiveMatch[1], session.open_id));
    }

    // 审批评论列表
    const commentsMatch = pathname.match(/^\/api\/contract-approval\/([^/]+)\/comments$/);
    if (commentsMatch && request.method === "GET") {
      return json(await flow.listComments(commentsMatch[1]));
    }

    return null;
  } catch (err) {
    console.error(`[contract-approval] ${pathname} error:`, err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

async function handleConfig(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { action?: string; base?: string; tables?: Record<string, string> };
  if (body.action === "get" || !body.action) {
    const cfg = await getContractApprovalConfig(env);
    return json({ configured: !!cfg, base: cfg?.base ?? null, tables: cfg?.tables ?? {} });
  }
  if (body.action !== "set") return json({ error: "action 必须是 get | set" }, 400);
  if (!body.base || !body.tables) return json({ error: "缺少 base 或 tables" }, 400);

  const cfg = await setContractApprovalConfig(env, {
    base: body.base,
    tables: body.tables as ContractApprovalConfig["tables"],
  });
  return json({ ok: true, config: cfg });
}
