<script setup lang="ts">
// 我的报销状态：按登录角色脱敏（full/summary/hidden）
import { ref, onMounted } from 'vue'
import { auth } from '../../../composables/useAuth'
import { fmtDashDate } from '../../../api'

const props = defineProps<{ shared: { load(name: string): Promise<any> } }>()

const fin = ref<any>(undefined)
const failed = ref(false)
const mine = ref<any[]>([])

onMounted(async () => {
  try {
    const d = await props.shared.load('dashboard')
    fin.value = d?.finance ?? null
    mine.value = (fin.value?.recent ?? []).filter((f: any) => auth.me.user?.name && f.applicant === auth.me.user.name).slice(0, 6)
  } catch { failed.value = true }
})
</script>

<template>
  <p v-if="failed" class="text-sm text-gray-400">加载失败，请刷新重试。</p>
  <p v-else-if="fin === undefined" class="text-sm text-gray-400">加载中…</p>
  <p v-else-if="!fin || fin.visibility === 'hidden'" class="text-sm text-gray-400">登录后可见报销汇总；明细仅队长/财务角色可见。</p>
  <template v-else>
    <p class="text-sm text-gray-600">全队报销 {{ fin.records ?? 0 }} 笔 · 合计 <b style="color:var(--nec-navy)">¥{{ fin.totalAmount ?? '—' }}</b></p>
    <ul v-if="fin.recent && mine.length" class="divide-y divide-gray-100 mt-2">
      <li v-for="(f, i) in mine" :key="i" class="py-1.5 flex items-baseline gap-2">
        <span class="text-xs text-gray-400 mono shrink-0">{{ fmtDashDate(f.date) }}</span>
        <span class="flex-1 min-w-0 truncate">{{ f.name }}</span>
        <span class="text-xs mono shrink-0">¥{{ f.amount ?? '—' }}</span>
      </li>
    </ul>
    <p v-else-if="fin.recent" class="text-xs text-gray-400 mt-2">最近报销里没有你的记录</p>
    <p v-else class="text-xs text-gray-400 mt-2">报销明细仅队长/财务角色可见</p>
  </template>
</template>
