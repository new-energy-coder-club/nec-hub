// 合规申请（G-02 · 审批与通知中心 PRD V1.1 Plan B）共享状态与业务逻辑：
// 独立入口（/apps/compliance/）与门户 Tab 复用同一套；
// fetch 端点 / sessionStorage 键 / 校验规则逐条对齐原 public/apps/compliance/index.html
import { reactive, computed } from 'vue'
import { toast } from '@shared/ui/feedback'

/* ========== 驳回原因（标准化 5 个固定选项，便于统计复盘） ========== */

export const REJECT_REASONS = [
  '内容事实错误',
  '排版或 VI 不规范',
  '涉及未授权信息',
  '发布时间冲突',
  '其他（须在审批意见中说明）',
]

/* ========== 状态徽章 ========== */

export const STATUS_COLORS: Record<string, string> = {
  '审批中': '#1FA9E8',
  '已通过': '#16A34A',
  '已驳回': '#DC2626',
  '已撤销': '#9CA3AF',
  '已打款': '#15803D',
  '已完成': '#141B5E',
  '已发布': '#1A2FA0',
}
export function statusColor(s: string): string { return STATUS_COLORS[s] || '#5A6472' }

export function fmtMs(ts: unknown): string {
  const n = Number(ts)
  return n ? new Date(n).toLocaleString('zh-CN') : '—'
}

/* ========== 记录类型 ========== */

export interface ComplianceRecord {
  application_id: string
  status: string
  title?: string
  applicant?: string
  submitted_at?: number | string
  url?: string
  fields?: Record<string, any>
  // 驳回面板本地 UI 态（loadTodos 时初始化，不进请求体）
  rejectOpen?: boolean
  rejectReason?: string
  rejectComment?: string
  rejectErr?: string
}

export type ListState = 'idle' | 'loading' | 'login' | 'hint' | 'empty' | 'error' | 'ok'

/* ========== 共享状态 ========== */

export const store = reactive({
  form: { ctype: '', title: '', content: '', publishAt: '', sponsor: '', sponsorReq: '' },
  submitting: false,
  submitError: '',
  success: { visible: false, id: '', status: '' },
  mine: { state: 'idle' as ListState, hint: '', records: [] as ComplianceRecord[] },
  todos: { state: 'idle' as ListState, records: [] as ComplianceRecord[] },
  openRejectId: null as string | null,
})

/* ========== 提交申请（前端校验与 DEFAULT_FLOWS.compliance 的 required + conditional 对齐） ========== */

export const missingItems = computed(() => {
  const f = store.form
  const missing: string[] = []
  if (!f.ctype) missing.push('合规类型')
  if (!f.title.trim()) missing.push('标题')
  if (!f.content.trim()) missing.push('内容说明')
  if (!f.publishAt) missing.push('计划发布时间')
  if (!f.sponsor) missing.push('赞助商相关')
  if (f.sponsor === '是' && !f.sponsorReq.trim()) missing.push('赞助商要求')
  return missing
})

export const sponsorReqMissing = computed(() => store.form.sponsor === '是' && !store.form.sponsorReq.trim())

export function resetForm() {
  store.form.ctype = ''
  store.form.title = ''
  store.form.content = ''
  store.form.publishAt = ''
  store.form.sponsor = ''
  store.form.sponsorReq = ''
  store.submitError = ''
}

export async function submitCompliance() {
  if (store.submitting || missingItems.value.length) return
  store.submitting = true
  store.submitError = ''
  try {
    const f = store.form
    const fields: Record<string, any> = {
      合规类型: f.ctype,
      标题: f.title.trim(),
      内容说明: f.content.trim(),
      计划发布时间: new Date(f.publishAt).getTime(),
      赞助商相关: f.sponsor,
    }
    if (f.sponsor === '是') fields['赞助商要求'] = f.sponsorReq.trim()

    const resp = await fetch('/api/approvals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'compliance', fields }),
    })
    const data = await resp.json()
    if (resp.status === 401) throw new Error('请先登录后再提交')
    if (!resp.ok || data.error) throw new Error(data.error || ('HTTP ' + resp.status))

    store.success.id = data.application_id
    store.success.status = data.status || '审批中'
    store.success.visible = true
    resetForm()
    loadMine()
  } catch (e: any) {
    store.submitError = e.message || String(e)
  } finally {
    store.submitting = false
  }
}

/* ========== 我的申请（仅本人可见 · 最近 20 条） ========== */

export async function loadMine() {
  store.mine.state = 'loading'
  try {
    const resp = await fetch('/api/approvals/mine?type=compliance')
    if (resp.status === 401) { store.mine.state = 'login'; return }
    const d = await resp.json()
    if (d.hint && !(d.records || []).length) {
      store.mine.hint = d.hint
      store.mine.state = 'hint'
      return
    }
    const rows = d.records || []
    if (!rows.length) { store.mine.state = 'empty'; return }
    store.mine.records = rows
    store.mine.state = 'ok'
  } catch {
    store.mine.state = 'error'
  }
}

export async function doPublish(appId: string) {
  const link = prompt('请输入发布链接（发布后回填留档）：', '')
  if (link === null) return
  if (!link.trim()) { toast('发布链接不能为空'); return }
  try {
    const resp = await fetch('/api/approvals/compliance/' + encodeURIComponent(appId) + '/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ link: link.trim() }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok || data.error) throw new Error(data.error || ('HTTP ' + resp.status))
    loadMine()
  } catch (e: any) {
    toast('回填发布链接失败：' + (e.message || e))
  }
}

/* ========== 待我审批（仅审批人角色有内容） ========== */

export async function loadTodos() {
  store.todos.state = 'loading'
  try {
    const resp = await fetch('/api/approvals/pending?type=compliance')
    if (resp.status === 401) { store.todos.state = 'login'; return }
    const d = await resp.json()
    const rows: ComplianceRecord[] = d.records || []
    if (!rows.length) { store.todos.state = 'empty'; return }
    store.todos.records = rows.map(r => ({ ...r, rejectOpen: false, rejectReason: '', rejectComment: '', rejectErr: '' }))
    store.todos.state = 'ok'
  } catch {
    store.todos.state = 'error'
  }
}

/** 驳回面板手风琴：同时只展开一个 */
export function toggleRejectPanel(appId: string) {
  const row = store.todos.records.find(r => r.application_id === appId)
  if (!row) return
  const willOpen = !row.rejectOpen
  if (store.openRejectId && store.openRejectId !== appId) {
    const prev = store.todos.records.find(r => r.application_id === store.openRejectId)
    if (prev) prev.rejectOpen = false
  }
  row.rejectOpen = willOpen
  store.openRejectId = willOpen ? appId : null
}

export async function doApprove(appId: string) {
  const comment = prompt('审批意见（可空）：', '')
  if (comment === null) return
  try {
    const resp = await fetch('/api/approvals/compliance/' + encodeURIComponent(appId) + '/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comment: comment || '' }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok || data.error) throw new Error(data.error || ('HTTP ' + resp.status))
    loadTodos()
    loadMine()
  } catch (e: any) {
    toast('通过失败：' + (e.message || e))
  }
}

export async function doReject(appId: string) {
  const row = store.todos.records.find(r => r.application_id === appId)
  if (!row) return
  const reason = row.rejectReason || ''
  const comment = (row.rejectComment || '').trim()
  row.rejectErr = ''
  if (!reason) {
    row.rejectErr = '请选择驳回原因（必选，用于标准化统计）'
    return
  }
  if (reason === REJECT_REASONS[4] && !comment) {
    row.rejectErr = '选择「其他」时必须填写审批意见说明具体原因'
    return
  }
  try {
    const resp = await fetch('/api/approvals/compliance/' + encodeURIComponent(appId) + '/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason, comment }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok || data.error) throw new Error(data.error || ('HTTP ' + resp.status))
    store.openRejectId = null
    loadTodos()
    loadMine()
  } catch (e: any) {
    row.rejectErr = '驳回失败：' + (e.message || e)
  }
}
