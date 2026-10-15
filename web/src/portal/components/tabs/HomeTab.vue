<script setup lang="ts">
// FE-06/07 我的首页：白名单组件按布局配置渲染（个人 > 组 > 全员默认）
import { ref, computed, watch, onMounted, provide, type Component } from 'vue'

defineEmits<{ (e: 'goto', tab: string): void }>()
import { auth } from '@shared/auth'
import { HOME_PROMPT } from '@shared/prompts'
import { copyText } from '@shared/api'
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
/** 与后端 DEFAULT_HOME_LAYOUT 保持一致（未登录访客与 /api/home 失败时的兜底） */
const HOME_DEFAULT_WIDGETS = ['my-tasks', 'goals', 'my-apps', 'docs']
const HOME_SOURCE_LABEL: Record<string, string> = { personal: '个人定制', group: '组默认', default: '全员默认' }

interface HomeWidget { id: string; title?: string }

const widgets = ref<HomeWidget[]>(HOME_DEFAULT_WIDGETS.map(id => ({ id })))
const source = ref('default')
const group = ref('')
const freshNote = ref('')
const showPrompt = ref(false)
// 同一次渲染内共享数据请求，避免多组件重复拉同一接口
const shared = ref<SharedLoader>(createShared())

function createShared(): SharedLoader {
  const cache: Record<string, Promise<any>> = {}
  return {
    load(name: string) {
      if (!cache[name]) cache[name] = fetch('/api/' + name).then(r => r.ok ? r.json() : null).catch(() => null)
      return cache[name]
    },
  }
}

/** 副标题补充数据新鲜度：「全员默认 · 任务同步于 x 分钟前」（dashboard 各表带 cachedAt） */
function noteHomeFreshness(d: any) {
  const at = d?.tasks?.cachedAt
  if (!at || freshNote.value) return
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
  let list = HOME_DEFAULT_WIDGETS.map(id => ({ id }))
  let src = 'default', grp = ''
  if (auth.me.authenticated) {
    try {
      const resp = await fetch('/api/home')
      if (resp.ok) {
        const d = await resp.json()
        const wl = (d.layout?.widgets ?? []).filter((w: HomeWidget) => HOME_WIDGET_DEFS[w.id])
        if (wl.length) list = wl
        src = d.source || 'default'
        grp = d.group || ''
      }
    } catch { /* 布局读取失败按默认渲染 */ }
  }
  freshNote.value = ''
  source.value = src
  group.value = grp
  widgets.value = list
  shared.value = createShared()
}

async function resetHome() {
  if (!confirm('恢复默认首页？你的个人布局将被删除（回落到组默认/全员默认）。')) return
  try {
    const resp = await fetch('/api/home/reset', { method: 'POST' })
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    await loadHome()
  } catch (e: any) {
    alert('恢复默认失败：' + (e.message || e))
  }
}

/** 悬停「移除」：从当前布局去掉该组件并写入个人布局（POST /api/home） */
async function removeHomeWidget(i: number) {
  const w = widgets.value[i]
  if (!w) return
  const rest = widgets.value.filter((_, j) => j !== i)
  if (!rest.length) { alert('至少保留一个组件。'); return }
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
    alert('移除失败：' + (e.message || e))
  }
}

// ---- 团队动态窄条：最近 git 提交（来自 GitHub webhook 落 KV，GET /api/prd 的 recentCommits） ----
const commits = ref<any[]>([])
function fmtAt(v: any): string {
  const t = new Date(v)
  return isNaN(t.getTime()) ? '' : t.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
async function loadHomeActivity() {
  try {
    const resp = await fetch('/api/prd')
    if (!resp.ok) return
    const b = await resp.json()
    commits.value = (Array.isArray(b.recentCommits) && b.recentCommits.length
      ? b.recentCommits
      : b.lastCommit ? [b.lastCommit] : []).slice(0, 3)
  } catch { /* 动态条加载失败不阻塞首页 */ }
}

onMounted(() => { loadHome(); loadHomeActivity() })
watch(() => auth.tick, () => loadHome())
</script>

<template>
  <section id="tab-home">
    <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
      <h2 class="text-lg font-bold">我的首页<span id="home-source" class="text-xs font-normal text-gray-400 ml-2">{{ sourceLabel }}</span></h2>
      <div class="flex items-center gap-2">
        <button @click="resetHome" id="home-reset-btn" v-show="auth.me.authenticated" class="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600">恢复默认</button>
        <button @click="showPrompt = !showPrompt" class="text-sm text-white px-4 py-2 rounded-lg" style="background:var(--nec-cyan)">✨ 改我的首页</button>
      </div>
    </div>
    <div v-if="showPrompt" id="home-prompt-box" class="mb-6 bg-white rounded-xl shadow p-5">
      <h3 class="font-bold mb-2">一句话改首页（复制 Prompt 发给你的 Agent）</h3>
      <pre class="prompt text-sm bg-gray-900 text-green-300 rounded-lg p-4" id="home-prompt">{{ HOME_PROMPT }}</pre>
      <button @click="copyText(HOME_PROMPT)" class="mt-3 text-sm text-white px-3 py-1.5 rounded" style="background:var(--nec-navy)">复制</button>
      <p class="text-xs text-gray-400 mt-3">布局为白名单组件制（禁止自由 HTML），组件顺序即渲染顺序，配置绑定飞书账号、换设备/重新登录都保持。组长/队长把 Prompt 里的 scope 改成 group 可配置本组默认首页。</p>
    </div>
    <div id="home-activity" class="mb-4">
      <div v-if="commits.length" class="bg-white rounded-xl shadow px-4 py-3">
        <div class="flex items-center gap-2 text-xs mb-1">
          <span class="font-bold" style="color:var(--nec-navy)">团队动态</span>
          <span class="text-gray-400">· 最近 git 提交</span>
          <button @click="$emit('goto', 'prd')" class="ml-auto hover:underline" style="color:var(--nec-cyan)">PRD 看板 →</button>
        </div>
        <ul class="divide-y divide-gray-50">
          <li v-for="(c, i) in commits" :key="i" class="py-1.5 flex items-baseline gap-2 text-sm">
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 mono shrink-0">{{ c.branch || 'main' }}</span>
            <a v-if="c.url" :href="c.url" target="_blank" class="flex-1 min-w-0 truncate hover:underline" style="color:var(--nec-ink)">{{ c.message || '' }}</a>
            <span v-else class="flex-1 min-w-0 truncate">{{ c.message || '' }}</span>
            <span class="text-xs text-gray-400 shrink-0">{{ c.author || '' }}{{ c.at ? ' · ' + fmtAt(c.at) : '' }}</span>
          </li>
        </ul>
      </div>
    </div>
    <div id="home-widgets" class="space-y-4">
      <div v-for="(w, i) in widgets" :key="i" class="bg-white rounded-xl shadow p-5 group relative">
        <button v-if="auth.me.authenticated" @click="removeHomeWidget(i)" title="从我的首页移除该组件（写入个人布局）"
                class="absolute top-3 right-3 hidden group-hover:block text-xs text-gray-300 hover:text-red-500">✕ 移除</button>
        <h3 class="font-bold mb-3">{{ w.title || HOME_WIDGET_DEFS[w.id].title }}</h3>
        <component :is="HOME_WIDGET_DEFS[w.id].comp" :shared="shared" />
      </div>
    </div>
  </section>
</template>
