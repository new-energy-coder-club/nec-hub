<script setup lang="ts">
// 我的报销（R-01）：GET /api/approvals/mine?type=reimburse（Plan B 审批引擎；登录后可见）
import { ref, watch, onMounted } from 'vue'
import { auth } from '@shared/auth'
import { dashStatusColor, fmtMoney } from '@shared/format'

const state = ref<'login' | 'loading' | 'list'>('login')
const rows = ref<any[]>([])
const hint = ref('')
const failed = ref(false)

function render() {
  if (!auth.me.authenticated) { state.value = 'login'; return }
  state.value = 'loading'
  failed.value = false
  fetch('/api/approvals/mine?type=reimburse').then(r => {
    if (r.status === 401) return { __unauthorized: true }
    return r.json()
  }).then(d => {
    if (d.__unauthorized) { state.value = 'login'; return }
    if (d.hint && !(d.records ?? []).length) { hint.value = d.hint; rows.value = []; state.value = 'list'; return }
    hint.value = ''
    rows.value = d.records ?? []
    state.value = 'list'
  }).catch(() => { failed.value = true; state.value = 'list' })
}

onMounted(render)
watch(() => auth.tick, render)
</script>

<template>
  <div class="bg-white rounded-xl shadow p-5">
    <h3 class="font-bold mb-3">我的报销</h3>
    <div id="my-rb-list" class="text-sm text-gray-400">
      <p v-if="state === 'login'" class="text-gray-400">登录后可见。</p>
      <p v-else-if="state === 'loading'">加载中…</p>
      <p v-else-if="failed" class="text-red-500">加载失败，请稍后重试。</p>
      <p v-else-if="hint" class="text-gray-400">{{ hint }}</p>
      <p v-else-if="!rows.length" class="text-gray-400">暂无记录</p>
      <div v-else class="overflow-x-auto">
        <table class="w-full">
          <thead><tr class="text-left text-xs text-gray-400">
            <th class="pb-2 font-medium">单号</th><th class="pb-2 font-medium">事项</th>
            <th class="pb-2 font-medium">金额</th><th class="pb-2 font-medium">状态</th><th class="pb-2 font-medium">提交时间</th>
          </tr></thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="i" class="border-t border-gray-100">
              <td class="py-2 pr-3 mono text-xs whitespace-nowrap">{{ r.fields?.申请单号 || r.application_id || '—' }}</td>
              <td class="py-2 pr-3">{{ r.fields?.事项 || '—' }}</td>
              <td class="py-2 pr-3 mono whitespace-nowrap text-right">{{ r.fields?.金额 != null ? '¥' + fmtMoney(r.fields.金额) : '—' }}</td>
              <td class="py-2 pr-3 whitespace-nowrap">
                <span class="px-2 py-0.5 rounded text-xs text-white" :style="`background:${dashStatusColor(r.status)}`">{{ r.status || '—' }}</span>
                <span v-if="r.status === '审批中'" class="text-xs text-gray-400 ml-1">通过后可在群里收到通知</span>
              </td>
              <td class="py-2 text-gray-400 text-xs whitespace-nowrap">{{ r.fields?.提交时间 ? new Date(r.fields.提交时间).toLocaleDateString('zh-CN') : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <p class="text-xs text-gray-400 mt-2">审批由财务/队长在飞书处理，结果在群里通知；流程未配置时此列表为空。</p>
  </div>
</template>
