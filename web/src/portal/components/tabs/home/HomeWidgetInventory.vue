<script setup lang="ts">
// 物资查询：前端关键字筛选（名称匹配，前 30 条）
import { ref, computed, onMounted } from 'vue'

const props = defineProps<{ shared: { load(name: string): Promise<any> } }>()

const items = ref<any[] | null>(null)
const failed = ref(false)
const q = ref('')

onMounted(async () => {
  try {
    const d = await props.shared.load('dashboard')
    items.value = d?.inventory?.items ?? []
  } catch { failed.value = true }
})

const filtered = computed(() => {
  // 关键字规范化一次，不在每项上重复 trim/toLowerCase
  const kw = q.value.trim().toLowerCase()
  return (items.value ?? []).filter(it => !kw || it.name.toLowerCase().includes(kw)).slice(0, 30)
})
</script>

<template>
  <p v-if="failed" class="text-sm text-gray-400">加载失败，请刷新重试。</p>
  <p v-else-if="items === null" class="text-sm text-gray-400">加载中…</p>
  <p v-else-if="!items.length" class="text-sm text-gray-400">暂无物资数据。</p>
  <template v-else>
    <input v-model="q" id="home-inv-q" placeholder="🔍 输入关键字筛选物资…" class="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm mb-2">
    <div id="home-inv-list" class="max-h-64 overflow-y-auto">
      <p v-if="!filtered.length" class="text-sm text-gray-400 py-2">没有匹配的物资。</p>
      <div v-for="(it, i) in filtered" :key="i" class="py-1.5 border-b border-gray-100 last:border-0 flex items-baseline gap-2 text-sm">
        <span class="flex-1 min-w-0 truncate">{{ it.name }}</span>
        <span class="text-xs mono text-gray-500 shrink-0">× {{ it.qty ?? '—' }}</span>
        <span class="text-xs text-gray-400 shrink-0">{{ it.location || '—' }}</span>
      </div>
    </div>
  </template>
</template>
