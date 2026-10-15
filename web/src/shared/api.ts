// 共享 fetch 封装：门户与子应用共用（原 src/api.ts 的 API 部分迁入）

export const ORIGIN = location.origin

export function copyText(text: string) {
  navigator.clipboard.writeText(text)
}

// ---- 通用 fetch 封装 ----
export async function fetchJson(url: string, options?: RequestInit) {
  const r = await fetch(url, options)
  return r.json()
}

// ---- 图纸评审 API 封装（/api/drawing-review 前缀，错误抛出 error 字段） ----
export async function apiDr(path: string, options: RequestInit = {}) {
  const res = await fetch('/api/drawing-review' + path, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export interface ApiModError extends Error {
  status?: number
  hint?: string
}

// ---- 通用模块 API（hardware-review / contract-approval 等 module-gateway 模块共用）：
// 非 2xx 抛出带后端 error 文案的 Error，附 .status / .hint 供引导态判定（503 未配置 / 401 未登录） ----
export async function apiMod(base: string, path: string, options: RequestInit = {}) {
  const res = await fetch(base + path, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err: ApiModError = new Error(data.error || `HTTP ${res.status}`)
    err.status = res.status
    err.hint = data.hint
    throw err
  }
  return data
}
