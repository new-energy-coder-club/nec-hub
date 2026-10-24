<script setup lang="ts">
// 我的任务：绑定飞书任务（Task v2）后同步展示，未绑定引导重新授权（GET /api/my-tasks，KV 5 分钟缓存）
import { ref, watch, onMounted } from 'vue'
import { auth } from '@shared/auth'
import { tabs } from '@portal/composables/useTabs'
import { confirmDialog } from '@shared/ui/feedback'

const state = ref<'loading' | 'unauthenticated' | 'expired' | 'unbound' | 'list' | 'error'>('loading')
const errorMsg = ref('')
const data = ref<any>(null)
const authUrl = ref<string | null>(null)

async function loadMyTasks(force?: boolean) {
  if (!auth.me.authenticated) {
    state.value = 'unauthenticated'
    return
  }
  let d: any
  try {
    const resp = await fetch('/api/my-tasks' + (force ? '?refresh=1' : ''))
    if (resp.status === 401) {
      state.value = 'expired'
      return
    }
    d = await resp.json()
  } catch (e: any) {
    state.value = 'error'
    errorMsg.value = e?.message || String(e)
    return
  }
  if (!d.bound) {
    authUrl.value = d.authorizeUrl || null
    data.value = d
    state.value = 'unbound'
    return
  }
  data.value = d
  state.value = 'list'
}

function bindMyTasks() {
  if (authUrl.value) location.href = authUrl.value
}

async function unbindMyTasks() {
  if (!(await confirmDialog('解绑后将停止同步你的飞书任务，确定解绑？'))) return
  await fetch('/api/my-tasks/unbind', { method: 'POST' }).catch(() => {})
  loadMyTasks()
}

const now = Date.now()
function dueOf(t: any): string {
  return t.dueTimestamp
    ? new Date(t.dueTimestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '无截止时间'
}
function isOverdue(t: any): boolean {
  return !t.completedAt && t.dueTimestamp && t.dueTimestamp < now
}

onMounted(() => loadMyTasks())
// 切到该 Tab 时刷新；登录/登出后重载
watch(() => tabs.active, t => { if (t === 'my-tasks') loadMyTasks() })
watch(() => auth.tick, () => loadMyTasks())
</script>

<template>
  <section id="tab-my-tasks">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">我的任务<span id="my-tasks-meta" class="text-xs font-normal text-gray-400 ml-2">{{ state === 'list' ? '同步于 ' + new Date(data.syncedAt).toLocaleString('zh-CN') + (data.cached ? '（缓存）' : '') : '' }}</span></h2>
      <div class="flex items-center gap-2" id="my-tasks-actions">
        <template v-if="state === 'list'">
          <button @click="loadMyTasks(true)" class="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600">同步</button>
          <button @click="unbindMyTasks" class="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600">解绑</button>
        </template>
      </div>
    </div>
    <div id="my-tasks-body" class="space-y-3">
      <div v-if="state === 'unauthenticated'" class="bg-white rounded-xl shadow p-8 text-center text-sm text-gray-400">请先点击右上角「飞书登录」，登录后可绑定并同步你的飞书任务</div>
      <div v-else-if="state === 'expired'" class="bg-white rounded-xl shadow p-8 text-center text-sm text-gray-400">登录已过期，请重新登录</div>
      <div v-else-if="state === 'error'" class="bg-white rounded-xl shadow p-8 text-center text-sm text-red-500">任务加载失败：{{ errorMsg }}</div>
      <div v-else-if="state === 'unbound'" class="bg-white rounded-xl shadow p-8 text-center">
        <p class="text-sm text-gray-500 mb-1">尚未绑定飞书任务{{ data?.rebind ? '（原授权已失效）' : '' }}</p>
        <p class="text-xs text-gray-400 mb-4">授权后中台将代你同步拉取飞书任务（Task v2，只读）</p>
 <button v-if="authUrl" @click="bindMyTasks" class="text-sm text-white px-4 py-2 rounded-lg bg-nec-cyan">🔗 绑定飞书任务</button>
        <p v-else class="text-xs text-red-500">飞书应用未配置，无法发起授权</p>
      </div>
      <div v-else-if="state === 'list' && !(data?.tasks?.length)" class="bg-white rounded-xl shadow p-8 text-center text-sm text-gray-400">🎉 没有未完成的飞书任务</div>
      <template v-else-if="state === 'list'">
        <div v-for="(t, i) in data.tasks" :key="i" class="bg-white rounded-xl shadow p-4 flex items-center gap-3" :class="{ 'opacity-50': t.completedAt }">
          <div class="flex-1 min-w-0">
 <a v-if="t.url" :href="t.url" target="_blank" class="font-medium hover:underline text-nec-navy" :class="{ 'line-through text-gray-400': t.completedAt }">{{ t.summary }}</a>
 <span v-else class="font-medium text-nec-navy" :class="{ 'line-through text-gray-400': t.completedAt }">{{ t.summary }}</span>
            <p class="text-xs mt-1" :class="isOverdue(t) ? 'text-red-600 font-medium' : 'text-gray-400'">{{ isOverdue(t) ? '已逾期 · ' : '' }}截止：{{ dueOf(t) }}</p>
          </div>
          <span v-if="t.completedAt" class="text-xs text-gray-400 shrink-0">已完成</span>
          <span v-else-if="isOverdue(t)" class="text-xs text-white px-2 py-0.5 rounded bg-red-500 shrink-0">逾期</span>
        </div>
      </template>
    </div>
  </section>
</template>
