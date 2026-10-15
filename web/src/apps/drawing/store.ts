// 机械图纸审批共享状态与业务逻辑：独立入口（/apps/drawing/）与后续门户 Tab 复用同一套
// 端点 / 视图路由 / 驳回重提语义逐条对齐原 public/apps/drawing/index.html
import { reactive } from 'vue'
import { apiMod, type ApiModError } from '@shared/api'

export interface ApprovalRecord {
  application_id: string
  status: string
  url?: string
  fields: Record<string, any>
}

export type ViewName = 'mine' | 'submit' | 'done'

export interface SubmitFormState {
  drawingName: string
  version: string
  mechanism: string
  material: string
  processType: string
  cost: string | number
  urgency: string
  urgentReason: string
  files: string
}

function newForm(): SubmitFormState {
  return {
    drawingName: '',
    version: 'V1.0',
    mechanism: '',
    material: '',
    processType: '自加工',
    cost: '',
    urgency: '常规',
    urgentReason: '',
    files: '',
  }
}

export const store = reactive({
  view: 'mine' as ViewName,
  /** 驳回重提来源记录（沿用图号、版本 +0.1、写前置版本记录） */
  resubmitFrom: null as ApprovalRecord | null,
  mineRecords: [] as ApprovalRecord[],
  mineState: 'idle' as 'idle' | 'loading' | 'error',
  mineError: '',
  doneAppId: '',
  /** 流程未配置（提交报「未配置」或 mine 接口返回 hint 时置位） */
  notConfigured: false,
  form: newForm(),
  formErrors: [] as string[],
  submitting: false,
  submitError: '',
  drawingNoPreview: '',
})

/* ========== 状态徽章 ========== */

const STATUS_STYLE: Record<string, string> = {
  '审批中': 'background:#E8ECFB;color:#1A2FA0',
  '已通过': 'background:#E3F6EC;color:#177A4C',
  '已驳回': 'background:#FDECEC;color:#B02323',
  '加工中': 'background:#FFF4DB;color:#92610B',
  '已归档': 'background:#EEF1F8;color:#5A6472',
  '已撤销': 'background:#EEF1F8;color:#5A6472',
}
const FALLBACK_STATUS_STYLE = 'background:#EEF1F8;color:#5A6472'
export function statusStyle(s: string): string { return STATUS_STYLE[s] || FALLBACK_STATUS_STYLE }

export function fmtTime(ts: unknown): string {
  const n = Number(ts)
  return n ? new Date(n).toLocaleString('zh-CN', { hour12: false }) : ''
}

/* ========== 视图路由 ========== */

export function router(view: ViewName) {
  store.view = view
  if (view === 'mine') loadMine()
}

/* ========== 提交表单 ========== */

export function drawingNoPreviewText(): string {
  return store.resubmitFrom
    ? `${store.resubmitFrom.fields['图号']}（沿用）`
    : `MECH-${new Date().getFullYear()}-提交后分配`
}

export function resetForm() {
  store.resubmitFrom = null
  store.form = newForm()
  store.formErrors = []
  store.submitError = ''
  store.drawingNoPreview = drawingNoPreviewText()
}

export function bumpVersion(v: unknown): string {
  const m = String(v || '').trim().match(/^V?(\d+)\.(\d+)$/i)
  if (m) return `V${m[1]}.${Number(m[2]) + 1}`
  return String(v || 'V1.0') + '.1'
}

export function startResubmit(rec: ApprovalRecord) {
  store.resubmitFrom = rec
  const f = rec.fields
  store.form = {
    drawingName: f['图纸名称'] || '',
    version: bumpVersion(f['版本']),
    mechanism: f['所属机构'] || '',
    material: f['材料与工艺'] || '',
    processType: f['加工方式'] || '自加工',
    cost: f['预估加工费'] || '',
    urgency: '常规',
    urgentReason: '',
    files: f['图纸文件'] || '',
  }
  store.formErrors = []
  store.submitError = ''
  store.drawingNoPreview = drawingNoPreviewText()
  router('submit')
}

export function cancelResubmit() {
  resetForm()
}

export function validateForm(): { errors: string[]; files: string[] } {
  const errors: string[] = []
  const form = store.form
  const files = form.files.split('\n').map(s => s.trim()).filter(Boolean)
  if (!form.drawingName.trim()) errors.push('图纸名称')
  if (!form.version.trim()) errors.push('版本')
  if (!form.mechanism) errors.push('所属机构')
  if (!form.material.trim()) errors.push('材料与工艺')
  if (form.processType === '外协加工') {
    const cost = Number(form.cost)
    if (!form.cost || !(cost > 0)) errors.push('预估加工费（外协必填，须大于 0）')
  }
  if (form.urgency === '加急' && !form.urgentReason.trim()) errors.push('加急原因')
  if (!files.length) errors.push('图纸文件（至少 1 个）')
  return { errors, files }
}

/** 提交；返回是否有表单错误需要滚动定位 */
export async function submitDrawing(): Promise<'ok' | 'invalid' | 'failed'> {
  store.formErrors = []
  const { errors, files } = validateForm()
  if (errors.length) {
    store.formErrors = errors
    return 'invalid'
  }
  const form = store.form
  const fields: Record<string, any> = {
    图纸名称: form.drawingName.trim(),
    图号: store.resubmitFrom ? store.resubmitFrom.fields['图号'] : '@appId',
    版本: form.version.trim(),
    所属机构: form.mechanism,
    材料与工艺: form.material.trim(),
    加工方式: form.processType,
    图纸文件: files.join('、'),
    紧急程度: form.urgency,
  }
  if (form.processType === '外协加工') fields['预估加工费'] = Number(form.cost)
  if (form.urgency === '加急') fields['加急原因'] = form.urgentReason.trim()
  if (store.resubmitFrom) {
    fields['前置版本记录'] = `${store.resubmitFrom.application_id} · ${store.resubmitFrom.fields['版本'] || ''}（已驳回）`
  }

  store.submitting = true
  try {
    const data = await apiMod('', '/api/approvals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'drawing', fields }),
    })
    store.doneAppId = data.application_id
    router('done')
    return 'ok'
  } catch (e) {
    const err = e as ApiModError
    if (err.status === 403) {
      // 403（非机械组等权限拒绝）走表单错误区展示，文案取后端 hint
      store.formErrors = [err.hint || err.message]
      return 'invalid'
    }
    if (/未配置/.test(err.message)) store.notConfigured = true
    store.submitError = '提交失败：' + err.message
    return 'failed'
  } finally {
    store.submitting = false
  }
}

/* ========== 我的申请 ========== */

export async function loadMine() {
  store.mineState = 'loading'
  store.mineError = ''
  try {
    const data = await apiMod('', '/api/approvals/mine?type=drawing')
    if (data.hint) store.notConfigured = true
    store.mineRecords = data.records || []
    store.mineState = 'idle'
  } catch (e) {
    store.mineState = 'error'
    store.mineError = (e as Error).message
  }
}

export async function doAction(appId: string, action: 'start' | 'archive') {
  const label = action === 'start' ? '开始加工' : '归档'
  try {
    await apiMod('', `/api/approvals/drawing/${encodeURIComponent(appId)}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    loadMine()
  } catch (e) {
    alert(`${label}失败：` + (e as Error).message)
  }
}
