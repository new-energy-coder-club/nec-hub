<script setup lang="ts">
// FE-06/07 我的首页：白名单组件按布局配置渲染（个人 > 组 > 全员默认）
// 首页升级：待办卡行（#3）、团队动态去重/全文/兜底链接（#4）、两栏信息密度（#6）、
// 编辑布局文案 + 拖拽排序（#8）、新人一次性引导（#12）、widget 跳转注入（homeGoto）。
import { ref, computed, watch, onMounted, provide, reactive, type Component } from 'vue'

const emit = defineEmits<{ (e: 'goto', tab: string): void }>()
import { auth } from '@shared/auth'
import { HOME_PROMPT } from '@shared/prompts'
import { copyText } from '@shared/api'
import { todoBar, loadTodos } from '@portal/composables/useBanners'
import { toast, confirmDialog } from '@shared/ui/feedback'
import HomeWidgetApps from './home/HomeWidgetApps.vue'
import HomeWidgetTasks from './home/HomeWidgetTasks.vue'
import HomeWidgetReimburse from './home/HomeWidgetReimburse.vue'
import HomeWidgetDocs from './home/HomeWidgetDocs.vue'
import HomeWidgetGoals from './home/HomeWidgetGoals.vue'
import HomeWidgetInventory from './home/HomeWidgetInventory.vue'

export interface SharedLoader { load(name: string): Promise<any> }

const HOME_WIDGET_DEFS: Record<string, { title: string; comp: Component }> = {
  'my-apps': { title: '我的应用快捷区', comp: HomeWidgetApps },
  'my-tasks': { title: '我的任务', comp: HomeWidgetTasks },
  'my-reimburse': { title: '我的报销状态', comp: HomeWidgetReimburse },
  'docs': { title: '常用资料', comp: HomeWidgetDocs },
  'goals': { title: '赛季目标', comp: HomeWidgetGoals },
  'inventory': { title: '物资查询', comp: HomeWidgetInventory },
}
const HOME_SOURCE_LABEL: Record<string, string> = { personal: '个人定制', group: '组默认', default: '全员默认' }

interface HomeWidget { id: string; title?: string }

const widgets = ref<HomeWidget[]>([])
const homeLoading = ref(true)
const source = ref('default')
const group = ref('')
const freshNote = ref('')
const showPrompt = ref(false)
let cachedDefaultWidgets: HomeWidget[] = []
let homeLoadSeq = 0
// 同一次渲染内共享数据请求，避免多组件重复拉同一接口
const shared = ref<SharedLoader>(createShared())

function filterHomeWidgets(raw: unknown): HomeWidget[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((w: any) => w && typeof w.id === 'string' && HOME_WIDGET_DEFS[w.id])
}

function createShared(): SharedLoader {
  const cache: Record<string, Promise<any>> = {}
  return {
    load(name: string) {
      if (!cache[name]) cache[name] = fetch('/api/' + name).then(r => r.ok ? r.json() : null).catch(() => null)
      return cache[name]
    },
  }
}

/** widget 内跳转 Tab 的注入口：与 App.vue 的 @goto=switchTab 同链路（useTabs 会自动展开「更多」分组） */
provide('homeGoto', (tab: string) => emit('goto', tab))

/** 副标题补充数据新鲜度：「全员默认 · 任务同步于 x 分钟前」（dashboard 各表带 cachedAt）。
 *  任务 widget 的「刷新」会再次注入，因此这里允许覆盖（移除原「只写一次」守卫）。 */
function noteHomeFreshness(d: any) {
  const at = d?.tasks?.cachedAt
  if (!at) return
  const t = new Date(at).getTime()
  if (!isFinite(t)) return
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
  freshNote.value = ` · 任务同步于 ${mins < 1 ? '刚刚' : mins + ' 分钟前'}`
}
provide('noteHomeFreshness', noteHomeFreshness)

const sourceLabel = computed(() => {
  const base = `（${HOME_SOURCE_LABEL[source.value] || source.value}${source.value === 'group' && group.value ? ' · ' + group.value : ''}${freshNote.value}）`
  return base
})

async function loadHome() {
  const seq = ++homeLoadSeq
  homeLoading.value = true
  let list = cachedDefaultWidgets.slice()
  let src = 'default', grp = ''
  let resolved = false
  if (auth.me.authenticated) {
    try {
      const resp = await fetch('/api/home')
      const d = await resp.json().catch(() => null)
      if (resp.ok && d) {
        const defaults = filterHomeWidgets(d.defaults?.widgets)
        if (defaults.length) cachedDefaultWidgets = defaults
        const wl = filterHomeWidgets(d.layout?.widgets)
        if (wl.length) list = wl
        else if (defaults.length) list = defaults
        src = d.source || 'default'
        grp = d.group || ''
        resolved = true
      }
    } catch { /* 布局读取失败时继续尝试后端默认布局 */ }
  }
  // 未登录或生效布局读取失败时，仍展示后端默认布局，不在前端复制默认清单。
  if (!resolved && !list.length) {
    try {
      const resp = await fetch('/api/home/defaults')
      if (resp.ok) {
        const d = await resp.json()
        const defaults = filterHomeWidgets(d.defaults?.widgets)
        if (defaults.length) {
          cachedDefaultWidgets = defaults
          list = defaults
        }
      }
    } catch { /* 默认布局读取失败时保留空态，避免渲染未知组件 */ }
  }
  if (seq !== homeLoadSeq) return
  freshNote.value = ''
  source.value = src
  group.value = grp
  widgets.value = list
  shared.value = createShared()
  homeLoading.value = false
}

async function resetHome() {
  if (!(await confirmDialog('恢复默认首页？你的个人布局将被删除（回落到组默认/全员默认）。'))) return
  try {
    const resp = await fetch('/api/home/reset', { method: 'POST' })
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    await loadHome()
  } catch (e: any) {
    toast('恢复默认失败：' + (e.message || e))
  }
}

/** 悬停「移除」：从当前布局去掉该组件并写入个人布局（POST /api/home） */
async function removeHomeWidget(i: number) {
  const w = widgets.value[i]
  if (!w) return
  const rest = widgets.value.filter((_, j) => j !== i)
  if (!rest.length) { toast('至少保留一个组件。'); return }
  try {
    const resp = await fetch('/api/home', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ widgets: rest.map(x => ({ id: x.id })) }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok || data.error) throw new Error(data.error || ('HTTP ' + resp.status))
    await loadHome()
  } catch (e: any) {
    toast('移除失败：' + (e.message || e))
  }
}

// ---- #8 拖拽排序：卡片手柄（⠿）可拖，dragover 本地预览重排；drop 松手后 POST /api/home 保存 ----
const dragIdx = ref(-1)
let reordered = false // 本次拖拽是否发生过重排（与 drop/dragend 收口）
function onDragStart(i: number, ev: DragEvent) {
  if (!auth.me.authenticated) { ev.preventDefault(); return } // 未登录不可拖（后端 401）
  dragIdx.value = i
  reordered = false
  ev.dataTransfer!.effectAllowed = 'move'
}
function onDragOver(i: number, ev: DragEvent) {
  ev.preventDefault()
  const from = dragIdx.value
  if (from < 0 || from === i) return
  const arr = widgets.value.slice()
  const [moved] = arr.splice(from, 1)
  arr.splice(i, 0, moved)
  widgets.value = arr
  dragIdx.value = i
  reordered = true
}
function onCardDrop(ev: DragEvent) {
  ev.preventDefault()
  const was = dragIdx.value
  dragIdx.value = -1
  if (was >= 0 && reordered) saveHomeOrder()
}
function onDragEnd() {
  if (dragIdx.value >= 0 && reordered) {
    // 拖到卡片外松手：不落 drop，本地预览的调整作废，回滚服务器顺序
    dragIdx.value = -1
    reordered = false
    loadHome()
  } else {
    dragIdx.value = -1
  }
}
async function saveHomeOrder() {
  try {
    const resp = await fetch('/api/home', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ widgets: widgets.value.map(x => ({ id: x.id })) }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok || data.error) throw new Error(data.error || ('HTTP ' + resp.status))
  } catch (e: any) {
    toast('排序保存失败：' + (e.message || e) + '，已恢复原顺序')
  }
  reordered = false
  await loadHome()
}

// ---- #3 待办卡行：告警条之下、团队动态之上（未登录隐藏，接口失败静默 0） ----
// 口径：
//   待审批 = /api/todos 里飞书审批 count + 本地审批单 count（都是「待我处理」的单，见 src/todos.ts）；
//   待评审 = 本地审批底表中 type 为 drawing / hardware 且审批中的单（对应图纸评审/硬件评审两个 Tab，点击进图纸评审）；
//   我的任务 = /api/my-tasks 未完成任务数（completedAt 为空；含无截止时间的任务；未绑定飞书任务为 0）；
//   报销中 = /api/erp/reimburse/docs/mine 里状态仍为审批中的单（D1 快照口径）；请求失败回落 todoBar.data.finance.count。
const todoCards = reactive({ approval: 0, review: 0, tasks: 0, reimburse: 0 })

const ERPS_STATUS_PENDING_RE = /审批中|待确认|待审核|待处理|进行中/

function applyTodoCounts() {
  const d = todoBar.data
  if (!d) return
  todoCards.approval = (d.approvals?.count ?? 0) + (d.approvals_local?.count ?? 0)
  todoCards.review = (d.approvals_local?.items ?? []).filter((x: any) => x.type === 'drawing' || x.type === 'hardware').length
}

async function loadMyTasksCount() {
  try {
    const resp = await fetch('/api/my-tasks')
    if (!resp.ok) return
    const d = await resp.json()
    todoCards.tasks = d.bound ? (d.tasks ?? []).filter((t: any) => !t.completedAt).length : 0
  } catch { /* 静默 0 */ }
}

async function loadReimburseCount() {
  try {
    const resp = await fetch('/api/erp/reimburse/docs/mine')
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    const d = await resp.json()
    todoCards.reimburse = (d.docs ?? []).filter((x: any) => ERPS_STATUS_PENDING_RE.test(String(x.status ?? ''))).length
  } catch {
    todoCards.reimburse = todoBar.data?.finance?.count ?? 0
  }
}

async function loadTodoCards() {
  if (!auth.me.authenticated) {
    todoCards.approval = todoCards.review = todoCards.tasks = todoCards.reimburse = 0
    return
  }
  if (!todoBar.data) await loadTodos() // App 挂载时也在拉，多数情况已就绪
  applyTodoCounts()
  void loadMyTasksCount()
  void loadReimburseCount()
}

// ---- #4 团队动态窄条：最近 git 提交（来自 GitHub webhook 落 KV，GET /api/prd 的 recentCommits） ----
// 后端条目为 { repo, branch, message, author, url, at }（无 sha/id 字段，见 src/prd.ts），按 url 唯一去重；
// 历史不同分支的同一条提交合并为「N 分支」徽章（title 列出分支名）；最多 4 条，保持接口时间倒序。
const commits = ref<any[]>([])
const COMMIT_FALLBACK_BASE = 'https://github.com/new-energy-coder-club/nec-hub/commit/'
function fmtAt(v: any): string {
  const t = new Date(v)
  return isNaN(t.getTime()) ? '' : t.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function commitKey(c: any): string {
  return String(c.sha || c.id || c.url || `${c.message}|${c.at || ''}`)
}
/** 有 url 直接跳；无 url 但有 sha 时用 GitHub commit 页兜底 */
function commitHref(c: any): string {
  if (c.url) return c.url
  if (c.sha) return COMMIT_FALLBACK_BASE + c.sha
  return ''
}
async function loadHomeActivity() {
  try {
    const resp = await fetch('/api/prd')
    if (!resp.ok) return
    const b = await resp.json()
    const raw = Array.isArray(b.recentCommits) && b.recentCommits.length
      ? b.recentCommits
      : b.lastCommit ? [b.lastCommit] : []
    const map = new Map<string, any>()
    for (const c of raw) {
      const key = commitKey(c)
      const ex = map.get(key)
      if (ex) {
        const br = String(c.branch || 'main')
        if (!ex.branches.includes(br)) ex.branches.push(br)
        continue
      }
      map.set(key, { ...c, branches: [String(c.branch || 'main')] })
    }
    commits.value = [...map.values()].slice(0, 4) // 接口 time 倒序，合并按首次出现位置
  } catch { /* 动态条加载失败不阻塞首页 */ }
}

// ---- #12 新人引导：首次进入在待办卡行下方渲染一条淡蓝一次性提示（localStorage 标记，可 ✕） ----
const HOME_INTRO_KEY = 'nec_home_intro_seen'
/** 分区注解（按当前 widget 顺序拼一句说明） */
const INTRO_HINTS: Record<string, string> = {
  'my-tasks': '我的任务｜飞书任务同步与逾期',
  'goals': '赛季目标｜目标进度与风险',
  'my-apps': '应用快捷区｜常用应用直达',
  'docs': '常用资料｜团队文档',
  'my-reimburse': '报销状态｜我的报销单',
  'inventory': '物资查询｜物资台账查询',
}
const introHidden = ref(true)
const introText = computed(() => {
  const parts = widgets.value.filter(w => INTRO_HINTS[w.id]).map(w => INTRO_HINTS[w.id])
  return parts.length ? '本页分区说明：' + parts.join('；') + '。' : ''
})
function dismissHomeIntro() {
  introHidden.value = true
  try { localStorage.setItem(HOME_INTRO_KEY, '1') } catch { /* ignore */ }
}

onMounted(() => {
  try { introHidden.value = localStorage.getItem(HOME_INTRO_KEY) === '1' } catch { /* ignore */ }
  loadHome()
  loadHomeActivity()
  loadTodoCards()
})
watch(() => auth.tick, () => { loadHome(); loadTodoCards() })
watch(() => todoBar.data, () => applyTodoCounts())
</script>

<template>
  <section id="tab-home">
    <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
      <h2 class="text-lg font-bold">我的首页<span id="home-source" class="text-xs font-normal text-gray-400 ml-2">{{ sourceLabel }}</span></h2>
      <div class="flex items-center gap-2">
        <button @click="resetHome" id="home-reset-btn" v-show="auth.me.authenticated" class="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600">恢复默认</button>
 <button @click="showPrompt = !showPrompt" id="home-edit-layout-btn" class="text-sm text-white px-4 py-2 rounded-lg bg-nec-cyan">编辑布局</button>
      </div>
    </div>
    <div v-if="showPrompt" id="home-prompt-box" class="mb-6 bg-white rounded-xl shadow p-5">
      <h3 class="font-bold mb-2">编辑布局：复制 Prompt 给你的 Agent</h3>
      <pre class="prompt text-sm bg-gray-900 text-green-300 rounded-lg p-4" id="home-prompt">{{ HOME_PROMPT }}</pre>
 <button @click="copyText(HOME_PROMPT)" class="mt-3 text-sm text-white px-3 py-1.5 rounded bg-nec-navy">复制</button>
      <p class="text-xs text-gray-400 mt-3">布局为白名单组件制（禁止自由 HTML），组件顺序即渲染顺序，配置绑定飞书账号、换设备/重新登录都保持。组长/队长把 Prompt 里的 scope 改成 group 可配置本组默认首页。也可直接拖动下方卡片右上角的 ⠿ 手柄排序，松手自动保存。</p>
    </div>

    <!-- #3 待办卡行：告警条之下、团队动态之上 -->
    <div v-if="auth.me.authenticated" id="home-todo-cards" class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <button type="button" @click="emit('goto', 'contract-approval')" title="打开合同审批面板"
              class="bg-white rounded-xl shadow px-4 py-3 flex items-center gap-2.5 hover:shadow-md transition cursor-pointer">
        <span class="text-lg shrink-0" aria-hidden="true">📋</span>
        <span class="flex-1 min-w-0 text-left text-sm font-bold">待审批</span>
        <span class="text-xl font-bold shrink-0" :class="todoCards.approval ? 'text-[#C22E2E]' : 'text-gray-300'">{{ todoCards.approval }}</span>
      </button>
      <button type="button" @click="emit('goto', 'drawing-review')" title="打开图纸评审面板"
              class="bg-white rounded-xl shadow px-4 py-3 flex items-center gap-2.5 hover:shadow-md transition cursor-pointer">
        <span class="text-lg shrink-0" aria-hidden="true">🔍</span>
        <span class="flex-1 min-w-0 text-left text-sm font-bold">待评审</span>
        <span class="text-xl font-bold shrink-0" :class="todoCards.review ? 'text-[#C22E2E]' : 'text-gray-300'">{{ todoCards.review }}</span>
      </button>
      <button type="button" @click="emit('goto', 'my-tasks')" title="打开我的任务面板"
              class="bg-white rounded-xl shadow px-4 py-3 flex items-center gap-2.5 hover:shadow-md transition cursor-pointer">
        <span class="text-lg shrink-0" aria-hidden="true">🎯</span>
        <span class="flex-1 min-w-0 text-left text-sm font-bold">我的任务</span>
        <span class="text-xl font-bold shrink-0" :class="todoCards.tasks ? 'text-[#C22E2E]' : 'text-gray-300'">{{ todoCards.tasks }}</span>
      </button>
      <button type="button" @click="emit('goto', 'reimburse')" title="打开报销面板"
              class="bg-white rounded-xl shadow px-4 py-3 flex items-center gap-2.5 hover:shadow-md transition cursor-pointer">
        <span class="text-lg shrink-0" aria-hidden="true">💰</span>
        <span class="flex-1 min-w-0 text-left text-sm font-bold">报销中</span>
        <span class="text-xl font-bold shrink-0" :class="todoCards.reimburse ? 'text-[#C22E2E]' : 'text-gray-300'">{{ todoCards.reimburse }}</span>
      </button>
    </div>

    <!-- #12 新人引导：待办卡行下方、仅首次、可关闭 -->
    <div v-if="!introHidden && introText" id="home-intro"
         class="mb-4 rounded-xl px-4 py-2.5 text-xs text-gray-600 flex items-center gap-3"
         style="background:var(--nec-info-bg); border:1px solid #BFE3F5">
      <span class="shrink-0" aria-hidden="true">💡</span>
      <span class="flex-1 leading-relaxed">{{ introText }}</span>
      <button @click="dismissHomeIntro" class="text-gray-400 hover:text-gray-600 shrink-0" title="不再显示">✕</button>
    </div>

    <div id="home-activity" class="mb-4">
      <div v-if="commits.length" class="bg-white rounded-xl shadow px-4 py-3">
        <div class="flex items-center gap-2 text-xs mb-1">
 <span class="font-bold text-nec-navy">团队动态</span>
          <span class="text-gray-400">· 最近 git 提交</span>
 <button @click="emit('goto', 'prd')" class="ml-auto hover:underline text-nec-cyan">PRD 看板 →</button>
        </div>
        <ul class="divide-y divide-gray-50">
          <li v-for="(c, i) in commits" :key="i" class="py-1.5 flex items-baseline gap-2 text-sm">
            <span v-if="c.branches.length > 1" class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 mono shrink-0" :title="c.branches.join(' / ')">{{ c.branches.length }} 分支</span>
            <span v-else class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 mono shrink-0" :title="c.branches[0]">{{ c.branches[0] }}</span>
 <a v-if="commitHref(c)" :href="commitHref(c)" target="_blank" :title="c.message" class="flex-1 min-w-0 truncate hover:underline text-nec-ink">{{ c.message || '' }}</a>
            <span v-else :title="c.message" class="flex-1 min-w-0 truncate">{{ c.message || '' }}</span>
            <span class="text-xs text-gray-400 shrink-0">{{ c.author || '' }}{{ c.at ? ' · ' + fmtAt(c.at) : '' }}</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- #6 信息密度两栏：xl 屏 CSS columns-2（顺序自上而下），小屏单列；卡片 break-inside-avoid -->
    <div id="home-widgets" class="xl:columns-2 xl:gap-4">
      <div v-if="homeLoading && !widgets.length" id="home-widgets-loading"
           class="bg-white rounded-xl shadow p-8 text-center text-sm text-gray-400 break-inside-avoid mb-4">首页布局加载中…</div>
      <div v-else-if="!widgets.length" id="home-widgets-empty"
           class="bg-white rounded-xl shadow p-8 text-center text-sm text-gray-400 break-inside-avoid mb-4">暂无可用首页组件</div>
      <template v-else>
        <div v-for="(w, i) in widgets" :key="w.id"
             class="bg-white rounded-xl shadow p-5 group relative break-inside-avoid mb-4"
             :class="{ 'ring-2 ring-sky-200': dragIdx === i }"
             @dragover="onDragOver(i, $event)" @drop="onCardDrop($event)">
          <div class="flex items-center justify-between gap-2 mb-3">
            <h3 class="font-bold truncate">{{ w.title || HOME_WIDGET_DEFS[w.id].title }}</h3>
            <div v-if="auth.me.authenticated" class="flex items-center gap-2 shrink-0">
              <span @dragstart="onDragStart(i, $event)" @dragend="onDragEnd"
                    draggable="true" title="拖拽排序（松手自动保存）"
                    class="text-xs text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing select-none">⠿ 拖拽</span>
              <button @click="removeHomeWidget(i)" title="从我的首页移除该组件（写入个人布局）"
                      class="hidden group-hover:block text-xs text-gray-300 hover:text-red-500">✕ 移除</button>
            </div>
          </div>
          <component :is="HOME_WIDGET_DEFS[w.id].comp" :shared="shared" />
        </div>
      </template>
    </div>
  </section>
</template>