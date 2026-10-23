/**
 * 域名分发 MCP 工具：apply_domain / release_domain（均仅管理端，申请/释放推飞书群公示）
 */

import { applyDomain, releaseDomain } from "../../domains/service";
import type { CreateDomainBody } from "../../domains/types";
import { notifyFeishu } from "../../feishu/bot";
import type { McpToolDef } from "./shared";

/** 域名分发系统：代申请三级域名（仅管理端；申请成功推飞书群公示） */
export async function toolApplyDomain(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) throw new Error("apply_domain 仅管理端可用（需 MCP_TOKEN）");
  const name = String(args.applicant_name ?? "mcp-admin");
  const { entry, hint } = await applyDomain(env, args as CreateDomainBody, { name, open_id: `mcp:${name}` }, { isAdmin: true });
  const statusText = entry.status === "active" ? "DNS 已生效" : entry.status === "pending" ? "待同步 DNS" : "DNS 同步失败";
  const notifyResult = await notifyFeishu(
    env,
    "domains",
    "🌐 域名申请",
    `${name} 申请了 ${entry.fqdn} → ${entry.type} ${entry.target}（${statusText}）`,
    `https://${entry.fqdn}`,
  );
  return {
    content: [
      {
        type: "text",
        text: `${entry.status === "failed" ? "⚠️" : "✅"} 域名申请：${entry.fqdn} → ${entry.type} ${entry.target}\n状态：${entry.status}（${hint}）\n群公示：${notifyResult.detail}`,
      },
    ],
  };
}

/** 域名分发系统：释放三级域名（仅管理端；先删 CF 记录再删登记，推飞书群公示） */
export async function toolReleaseDomain(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  if (!hasMcpToken) throw new Error("release_domain 仅管理端可用（需 MCP_TOKEN）");
  const name = String(args.applicant_name ?? "mcp-admin");
  const entry = await releaseDomain(env, args.subdomain, { name, open_id: `mcp:${name}` }, { isAdmin: true });
  const notifyResult = await notifyFeishu(env, "domains", "🌐 域名释放", `${name} 释放了 ${entry.fqdn}（原指向 ${entry.type} ${entry.target}）`);
  return {
    content: [{ type: "text", text: `✅ 已释放域名：${entry.fqdn}\n群公示：${notifyResult.detail}` }],
  };
}

export const applyDomainTool: McpToolDef = {
  name: "apply_domain",
  description:
    "代申请 NEC 团队三级域名 <subdomain>.newenergycoder.club（域名分发系统，仅管理端 MCP_TOKEN）。校验规则同门户：标签小写字母/数字/连字符、2-63 字符、保留名不开放；type 支持 CNAME/A/AAAA，CNAME 目标须为主机名且不能指向根域自身；四级及更深子域名（如 app.dev）强制仅 DNS。已配置 CF 凭证时自动创建 DNS 记录并推飞书群公示。注意：R2 托管应用（deploy_app）自带 <name>.<zone> 直达域名，无需申请；本工具用于指向 Vercel/服务器等外部目标。",
  inputSchema: {
    type: "object",
    properties: {
      subdomain: { type: "string", description: "子域名前缀，如 demo 或 app.dev（多级）" },
      type: { type: "string", description: "CNAME（默认）| A | AAAA" },
      target: { type: "string", description: "解析目标：CNAME 为主机名（如 my-app.pages.dev），A/AAAA 为 IP" },
      description: { type: "string", description: "用途说明（≤120 字）" },
      proxied: { type: "boolean", description: "是否走 Cloudflare 代理（橙云），默认 false；四级及更深域名强制 false" },
      applicant_name: { type: "string", description: "申请人姓名（缺省 mcp-admin）" },
    },
    required: ["subdomain", "target"],
  },
  impl: (args, env, ctx) => toolApplyDomain(args, env, ctx.hasMcpToken),
};

export const releaseDomainTool: McpToolDef = {
  name: "release_domain",
  description:
    "释放 NEC 团队三级域名（域名分发系统，仅管理端 MCP_TOKEN）：先删 Cloudflare DNS 记录再删登记，并推飞书群公示。",
  inputSchema: {
    type: "object",
    properties: {
      subdomain: { type: "string", description: "要释放的子域名前缀" },
      applicant_name: { type: "string", description: "操作人姓名（缺省 mcp-admin）" },
    },
    required: ["subdomain"],
  },
  impl: (args, env, ctx) => toolReleaseDomain(args, env, ctx.hasMcpToken),
};

export const tools: McpToolDef[] = [applyDomainTool, releaseDomainTool];
