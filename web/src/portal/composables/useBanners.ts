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
})

function goalBannerSig(items: GoalItem[]): string {
  return items.map(it => `${it.title}@${it.daysLeft}`).join('|')
}

/** 由数据看板每次加载后调用：未达标且 0 ≤ 剩余天数 ≤ 7（含逾期）的目标置顶提醒 */
export function renderGoalBanner(g: { configured?: boolean; items?: GoalItem[] } | null) {
  const items = (g && g.configured ? g.items ?? [] : []).filter(it => !it.done && it.daysLeft !== null && it.daysLeft <= 7)
  if (!items.length) { goalBanner.items = []; return }
  let dismissed = ''
  try { dismissed = localStorage.getItem(GOAL_BANNER_DISMISS_KEY) || '' } catch { /* ignore */ }
  const hasCritical = items.some(it => (it.daysLeft ?? 99) <= 3)
  if (!hasCritical && dismissed && dismissed === goalBannerSig(items)) { goalBanner.items = []; return } // 已关闭且内容未变，保持隐藏
  goalBanner.items = items
}

export function dismissGoalBanner() {
  try { localStorage.setItem(GOAL_BANNER_DISMISS_KEY, goalBannerSig(goalBanner.items)) } catch { /* ignore */ }
  goalBanner.items = []
}

// ---- FE-09 待办条：聚合逾期任务 / 待确认报销 / 飞书审批 / 本地审批单（GET /api/todos，5 分钟缓存） ----
// G-04：本地审批单（approvals_local）中 urgent=true 的合规单红色高亮 + 「T-1」徽标置顶；有 deadline 的非 urgent 条目显示倒计时
export const TODO_TYPE_LABELS: Record<string, string> = { reimburse: '报销', drawing: '图纸', hardware: '硬件', compliance: '合规' }

export const todoBar = reactive({
  data: null as any,
  expanded: false,
})

export async function loadTodos() {
  if (!auth.me.authenticated) { todoBar.data = null; return }
  try {
    const resp = await fetch('/api/todos')
    if (!resp.ok) { todoBar.data = null; return }
    const d = await resp.json()
    todoBar.data = d && d.total ? d : null
  } catch {
    todoBar.data = null
  }
}

export function toggleTodoList() {
  todoBar.expanded = !todoBar.expanded
}

export function hideTodoBar() {
  todoBar.data = null
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
