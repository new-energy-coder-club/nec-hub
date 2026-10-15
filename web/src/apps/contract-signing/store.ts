// 协议签署 OA 审批（contract-approval）共享状态与业务逻辑
// 端点 / 权限判定 / 文案逐条对齐原 public/apps/contract-signing/index.html
import { reactive } from 'vue'
import { apiMod } from '@shared/api'

export interface CsUser { open_id: string; name?: string; role?: string; avatar_url?: string }
export interface CsApprover { level: string; approverId: string; name?: string; status?: string; comment?: string; actedAt?: string }
export interface CsFile { name: string; token?: string; url?: string; size?: number }
export interface CsApproval {
  approvalId: string
  contractName: string
  contractNumber?: string
  contractType?: string
  parties?: string[]
  /** 合同金额（数字或 null，提交时必填） */
  amount?: number | null
  /** 币种（CNY/USD/EUR/JPY/GBP/HKD，默认 CNY） */
  currency?: string
  effectiveDate?: string
  expirationDate?: string
  summary?: string
  contractFiles?: CsFile[]
  approvers?: CsApprover[]
  submittedBy: string
  status: string
  createdAt?: string
}
export interface CsComment { reviewerId: string; content: string; timestamp?: string }

export type CsView = 'list' | 'submit' | 'detail'

export const store = reactive({
  view: 'list' as CsView,
  detailId: '',
  /** 当前登录用户（/api/whoami），用于判断操作权限（提交人 / 审批人） */
  currentUser: null as CsUser | null,
  /** 401：提示回门户登录（参照原应用 handleAuthFailure） */
  authFailed: false,
  /** 飞书 Base 未配置：展示「联系管理员配置」提示 */
  notConfigured: false,
  /** 提交抽屉开关（默认视图为列表，抽屉叠于其上） */
  drawerOpen: false,
  /** 新提交单置顶高亮 3 秒：highlightId + highlightAt 时间戳 */
  highlightId: '',
  highlightAt: 0,
  /** 列表刷新信号：提交成功后自增，ApprovalList 监听重载 */
  listTick: 0,
})

export function router(view: CsView, id = '') {
  store.view = view
  if (view === 'detail' && id) store.detailId = id
}

/** 打开提交抽屉（固定在列表视图上打开） */
export function openSubmit() {
  store.view = 'list'
  store.drawerOpen = true
}

/** 提交成功：标记新审批单，供列表置顶高亮 3 秒 */
export function markHighlight(approvalId: string) {
  store.highlightId = approvalId
  store.highlightAt = Date.now()
}

// ---- fetch 封装：非 2xx 抛出带后端 error 文案的 Error；401 额外标记未登录 ----
export async function api(path: string, options: RequestInit = {}) {
  try {
    return await apiMod('', path, options)
  } catch (err: any) {
    if (err?.status === 401) {
      store.authFailed = true
      throw new Error(err.message || '请先登录')
    }
    throw err
  }
}

export async function loadCurrentUser() {
  try {
    const data = await api('/api/whoami')
    if (data.authenticated && data.user) store.currentUser = data.user
  } catch { /* ignore */ }
}

// 探测配置：未配置时给出「联系管理员配置飞书 Base」的友好提示
export async function probeConfig() {
  try {
    const cfg = await api('/api/contract-approval/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'get' }),
    })
    if (!cfg.configured) store.notConfigured = true
  } catch { /* ignore */ }
}

/* ---------- 展示映射（与原页面 statusMap / typeMap / levelMap / decisionMap 一致） ---------- */
export const statusMap: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'background:#EEF1F8;color:#5A6472' },
  pending_approval: { label: '待审批', color: 'background:#E8ECFB;color:#1A2FA0' },
  in_review: { label: '审批中', color: 'background:#FFF4DB;color:#92610B' },
  approved: { label: '已批准', color: 'background:#E3F6EC;color:#177A4C' },
  rejected: { label: '已拒绝', color: 'background:#FBE3E3;color:#C22E2E' },
  revised: { label: '待修改', color: 'background:#FDEADD;color:#B04A0F' },
  archived: { label: '已归档', color: 'background:#EDF0F7;color:#141B5E' },
}
export const typeMap: Record<string, string> = {
  purchase: '采购合同',
  sales: '销售合同',
  service: '服务合同',
  partnership: '合作协议',
  nda: '保密协议',
}
export const levelMap: Record<string, string> = {
  team_lead: '团队负责人',
  department_head: '部门主管',
  finance: '财务',
  legal: '法务',
}
export const decisionMap: Record<string, { label: string; color: string }> = {
  pending: { label: '待审批', color: 'background:#EEF1F8;color:#5A6472' },
  approved: { label: '已同意', color: 'background:#E3F6EC;color:#177A4C' },
  rejected: { label: '已拒绝/要求修改', color: 'background:#FBE3E3;color:#C22E2E' },
  not_required: { label: '无需审批', color: 'background:#EEF1F8;color:#5A6472' },
}

export function statusBadge(status: string): { label: string; color: string } {
  return statusMap[status] || { label: status, color: 'background:#EEF1F8;color:#5A6472' }
}
export function renderType(t?: string): string { return typeMap[t || ''] || t || '服务合同' }
export function renderLevel(l?: string): string { return levelMap[l || ''] || l || '—' }
export function decisionBadge(status?: string): { label: string; color: string } {
  return decisionMap[status || ''] || decisionMap.pending
}

export function personLabel(openId?: string, name?: string): string {
  if (name) return name
  if (!openId) return '—'
  if (store.currentUser && openId === store.currentUser.open_id) return store.currentUser.name || '我'
  return `ou_…${openId.slice(-6)}`
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return Math.max(1, Math.round(bytes / 1024)) + ' KB'
}

export function parseParties(text: string): string[] {
  return (text || '').split(/[,，]/).map(s => s.trim()).filter(Boolean)
}

// 批量导入：名称|文件token|链接，每行一条
export function parseFileBatch(text: string): CsFile[] {
  return (text || '').split('\n').map(s => s.trim()).filter(Boolean).map(line => {
    const [name, token, url] = line.split('|').map(s => (s || '').trim())
    return { name, token: token || 'manual', ...(url ? { url } : {}) }
  })
}

// 批量替换审批人：层级|open_id|姓名，每行一条
export function parseApproverBatch(text: string): CsApprover[] {
  return (text || '').split('\n').map(s => s.trim()).filter(Boolean).map(line => {
    const [level, approverId, name] = line.split('|').map(s => (s || '').trim())
    return approverId ? { level: level || 'team_lead', approverId, ...(name ? { name } : {}) } : null
  }).filter(Boolean) as CsApprover[]
}

/* ---------- 流程步骤条：提交 → 待审批 → 审批中 → 审批结论 → 归档 ---------- */
export const FLOW_STEPS = ['提交合同', '待审批', '审批中', '审批结论', '归档']
export const STATUS_STEP: Record<string, number> = {
  draft: 0, pending_approval: 1, in_review: 2,
  approved: 3, rejected: 3, revised: 3, archived: 5,
}
export interface FlowStep { label: string; dot: string; cls: string; connDone: boolean }
export function stepBar(status: string): FlowStep[] {
  const cur = STATUS_STEP[status] ?? 0
  return FLOW_STEPS.map((label, i) => {
    const done = i < cur || cur >= FLOW_STEPS.length
    const current = i === cur
    const cls = done ? 'done' : current ? 'current' : ''
    const dot = done ? '✓' : String(i + 1).padStart(2, '0')
    const lbl = i === 3 && cur === 3 && statusMap[status] ? statusMap[status].label : label
    return { label: lbl, dot, cls, connDone: i <= cur }
  })
}

/* ---------- 金额 / 币种 / 日期 ---------- */
export const CURRENCIES = ['CNY', 'USD', 'EUR', 'JPY', 'GBP', 'HKD'] as const
export const MAX_AMOUNT = 9_999_999.99

/** 金额千分位渲染（输入层内部保留可解析的数值字符串，仅展示层加千分位） */
export function formatAmount(raw: string): string {
  const m = raw.match(/^(\d+)(\.\d*)?$/)
  if (!m) return raw
  const int = m[1].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return int + (m[2] ? m[2].slice(0, 3) : '')
}

/** 列表/详情金额展示：¥ 千分位 + 币种；null → — */
export function fmtMoney(amount?: number | null, currency?: string | null): string {
  if (amount === null || amount === undefined) return '—'
  try {
    const n = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
    return `¥ ${n} ${currency || 'CNY'}`
  } catch {
    return `¥ ${amount} ${currency || 'CNY'}`
  }
}

/** 列表/详情日期一律 YYYY-MM-DD（截断 ISO 时间部分） */
export function fmtDate(v?: string): string {
  return v ? String(v).slice(0, 10) : '—'
}

/** 距到期剩余天数（按自然日，负数=已过期）；解析失败返回 null */
export function daysUntil(expirationDate?: string): number | null {
  if (!expirationDate) return null
  const t = new Date(String(expirationDate).slice(0, 10) + 'T00:00:00').getTime()
  if (isNaN(t)) return null
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((t - now.getTime()) / 86400000)
}

/** 合同文件预览链接：r2 token → /api/contract-approval/file；url 型 → 原链接 */
export function filePreviewHref(f: CsFile): string | null {
  if (f.url) return f.url
  if (f.token && f.token.startsWith('r2:')) {
    const key = f.token.slice(3)
    return `/api/contract-approval/file?key=${encodeURIComponent(key)}&name=${encodeURIComponent(f.name || key.split('/').pop() || 'file')}`
  }
  return null
}

/** 文件类型图标（按扩展名） */
export function fileIcon(name?: string): string {
  const ext = (name || '').split('.').pop()?.toLowerCase() || ''
  if (ext === 'pdf') return 'PDF'
  if (ext === 'doc' || ext === 'docx') return 'DOC'
  if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') return 'XLS'
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') return 'IMG'
  return 'FILE'
}
