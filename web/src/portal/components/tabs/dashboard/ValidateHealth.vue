<script setup lang="ts">
// FE-05 数据健康：最新校验报告展示 + 手动触发（mine 所有登录用户 / all 仅队长·组长）
import { ref, watch, onMounted } from 'vue'
import { auth, isLeader } from '@shared/auth'

const report = ref<any>(null)
const loaded = ref(false)
const failedMsg = ref('')
const running = ref<'' | 'mine' | 'all'>('')

async function loadValidateHealth() {
  if (!auth.me.authenticated) { report.value = null; loaded.value = false; return }
  loaded.value = true
  try {
    const resp = await fetch('/api/validate/report')
    if (resp.ok) {
      const rep = await resp.json()
      report.value = rep && !rep.empty ? rep : null
    }
  } catch { /* 报告读取失败按空处理 */ }
}

async function runValidate(scope: 'mine' | 'all') {
  running.value = scope
  failedMsg.value = ''
  try {
    const resp = await fetch('/api/validate/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope }),
    })
    const data = await resp.json()
    if (!resp.ok || data.error) throw new Error(data.error || ('HTTP ' + resp.status))
    if (scope === 'all') {
      report.value = data
    } else {
      // mine：页内渲染结果（复用全量报告的条目样式，异常可直接点「打开记录」去改），不再用 alert
      const byType: Record<string, number> = {}
      (data.violations ?? []).forEach((v: any) => { byType[v.type] = (byType[v.type] ?? 0) + 1 })
      report.value = {
        generatedAt: new Date().toISOString(),
        total: data.total ?? 0,
        violations: data.violations ?? [],
        byType: Object.entries(byType).map(([type, count]) => ({ type, count })),
        scopeNote: `本次校验范围：与你相关的数据（${new Date().toLocaleTimeString('zh-CN')}）`,
      }
    }
  } catch (e: any) {
    failedMsg.value = '校验失败：' + (e.message || e)
  } finally {
    running.value = ''
  }
}

function violationsOf(type: string): any[] {
  return (report.value?.violations ?? []).filter((v: any) => v.type === type).slice(0, 20)
}

onMounted(loadValidateHealth)
watch(() => auth.tick, loadValidateHealth)
</script>

<template>
  <div id="dash-health" class="mt-4">
    <div v-if="!auth.me.authenticated" class="bg-white rounded-xl shadow p-5 text-sm text-gray-500">🩺 数据健康：登录后可查看校验报告并触发校验（队员校验自己的数据，队长/组长可全量校验）。</div>
    <div v-else-if="failedMsg" class="bg-white rounded-xl shadow p-5 text-sm text-red-500">{{ failedMsg }}</div>
    <div v-else class="bg-white rounded-xl shadow p-5">
      <div class="flex items-center justify-between mb-2">
        <h3 class="font-bold">数据健康</h3>
        <div class="flex gap-2">
          <button @click="runValidate('mine')" :disabled="!!running" id="vh-btn-mine" class="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 disabled:opacity-50">{{ running === 'mine' ? '校验中…' : '校验我的数据' }}</button>
 <button v-if="isLeader()" @click="runValidate('all')" :disabled="!!running" id="vh-btn-all" class="text-xs px-3 py-1.5 rounded-lg text-white disabled:opacity-50 bg-nec-navy">{{ running === 'all' ? '校验中…' : '全量校验' }}</button>
        </div>
      </div>
      <p v-if="!report" class="text-sm text-gray-400">暂无校验报告：点「校验我的数据」立即跑一次，或等每周一 08:00 自动巡检（摘要推送飞书群）。</p>
      <template v-else>
        <p class="text-xs text-gray-400 mb-1">
          {{ report.scopeNote ? report.scopeNote : `上次全量校验：${report.generatedAt ? new Date(report.generatedAt).toLocaleString('zh-CN') : '—'} · 每周一 08:00 自动巡检` }}
          · 共 <b :class="{ 'text-red-600': report.total }" :style="report.total ? '' : 'color:var(--nec-cyan)'">{{ report.total }}</b> 条异常
        </p>
        <p v-if="!(report.byType ?? []).length" class="text-sm text-gray-400 mt-2">🎉 未发现异常，4 张底表数据全绿。</p>
        <div v-for="t in (report.byType ?? [])" :key="t.type" class="mt-3">
          <p class="text-sm font-medium text-slate-700">{{ t.type }} <span class="text-xs text-gray-400">× {{ t.count }}</span></p>
          <ul>
            <li v-for="(v, i) in violationsOf(t.type)" :key="i" class="py-1.5 border-t border-gray-100 text-sm">
              <div class="flex items-baseline gap-2 flex-wrap">
                <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{{ v.table }}</span>
                <span class="text-gray-600">字段「{{ v.field }}」{{ v.value ? '=' + v.value : '为空' }}</span>
 <a :href="v.link" target="_blank" class="text-xs hover:underline text-nec-cyan">打开记录 →</a>
              </div>
              <p class="text-xs text-gray-400 mt-0.5">建议：{{ v.suggestion }}</p>
            </li>
          </ul>
        </div>
        <p v-if="report.errors" class="text-xs text-amber-600 mt-2">⚠ {{ Object.entries(report.errors).map(([t, e]) => `${t}：${e}`).join('；') }}</p>
      </template>
    </div>
  </div>
</template>
