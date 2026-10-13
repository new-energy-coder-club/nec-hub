/**
 * FE-06 千人千面「改我的首页」/ FE-07 组别默认首页 — 布局模型（纯函数层）
 *
 * 白名单制：布局只允许组合预置组件 id，禁止自由 HTML（PRD §10 风险项）。
 * 渲染三层回退：个人 home:<open_id> > 组 home:group:<组名> > 代码内置全员默认。
 * 本文件不触碰 KV / 网络，校验与回退解析均为纯函数，便于测试。
 */

export const HOME_WIDGET_IDS = ["my-apps", "my-tasks", "my-reimburse", "docs", "goals", "inventory"] as const;
export type HomeWidgetId = (typeof HOME_WIDGET_IDS)[number];

export interface HomeWidget {
  id: HomeWidgetId;
  /** 可选：覆盖组件默认标题 */
  title?: string;
}

export interface HomeLayout {
  version: 1;
  widgets: HomeWidget[];
  updatedAt?: string;
}

export const HOME_WIDGET_META: Record<HomeWidgetId, { title: string; description: string }> = {
  "my-apps": { title: "我的应用快捷区", description: "应用广场快捷入口（数据来自 /api/apps）" },
  "my-tasks": { title: "我的任务", description: "与我相关的未完成任务（数据来自 /api/dashboard）" },
  "my-reimburse": { title: "我的报销状态", description: "报销汇总与我的最近报销（数据来自 /api/dashboard）" },
  docs: { title: "常用资料", description: "资料页精选条目（数据来自 /api/docs）" },
  goals: { title: "赛季目标", description: "赛季目标进度速览（数据来自 /api/dashboard）" },
  inventory: { title: "物资查询", description: "物资台账速览与筛选（数据来自 /api/dashboard）" },
};

/** 单个首页最多组件数（防配置滥用与渲染失控） */
export const MAX_HOME_WIDGETS = 8;

/** 全员默认首页（home:default 内置在代码里，不落 KV） */
export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  version: 1,
  widgets: [{ id: "my-tasks" }, { id: "goals" }, { id: "my-apps" }, { id: "docs" }],
};

const WIDGET_ID_SET = new Set<string>(HOME_WIDGET_IDS);

/**
 * 规范化布局输入：接受 { widgets: [...] } 或直接数组；元素为组件 id 字符串或 { id, title? }。
 * 非白名单组件被丢弃；去重、截断到 MAX_HOME_WIDGETS；title 超长截断。
 * 形状不对或过滤后为空返回 null（调用方回退到下一层配置）。
 */
export function parseHomeLayout(raw: unknown): HomeLayout | null {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { widgets?: unknown }).widgets)
      ? ((raw as { widgets: unknown[] }).widgets)
      : null;
  if (!list) return null;
  const updatedAt =
    !Array.isArray(raw) && raw && typeof raw === "object" && typeof (raw as { updatedAt?: unknown }).updatedAt === "string"
      ? String((raw as { updatedAt: string }).updatedAt)
      : undefined;
  const seen = new Set<string>();
  const widgets: HomeWidget[] = [];
  for (const item of list) {
    const id = typeof item === "string" ? item.trim() : String((item as { id?: unknown })?.id ?? "").trim();
    if (!WIDGET_ID_SET.has(id) || seen.has(id)) continue;
    seen.add(id);
    const title =
      item && typeof item === "object" && typeof (item as { title?: unknown }).title === "string"
        ? String((item as { title: string }).title).trim().slice(0, 30)
        : "";
    widgets.push(title ? { id: id as HomeWidgetId, title } : { id: id as HomeWidgetId });
    if (widgets.length >= MAX_HOME_WIDGETS) break;
  }
  return widgets.length ? { version: 1, widgets, ...(updatedAt ? { updatedAt } : {}) } : null;
}

export type HomeLayoutSource = "personal" | "group" | "default";

export interface ResolvedHomeLayout {
  layout: HomeLayout;
  source: HomeLayoutSource;
  /** 用户所属组（来自队员名单；未匹配到为空串） */
  group: string;
}

/**
 * 三层回退解析：个人 > 组 > 全员默认。
 * getJson 由调用方注入（生产为 env.REGISTRY.get(key, "json")，测试可给 Map）。
 * 任何一层配置缺失或损坏（parse 为 null）都静默落到下一层。
 */
export async function resolveHomeLayout(
  getJson: (key: string) => Promise<unknown> | unknown,
  openId: string,
  group: string,
): Promise<ResolvedHomeLayout> {
  if (openId) {
    const personal = parseHomeLayout(await getJson(personalHomeKey(openId)));
    if (personal) return { layout: personal, source: "personal", group };
  }
  if (group) {
    const groupLayout = parseHomeLayout(await getJson(groupHomeKey(group)));
    if (groupLayout) return { layout: groupLayout, source: "group", group };
  }
  return { layout: DEFAULT_HOME_LAYOUT, source: "default", group };
}

/** 个人布局 KV key：home:<open_id> */
export function personalHomeKey(openId: string): string {
  return `home:${openId}`;
}

/** 组默认布局 KV key：home:group:<组名> */
export function groupHomeKey(group: string): string {
  return `home:group:${group}`;
}
