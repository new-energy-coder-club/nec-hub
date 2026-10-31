<script setup lang="ts">
// NEC 开源仓库（GitHub org + Gitee 账号合并，点击表头按 Star/Fork/Commit 等排序）
import { ref, computed, onMounted } from 'vue'

const REPO_COLS = [
  { key: 'name',     label: '仓库' },
  { key: 'host',     label: '来源' },
  { key: 'language', label: '语言' },
  { key: 'stars',    label: '★ Star' },
  { key: 'forks',    label: '⑂ Fork' },
  { key: 'commits',  label: 'Commit' },
  { key: 'pushedAt', label: '最近提交' },
]

const reposData = ref<any[]>([])
const meta = ref('')
const error = ref('')
const failed = ref(false)
const reposSort = ref<{ key: string; dir: 1 | -1 }>({ key: 'stars', dir: -1 })
const reposHost = ref('all')

onMounted(() => {
  fetch('/api/repos').then(r => r.json()).then(d => {
    reposData.value = d.repos || []
    if (!reposData.value.length) {
      error.value = d.error || '暂无公开仓库。'
      return
    }
    const time = d.cachedAt ? new Date(d.cachedAt).toLocaleString('zh-CN') : ''
    meta.value = `共 ${reposData.value.length} 个开源仓库（GitHub ${d.github || ''} + Gitee ${d.gitee || ''}） · 数据更新于 ${time}${d.stale ? '（上游暂不可用，展示缓存快照）' : ''}`
  }).catch(() => { failed.value = true })
})

function sortRepos(key: string) {
  if (reposSort.value.key === key) reposSort.value.dir = (reposSort.value.dir * -1) as 1 | -1
  else reposSort.value = { key, dir: key === 'name' || key === 'host' ? 1 : -1 }
}

function arrow(k: string): string {
  return reposSort.value.key === k ? (reposSort.value.dir > 0 ? ' ↑' : ' ↓') : ''
}

const rows = computed(() => {
  const { key, dir } = reposSort.value
  const data = reposData.value.filter(r => reposHost.value === 'all' || r.host === reposHost.value)
  const val = (r: any): any => key === 'name' ? r.name : key === 'host' ? r.host : key === 'pushedAt' ? (Date.parse(r.pushedAt) || 0) : (r[key] || 0)
  // 先取排序键再排序（装饰-排序-去装饰）：避免比较器里 O(n log n) 次重复取值/Date.parse
  return data
    .map(r => ({ v: val(r), r }))
    .sort((a, b) => (typeof a.v === 'string' ? a.v.localeCompare(b.v) : a.v - b.v) * dir)
    .map(x => x.r)
})

const hostBtns = [
  { host: 'all', label: '全部' },
  { host: 'github', label: 'GitHub' },
  { host: 'gitee', label: 'Gitee' },
]
</script>

<template>
  <section id="tab-repos">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">NEC 开源仓库</h2>
      <div class="text-sm">
 <a href="https://github.com/necc-hub" target="_blank" class="hover:underline text-nec-cyan">GitHub org →</a>
        <span class="text-gray-300 mx-1">·</span>
 <a href="https://gitee.com/darrenpig" target="_blank" class="hover:underline text-nec-cyan">Gitee →</a>
      </div>
    </div>
    <div class="flex items-center gap-2 mb-3 text-xs">
      <button v-for="b in hostBtns" :key="b.host" :data-host="b.host"
              class="host-btn px-3 py-1 rounded-full" :class="{ on: reposHost === b.host }"
              @click="reposHost = b.host">{{ b.label }}</button>
      <span class="text-gray-400 ml-auto">点击表头列可排序</span>
    </div>
    <div id="repos-box" class="bg-white rounded-xl shadow overflow-hidden">
      <p v-if="failed" class="p-8 text-center text-red-500 text-sm">仓库列表加载失败，请稍后刷新重试。</p>
      <p v-else-if="error" class="p-8 text-center text-gray-400 text-sm">{{ error }}</p>
      <p v-else-if="!reposData.length" class="p-8 text-center text-gray-400 text-sm">加载中…</p>
      <p v-else-if="!rows.length" class="p-8 text-center text-gray-400 text-sm">该来源下暂无仓库。</p>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs text-gray-400 border-b">
              <th v-for="c in REPO_COLS" :key="c.key" class="px-4 py-3 font-medium whitespace-nowrap">
                <button @click="sortRepos(c.key)" class="hover:underline">{{ c.label }}{{ arrow(c.key) }}</button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.host + r.name" class="border-b last:border-0 hover:bg-gray-50">
              <td class="px-4 py-3">
 <a :href="r.url" target="_blank" class="font-bold hover:underline text-nec-navy">{{ r.name }}</a>
                <span v-if="r.host === 'gitee'" class="text-[10px] text-red-500 border border-red-200 rounded px-1 ml-1">Gitee</span>
                <span v-else class="text-[10px] text-gray-400 border border-gray-200 rounded px-1 ml-1">GitHub</span>
                <span v-if="r.isFork" class="text-[10px] text-gray-400 border border-gray-200 rounded px-1">fork</span>
                <p class="text-xs text-gray-400 mt-0.5">{{ r.description || '' }}</p>
              </td>
              <td class="px-4 py-3 whitespace-nowrap text-gray-500">{{ r.host === 'gitee' ? 'Gitee' : 'GitHub' }}</td>
              <td class="px-4 py-3 whitespace-nowrap text-gray-500">{{ r.language || '—' }}</td>
              <td class="px-4 py-3 mono whitespace-nowrap">{{ r.stars }}</td>
              <td class="px-4 py-3 mono whitespace-nowrap">{{ r.forks }}</td>
              <td class="px-4 py-3 mono whitespace-nowrap">{{ r.commits ?? '—' }}</td>
              <td class="px-4 py-3 mono whitespace-nowrap text-gray-500">{{ r.pushedAt ? new Date(r.pushedAt).toLocaleDateString('zh-CN') : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <p id="repos-meta" class="text-xs text-gray-400 mt-2">{{ meta }}</p>
  </section>
</template>
