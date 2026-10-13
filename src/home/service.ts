/**
 * FE-06/07 首页布局 — KV 存取层
 */

import {
  groupHomeKey,
  parseHomeLayout,
  personalHomeKey,
  resolveHomeLayout,
  type HomeLayout,
  type ResolvedHomeLayout,
} from "./layout";

/** 读取当前用户生效布局（个人 > 组 > 默认） */
export async function getResolvedHome(
  env: Env,
  openId: string,
  group: string,
): Promise<ResolvedHomeLayout> {
  return resolveHomeLayout((key) => env.REGISTRY.get(key, "json"), openId, group);
}

/** 写布局：scope=user 存 home:<open_id>，scope=group 存 home:group:<组名>；写入前再过一次白名单 */
export async function saveHomeLayout(
  env: Env,
  scope: "user" | "group",
  target: string,
  layout: HomeLayout,
): Promise<HomeLayout> {
  const clean = parseHomeLayout(layout.widgets);
  if (!clean) throw new Error("布局为空或组件均不在白名单内");
  const full: HomeLayout = { ...clean, updatedAt: new Date().toISOString() };
  const key = scope === "group" ? groupHomeKey(target) : personalHomeKey(target);
  await env.REGISTRY.put(key, JSON.stringify(full));
  return full;
}

/** 删除布局（恢复默认 = 删个人配置，回落到组/全员默认） */
export async function deleteHomeLayout(env: Env, scope: "user" | "group", target: string): Promise<void> {
  await env.REGISTRY.delete(scope === "group" ? groupHomeKey(target) : personalHomeKey(target));
}
