/**
 * 合同审批流程 — 路由注册
 *
 * 入口骨架（配置接口 / 503 / 会话 / 401 / 500 兜底）统一由 shared/module-gateway 提供。
 */

import { ContractApprovalAdapter } from "./adapter";
import { getContractApprovalConfig, setContractApprovalConfig } from "./config";
import {
  ContractApprovalFlowService,
  peekNextContractNumber,
  type ApprovalActionInput,
  type ResubmitInput,
  type SubmitApprovalInput,
} from "./flow.service";
import { loadMemberDirectory } from "../feishu/member-directory";
import { json } from "../shared/http";
import { withModuleGate, type ModuleRouteContext } from "../shared/module-gateway";
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
  amount?: number;
  currency?: string;
  approvers?: SubmitApprovalInput["approvers"];
}

export async function handleContractApproval(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  return withModuleGate(
    {
      configPath: "/api/contract-approval/config",
      label: "合同审批流程",
      logTag: "contract-approval",
      getConfig: getContractApprovalConfig,
      handleConfig,
      handler: handleAuthed,
    },
    request,
    env,
    pathname,
  );
}

async function handleAuthed(ctx: ModuleRouteContext<ContractApprovalConfig>): Promise<Response | null> {
  const { request, env, cfg, session, pathname } = ctx;
  const store = new ContractApprovalAdapter(env, cfg);
  const flow = new ContractApprovalFlowService(store, env.REGISTRY);

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
      amount: body.amount,
      currency: body.currency,
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
      required: ["contractName", "contractFiles", "approvers", "amount"],
      contractTypes: ["purchase", "sales", "service", "partnership", "nda"],
      approvalLevels: ["team_lead", "department_head", "finance", "legal"],
      rules: [
        "至少指定一名审批人",
        "提交人不能兼任审批人",
        "全部审批人通过后单据生效",
        "金额必须大于 0 且不超过 9,999,999.99",
        "币种仅支持 CNY/USD/EUR/JPY/GBP/HKD（默认 CNY）",
        "到期日期必须晚于生效日期",
        "合同编号留空将自动生成 HT-YYYY-序号（可先预览）",
      ],
    });
  }

  // 下一个合同编号预览（只读，不占用计数）
  if (pathname === "/api/contract-approval/next-number" && request.method === "GET") {
    return json({ number: await peekNextContractNumber(env.REGISTRY, new Date().getFullYear()) });
  }

  // 审批人搜索（姓名或 ou_ 子串；名单未配置时返回空数组 + hint）
  if (pathname === "/api/contract-approval/members" && request.method === "GET") {
    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    const directory = await loadMemberDirectory(env).catch(() => null);
    if (!directory || directory.size === 0) {
      return json({ members: [], hint: "队员名单未配置" });
    }
    const lowerQ = q.toLowerCase();
    const members: Array<{ name: string; open_id: string }> = [];
    for (const [name, openId] of directory) {
      if (!q || name.toLowerCase().includes(lowerQ) || openId.includes(q)) {
        members.push({ name, open_id: openId });
      }
    }
    return json({ members });
  }

  // 合同文件预览（R2 流式返回；key 为上传接口返回的 R2 key）
  if (pathname === "/api/contract-approval/file" && request.method === "GET") {
    const url = new URL(request.url);
    const key = url.searchParams.get("key") ?? "";
    const name = url.searchParams.get("name") ?? "";
    if (!key) return json({ error: "缺少 key 参数" }, 400);
    const object = await env.APPS_BUCKET.get(key);
    if (!object) return json({ error: "文件不存在" }, 404);
    const contentType = object.httpMetadata?.contentType || "application/octet-stream";
    const fallbackName = decodeURIComponent(key.split("/").pop() ?? "file");
    const filename = name || fallbackName;
    return new Response(object.body, {
      headers: {
        "content-type": contentType,
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
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
