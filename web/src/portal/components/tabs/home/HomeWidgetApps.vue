<script setup lang="ts">
// 我的应用快捷区：类型角标 + 按类型分组排序（前 6 个）
import { ref, onMounted } from 'vue'

const props = defineProps<{ shared: { load(name: string): Promise<any> } }>()

const apps = ref<any[] | null>(null)
const failed = ref(false)

// 类型角标：本中台托管=应用 / external+Vercel=网站 / 其他外链=外链；按类型分组排序
const APP_KIND_STYLE: Record<string, { label: string; style: string }> = {
  app:  { label: '应用', style: 'background:#EAF7FD;color:#1FA9E8' },
  site: { label: '网站', style: 'background:#FFFBEB;color:#D97706' },
  ext:  { label: '外链', style: 'background:#F3F4F6;color:#6B7280' },
}
function kindOf(a: any): string {
  if (!a.external) return 'app'
  try { if (new URL(a.url).hostname.endsWith('vercel.app')) return 'site' } catch { /* url 异常按外链 */ }
  return 'ext'
}
const KIND_ORDER: Record<string, number> = { app: 0, site: 1, ext: 2 }

// 命名规范：标题里的「中文名 // 英文名」拆成主标题 + 副标题两行
function titleParts(title: string): string[] {
  return String(title || '').split(/\s*\/\/\s*/)
}

onMounted(async () => {
  try {
    const list = (await props.shared.load('apps')) || []
    apps.value = list.slice().sort((x: any, y: any) => KIND_ORDER[kindOf(x)] - KIND_ORDER[kindOf(y)]).slice(0, 6)
  } catch { failed.value = true }
})
</script>

<template>
  <p v-if="failed" class="text-sm text-gray-400">加载失败，请刷新重试。</p>
  <p v-else-if="apps === null" class="text-sm text-gray-400">加载中…</p>
  <p v-else-if="!apps.length" class="text-sm text-gray-400">还没有应用上架，去「应用广场」发布第一个。</p>
  <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    <a v-for="a in apps" :key="a.name" :href="a.url" target="_blank" class="relative block border border-gray-100 rounded-lg p-3 hover:shadow-md transition">
      <span class="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded" :style="APP_KIND_STYLE[kindOf(a)].style">{{ APP_KIND_STYLE[kindOf(a)].label }}</span>
      <p class="font-bold text-slate-800 text-sm truncate pr-8">{{ titleParts(a.title)[0] }}</p>
      <p v-if="titleParts(a.title)[1]" class="text-[10px] mono text-gray-400 truncate">{{ titleParts(a.title).slice(1).join(' // ') }}</p>
      <p class="text-xs text-gray-400 mt-0.5">{{ a.name }} · {{ a.author }}</p>
    </a>
  </div>
</template>
