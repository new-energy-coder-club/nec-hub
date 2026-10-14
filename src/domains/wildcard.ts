/**
 * 泛域名应用直达 — <app>.<zone> 直接服务 R2 里 apps/<app>/ 的静态应用
 *
 * 前提（一次性配置）：
 *   1. wrangler.jsonc routes 加 { pattern: "*.<zone>/*", zone_name: "<zone>" }
 *   2. Cloudflare DNS 加一条 * 的代理记录（AAAA → 100::，橙云），Universal SSL 正好覆盖三级泛域名
 * 效果：deploy_app 上架后立刻拥有 https://<name>.<zone> 独立域名，零 DNS 配置。
 *
 * 优先级（Host 命中 *.<zone> 时）：
 *   1. hub / 保留子域名 → 返回 null，走平台常规路由（hub 是本 Worker 的 custom_domain）
 *   2. 域名分发系统里登记过外部目标（CNAME 到 Vercel/Pages 等）或其余保留名 → fetch(request)
 *      透传回源（Worker 子请求不会再命中本路由，由 DNS 记录决定真实去向）
 *   3. R2 存在 apps/<sub>/ → 复用 serveApp 托管（含边缘缓存）
 *   4. 都没有 → 404 引导页
 */

import { serveApp } from "../hosting";
import { json } from "../shared/http";
import { domainZone, findDomain, RESERVED_SUBDOMAINS } from "./service";

export async function handleAppSubdomain(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url);
  const zone = domainZone(env);
  const host = url.hostname.toLowerCase();
  if (host === zone || !host.endsWith(`.${zone}`)) return null;
  const sub = host.slice(0, -(zone.length + 1));
  // 泛 DNS 可匹配多级标签（a.b.<zone>），但 Universal SSL 只覆盖单级，多级不在此服务
  if (!sub || sub.includes(".")) return null;
  if (sub === "hub") return null;

  // 域名分发系统登记过外部目标 → 透传回源，不劫持成员已指向别处的域名
  if (await findDomain(env, sub)) return fetch(request);
  // 其余保留名（docs/mail 等）：可能有独立 DNS 记录指向平台基础设施，透传回源
  if (RESERVED_SUBDOMAINS.has(sub)) return fetch(request);

  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "method not allowed" }, 405);
  }

  // 映射到 /apps/<sub>/* 复用 serveApp（R2 回源 + 仓库 public/apps 回退 + 边缘缓存；缓存 key 含 Host 不串站）
  const appUrl = new URL(request.url);
  appUrl.pathname = `/apps/${sub}${url.pathname}`;
  const res = await serveApp(appUrl, env, ctx);
  if (res.status !== 404) return res;

  return json(
    {
      error: `「${sub}.${zone}」还没有对应的应用`,
      hint: `这是 NEC 团队应用直达域名。用 MCP 工具 deploy_app 发布名为 ${sub} 的应用后，本地址即刻可访问；或在门户「域名分发」把它指向外部平台。`,
    },
    404,
  );
}
