// 硬件评审：列表 / 提交 / 详情与流程操作（会议、整改、评估、归档、纪要、报告）
import { toast } from '@shared/ui/feedback'
import {
  api, errMsg, parseLines, parseOpenIds,
  type MeetingForm, type MinutesForm, type ReportForm,
} from './meta'
import { store } from './state'
import { prefillSubmitForm, loadCurrentUser, validateSubmitForm, collectHardwareFiles, serializeSpec } from './form'
import { checkDraft, clearDraft } from './draft'

export function router(view: 'list' | 'submit' | 'detail', id?: string) {
  store.view = view
  if (view === 'list') loadReviews()
  if (view === 'submit') { prefillSubmitForm(); checkDraft() }
  if (view === 'detail' && id) loadDetail(id)
}

export async function loadReviews(silent = false) {
  try {
    store.reviews = await api('/api/hardware-review')
    store.listState = 'ok'
  } catch (err) {
    // 后台轮询失败时保留旧数据与 ok 状态，不打断浏览
    if (silent && store.listState === 'ok') return
    const msg = errMsg(err)
    store.listState = /尚未配置/.test(msg) ? 'unconfigured' : 'error'
    store.listError = msg
  }
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
    clearDraft()
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
    toast(`会议已创建：${data.meeting?.meetingLink || 'mock'}`)
    loadDetail(reviewId)
  } catch (err) {
    toast('预约失败：' + errMsg(err))
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
    toast('操作失败：' + errMsg(err))
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
    toast('操作失败：' + errMsg(err))
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
    toast('操作失败：' + errMsg(err))
  }
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
