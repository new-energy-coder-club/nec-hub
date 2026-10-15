<script setup lang="ts">
// 资料页：分类筛选 + 发布 Prompt
import { ref, computed, onMounted } from 'vue'
import { DOC_PUBLISH_PROMPT } from '@shared/prompts'
import { copyText } from '@shared/api'

const DOC_CAT_LABEL: Record<string, string> = { brand: '品牌规范', template: '文档模板', sop: '制度 SOP', training: '培训材料' }
const DOC_CAT_ORDER = ['brand', 'template', 'sop', 'training']

const docsData = ref<any[]>([])
const docsCat = ref('all')
const showPrompt = ref(false)

onMounted(() => {
  fetch('/api/docs').then(r => r.json()).then(docs => { docsData.value = docs || [] }).catch(() => {})
})

const groups = computed(() => {
  const list = docsData.value.filter(d => docsCat.value === 'all' || d.category === docsCat.value)
  return DOC_CAT_ORDER.map(cat => ({ cat, items: list.filter(d => d.category === cat) })).filter(g => g.items.length)
})

const empty = computed(() => !groups.value.length)

const catBtns = [
  { cat: 'all', label: '全部' },
  ...DOC_CAT_ORDER.map(c => ({ cat: c, label: DOC_CAT_LABEL[c] })),
]
</script>

<template>
  <section id="tab-docs">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">资料页</h2>
      <button @click="showPrompt = !showPrompt" class="text-sm text-white px-4 py-2 rounded-lg" style="background:var(--nec-cyan)">＋ 发布/更新资料</button>
    </div>
    <div v-if="showPrompt" id="doc-publish-box" class="mb-6 bg-white rounded-xl shadow p-5">
      <h3 class="font-bold mb-2">资料页更新 Prompt（复制后发给你的 Agent）</h3>
      <pre class="prompt text-sm bg-gray-900 text-green-300 rounded-lg p-4" id="doc-publish-prompt">{{ DOC_PUBLISH_PROMPT }}</pre>
      <button @click="copyText(DOC_PUBLISH_PROMPT)" class="mt-3 text-sm text-white px-3 py-1.5 rounded" style="background:var(--nec-navy)">复制</button>
    </div>

    <div class="flex items-center gap-2 mb-4 text-xs flex-wrap">
      <button v-for="b in catBtns" :key="b.cat" :data-doc-cat="b.cat"
              class="doc-cat-btn px-3 py-1 rounded-full" :class="{ on: docsCat === b.cat }"
              @click="docsCat = b.cat">{{ b.label }}</button>
    </div>

    <div id="docs-list" class="space-y-6">
      <p v-if="empty" class="text-sm text-gray-400 bg-white rounded-xl shadow p-8 text-center">当前分类暂无资料。</p>
      <div v-for="g in groups" :key="g.cat">
        <h3 class="text-sm font-bold text-slate-700 mb-3">{{ DOC_CAT_LABEL[g.cat] }}</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <template v-for="d in g.items" :key="d.id">
            <a v-if="d.url" :href="d.url" target="_blank" class="block bg-white rounded-xl shadow hover:shadow-md transition p-5">
              <div class="flex items-center justify-between">
                <h4 class="font-bold">{{ d.title }}</h4>
                <span class="shrink-0">
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{{ d.category }}</span>
                </span>
              </div>
              <p class="text-sm text-gray-500 mt-1 line-clamp-2">{{ d.description || '' }}</p>
              <p class="text-xs text-gray-400 mt-3">维护：{{ d.maintainer || '—' }} · {{ new Date(d.updatedAt).toLocaleString('zh-CN') }}</p>
            </a>
            <div v-else class="block bg-white rounded-xl shadow p-5 opacity-75 cursor-default">
              <div class="flex items-center justify-between">
                <h4 class="font-bold">{{ d.title }}</h4>
                <span class="shrink-0">
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 mr-1">即将上线</span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{{ d.category }}</span>
                </span>
              </div>
              <p class="text-sm text-gray-500 mt-1 line-clamp-2">{{ d.description || '' }}</p>
              <p class="text-xs text-gray-400 mt-3">维护：{{ d.maintainer || '—' }} · {{ new Date(d.updatedAt).toLocaleString('zh-CN') }}</p>
            </div>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>
