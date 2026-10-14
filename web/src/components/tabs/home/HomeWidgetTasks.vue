<script setup lang="ts">
// 我的任务：登录后按负责人精确匹配过滤（与后端 splitNames 同口径）
import { ref, onMounted, inject } from 'vue'
import { auth } from '../../../composables/useAuth'
import { dashStatusColor, fmtDashDate, nameHits } from '../../../api'

const props = defineProps<{ shared: { load(name: string): Promise<any> } }>()
const noteHomeFreshness = inject<(d: any) => void>('noteHomeFreshness', () => {})

const list = ref<any[] | null>(null)
const failed = ref(false)
const myName = ref('')

onMounted(async () => {
  try {
    const d = await props.shared.load('dashboard')
    noteHomeFreshness(d)
    const all = d?.tasks?.upcoming ?? []
    myName.value = auth.me.authenticated ? (auth.me.user?.name ?? '') : ''
    list.value = (myName.value ? all.filter((t: any) => nameHits(t.owner, myName.value)) : all).slice(0, 8)
  } catch { failed.value = true }
})
</script>

<template>
  <p v-if="failed" class="text-sm text-gray-400">加载失败，请刷新重试。</p>
  <p v-else-if="list === null" class="text-sm text-gray-400">加载中…</p>
  <template v-else-if="!list.length">
    <p class="text-sm text-gray-400">{{ myName ? '暂无与你相关的未完成任务 🎉' : '登录后只看你的任务' }}</p>
    <p v-if="myName" class="text-xs text-gray-400 mt-1.5">去「我的任务」Tab 查看全部；在飞书任务中把自己加为负责人，任务就会出现在这里。</p>
  </template>
  <template v-else>
    <ul class="divide-y divide-gray-100">
      <li v-for="(t, i) in list" :key="i" class="py-1.5 flex items-baseline gap-2 flex-wrap">
        <span class="flex-1 min-w-0 truncate">{{ t.title || '—' }}</span>
        <span class="text-xs px-1.5 py-0.5 rounded text-white shrink-0" :style="`background:${dashStatusColor(t.status)}`">{{ t.status || '未标注' }}</span>
        <span class="text-xs text-gray-400 mono shrink-0">{{ fmtDashDate(t.deadline) }}</span>
      </li>
    </ul>
    <p v-if="!myName" class="text-xs text-gray-400 mt-2">当前为全队视角，登录后只看你的任务</p>
  </template>
</template>
