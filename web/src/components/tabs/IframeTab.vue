<script setup lang="ts">
// iframe 嵌入的独立应用 Tab：首次切换到该 Tab 才加载（data-src 懒加载）
import { ref, watch, onMounted } from 'vue'
import { tabs, type TabId } from '../../composables/useTabs'

const props = defineProps<{ tab: TabId; title: string; href: string; src: string; frameTitle: string }>()

const loaded = ref(false)
function maybeLoad() {
  if (tabs.active === props.tab && !loaded.value) loaded.value = true
}
onMounted(maybeLoad)
watch(() => tabs.active, maybeLoad)
</script>

<template>
  <section :id="'tab-' + tab">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">{{ title }}</h2>
      <a :href="href" target="_blank" class="text-xs hover:underline" style="color:var(--nec-cyan)">独立全屏版 {{ href }} →</a>
    </div>
    <iframe v-if="loaded" :src="src" :title="frameTitle" class="w-full rounded-xl border border-gray-200 bg-white" style="height:78vh" loading="lazy"></iframe>
    <iframe v-else :data-src="src" :title="frameTitle" class="w-full rounded-xl border border-gray-200" style="height:78vh" loading="lazy"></iframe>
  </section>
</template>
