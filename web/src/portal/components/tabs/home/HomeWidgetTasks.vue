<script setup lang="ts">
// 我的任务（FE-17 同源）：已绑定飞书任务时优先用 /api/my-tasks（Task v2，与「我的任务」Tab 同源），
// 未绑定/未登录/接口失败时回退 /api/dashboard 多维表格任务（按负责人精确匹配，与后端 splitNames 同口径）。
// 刷新：飞书源走 ?refresh=1 强刷；看板源走 /api/dashboard?fresh=1 并重放同一过滤口径。
import { ref, computed, onMounted, inject } from 'vue'
import { auth } from '@shared/auth'
import { dashStatusColor, fmtDashDate, nameHits } from '@shared/format'

const props = defineProps<{ shared: { load(name: string): Promise<any> } }>()
const noteHomeFreshness = inject<(d: any) => void>('noteHomeFreshness', () => {})

const source = ref<'feishu' | 'dashboard'>('dashboard')
const feishuTasks = ref<any[]>([])
const feishuSyncedAt = ref('')
const list = ref<any[] | null>(null)
const failed = ref(false)
const myName = ref('')
const dash = ref<any>(null)
const refreshing = ref(false)
const refreshErr = ref('')

/** 飞书 Task v2 源：绑定成功返回 true；未绑定/401/失败返回 false 由调用方回退看板 */
async function loadFeishuTasks(force = false): Promise<boolean> {
  if (!auth.me.authenticated) return false
  try {
    const resp = await fetch('/api/my-tasks' + (force ? '?refresh=1' : ''), force ? { cache: 'no-store' } : {})
    if (!resp.ok) return false
    const d = await resp.json()
    if (!d.bound) return false
    feishuTasks.value = (d.tasks ?? []).filter((t: any) => !t.completedAt)
    feishuSyncedAt.value = d.syncedAt ?? ''
    source.value = 'feishu'
    return true
  } catch { return false }
}

/** 用一份 dashboard 数据重算列表：shared 缓存的是旧 Promise，刷新走独立 fetch 后在这里重放同一过滤口径 */
function applyDash(d: any) {
  if (!d) return
  const all = d?.tasks?.upcoming ?? []
  myName.value = auth.me.authenticated ? (auth.me.user?.name ?? '') : ''
  list.value = (myName.value ? all.filter((t: any) => nameHits(t.owner, myName.value)) : all).slice(0, 8)
  dash.value = d
  noteHomeFreshness(d)
}

onMounted(async () => {
  if (await loadFeishuTasks()) return
  try {
    applyDash(await props.shared.load('dashboard'))
  } catch { failed.value = true }
})

async function refreshTasks() {
  if (refreshing.value) return
  refreshing.value = true
  refreshErr.value = ''
  try {
    if (source.value === 'feishu') {
      if (!(await loadFeishuTasks(true))) {
        // 绑定失效等情况回退看板源，保证 widget 不空白
        applyDash(await props.shared.load('dashboard'))
      }
      return
    }
    const resp = await fetch('/api/dashboard?fresh=1', { cache: 'no-store' })
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    applyDash(await resp.json())
  } catch (e: any) {
    refreshErr.value = '刷新失败：' + (e?.message || String(e)) + '，请稍后重试'
  } finally {
    refreshing.value = false
  }
}

/** 统一行模型：飞书源只保留未完成，逾期标红；看板源沿用原状态色 */
const rows = computed(() => {
  if (source.value === 'feishu') {
    return feishuTasks.value.slice(0, 8).map((t: any) => {
      const overdue = t.dueTimestamp && t.dueTimestamp < Date.now()
      return {
        title: t.summary || '—', url: t.url || '',
        status: overdue ? '逾期' : '进行中',
        color: overdue ? '#DC2626' : dashStatusColor('进行中'),
        deadline: t.dueTimestamp,
      }
    })
  }
  return (list.value ?? []).map((t: any) => ({
    title: t.title || '—', url: '',
    status: t.status || '未标注', color: dashStatusColor(t.status), deadline: t.deadline,
  }))
})

/** 新鲜度：同步距今分钟数与文案取同一整值，>10 分钟灰色 +「（已过时，点击刷新）」；<10 分钟维持「任务同步于 x 分钟前 / 刚刚」文案 */
const syncMins = computed(() => {
  const t = new Date(source.value === 'feishu' ? feishuSyncedAt.value : dash.value?.tasks?.cachedAt).getTime()
  if (!isFinite(t)) return null
  return Math.max(0, Math.round((Date.now() - t) / 60000))
})
const syncStale = computed(() => (syncMins.value ?? 0) > 10)
const syncNote = computed(() => {
  if (syncMins.value === null) return '同步中…'
  const prefix = source.value === 'feishu' ? '飞书任务同步于 ' : '任务同步于 '
  const base = `${prefix}${syncMins.value < 1 ? '刚刚' : syncMins.value + ' 分钟前'}`
  return syncStale.value ? base + '（已过时，点击刷新）' : base
})
</script>

<template>
  <p v-if="failed" class="text-sm text-gray-400">加载失败，请刷新重试。</p>
  <template v-else-if="source === 'feishu' || list !== null">
    <div class="flex items-center justify-between gap-2 mb-1">
      <p class="text-xs" :class="syncStale ? 'text-gray-400' : 'text-gray-500'">{{ syncNote }}</p>
      <button @click="refreshTasks" :disabled="refreshing"
              class="text-xs px-2 py-1 rounded border border-gray-200 bg-white text-gray-500 hover:text-gray-700 disabled:opacity-50 shrink-0">
        {{ refreshing ? '刷新中…' : '刷新' }}
      </button>
    </div>
    <template v-if="!rows.length">
      <p class="text-sm text-gray-400">{{ source === 'feishu' ? '没有未完成的飞书任务 🎉' : (myName ? '暂无与你相关的未完成任务 🎉' : '登录后只看你的任务') }}</p>
      <p class="text-xs text-gray-400 mt-1.5">{{ source === 'feishu' ? '去「我的任务」Tab 查看全部或管理绑定。' : (myName ? '去「我的任务」Tab 查看全部；在飞书任务中把自己加为负责人，任务就会出现在这里。' : '') }}</p>
    </template>
    <ul v-else class="divide-y divide-gray-100">
      <li v-for="(t, i) in rows" :key="i" class="py-1.5 flex items-baseline gap-2 flex-wrap">
        <a v-if="t.url" :href="t.url" target="_blank" class="flex-1 min-w-0 truncate hover:underline">{{ t.title }}</a>
        <span v-else class="flex-1 min-w-0 truncate">{{ t.title }}</span>
        <span class="text-xs px-1.5 py-0.5 rounded text-white shrink-0" :style="`background:${t.color}`">{{ t.status }}</span>
        <span class="text-xs text-gray-400 mono shrink-0">{{ fmtDashDate(t.deadline) }}</span>
      </li>
    </ul>
  </template>
  <p v-else class="text-sm text-gray-400">加载中…</p>
  <p v-if="refreshErr" class="text-xs text-[#C22E2E] mt-2">{{ refreshErr }}</p>
</template>
