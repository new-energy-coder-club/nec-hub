// 管理后台 API 封装（AdminTab 用）：会话清单/强制下线 + 模块配置写接口
// 真正鉴权以后端为准（ROLES.LEADER / ROLES.CONFIG_ADMIN），这里只做调用与错误透传

export interface AdminSessionUser {
  open_id: string
  name: string
  avatar_url?: string
  sessions: number
  latestCreatedAt: string
  latestExpiresAt: number
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, init)
  const data = await resp.json()
  if (!resp.ok || data.error) throw new Error(data.error || ('HTTP ' + resp.status))
  return data as T
}

export function fetchAdminSessions(): Promise<{ users: AdminSessionUser[]; total: number }> {
  return request('/api/admin/sessions')
}

export async function revokeUserSessions(openId: string): Promise<number> {
  const data = await request<{ ok: boolean; revoked: number }>('/api/admin/sessions/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ open_id: openId }),
  })
  return data.revoked ?? 0
}

/** 写 dashboard:config（POST /api/admin/config/dashboard，校验口径同 MCP config_dashboard） */
export function saveDashboardConfig(base: string, tables: Record<string, string>): Promise<void> {
  return saveAdminConfig('dashboard', { base, tables })
}

/** 写 flows:config 的单个流程补丁（POST /api/admin/config/flows，服务端深合并，校验口径同 MCP config_flows） */
export function saveFlowConfig(flow: string, cfg: { tableId: string; base: string }): Promise<void> {
  return saveAdminConfig('flows', { [flow]: cfg })
}

async function saveAdminConfig(module: 'dashboard' | 'flows', body: unknown): Promise<void> {
  await request(`/api/admin/config/${module}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** 写三个评审模块的配置（POST /api/<module>/config，module-gateway configRoles 门禁） */
export async function saveReviewModuleConfig(module: 'drawing-review' | 'hardware-review' | 'contract-approval', base: string, tables: Record<string, string>): Promise<void> {
  await request(`/api/${module}/config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'set', base, tables }),
  })
}
