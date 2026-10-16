// 报销助手：草稿（localStorage，400ms 防抖走 shared useDraft；空内容时删除旧草稿）
import { watch } from 'vue'
import { useDraft } from '@shared/composables/useDraft'
import { newLine } from './types'
import { store } from './state'

const DRAFT_KEY = 'nec_reimburse_erp_draft'

interface ReimburseDraft { lines: any[]; noinv: string; note: string; savedAt: number }

const draft = useDraft<ReimburseDraft>(DRAFT_KEY, {
  delay: 400,
  removeWhenEmpty: true,
  collect: () => ({ lines: store.lines, noinv: store.noinv, note: store.note, savedAt: Date.now() }),
  hasContent: d => store.lines.some(l => l.cat || l.item || l.amount) || !!d.noinv || !!d.note,
})

export function queueDraft() {
  draft.schedule()
}
export function saveDraftNow() {
  queueDraft()
  store.submitStatus = '💾 草稿已保存到浏览器本地'
}
export function restoreDraft() {
  const d = draft.read()
  if (!d) return
  if (Array.isArray(d.lines) && d.lines.length) store.lines = d.lines.map((l: any) => Object.assign(newLine(), l))
  if (d.noinv) store.noinv = d.noinv
  if (d.note) store.note = d.note
  if (d.lines || d.noinv || d.note) {
    store.submitStatus = '📝 已恢复 ' + new Date(d.savedAt).toLocaleString('zh-CN') + ' 的未提交草稿（附件需重新上传）'
  }
}
export function clearDraft() {
  draft.clear()
}

watch(() => [store.lines, store.noinv, store.note], queueDraft, { deep: true })
