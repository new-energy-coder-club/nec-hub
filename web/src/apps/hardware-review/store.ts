// 硬件评审流程：状态、API 与业务逻辑（自 public/apps/hardware-review/index.html 单文件版逐行迁入）
import { reactive, nextTick } from 'vue'
import { apiMod } from '@shared/api'

export interface HwUser { open_id: string; name?: string; avatar_url?: string }
export interface SpecRow { key: string; value: string; note: string }
export interface HwFile { name: string; token?: string; url?: string; size?: number; uploading?: boolean }
export interface Review {
  reviewId: string
  projectId: string
  hardwareName: string
  hardwareType: string
  hardwareVersion: string
  status: string
  designNotes: string
  designerId: string
  specification?: string
  meetingId?: string
  meetingLink?: string
  meetingStartTime?: number
  createdAt: number
}
export interface DraftState {
  projectId?: string
  hardwareName?: string
  hardwareType?: string
  hardwareVersion?: string
  designerId?: string
  designerName?: string
  spec?: SpecRow[]
  filesBatch?: string
  uploadedFiles?: HwFile[]
  designNotes?: string
  savedAt?: string
}

// 与原单文件版 api() 同语义：非 2xx 抛出带后端 error 文案的 Error
const api = (path: string, options: RequestInit = {}) => apiMod('', path, options)
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err))

export const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: '待提交', color: 'background:#EEF1F8;color:#5A6472' },
  pending_review: { label: '待评审', color: 'background:#E8ECFB;color:#1A2FA0' },
  in_review: { label: '评审中', color: 'background:#FFF4DB;color:#92610B' },
  rectifying: { label: '待整改', color: 'background:#FDEADD;color:#B04A0F' },
  report_generating: { label: '报告生成中', color: 'background:#EFE9FB;color:#6A3FB5' },
  assessing: { label: '评估中', color: 'background:#E7EAFB;color:#3D4BA8' },
  approved: { label: '已通过', color: 'background:#E3F6EC;color:#177A4C' },
  archived: { label: '已归档', color: 'background:#EDF0F7;color:#141B5E' },
}
export const TYPE_MAP: Record<string, string> = {
  controller: '控制器',
  sensor: '传感器',
  actuator: '执行器',
  motor: '电机/驱动',
  power: '电源/电池',
  communication: '通信模块',
  structure: '结构件',
  other: '其他',
}
// 流程步骤条：提交 → 预约会议 → 保存纪要 → 评审报告 → 评估归档
export const FLOW_STEPS = ['提交评审单', '预约会议', '保存纪要', '评审报告', '评估归档']
export const STATUS_STEP: Record<string, number> = {
  draft: 0, pending_review: 1, in_review: 2, rectifying: 2,
  report_generating: 3, assessing: 4, approved: 4, archived: 5,
}
// 规格参数：键值对编辑器 + 类型模板
export const SPEC_TEMPLATES: Record<string, string[]> = {
  controller: ['主控芯片', '工作电压', '工作电流', '通信接口', '防护等级'],
  sensor: ['测量范围', '精度', '供电电压', '输出接口', '防护等级'],
  actuator: ['额定电压', '额定电流', '行程/角度', '负载能力', '防护等级'],
  motor: ['额定电压', '额定功率', '额定转速', '额定扭矩', '防护等级'],
  power: ['额定电压', '容量', '充放电倍率', '循环寿命', '防护等级'],
  communication: ['通信协议', '工作频段', '传输速率', '供电电压', '防护等级'],
  structure: ['材料', '外形尺寸', '重量', '表面处理', '公差等级'],
  other: [],
}
export const DRAFT_KEY = 'hw-review-draft'

export const store = reactive({
  view: 'list' as 'list' | 'submit' | 'detail',
  displayMode: 'board' as 'board' | 'table',
  configured: true,
  currentUser: null as HwUser | null,
  reviews: [] as Review[],
  listState: 'loading' as 'loading' | 'ok' | 'error' | 'unconfigured',
  listError: '',
  detail: null as Review | null,
  detailState: 'loading' as 'loading' | 'ok' | 'error',
  detailError: '',
  // 提交表单
  form: {
    projectId: '',
    hardwareName: '',
    hardwareType: 'other',
    hardwareVersion: '',
    designerId: '',
    designNotes: '',
  },
  designerName: '加载中…',
  designerGray: true,
  designerAvatar: '',
  designerOverride: '',
  specRows: [] as SpecRow[],
  filesBatch: '',
  uploadedFiles: [] as HwFile[],
  fieldErrors: {} as Record<string, string>,
  submitting: false,
  submitResult: { text: '', ok: false },
  draftStatus: '',
  draftBanner: false,
  draftTime: '',
  pendingDraft: null as DraftState | null,
  prefilled: false,
  designNotesTemplate: '',
})

export function statusOf(status: string) {
  return STATUS_MAP[status] || { label: status, color: 'background:#EEF1F8;color:#5A6472' }
}
export function typeLabel(t: string) {
  return TYPE_MAP[t] || t || '其他'
}
export function stepOf(status: string) {
  return STATUS_STEP[status] ?? 0
}

export function parseLines(text: string) {
  return (text || '').split('\n').map(s => s.trim()).filter(Boolean)
}
export function parseOpenIds(text: string) {
  return (text || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean)
}

export function defaultMeetingTime() {
  const d = new Date(Date.now() + 24 * 3600 * 1000)
  d.setHours(14, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function personLabel(openId: string) {
  if (!openId) return '—'
  if (store.currentUser && openId === store.currentUser.open_id) return store.currentUser.name || '我'
  return `ou_…${openId.slice(-6)}`
}

export function renderDesignerChip(name?: string, avatarUrl?: string) {
  store.designerName = name || '未选择'
  store.designerGray = !name
  store.designerAvatar = avatarUrl || ''
}

// 当前登录用户（/api/whoami），用于预填设计负责人、纪要参会人/提出人
export async function loadCurrentUser() {
  try {
    const data = await api('/api/whoami')
    if (data.authenticated && data.user) store.currentUser = data.user
  } catch { /* ignore */ }
}

export function router(view: 'list' | 'submit' | 'detail', id?: string) {
  store.view = view
  if (view === 'list') loadReviews()
  if (view === 'submit') { prefillSubmitForm(); checkDraft() }
  if (view === 'detail' && id) loadDetail(id)
}

export async function loadReviews() {
  try {
    store.reviews = await api('/api/hardware-review')
    store.listState = 'ok'
  } catch (err) {
    const msg = errMsg(err)
    store.listState = /尚未配置/.test(msg) ? 'unconfigured' : 'error'
    store.listError = msg
  }
}

// 提交表单智能预填：当前用户 + /api/hardware-review/start 的默认值（版本号递增等）
export async function prefillSubmitForm() {
  if (store.prefilled) return
  store.prefilled = true
  if (store.currentUser && !store.form.designerId) {
    store.form.designerId = store.currentUser.open_id
    renderDesignerChip(store.currentUser.name, store.currentUser.avatar_url)
  }
  try {
    const data = await api('/api/hardware-review/start')
    const d = data.defaults || {}
    if (!store.form.projectId && d.projectId) store.form.projectId = d.projectId
    if (!store.form.hardwareName && d.hardwareName) store.form.hardwareName = d.hardwareName
    if (d.hardwareType) store.form.hardwareType = d.hardwareType
    if (!store.form.hardwareVersion && d.hardwareVersion) store.form.hardwareVersion = d.hardwareVersion
    if (!store.form.designerId && d.designerId) {
      store.form.designerId = d.designerId
      renderDesignerChip(personLabel(d.designerId))
    }
    // 设计说明模板不再直接填入正文，存起来供「插入模板」按钮使用
    if (d.designNotes && d.designNotes.startsWith('【硬件设计说明模板】')) {
      store.designNotesTemplate = d.designNotes
    } else if (!store.form.designNotes && d.designNotes) {
      store.form.designNotes = d.designNotes
    }
  } catch { /* ignore */ }
  // 规格参数编辑器默认给一行空行，避免空白区域看起来损坏
  if (!store.specRows.length) addSpecRow()
}

/* ---------- 规格参数：键值对编辑器 + 类型模板 ---------- */
export function addSpecRow(key = '', value = '', note = '') {
  store.specRows.push({ key, value, note })
}

export function removeSpecRow(i: number) {
  store.specRows.splice(i, 1)
  scheduleDraftSave()
}

export function specRowsEmpty() {
  return store.specRows.every(r => !r.key.trim())
}

export function applySpecTemplate() {
  const keys = SPEC_TEMPLATES[store.form.hardwareType] || []
  if (!keys.length) { addSpecRow(); return }
  if (!specRowsEmpty() && !confirm('已有参数行，仍要追加类型模板吗？')) return
  for (const k of keys) addSpecRow(k)
  scheduleDraftSave()
}

export function serializeSpec() {
  return store.specRows
    .map(r => {
      const k = r.key.trim()
      const v = r.value.trim()
      const n = r.note.trim()
      if (!k && !v) return ''
      return `${k}: ${v}${n ? `（${n}）` : ''}`
    })
    .filter(Boolean)
    .join('\n')
}

/* ---------- 硬件资料：文件上传（复用 /api/approvals/upload） ---------- */
export function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return Math.max(1, Math.round(bytes / 1024)) + ' KB'
}

export function removeFile(i: number) {
  store.uploadedFiles.splice(i, 1)
  scheduleDraftSave()
}

export async function uploadFiles(fileList: FileList | File[]) {
  for (const file of Array.from(fileList)) {
    if (file.size > 10 * 1024 * 1024) {
      setFieldError('hardwareFiles', `「${file.name}」超过 10MB 上限`)
      continue
    }
    store.uploadedFiles.push({ name: file.name, size: file.size, uploading: true })
    const entry = store.uploadedFiles[store.uploadedFiles.length - 1]
    try {
      const fd = new FormData()
      fd.append('file', file)
      const data = await api('/api/approvals/upload', { method: 'POST', body: fd })
      const saved = data.files?.[0]
      entry.token = saved?.key || ''
      entry.name = saved?.name || file.name
      entry.size = saved?.size ?? file.size
    } catch (err) {
      store.uploadedFiles = store.uploadedFiles.filter(f => f !== entry)
      setFieldError('hardwareFiles', `「${file.name}」上传失败：${errMsg(err)}`)
    } finally {
      entry.uploading = false
      scheduleDraftSave()
    }
  }
}

export function collectHardwareFiles() {
  const batch = parseLines(store.filesBatch).map(line => {
    const [name, token, url] = line.split('|').map(s => (s || '').trim())
    return { name, token: token || 'manual', ...(url ? { url } : {}) }
  })
  const uploaded = store.uploadedFiles.filter(f => f.token).map(f => ({ name: f.name, token: f.token as string, size: f.size }))
  return [...uploaded, ...batch]
}

/* ---------- 设计说明模板 ---------- */
export function insertDesignTemplate() {
  const tpl = store.designNotesTemplate ||
    '【硬件设计说明模板】\n\n1. 设计背景与目标：\n2. 关键规格参数：\n3. 选型理由与替代方案：\n4. 安全与可靠性考虑：\n5. 测试验证计划：\n6. 相关文档与标准：\n'
  store.form.designNotes = store.form.designNotes.trim()
    ? store.form.designNotes.replace(/\s*$/, '\n') + tpl
    : tpl
  scheduleDraftSave()
}

/* ---------- 草稿（localStorage 自动保存 + 恢复） ---------- */
let draftSaveTimer: ReturnType<typeof setTimeout> | null = null

export function collectFormState(): DraftState {
  return {
    projectId: store.form.projectId,
    hardwareName: store.form.hardwareName,
    hardwareType: store.form.hardwareType,
    hardwareVersion: store.form.hardwareVersion,
    designerId: store.form.designerId,
    designerName: store.designerName,
    spec: store.specRows.map(r => ({ key: r.key, value: r.value, note: r.note })),
    filesBatch: store.filesBatch,
    uploadedFiles: store.uploadedFiles.filter(f => f.token).map(({ name, token, size }) => ({ name, token, size })),
    designNotes: store.form.designNotes,
    savedAt: new Date().toISOString(),
  }
}

export function saveDraft(manual = false) {
  const state = collectFormState()
  const hasContent = state.projectId || state.hardwareName || state.designNotes ||
    (state.spec || []).some(r => r.key || r.value) || (state.uploadedFiles || []).length || state.filesBatch
  if (!hasContent && !manual) return
  localStorage.setItem(DRAFT_KEY, JSON.stringify(state))
  store.draftStatus = `草稿已保存 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

export function scheduleDraftSave() {
  if (draftSaveTimer) clearTimeout(draftSaveTimer)
  draftSaveTimer = setTimeout(() => saveDraft(false), 600)
}

export function applyDraft(state: DraftState) {
  store.form.projectId = state.projectId || ''
  store.form.hardwareName = state.hardwareName || ''
  if (state.hardwareType) store.form.hardwareType = state.hardwareType
  store.form.hardwareVersion = state.hardwareVersion || ''
  if (state.designerId) {
    store.form.designerId = state.designerId
    renderDesignerChip(
      state.designerName && state.designerName !== '加载中…' ? state.designerName : personLabel(state.designerId),
      state.designerId === store.currentUser?.open_id ? store.currentUser?.avatar_url : undefined,
    )
  }
  store.specRows = (state.spec || []).map(r => ({ key: r.key, value: r.value, note: r.note }))
  store.filesBatch = state.filesBatch || ''
  store.uploadedFiles = (state.uploadedFiles || []).map(f => ({ ...f }))
  store.form.designNotes = state.designNotes || ''
}

export function checkDraft() {
  let state: DraftState | null = null
  try { state = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') } catch { /* ignore */ }
  if (!state) return
  const hasContent = state.projectId || state.hardwareName || state.designNotes || (state.uploadedFiles || []).length
  if (!hasContent) return
  store.draftTime = state.savedAt ? `（${new Date(state.savedAt).toLocaleString('zh-CN')}）` : ''
  store.draftBanner = true
  store.pendingDraft = state
}

export function restoreDraft() {
  if (store.pendingDraft) applyDraft(store.pendingDraft)
  store.draftBanner = false
}

export function discardDraft() {
  localStorage.removeItem(DRAFT_KEY)
  store.pendingDraft = null
  store.draftBanner = false
}

/* ---------- 字段级校验 ---------- */
export function setFieldError(field: string, msg: string) {
  if (msg) store.fieldErrors[field] = msg
  else delete store.fieldErrors[field]
}

export function validateSubmitForm() {
  const checks: [string, string | number, string][] = [
    ['projectId', store.form.projectId.trim(), '请填写项目编号'],
    ['hardwareName', store.form.hardwareName.trim(), '请填写硬件名称'],
    ['hardwareVersion', store.form.hardwareVersion.trim(), '请填写硬件版本'],
    ['designerId', store.form.designerId.trim(), '请选择设计负责人'],
    ['hardwareFiles', collectHardwareFiles().length, '请至少上传或导入一条硬件资料'],
    ['designNotes', store.form.designNotes.trim(), '请填写设计说明'],
  ]
  let firstBad: string | null = null
  for (const [field, val, msg] of checks) {
    const bad = !val || (typeof val === 'string' && !val.trim())
    setFieldError(field, bad ? msg : '')
    if (bad && !firstBad) firstBad = field
  }
  if (firstBad) {
    const target = firstBad
    nextTick(() => {
      document.querySelector(`.field-error[data-for="${target}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }
  return !firstBad
}

export function onDesignerOverride() {
  const v = store.designerOverride.trim()
  if (v) {
    store.form.designerId = v
    renderDesignerChip(personLabel(v))
  } else if (store.currentUser) {
    store.form.designerId = store.currentUser.open_id
    renderDesignerChip(store.currentUser.name, store.currentUser.avatar_url)
  }
  scheduleDraftSave()
}

/* ---------- 提交评审单 ---------- */
export async function submitReview() {
  if (!validateSubmitForm()) {
    store.submitResult = { text: '请先补全上方标记为必填的内容', ok: false }
    return
  }
  store.submitting = true
  try {
    const data = await api('/api/hardware-review/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: store.form.projectId.trim(),
        hardwareName: store.form.hardwareName.trim(),
        hardwareType: store.form.hardwareType,
        hardwareVersion: store.form.hardwareVersion.trim(),
        designerId: store.form.designerId.trim(),
        hardwareFiles: collectHardwareFiles(),
        designNotes: store.form.designNotes.trim(),
        specification: serializeSpec(),
      }),
    })
    localStorage.removeItem(DRAFT_KEY)
    store.draftStatus = ''
    store.submitResult = { text: `提交成功：${data.reviewId}`, ok: true }
    store.form.projectId = ''
    store.form.hardwareName = ''
    store.form.hardwareType = 'other'
    store.form.hardwareVersion = ''
    store.form.designerId = ''
    store.form.designNotes = ''
    store.designerOverride = ''
    store.filesBatch = ''
    store.uploadedFiles = []
    store.specRows = []
    router('list')
  } catch (err) {
    store.submitResult = { text: '失败：' + errMsg(err), ok: false }
  } finally {
    store.submitting = false
  }
}

/* ---------- 详情与流程操作 ---------- */
export async function loadDetail(reviewId: string) {
  store.detail = null
  store.detailState = 'loading'
  try {
    store.detail = await api(`/api/hardware-review/${reviewId}`)
    store.detailState = 'ok'
  } catch (err) {
    store.detailError = errMsg(err)
    store.detailState = 'error'
  }
}

export interface MeetingForm { startTime: string; durationMinutes: number | string; attendeeOpenIds: string }

export async function scheduleMeeting(reviewId: string, form: MeetingForm) {
  try {
    const data = await api(`/api/hardware-review/${reviewId}/meeting`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        startTime: new Date(form.startTime).toISOString(),
        durationMinutes: Number(form.durationMinutes) || 60,
        attendeeOpenIds: parseOpenIds(form.attendeeOpenIds),
      }),
    })
    alert(`会议已创建：${data.meeting?.meetingLink || 'mock'}`)
    loadDetail(reviewId)
  } catch (err) {
    alert('预约失败：' + errMsg(err))
  }
}

export async function completeRectify(reviewId: string) {
  try {
    await api(`/api/hardware-review/${reviewId}/rectify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    loadDetail(reviewId)
  } catch (err) {
    alert('操作失败：' + errMsg(err))
  }
}

export async function assess(reviewId: string, result: 'pass' | 'fail') {
  try {
    await api(`/api/hardware-review/${reviewId}/assess`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ result }),
    })
    loadDetail(reviewId)
  } catch (err) {
    alert('操作失败：' + errMsg(err))
  }
}

export async function archive(reviewId: string) {
  try {
    await api(`/api/hardware-review/${reviewId}/archive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    loadDetail(reviewId)
  } catch (err) {
    alert('操作失败：' + errMsg(err))
  }
}

export interface MinutesForm {
  meetingTime: string
  attendees: string
  topics: string
  discussion: string
  issues: string
  nextActions: string
  conclusion: string
  conclusionNotes: string
}

export async function saveMinutes(reviewId: string, form: MinutesForm) {
  const actorId = store.currentUser?.open_id || store.detail?.designerId || ''
  const actorRef = { open_id: actorId, ...(store.currentUser?.name ? { name: store.currentUser.name } : {}) }
  const attendees = parseOpenIds(form.attendees).map(open_id => ({ open_id }))
  const issues = parseLines(form.issues).map((desc, i) => ({
    issueId: `ISS-${Date.now()}-${i + 1}`,
    description: desc,
    raisedBy: actorRef,
    status: 'open',
  }))
  const nextActions = parseLines(form.nextActions).map(line => {
    const [action, ownerId, dueDate] = line.split('|').map(s => (s || '').trim())
    return { action, owner: ownerId ? { open_id: ownerId } : actorRef, ...(dueDate ? { dueDate } : {}) }
  })
  await api(`/api/hardware-review/${reviewId}/minutes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      meetingTime: new Date(form.meetingTime).toISOString(),
      discussion: form.discussion,
      attendees,
      topics: parseLines(form.topics),
      issues,
      nextActions,
      conclusion: form.conclusion,
      attachments: [],
    }),
  })
  await api(`/api/hardware-review/${reviewId}/conclusion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      conclusion: form.conclusion,
      ...(form.conclusionNotes ? { notes: form.conclusionNotes } : {}),
      ...(issues.length ? { issues } : {}),
    }),
  })
}

export interface ReportForm { summary: string; checklist: string }

export async function generateReport(reviewId: string, form: ReportForm) {
  const checklist = JSON.parse(form.checklist)
  return api(`/api/hardware-review/${reviewId}/report/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ summary: form.summary, checklist }),
  })
}

// 初始化：当前用户 → 配置探测（失败不阻塞列表加载）→ 列表加载 + 表单预填
export async function initApp() {
  await loadCurrentUser()
  try {
    const cfg = await api('/api/hardware-review/config')
    store.configured = !!cfg.configured
  } catch { /* 配置探测失败时保持横幅隐藏，列表加载照常 */ }
  loadReviews()
  prefillSubmitForm()
}
