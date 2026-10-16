// 硬件评审：提交表单域——预填、规格参数编辑器、资料上传、设计说明模板、字段级校验
import { nextTick } from 'vue'
import { confirmDialog } from '@shared/ui/feedback'
import { api, errMsg, SPEC_TEMPLATES, parseLines } from './meta'
import { store } from './state'
import { scheduleDraftSave } from './draft'

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

export async function applySpecTemplate() {
  const keys = SPEC_TEMPLATES[store.form.hardwareType] || []
  if (!keys.length) { addSpecRow(); return }
  if (!specRowsEmpty() && !(await confirmDialog('已有参数行，仍要追加类型模板吗？'))) return
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
