// 赛季目标管理：状态与 API（自 public/apps/season-goals/index.html 原生 JS 逐行迁移）
import { reactive } from 'vue'

export type ViewName = 'submit' | 'collect' | 'goals' | 'plan'

export interface CollectItem {
  recordId: string
  submitter?: string
  title: string
  krs?: string
  group: string
  deadline?: string
  source?: string
  status: string
}

export interface GoalItem {
  title: string
  group: string
  deadline?: string
  status: string
  progress: number
  krs?: string
  done: boolean
  overdue: boolean
  pct: number
}

export interface PlanSuggestion {
  title: string
  deadline: string
  krs: string
  basedOnTasks: string[]
}

export interface PlanData {
  taskCount: number
  generatedAt: string | number
  suggestions: PlanSuggestion[]
  skipped: { group: string; reason: string }[]
}

export const statusMap: Record<string, string> = {
  待评审: 'bg-[#E8ECFB] text-[#1A2FA0]',
  已采纳: 'bg-green-50 text-green-700',
  已拒绝: 'bg-gray-100 text-gray-500',
  进行中: 'bg-yellow-50 text-yellow-700',
  已完成: 'bg-green-50 text-green-700',
}

export function statusColor(status: string): string {
  return statusMap[status] || 'bg-gray-100 text-gray-700'
}

export const store = reactive({
  view: 'submit' as ViewName,
  notConfigured: false,
  collect: { items: null as CollectItem[] | null, error: '' },
  goals: { items: null as GoalItem[] | null, error: '' },
  plan: { phase: 'idle' as 'idle' | 'loading' | 'done' | 'error', error: '', data: null as PlanData | null },
  applyDisabled: true,
  toast: { msg: '', ok: true, visible: false },
})

export const submit = reactive({
  title: '',
  krs: '',
  group: '硬件组',
  deadline: '',
  note: '',
  result: '',
  resultOk: false,
})

// 与原 api() 一致：401 回门户走飞书 OAuth 登录，非 2xx 抛出后端 error 文案
async function api(path: string, options: RequestInit = {}) {
  const res = await fetch(path, options)
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) {
    location.href = '/'
    throw new Error('请先登录')
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

let toastTimer: number | undefined
export function toast(msg: string, ok = true) {
  store.toast.msg = msg
  store.toast.ok = ok
  store.toast.visible = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { store.toast.visible = false }, 3000)
}

export function router(view: ViewName) {
  store.view = view
  if (view === 'collect') loadCollect()
  if (view === 'goals') loadGoals()
}

// ---------- 收集单 ----------

export async function loadCollect() {
  try {
    const data: CollectItem[] = await api('/api/season-goals/collect')
    store.collect.items = data
    store.collect.error = ''
  } catch (err) {
    store.collect.error = (err as Error).message
  }
}

export async function approve(recordId: string) {
  try {
    await api('/api/season-goals/collect/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recordId }),
    })
    toast('已采纳，目标已创建')
    loadCollect()
  } catch (err) {
    toast('采纳失败：' + (err as Error).message, false)
  }
}

export async function reject(recordId: string) {
  try {
    await api('/api/season-goals/collect/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recordId }),
    })
    toast('已拒绝')
    loadCollect()
  } catch (err) {
    toast('拒绝失败：' + (err as Error).message, false)
  }
}

// ---------- 目标看板 ----------

const DONE_RE = /完成|达成|达标|done|close/i

export async function loadGoals() {
  try {
    const data: Omit<GoalItem, 'done' | 'overdue' | 'pct'>[] = await api('/api/season-goals/goals')
    const today = new Date().toISOString().slice(0, 10)
    store.goals.items = data.map(g => {
      const done = DONE_RE.test(g.status) || g.progress >= 100
      const overdue = !done && !!g.deadline && g.deadline < today
      const pct = Math.min(Math.max(g.progress, 0), 100)
      return { ...g, done, overdue, pct }
    })
    store.goals.error = ''
  } catch (err) {
    store.goals.error = (err as Error).message
  }
}

// ---------- 自动规划 ----------

export async function previewPlan() {
  store.plan.phase = 'loading'
  store.applyDisabled = true
  try {
    const data: PlanData = await api('/api/season-goals/plan')
    store.plan.data = data
    store.plan.phase = 'done'
    store.applyDisabled = !data.suggestions.length
  } catch (err) {
    store.plan.error = (err as Error).message
    store.plan.phase = 'error'
  }
}

export function fmtGeneratedAt(v: string | number): string {
  return new Date(v).toLocaleString()
}

export async function applyPlan() {
  try {
    const data = await api('/api/season-goals/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    toast(`已生成 ${data.created} 条草稿到收集单`)
    router('collect')
  } catch (err) {
    toast('生成失败：' + (err as Error).message, false)
  }
}

// ---------- 提交表单 ----------

export async function submitGoal() {
  try {
    await api('/api/season-goals/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: submit.title,
        krs: submit.krs,
        group: submit.group,
        deadline: submit.deadline,
        note: submit.note,
      }),
    })
    submit.resultOk = true
    submit.result = '提交成功，等待评审采纳'
    toast('提交成功')
    submit.title = ''
    submit.krs = ''
    submit.group = '硬件组'
    submit.deadline = ''
    submit.note = ''
    router('collect')
  } catch (err) {
    submit.resultOk = false
    submit.result = '失败：' + (err as Error).message
    toast('提交失败：' + (err as Error).message, false)
  }
}

export async function init() {
  try {
    const cfg = await api('/api/season-goals/config')
    if (!cfg.configured) store.notConfigured = true
  } catch { /* 配置探测失败不阻塞页面 */ }
  router('submit')
}
