/**
 * 审批与通知中心（PRD V1.1 Plan B）— 路由入口
 *
 * /api/approvals 前缀的三类端点分发到 ./handlers；引擎核心在 ./engine，流程配置在 ./flows。
 */

import { handleApprovalAction, handleApprovalMine, handleApprovalPending, handleApprovalSubmit, handleApprovalUpload } from "./handlers";

export async function handleApprovals(
  request: Request,
  env: Env,
  pathname: string,
  ctx?: ExecutionContext,
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
  const actionMatch = pathname.match(/^\/api\/approvals\/([a-z]+)\/([^/]+)\/(approve|reject|pay|start|archive|arrive|issue|publish)$/);
  if (actionMatch && request.method === "POST") {
    return await handleApprovalAction(request, env, actionMatch[1], actionMatch[2], actionMatch[3], ctx);
  }
  return null;
}
