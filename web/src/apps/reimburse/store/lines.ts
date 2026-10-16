// 报销助手：明细行编辑与费用项目选择弹窗
import { computed } from 'vue'
import { toast } from '@shared/ui/feedback'
import { newLine, validAmount } from './types'
import { store } from './state'

export const lineTotal = computed(() => store.lines.reduce((s, l) => s + (validAmount(l.amount) ? Number(l.amount) : 0), 0))

export function addLine() {
  store.lines.push(newLine())
  store.selected = store.lines.length - 1
}

export function delLines(checked: number[]) {
  const drop = new Set(checked.length ? checked : [store.selected])
  if (store.lines.length - drop.size < 1) { toast('至少保留一行明细'); return }
  store.lines = store.lines.filter((_, i) => !drop.has(i))
  store.selected = Math.min(store.selected, store.lines.length - 1)
}

export function selectLine(i: number) { store.selected = i }

/* ========== 费用项目选择弹窗 ========== */

export function openCatModal(row: number) {
  store.selected = row
  store.catModal.temp = store.lines[row] ? store.lines[row].cat : ''
  store.catModal.search = ''
  if (!store.catalog.some(g => g.group === store.catModal.group)) store.catModal.group = store.catalog[0].group
  store.catModal.open = true
}
export function closeCatModal() { store.catModal.open = false }
export function pickCat(v: string) { store.catModal.temp = v }
export function confirmCat() {
  if (store.catModal.temp && store.lines[store.selected]) store.lines[store.selected].cat = store.catModal.temp
  closeCatModal()
}
