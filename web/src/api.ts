// 共享工具：HTML 转义、格式化、状态色（与原单文件版逐一对应）

const ESC_RE = /[&<>"']/g
const ESC_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export function esc(s: unknown): string {
  return String(s ?? '').replace(ESC_RE, c => ESC_MAP[c])
}

export const ORIGIN = location.origin

export function copyText(text: string) {
  navigator.clipboard.writeText(text)
}

// 状态匹配正则提升为常量：dashStatusColor 在每个任务行/图例渲染时调用
export const DASH_STATUS_RE = {
  doing: /进行|doing|progress/i,
  done: /完成|done|完结/i,
  todo: /未开始|待|todo|pending/i,
  cancel: /取消|cancel|关闭|close/i,
}
export function dashStatusColor(name: string): string {
  if (DASH_STATUS_RE.doing.test(name)) return '#1FA9E8'
  if (DASH_STATUS_RE.done.test(name)) return '#141B5E'
  if (DASH_STATUS_RE.todo.test(name)) return '#9CA3AF'
  if (DASH_STATUS_RE.cancel.test(name)) return '#D1D5DB'
  return '#4FC3F7'
}

export function fmtDashDate(v: unknown): string {
  if (typeof v !== 'number' || !isFinite(v)) return '—'
  const d = new Date(v)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

/** 金额统一格式：千分位、最多两位小数；非数字原样转义输出 */
export function fmtMoney(n: unknown): string {
  if (typeof n === 'number' && isFinite(n)) return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  const p = Number(n)
  return isFinite(p) && n !== '' && n !== null ? p.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—'
}

/** 名字字段按多人分隔符拆分后精确比对（与后端 splitNames 同口径） */
export function nameHits(raw: unknown, name: string): boolean {
  if (!raw || !name) return false
  return String(raw).split(/[、,，;；\/\s]+/).map(s => s.trim()).includes(name)
}

export function goalBarColor(it: { overdue?: boolean; done?: boolean }): string {
  if (it.overdue) return '#DC2626'
  if (it.done) return '#141B5E'
  return '#1FA9E8'
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
