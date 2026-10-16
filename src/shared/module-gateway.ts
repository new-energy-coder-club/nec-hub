/**
 * 业务模块路由网关 — drawing-review / hardware-review / contract-approval 共用骨架
 *
 * 统一三个模块入口的公共流程：
 *   /config 接口（GET 查配置免登录 / POST 写配置可配管理员角色门禁）→ 未配置 503 → 会话解析（同 sid 滑动续期）
 *   → 401 未登录 →（可选角色门禁 403）→ 业务分发（500 兜底）
 * 业务分发返回 null 表示路径不匹配，交回入口 if 链继续 fallthrough（此语义不可变）。
 * 各模块的错误文案/状态码按参数逐字保留。
 */

import { ROLES, resolveUserRole } from "../auth/role";
import { json } from "./http";
import { resolveSession, type HubUser } from "./session";

/** 登录后的业务分发上下文 */
export interface ModuleRouteContext<Cfg> {
  request: Request;
  env: Env;
  cfg: Cfg;
  session: HubUser;
  pathname: string;
}

export interface ModuleGatewaySpec<Cfg extends { base: string; tables: object }> {
  /** 配置接口路径，如 /api/drawing-review/config */
  configPath: string;
  /** 模块显示名（503 文案用），如「新增机图纸评审流程」 */
  label: string;
  /** 日志前缀（500 时 console.error 用），如 drawing-review */
  logTag: string;
  /** 读取模块配置 */
  getConfig: (env: Env) => Promise<Cfg | null>;
  /** POST 配置接口处理（模块各自保留） */
  handleConfig: (request: Request, env: Env) => Promise<Response>;
  /** 登录后的业务分发；返回 null 表示路径不匹配 */
  handler: (ctx: ModuleRouteContext<Cfg>) => Promise<Response | null>;
  /** 可选角色门禁：role.role 不匹配时按项目既有 403 形状拒绝；缺省不加门禁 */
  roles?: RegExp;
  /** POST 写配置的管理员角色门禁：缺省保持免登录（向后兼容） */
  configRoles?: RegExp;
}

/** 写配置管理员口径：常量在 auth/role.ts 集中管理（与 src/domains/index.ts 同口径），此处 re-export 兼容既有引用 */
export const CONFIG_ADMIN_ROLES = ROLES.CONFIG_ADMIN;

export async function withModuleGate<Cfg extends { base: string; tables: object }>(
  spec: ModuleGatewaySpec<Cfg>,
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  const cfg = await spec.getConfig(env);

  // 配置接口：GET 免登录；POST 写操作按 configRoles 加管理员门禁
  if (pathname === spec.configPath) {
    if (request.method === "GET") return json({ configured: !!cfg, base: cfg?.base ?? null, tables: cfg?.tables ?? {} });
    if (request.method === "POST") {
      if (spec.configRoles) {
        const s = await resolveSession(env, request);
        if (!s) return json({ error: "请先登录" }, 401);
        const role = await resolveUserRole(env, s.user);
        if (!spec.configRoles.test(role.role)) {
          return json({ error: `权限不足：${spec.label}配置仅限授权角色操作（当前角色：${role.role}）` }, 403);
        }
        return spec.handleConfig(request, env);
      }
      return spec.handleConfig(request, env);
    }
    return json({ error: "method not allowed" }, 405);
  }

  // 未配置时返回友好提示
  if (!cfg) {
    return json(
      {
        error: `${spec.label}尚未配置`,
        hint: `请先调用 POST ${spec.configPath} 设置 base 与 tables`,
      },
      503,
    );
  }

  // 后续接口要求登录态
  const s = await resolveSession(env, request);
  if (!s) return json({ error: "请先登录" }, 401);

  // 可选角色门禁（默认不加）：形状与项目既有 403 一致
  if (spec.roles) {
    const role = await resolveUserRole(env, s.user);
    if (!spec.roles.test(role.role)) {
      return json({ error: `权限不足：${spec.label}仅限授权角色操作（当前角色：${role.role}）` }, 403);
    }
  }

  let res: Response | null;
  try {
    res = await spec.handler({ request, env, cfg, session: s.user, pathname });
  } catch (err) {
    console.error(`[${spec.logTag}] ${pathname} error:`, err);
    res = json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
  return res;
}
