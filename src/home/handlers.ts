/**
 * FE-06/07 首页布局 — Worker 侧胶水层
 *
 * HTTP 端点：GET /api/home（生效布局）、GET /api/home/defaults（全员默认）、POST /api/home（写个人布局）、POST /api/home/reset（恢复默认）。
 * MCP 工具：set_home_layout（自然语言「改我的首页」的写入入口，user_token 鉴权绑定调用者；
 * scope=group 配置组别默认首页，需组长/队长角色）。
 */

import { validateUserToken } from "../auth/feishu-auth";
import { ROLES, resolveUserRole } from "../auth/role";
import { json } from "../shared/http";
import { resolveSession } from "../shared/session";
import { DEFAULT_HOME_LAYOUT, HOME_WIDGET_META, parseHomeLayout, type HomeLayout } from "./layout";
import { deleteHomeLayout, getResolvedHome, saveHomeLayout } from "./service";

/** 生效布局的 API 响应形状（门户渲染引擎消费）；defaults 为后端默认布局，门户无需维护第二份清单 */
async function homePayload(env: Env, openId: string, group: string) {
  const resolved = await getResolvedHome(env, openId, group);
  return {
    layout: resolved.layout,
    source: resolved.source,
    group: resolved.group,
    defaults: DEFAULT_HOME_LAYOUT,
    widgets: HOME_WIDGET_META,
  };
}

/** GET /api/home/defaults：公开的全员默认布局与组件元数据，不含任何用户配置 */
export function handleGetHomeDefaults(): Response {
  return json({ defaults: DEFAULT_HOME_LAYOUT, widgets: HOME_WIDGET_META });
}

/** GET /api/home：当前用户的生效布局（三层回退后的结果）。未登录 401 */
export async function handleGetHome(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "请先登录" }, 401);
  const role = await resolveUserRole(env, session.user, ctx);
  return json(await homePayload(env, session.user.open_id, role.group));
}

/** POST /api/home：写个人布局（body 为 { widgets: [...] } 或直接数组）。未登录 401；组件全非法 400 */
export async function handleSetHome(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "请先登录" }, 401);
  const body = await request.json().catch(() => null);
  const layout = parseHomeLayout(body);
  if (!layout) {
    return json(
      { error: `布局无效：widgets 至少要有一个白名单组件（${Object.keys(HOME_WIDGET_META).join(" / ")}）` },
      400,
    );
  }
  await saveHomeLayout(env, "user", session.user.open_id, layout);
  const role = await resolveUserRole(env, session.user, ctx);
  return json(await homePayload(env, session.user.open_id, role.group));
}

/** POST /api/home/reset：恢复默认（删个人配置，回落到组配置/全员默认）。未登录 401 */
export async function handleResetHome(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const session = await resolveSession(env, request, ctx);
  if (!session) return json({ error: "请先登录" }, 401);
  await deleteHomeLayout(env, "user", session.user.open_id);
  const role = await resolveUserRole(env, session.user, ctx);
  return json(await homePayload(env, session.user.open_id, role.group));
}

// ---------- MCP 工具：set_home_layout ----------

/** 组默认首页写权限（与 FE-05 全量校验同一判定口径） */
const LEADER_ROLE_RE = ROLES.LEADER;

function layoutSummary(prefix: string, layout: HomeLayout): string {
  const items = layout.widgets
    .map((w) => `${w.title || HOME_WIDGET_META[w.id].title}（${w.id}）`)
    .join(" → ");
  return `${prefix}\n组件顺序：${items}`;
}

export async function toolSetHomeLayout(args: Record<string, unknown>, env: Env, hasMcpToken: boolean) {
  const action = String(args.action ?? "set");
  if (!["set", "get", "reset"].includes(action)) throw new Error("action 必须是 set | get | reset");
  const scope = String(args.scope ?? "user");
  if (scope !== "user" && scope !== "group") throw new Error("scope 必须是 user | group");

  // 身份解析：优先 user_token（绑定调用者本人）；管理端 MCP_TOKEN 可用 open_id 直接指定用户
  let openId = "";
  let name = "";
  const userToken = String(args.user_token ?? "").trim();
  if (userToken) {
    const u = await validateUserToken(userToken);
    openId = u.openId;
    name = u.name;
  } else if (hasMcpToken) {
    openId = String(args.open_id ?? "").trim();
    if (!openId) throw new Error("管理端调用需提供 open_id（指定目标用户），或改用 user_token 绑定调用者本人");
  } else {
    throw new Error("请提供 user_token（飞书 user_access_token）以绑定本人账号，或由配置了 MCP_TOKEN 的管理端调用");
  }

  const role = await resolveUserRole(env, { name, open_id: openId });
  let group = role.group;
  if (scope === "group") {
    if (!LEADER_ROLE_RE.test(role.role)) {
      throw new Error(`权限不足：组别默认首页仅组长/队长可配置（当前角色：${role.role}）`);
    }
    const want = String(args.group ?? "").trim();
    if (want) group = want;
    if (!group) throw new Error("未识别到所属组别（队员名单组别字段为空），请显式传 group 参数");
    // 组长只能配置本组；队长可跨组
    if (!ROLES.CAPTAIN.test(role.role) && role.group && group !== role.group) {
      throw new Error(`权限不足：组长只能配置本组（${role.group}）的默认首页，收到的是「${group}」`);
    }
  }
  const target = scope === "group" ? group : openId;

  if (action === "get") {
    const resolved = await getResolvedHome(env, openId, role.group);
    const sourceLabel = { personal: "个人定制", group: `组默认（${resolved.group}）`, default: "全员默认" }[resolved.source];
    return {
      content: [{ type: "text", text: layoutSummary(`当前生效布局（${sourceLabel}）：`, resolved.layout) }],
    };
  }
  if (action === "reset") {
    await deleteHomeLayout(env, scope, target);
    return {
      content: [
        {
          type: "text",
          text:
            scope === "group"
              ? `✅ 已删除组「${group}」的默认首页，该组成员将回落到全员默认布局。`
              : "✅ 已恢复默认：个人布局已删除，回落到组配置/全员默认。重新登录或刷新门户即生效。",
        },
      ],
    };
  }

  // action=set
  const layout = parseHomeLayout(args.widgets ?? args.layout);
  if (!layout) {
    throw new Error(
      `widgets 至少要有一个白名单组件：${Object.entries(HOME_WIDGET_META)
        .map(([id, m]) => `${id}（${m.title}）`)
        .join(" / ")}。白名单制，禁止自由 HTML。`,
    );
  }
  const saved = await saveHomeLayout(env, scope, target, layout);
  const scopeLabel = scope === "group" ? `组「${group}」的默认首页` : `你的个人首页（绑定 open_id=${openId}）`;
  return {
    content: [
      {
        type: "text",
        text:
          layoutSummary(`✅ ${scopeLabel}已保存：`, saved) +
          `\n刷新门户「我的首页」即可看到新布局；配置会随账号保持，换设备/重新登录不变。`,
      },
    ],
  };
}
