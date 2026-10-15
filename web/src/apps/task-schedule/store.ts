// 任务排期（Taskto 地铁线路图 Todo）共享状态与工具：独立入口（/apps/task-schedule/）与门户 Tab 复用同一套
// 纯本地应用：无 fetch 端点、无登录门控，持久化分两处：
//   lines/tasks → localStorage「nec-taskto-v1」（与原 public/apps/task-schedule/index.html 对齐，导出/导入 schema 不变）
//   UI 偏好（白底/左侧视图）→ localStorage「nec-taskto-ui-v1」，与数据互不混写
import { reactive, computed } from 'vue'

export interface TaskLine { id: string; name: string; color: string }
export interface TaskItem { id: string; title: string; date: string; line: string; done: boolean; note: string }
export interface UiPref { whiteBg: boolean; leftView: 'metro' | 'git' }

export const LS_KEY = 'nec-taskto-v1'
export const UI_KEY = 'nec-taskto-ui-v1'

export const DEFAULT_DATA: { lines: TaskLine[]; tasks: TaskItem[] } = {
  lines: [
    { id: 'main', name: '论文主线', color: '#3b82f6' },
    { id: 'doc',  name: '文档',     color: '#ef4444' },
    { id: 'exp',  name: '实验',     color: '#facc15' },
  ],
  tasks: [
    { id: 't1',  title: 'Write Literature Review',        date: '2025-03-04T17:35', line: 'main', done: false, note: '' },
    { id: 't2',  title: 'Read Literature',                date: '2025-03-04T17:37', line: 'main', done: true,  note: '' },
    { id: 't3',  title: 'Design Experiment Plan',         date: '2025-03-04T17:37', line: 'main', done: false, note: '' },
    { id: 't4',  title: 'Organize Literature Comparison', date: '2025-03-04T17:38', line: 'doc',  done: true,  note: '' },
    { id: 't5',  title: 'Doc Done',                       date: '2025-03-04T17:43', line: 'doc',  done: true,  note: '' },
    { id: 't6',  title: 'Collect Experimental Data',      date: '2025-03-04T17:39', line: 'exp',  done: false, note: '' },
    { id: 't7',  title: 'Analyze Experimental Results',   date: '2025-03-04T17:39', line: 'exp',  done: false, note: '' },
    { id: 't8',  title: 'Experiment Done',                date: '2025-03-04T17:43', line: 'main', done: true,  note: '' },
    { id: 't9',  title: 'Compete the paper',              date: '2025-03-04T17:40', line: 'main', done: false, note: '' },
    { id: 't10', title: 'Submit Paper',                   date: '2025-03-04T17:40', line: 'main', done: false, note: '' },
  ],
}

function load(): { lines: TaskLine[]; tasks: TaskItem[] } {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const d = JSON.parse(raw)
      if (d && Array.isArray(d.tasks) && Array.isArray(d.lines)) return d
    }
  } catch { /* ignore */ }
  return structuredClone(DEFAULT_DATA)
}

// UI 偏好读取：逐字段校验，任何异常回退默认值（白底关闭、左侧地铁图）
function loadUi(): UiPref {
  const d: UiPref = { whiteBg: false, leftView: 'metro' }
  try {
    const raw = localStorage.getItem(UI_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (p && typeof p.whiteBg === 'boolean') d.whiteBg = p.whiteBg
      if (p && (p.leftView === 'metro' || p.leftView === 'git')) d.leftView = p.leftView
    }
  } catch { /* ignore */ }
  return d
}

export const store = reactive({
  ...load(),
  filter: 'all',
  expandedId: null as string | null,
  mapVisible: true,
  statOpen: false,
  ...loadUi(),
})

// 只持久化 lines/tasks（与原 state 结构一致，UI 状态不落盘）
export function save() { localStorage.setItem(LS_KEY, JSON.stringify({ lines: store.lines, tasks: store.tasks })) }

// UI 偏好单独落盘，不触碰 lines/tasks 的保存行为与导出 schema
export function saveUi() { localStorage.setItem(UI_KEY, JSON.stringify({ whiteBg: store.whiteBg, leftView: store.leftView })) }

export function resetToDefault() {
  const d = structuredClone(DEFAULT_DATA)
  store.lines = d.lines
  store.tasks = d.tasks
}

export const uid = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

export const lineOf = (id: string) => store.lines.find(l => l.id === id) || store.lines[0]

export function fmtDate(iso: string) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const mon = d.toLocaleString('en-US', { month: 'short' })
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${mon} ${d.getDate()}, ${d.getFullYear()} at ${hh}:${mm}`
}

export const visibleTasks = computed(() => store.tasks.filter(t => {
  if (store.filter === 'all') return true
  if (store.filter === 'todo') return !t.done
  if (store.filter === 'done') return t.done
  if (store.filter.startsWith('line:')) return t.line === store.filter.slice(5)
  return true
}))