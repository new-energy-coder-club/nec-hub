/**
 * 飞书任务 Task v2 API 封装（user_access_token 身份，读取当前用户任务）
 */

const FEISHU_API = "https://open.feishu.cn/open-apis";

export interface FeishuTask {
  guid: string;
  summary: string;
  /** 截止时间（epoch ms），无截止为 null */
  dueTimestamp: number | null;
  /** 完成时间（epoch ms），未完成为 null */
  completedAt: number | null;
  url: string;
  members: Array<{ id: string; type: string; role: string }>;
}

/** token 失效/权限不足类错误：上层捕获后引导用户重新绑定授权 */
export class FeishuUserAuthError extends Error {}

/** 视为"需重新绑定"的飞书错误码：99991661/63/64 token 失效，99991672 缺少 scope（重新授权可覆盖） */
const TOKEN_INVALID_CODES = new Set([99991661, 99991663, 99991664, 99991672]);

interface TaskV2Item {
  guid?: string;
  summary?: string;
  due?: { timestamp?: string; is_all_day?: boolean } | null;
  completed_at?: string;
  url?: string;
  members?: Array<{ id?: string; type?: string; role?: string }>;
}

/** 分页拉取当前用户未完成任务（最多 max 条） */
export async function listUserTasks(userToken: string, max = 200): Promise<FeishuTask[]> {
  const out: FeishuTask[] = [];
  let pageToken = "";
  do {
    const u = new URL(`${FEISHU_API}/task/v2/tasks`);
    u.searchParams.set("page_size", "50");
    u.searchParams.set("completed", "false");
    if (pageToken) u.searchParams.set("page_token", pageToken);
    const resp = await fetch(u.toString(), { headers: { authorization: `Bearer ${userToken}` } });
    const data = (await resp.json()) as {
      code?: number;
      msg?: string;
      data?: { items?: TaskV2Item[]; has_more?: boolean; page_token?: string };
    };
    if (resp.status === 401 || (data.code != null && TOKEN_INVALID_CODES.has(data.code))) {
      throw new FeishuUserAuthError(`飞书任务授权已失效：${data.msg ?? `HTTP ${resp.status}`}`);
    }
    if (data.code !== 0) {
      throw new Error(`飞书任务读取失败：${data.msg ?? `code ${data.code}`}`);
    }
    for (const it of data.data?.items ?? []) {
      out.push({
        guid: it.guid ?? "",
        summary: it.summary ?? "",
        dueTimestamp: it.due?.timestamp ? Number(it.due.timestamp) : null,
        completedAt: it.completed_at && it.completed_at !== "0" ? Number(it.completed_at) : null,
        url: it.url ?? "",
        members: (it.members ?? []).map((m) => ({ id: m.id ?? "", type: m.type ?? "", role: m.role ?? "" })),
      });
    }
    pageToken = data.data?.has_more ? (data.data?.page_token ?? "") : "";
  } while (pageToken && out.length < max);
  return out.slice(0, max);
}
