/**
 * 管理端 MCP 工具实现聚合层（fail-closed 闸门统一入口）。
 *
 * 背景：mcp-admin-guard.test.ts 按「鉴权下沉到工具层」的目标签名编写（TDD），
 * 本模块提供该签名的适配实现：先过 requireMcpToken 闸门，再委托 tools/ 下的真实实现。
 * 调用约定：(args, env, hasMcpToken, request?) —— 与测试口径一致。
 */
import { requireMcpToken } from "./guard";
import { toolDeployApp as rawDeployApp, toolRegisterApp as rawRegisterApp, toolSyncVercel as rawSyncVercel } from "./tools/apps";
import { toolConfigDashboard as rawConfigDashboard } from "./tools/bitable-config";
import { toolPublishDoc as rawPublishDoc, toolRemoveDocs as rawRemoveDocs } from "./tools/docs";
import { toolImportSkills as rawImportSkills, toolRemoveSkills as rawRemoveSkills } from "./tools/skills";

type Args = Record<string, unknown>;

export async function toolDeployApp(args: Args, env: Env, hasMcpToken: boolean, request?: Request) {
  requireMcpToken(hasMcpToken, "deploy_app");
  return rawDeployApp(args, env, request ?? new Request("https://hub.local/mcp"));
}

export async function toolRegisterApp(args: Args, env: Env, hasMcpToken: boolean) {
  requireMcpToken(hasMcpToken, "register_app");
  return rawRegisterApp(args, env);
}

export async function toolSyncVercel(args: Args, env: Env, hasMcpToken: boolean) {
  requireMcpToken(hasMcpToken, "sync_vercel");
  return rawSyncVercel(args, env);
}

export async function toolImportSkills(args: Args, env: Env, hasMcpToken: boolean) {
  requireMcpToken(hasMcpToken, "import_skills");
  return rawImportSkills(args, env);
}

export async function toolRemoveSkills(args: Args, env: Env, hasMcpToken: boolean) {
  requireMcpToken(hasMcpToken, "remove_skills");
  return rawRemoveSkills(args, env);
}

export async function toolConfigDashboard(args: Args, env: Env, hasMcpToken: boolean) {
  requireMcpToken(hasMcpToken, "config_dashboard");
  return rawConfigDashboard(args, env);
}

export async function toolPublishDoc(args: Args, env: Env, hasMcpToken: boolean) {
  requireMcpToken(hasMcpToken, "publish_doc");
  return rawPublishDoc(args, env);
}

export async function toolRemoveDocs(args: Args, env: Env, hasMcpToken: boolean) {
  requireMcpToken(hasMcpToken, "remove_docs");
  return rawRemoveDocs(args, env);
}
