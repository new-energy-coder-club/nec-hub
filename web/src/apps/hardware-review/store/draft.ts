// 硬件评审：草稿（localStorage 自动保存 + 恢复，600ms 防抖走 shared useDraft）
import { useDraft } from '@shared/composables/useDraft'
import { DRAFT_KEY, type DraftState } from './meta'
import { store } from './state'
import { personLabel, renderDesignerChip } from './form'

function draftHasContent(state: DraftState) {
  return !!(state.projectId || state.hardwareName || state.designNotes ||
    (state.spec || []).some(r => r.key || r.value) || (state.uploadedFiles || []).length || state.filesBatch)
}

const draft = useDraft<DraftState>(DRAFT_KEY, {
  collect: collectFormState,
  hasContent: draftHasContent,
  delay: 600,
  onSaved: () => {
    store.draftStatus = `草稿已保存 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
  },
})

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
  draft.saveNow(manual)
}

export function scheduleDraftSave() {
  draft.schedule()
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
  const state = draft.read()
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
  draft.clear()
  store.pendingDraft = null
  store.draftBanner = false
}

export function clearDraft() {
  draft.clear()
}
