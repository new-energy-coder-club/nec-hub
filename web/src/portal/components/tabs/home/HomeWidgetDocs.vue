<script setup lang="ts">
// 常用资料（前 6 条）
import { ref, onMounted } from 'vue'

const props = defineProps<{ shared: { load(name: string): Promise<any> } }>()

const docs = ref<any[] | null>(null)
const failed = ref(false)

onMounted(async () => {
  try {
    docs.value = ((await props.shared.load('docs')) || []).slice(0, 6)
  } catch { failed.value = true }
})
</script>

<template>
  <p v-if="failed" class="text-sm text-gray-400">加载失败，请刷新重试。</p>
  <p v-else-if="docs === null" class="text-sm text-gray-400">加载中…</p>
  <p v-else-if="!docs.length" class="text-sm text-gray-400">资料页暂无条目。</p>
  <ul v-else class="divide-y divide-gray-100">
    <li v-for="(d, i) in docs" :key="i" class="py-1.5">
 <a v-if="d.url" :href="d.url" target="_blank" class="hover:underline font-medium text-nec-navy">{{ d.title }}</a>
      <template v-else>
        <span class="font-medium text-gray-400">{{ d.title }}</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-600">即将上线</span>
      </template>
      <p class="text-xs text-gray-400 truncate">{{ d.description || '' }}</p>
    </li>
  </ul>
</template>
