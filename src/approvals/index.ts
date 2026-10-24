/**
 * 审批与通知中心（PRD V1.1 Plan B）— 路由入口
 *
 * /api/approvals 前缀的三类端点分发到 ./handlers；引擎核心在 ./engine，流程配置在 ./flows。
 */

import { handleApprovalAction, handleApprovalMine, handleApprovalPending, handleApprovalSubmit, handleApprovalUpload, type ApprovalStatusHook } from "./handlers";

export async function handleApprovals(
  request: Request,
  env: Env,
  pathname: string,
  ctx?: ExecutionContext,
  hooks: { onStatusChange?: ApprovalStatusHook } = {},
): Promise<Response | null> {
  if (pathname === "/api/approvals" && request.method === "POST") {
    return await handleApprovalSubmit(request, env, ctx);
  }
  if (pathname === "/api/approvals/mine" && request.method === "GET") {
    return await handleApprovalMine(request, env, ctx);
  }
  if (pathname === "/api/approvals/pending" && request.method === "GET") {
    return await handleApprovalPending(request, env, ctx);
  }
  if (pathname === "/api/approvals/upload" && request.method === "POST") {
    return await handleApprovalUpload(request, env, ctx);
  }
  // 动作名白名单在 handleApprovalAction 内按流程校验（全局机动作 ∪ flow.machine 动作），路由层放行所有合法标识符
  const actionMatch = pathname.match(/^\/api\/approvals\/([a-z_]+)\/([^/]+)\/([a-z][a-z0-9_]*)$/);
  if (actionMatch && request.method === "POST") {
    return await handleApprovalAction(request, env, actionMatch[1], actionMatch[2], actionMatch[3], ctx, hooks.onStatusChange);
  }
  return null;
}
