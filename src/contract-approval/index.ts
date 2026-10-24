/**
 * 合同审批流程 — 路由注册
 *
 * 迁移说明（审批引擎 Phase 2，选项 A 兼容迁移）：审批单本体/状态机/会签/单号/通知由
 * src/approvals 引擎承担（submitApprovalCore / runApprovalAction，单号 HT-2026-001，
 * countersign.approversField=「审批人」全员通过才流转）；本文件只做薄壳转调 +
 * 提交前业务校验（金额/币种/日期/审批人名单/手动编号查重）+ 副作用（评论子表、
 * 会签名单重置、事件日志）。URL 与请求/响应形状保持不变，前端零改动。
 * 入口骨架（配置接口 / 503 / 会话 / 401 / 500 兜底）统一由 shared/module-gateway 提供。
 */

import { submitApprovalCore, runApprovalAction } from "../approvals/engine";
import { ensureFlowTableLink } from "../approvals/flows";
import { peekNextSerial } from "../approvals/core/serial";
import { resolveUserRole } from "../auth/role";
import { ContractApprovalAdapter } from "./adapter";
import { getContractApprovalConfig, setContractApprovalConfig } from "./config";
import {
  buildContractApprovers,
  logApprovalEvent,
  nextStatus,
  validateContractAmount,
  validateCurrency,
  type ApprovalActionInput,
  type ResubmitInput,
  type SubmitApprovalInput,
} from "./flow.service";
import { loadMemberDirectory } from "../feishu/member-directory";
import { json, readJson } from "../shared/http";
import { withModuleGate, CONFIG_ADMIN_ROLES, type ModuleRouteContext } from "../shared/module-gateway";
import type { HubUser } from "../shared/session";
import type { Attachment, ContractApprovalConfig, ContractType } from "./types";

/** 引擎流程类型（合同审批单动作全部走引擎 contract 流程） */
const FLOW_TYPE = "contract" as const;

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
      configRoles: CONFIG_ADMIN_ROLES,
    },
    request,
    env,
    pathname,
  );
}

async function handleAuthed(ctx: ModuleRouteContext<ContractApprovalConfig>): Promise<Response | null> {
  const { request, env, cfg, session, pathname } = ctx;
  const store = new ContractApprovalAdapter(env, cfg);

  // 提交审批单（薄壳：提交前校验 + 手动编号查重 → 引擎写单与通知；事件日志留本层）
  if (pathname === "/api/contract-approval/submit" && request.method === "POST") {
    const body = await readJson<SubmitBody>(request);
    if (!body) return json({ error: "请求体必须是 JSON" }, 400);
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
    return json(await submitViaEngine(env, cfg, store, input, session));
  }

  // 审批单列表
  if (pathname === "/api/contract-approval" && request.method === "GET") {
    return json(await store.listApprovals());
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

  // 下一个合同编号预览（只读，不占用计数；引擎 HT 年计数器）
  if (pathname === "/api/contract-approval/next-number" && request.method === "GET") {
    return json({ number: await peekNextSerial(env.REGISTRY, "HT", new Date().getFullYear(), 3) });
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
    const approval = await store.findApprovalById(detailMatch[1]);
    if (!approval) return json({ error: "审批单不存在" }, 404);
    return json(approval);
  }

  // 开始审批（薄壳：提交人或审批人；start_review 流转走引擎）
  const startMatch = pathname.match(/^\/api\/contract-approval\/([^/]+)\/start-review$/);
  if (startMatch && request.method === "POST") {
    const id = startMatch[1];
    const current = await requireApproval(store, id);
    if (!nextStatus(current.status, "start_review")) {
      throw new Error(`当前状态 ${current.status} 不允许开始审批`);
    }
    await runContractAction(env, cfg, id, "start_review", session);
    await logApprovalEvent(store, id, session.open_id, "start_review", current.status, "in_review");
    return json(await store.findApprovalById(id));
  }

  // 审批操作（薄壳：approve / reject / revise 走引擎会签；评论副作用前置——写失败则中止，不动作）
  const actionMatch = pathname.match(/^\/api\/contract-approval\/([^/]+)\/action$/);
  if (actionMatch && request.method === "POST") {
    const body = await readJson<ApprovalActionInput>(request);
    if (!body) return json({ error: "请求体必须是 JSON" }, 400);
    const id = actionMatch[1];
    const current = await requireApproval(store, id);
    if (current.status !== "in_review") throw new Error(`当前状态 ${current.status} 不允许审批操作`);
    if (body.comment) {
      await store.createComment({
        commentId: `COM-${id}-${Date.now()}`,
        approvalId: id,
        reviewerId: session.open_id,
        content: body.comment,
        timestamp: new Date().toISOString(),
        attachments: body.attachments,
      });
    }
    await runContractAction(env, cfg, id, body.action, session, body.comment);
    // revise：引擎只负责流转；会签名单里把本人标记为 rejected（旧 takeAction 语义）
    if (body.action === "revise") {
      const approvers = current.approvers.map((a) =>
        a.approverId === session.open_id
          ? { ...a, status: "rejected" as const, comment: body.comment, actedAt: new Date().toISOString() }
          : a,
      );
      await store.updateApproval(current.recordId, { approvers });
    }
    const after = await store.findApprovalById(id);
    await logApprovalEvent(store, id, session.open_id, body.action, current.status, after?.status, { comment: body.comment });
    return json(after);
  }

  // 重新提交（薄壳：仅提交人；resubmit 流转走引擎，审批人名单重置/替换与附件摘要更新留本层）
  const resubmitMatch = pathname.match(/^\/api\/contract-approval\/([^/]+)\/resubmit$/);
  if (resubmitMatch && request.method === "POST") {
    const body = await readJson<ResubmitInput>(request);
    if (!body) return json({ error: "请求体必须是 JSON" }, 400);
    const id = resubmitMatch[1];
    const current = await requireApproval(store, id);
    if (session.open_id !== current.submittedBy) throw new Error("只有提交人可以重新提交");
    if (!nextStatus(current.status, "resubmit")) {
      throw new Error(`当前状态 ${current.status} 不允许重新提交`);
    }
    // 重新提交后所有审批人重置为待审批；若换审批人则整表替换
    const approvers = body.approvers
      ? buildContractApprovers(body.approvers, session.open_id)
      : current.approvers.map((a) => ({ ...a, status: "pending" as const, comment: undefined, actedAt: undefined }));
    await runContractAction(env, cfg, id, "resubmit", session);
    await store.updateApproval(current.recordId, {
      approvers,
      contractFiles: body.contractFiles ?? current.contractFiles,
      summary: body.summary ?? current.summary,
      updatedAt: new Date().toISOString(),
    });
    await logApprovalEvent(store, id, session.open_id, "resubmit", current.status, "pending_approval");
    return json(await store.findApprovalById(id));
  }

  // 归档（薄壳：approved / rejected 状态，提交人或审批人；archive 流转走引擎）
  const archiveMatch = pathname.match(/^\/api\/contract-approval\/([^/]+)\/archive$/);
  if (archiveMatch && request.method === "POST") {
    const id = archiveMatch[1];
    const current = await requireApproval(store, id);
    if (!nextStatus(current.status, "archive")) {
      throw new Error(`当前状态 ${current.status} 不允许归档`);
    }
    await runContractAction(env, cfg, id, "archive", session);
    await logApprovalEvent(store, id, session.open_id, "archive", current.status, "archived");
    return json(await store.findApprovalById(id));
  }

  // 审批评论列表
  const commentsMatch = pathname.match(/^\/api\/contract-approval\/([^/]+)\/comments$/);
  if (commentsMatch && request.method === "GET") {
    const approval = await store.findApprovalById(commentsMatch[1]);
    if (!approval) throw new Error(`审批单 ${commentsMatch[1]} 不存在`);
    return json(await store.getCommentsByApproval(commentsMatch[1]));
  }

  return null;
}

/** 审批单存在性校验（保留旧文案） */
async function requireApproval(store: ContractApprovalAdapter, approvalId: string) {
  const approval = await store.findApprovalById(approvalId);
  if (!approval) throw new Error(`审批单 ${approvalId} 不存在`);
  return approval;
}

/** 薄壳引擎动作：flows:config 底表链接回填 → 引擎 runApprovalAction（状态机/会签/通知） */
async function runContractAction(
  env: Env,
  cfg: ContractApprovalConfig,
  approvalId: string,
  action: string,
  session: HubUser,
  comment?: string,
): Promise<void> {
  await ensureFlowTableLink(env, FLOW_TYPE, cfg.tables.approvals, cfg.base);
  await runApprovalAction(env, {
    type: FLOW_TYPE,
    appId: approvalId,
    action,
    comment,
    user: session,
    role: await resolveUserRole(env, session),
  });
}

/** 提交薄壳：提交前业务校验（沿用旧 flow.service 文案）→ 手动编号查重 → 引擎写单与通知 → 事件日志 */
async function submitViaEngine(
  env: Env,
  cfg: ContractApprovalConfig,
  store: ContractApprovalAdapter,
  input: SubmitApprovalInput,
  session: HubUser,
) {
  if (!input.contractName?.trim()) throw new Error("合同名称为必填项");
  if (!input.contractFiles || input.contractFiles.length === 0) throw new Error("合同文件为必填项");
  const amount = validateContractAmount(input.amount);
  const currency = validateCurrency(input.currency);
  if (input.effectiveDate && input.expirationDate && input.expirationDate <= input.effectiveDate) {
    throw new Error("到期日期必须晚于生效日期");
  }
  const approvers = buildContractApprovers(input.approvers, session.open_id);

  // 手动编号查重；留空则与审批单号共用引擎 HT 计数器（"@appId" 占位由引擎替换为分配单号）
  const manualNumber = input.contractNumber?.trim() ?? "";
  if (manualNumber) {
    const duplicated = (await store.listApprovals()).some(
      (a) => a.contractNumber && a.contractNumber === manualNumber,
    );
    if (duplicated) throw new Error(`合同编号已存在（${manualNumber}）`);
  }

  await ensureFlowTableLink(env, FLOW_TYPE, cfg.tables.approvals, cfg.base);
  const now = new Date().toISOString();
  const { application_id, status } = await submitApprovalCore(env, {
    type: FLOW_TYPE,
    fields: {
      审批单号: "@appId",
      合同编号: manualNumber || "@appId",
      合同名称: input.contractName.trim(),
      合同类型: input.contractType ?? "service",
      币种: currency,
      生效日期: input.effectiveDate,
      到期日期: input.expirationDate,
      合同摘要: input.summary ?? "",
      合同金额: amount,
      签约方: (input.parties ?? []).join("、"),
      合同文件: JSON.stringify(input.contractFiles),
      审批人: JSON.stringify(approvers),
      // 引擎另写「申请人/申请人 open_id/提交时间」中文字段；「提交人/创建时间」为模块原有字段，薄壳补写保持旧读取路径
      提交人: session.open_id,
      创建时间: now,
      更新时间: now,
    },
    user: session,
    role: await resolveUserRole(env, session),
    source: "portal",
  });
  await logApprovalEvent(store, application_id, session.open_id, "submit", "draft", status);
  return store.findApprovalById(application_id);
}

async function handleConfig(request: Request, env: Env): Promise<Response> {
  const body = (await readJson<{ action?: string; base?: string; tables?: Record<string, string> }>(request)) ?? {};
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
