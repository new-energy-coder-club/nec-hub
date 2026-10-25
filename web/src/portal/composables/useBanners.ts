// 顶部两条横幅：FE-04 赛季目标 T-7 提醒条 + FE-09 待办聚合条
import { reactive } from 'vue'
import { auth } from '@shared/auth'

// ---- FE-04 赛季目标关键节点 T-7 提醒条 ----
// ✕ 关闭后记住当前内容签名，内容不变时不再弹出；但有目标进入 T-3 以内时强制重弹，避免关键节点被误关丢失
const GOAL_BANNER_DISMISS_KEY = 'nec_goal_banner_dismiss'

export interface GoalItem {
  title: string
  link: string
  group: string
  progress: number | null
  daysLeft: number | null
  overdue: boolean
  done: boolean
  deadline?: number
  kr?: string
  status?: string
}

export const goalBanner = reactive({
  items: [] as GoalItem[],
  /** 存在 late 风险项 → 横幅背景切警示色（与待办条 #B45309 同层级提醒） */
  danger: false,
})

function goalBannerSig(items: GoalItem[]): string {
  return items.map(it => `${it.title}@${it.daysLeft}`).join('|')
}

// ---- 目标风险分级（首页赛季目标 widget 与顶部告警条共用同一口径） ----
// 时间进度 = (now − 当年 1 月 1 日 0 点) / (deadline − 当年 1 月 1 日 0 点)，gap = 时间进度×100 − progress
// gap > 20 → late（红）；> 10 → warn（黄）；否则 ok。已过期（deadline < now）且 progress < 100 直接 late。
// progress 先做 0-1 → 0-100 归一（与 widget 进度条显示同一口径），再钳制 [0,100]。
export type GoalRisk = 'late' | 'warn' | 'ok'

/** 时间基准（0-100）：年初 0 点 → 截止日走完的百分比，与 goalRisk 同一口径，供双条对比与刻度线 */
export function goalTimeProgress(deadlineMs: number): number {
  const yearStart = new Date(new Date().getFullYear(), 0, 1, 0, 0, 0, 0).getTime()
  const span = deadlineMs - yearStart
  // span ≤ 0（截止早于年初的数据异常）：视为时间已走完
  if (span <= 0) return 100
  return Math.min(100, Math.max(0, ((Date.now() - yearStart) / span) * 100))
}

export function goalRisk(deadlineMs: number | null | undefined, progress: number | null | undefined): GoalRisk {
  let p = typeof progress === 'number' && isFinite(progress) ? progress : 0
  if (p > 0 && p <= 1) p = p * 100 // 数据源若给 0-1 小数，统一按百分比量纲
  p = Math.min(Math.max(p, 0), 100)
  if (typeof deadlineMs === 'number' && isFinite(deadlineMs) && deadlineMs < Date.now() && p < 100) return 'late'
  if (typeof deadlineMs !== 'number' || !isFinite(deadlineMs)) return 'ok'
  const gap = goalTimeProgress(deadlineMs) - p
  if (gap > 20) return 'late'
  if (gap > 10) return 'warn'
  return 'ok'
}

/** 由数据看板每次加载后调用：未达标且 0 ≤ 剩余天数 ≤ 7（含逾期）的目标置顶提醒 */
export function renderGoalBanner(g: { configured?: boolean; items?: GoalItem[] } | null) {
  const items = (g && g.configured ? g.items ?? [] : []).filter(it => !it.done && it.daysLeft !== null && it.daysLeft <= 7)
  if (!items.length) { goalBanner.items = []; goalBanner.danger = false; return }
  let dismissed = ''
  try { dismissed = localStorage.getItem(GOAL_BANNER_DISMISS_KEY) || '' } catch { /* ignore */ }
  const hasCritical = items.some(it => (it.daysLeft ?? 99) <= 3)
  if (!hasCritical && dismissed && dismissed === goalBannerSig(items)) { goalBanner.items = []; goalBanner.danger = false; return } // 已关闭且内容未变，保持隐藏
  goalBanner.items = items
  goalBanner.danger = items.some(it => goalRisk(it.deadline, it.progress) === 'late') // 存在 late 项 → 警示红背景
}

export function dismissGoalBanner() {
  try { localStorage.setItem(GOAL_BANNER_DISMISS_KEY, goalBannerSig(goalBanner.items)) } catch { /* ignore */ }
  goalBanner.items = []
  goalBanner.danger = false
}

// ---- FE-09 待办条：聚合逾期任务 / 待确认报销 / 飞书审批 / 本地审批单（GET /api/todos，5 分钟缓存） ----
// G-04：本地审批单（approvals_local）中 urgent=true 的合规单红色高亮 + 「T-1」徽标置顶；有 deadline 的非 urgent 条目显示倒计时
// G-11：✕ 关闭记数据签名到 sessionStorage（同一浏览器会话内，数据变化才重新弹出；跨会话/重开浏览器不继承）。
//       todoBar.data 关掉后仍保留，首页待办卡不参与关闭、继续用 data 计数。
export const TODO_TYPE_LABELS: Record<string, string> = { reimburse: '报销', drawing: '图纸', hardware: '硬件', compliance: '合规' }

const TODO_BAR_HIDDEN_KEY = 'nec_todo_bar_hidden'

export const todoBar = reactive({
  data: null as any,
  expanded: false,
  hidden: false,
})

/** 待办数据签名：条目本身变化（而非仅计数）才触发重弹 */
function todoBarSig(d: any): string {
  if (!d) return ''
  const t = (d.tasks ?? []).map((x: any) => `${x.title}@${x.daysOverdue}`).join(',')
  const f = (d.finance?.items ?? []).map((x: any) => x.name).join(',')
  const a = (d.approvals?.items ?? []).map((x: any) => x.title).join(',')
  const al = (d.approvals_local?.items ?? []).map((x: any) => x.application_id).join(',')
  return `${d.total}|${t}|${f}|${a}|${al}`
}

export async function loadTodos() {
  if (!auth.me.authenticated) { todoBar.data = null; todoBar.hidden = false; return }
  try {
    const resp = await fetch('/api/todos')
    if (!resp.ok) { todoBar.data = null; todoBar.hidden = false; return }
    const d = await resp.json()
    todoBar.data = d && d.total ? d : null
    if (todoBar.data) {
      let prev = ''
      try { prev = sessionStorage.getItem(TODO_BAR_HIDDEN_KEY) || '' } catch { /* ignore */ }
      todoBar.hidden = prev !== '' && prev === todoBarSig(todoBar.data) // 签名未变 → 本会话内保持关闭
    }
  } catch {
    todoBar.data = null
    todoBar.hidden = false
  }
}

export function toggleTodoList() {
  todoBar.expanded = !todoBar.expanded
}

/** 门户内处理完待办后调用：先清服务端 5 分钟缓存再重拉，计数立即刷新 */
export async function refreshTodos() {
  try { await fetch('/api/todos/invalidate', { method: 'POST' }) } catch { /* 缓存清理失败不阻塞重拉 */ }
  await loadTodos()
}

export function hideTodoBar() {
  try { sessionStorage.setItem(TODO_BAR_HIDDEN_KEY, todoBarSig(todoBar.data)) } catch { /* ignore */ }
  todoBar.hidden = true
}

export function todoSummary(): string {
  const d = todoBar.data
  if (!d) return ''
  const t = d.tasks?.length ?? 0
  const f = d.finance?.count ?? 0
  const a = d.approvals?.count ?? 0
  const al = d.approvals_local?.count ?? 0
  const parts: string[] = []
  if (t) parts.push(`逾期任务 ${t}`)
  if (f) parts.push(`待确认报销 ${f}`)
  if (a) parts.push(`飞书审批 ${a}`)
  if (al) parts.push(`审批中 ${al}`)
  return `你有 ${d.total} 项待办（${parts.join(' · ')}），点击展开处理`
}
