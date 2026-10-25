<script setup lang="ts">
// Skill 中心：分类 + 检索 + 排序
import { ref, computed, onMounted } from 'vue'
import { ORIGIN } from '@shared/api'

// 与后端 src/hosting.ts 的 SKILL_CATEGORY_LABELS / 推断规则保持一致（静态页无法 import worker 代码）
const SKILL_CAT_LABEL: Record<string, string> = { dev: '开发工具', docs: '文档办公', design: '设计创意', media: '音视频', data: '数据分析', lark: '飞书协同', agent: 'Agent 基建', life: '生活效率', other: '其他' }
const SKILL_CAT_ORDER = ['dev', 'docs', 'design', 'media', 'data', 'lark', 'agent', 'life', 'other']
const SKILL_CAT_RULES: Array<[string, RegExp]> = [
  ['lark', /^lark-|飞书|多维表格|妙记/i],
  ['media', /video|audio|music|剪辑|视频|音频|音乐|字幕|ffmpeg|whisper|gif|混剪/i],
  ['design', /design|canvas|poster|brand|海报|视觉|排版|theme|插画/i],
  ['data', /data|analy|chart|sql|financial|数据|可视化|财报|股票|评分/i],
  ['docs', /docx|xlsx|excel|word|pdf|markdown|ppt|slide|文档|论文|thesis|paper|写作|手册/i],
  ['dev', /code|debug|git|review|test|deploy|refactor|代码|调试|commit|cli/i],
  ['agent', /mcp|skill|agent|persona|memory|claude|kimi|gemini|browser|prompt/i],
  ['life', /weather|travel|news|mail|todo|日程|天气|新闻|旅行|提醒|邮件/i],
]

function skillCategoryOf(s: any): string {
  const c = (s.category || '').toLowerCase()
  if (SKILL_CAT_LABEL[c]) return c
  const text = `${s.name} ${s.description || ''}`
  for (const [cat, re] of SKILL_CAT_RULES) if (re.test(text)) return cat
  return 'other'
}

const skillsData = ref<any[]>([])
const skillCat = ref('all')
const skillKw = ref('')
const skillSort = ref('updated')

onMounted(() => {
  fetch('/api/skills').then(r => r.json()).then(skills => { skillsData.value = skills || [] }).catch(() => {})
})

const catCounts = computed(() => {
  const counts: Record<string, number> = {}
  skillsData.value.forEach(s => { const c = skillCategoryOf(s); counts[c] = (counts[c] || 0) + 1 })
  return counts
})

const catBtns = computed(() =>
  [{ cat: 'all', label: `全部 ${skillsData.value.length}` }]
    .concat(SKILL_CAT_ORDER.filter(c => catCounts.value[c]).map(c => ({ cat: c, label: `${SKILL_CAT_LABEL[c]} ${catCounts.value[c]}` })))
)

const filtered = computed(() => {
  const kw = skillKw.value.trim().toLowerCase()
  let list = skillsData.value.filter(s =>
    (skillCat.value === 'all' || skillCategoryOf(s) === skillCat.value) &&
    (!kw || s.name.toLowerCase().includes(kw) ||
      (s.description || '').toLowerCase().includes(kw) ||
      (s.tags || []).some((t: string) => t.toLowerCase().includes(kw))))
  list = [...list].sort(skillSort.value === 'name'
    ? (a, b) => a.name.localeCompare(b.name)
    : (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
  return list
})

// 全部 + 无搜索词时按分类分组展示；筛选状态下用平铺结果列表
const grouped = computed(() => {
  if (skillCat.value !== 'all' || skillKw.value.trim()) return null
  return SKILL_CAT_ORDER
    .map(cat => ({ cat, items: filtered.value.filter(s => skillCategoryOf(s) === cat) }))
    .filter(g => g.items.length)
})

function skillUrl(s: any): string {
  return s.url || (ORIGIN + '/skills/' + encodeURIComponent(s.name) + '/SKILL.md')
}
</script>

<template>
  <section id="tab-skills">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">Skill 中心</h2>
      <span id="skills-count" class="text-xs text-gray-400">{{ skillsData.length ? `共 ${filtered.length} / ${skillsData.length} 个` : '' }}</span>
    </div>
    <input v-model="skillKw" id="skill-q" type="search" placeholder="🔍 搜索名称 / 描述 / 标签…"
           class="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm mb-3">
    <div class="flex items-center gap-2 mb-4 text-xs flex-wrap">
      <span id="skill-cat-btns" class="contents">
        <button v-for="b in catBtns" :key="b.cat" :data-skill-cat="b.cat"
                class="skill-cat-btn px-3 py-1 rounded-full" :class="{ on: skillCat === b.cat }"
                @click="skillCat = b.cat">{{ b.label }}</button>
      </span>
      <select v-model="skillSort" id="skill-sort" class="ml-auto border border-gray-200 rounded-full px-2 py-1 bg-white text-gray-500">
        <option value="updated">按更新时间</option>
        <option value="name">按名称</option>
      </select>
    </div>
    <div id="skills-list" class="space-y-3">
      <div v-if="!filtered.length" class="bg-white rounded-xl shadow p-8 text-center text-gray-400 text-sm">
        {{ skillsData.length ? '没有匹配的 Skill，换个关键字或分类试试。' : '还没有 Skill 上架。' }}
      </div>
      <template v-else-if="grouped">
        <div v-for="g in grouped" :key="g.cat">
          <h3 class="text-sm font-bold text-slate-700 mb-3">{{ SKILL_CAT_LABEL[g.cat] }}<span class="text-xs font-normal text-gray-400 ml-2">{{ g.items.length }}</span></h3>
          <div class="space-y-3">
            <div v-for="s in g.items" :key="s.name" class="bg-white rounded-xl shadow p-5 flex items-center gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h3 class="font-bold">{{ s.name }}</h3>
 <span class="text-[10px] px-1.5 py-0.5 rounded bg-nec-paper text-nec-gray border border-nec-line">{{ SKILL_CAT_LABEL[skillCategoryOf(s)] }}</span>
                  <span v-if="s.source === 'gitee'" class="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-500">Gitee</span>
                  <span v-if="s.source === 'hub'" class="text-[10px] px-1.5 py-0.5 rounded bg-[#E8ECFB] text-[#1A2FA0]">中台自托管</span>
                </div>
                <p class="text-sm text-gray-500 mt-1">{{ s.description || '' }}</p>
                <div v-if="(s.tags || []).length" class="flex gap-1 mt-1.5 flex-wrap">
                  <span v-for="t in (s.tags || []).slice(0, 5)" :key="t" class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">#{{ t }}</span>
                </div>
                <p class="text-xs text-gray-400 mt-1.5">更新于 {{ new Date(s.updatedAt).toLocaleString('zh-CN') }}</p>
              </div>
              <a :href="skillUrl(s)" target="_blank"
 class="text-sm hover:underline whitespace-nowrap text-nec-cyan">查看 SKILL.md{{ s.source === 'gitee' ? ' ⤤' : '' }}</a>
            </div>
          </div>
        </div>
      </template>
      <template v-else>
        <div v-for="s in filtered" :key="s.name" class="bg-white rounded-xl shadow p-5 flex items-center gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="font-bold">{{ s.name }}</h3>
 <span class="text-[10px] px-1.5 py-0.5 rounded bg-nec-paper text-nec-gray border border-nec-line">{{ SKILL_CAT_LABEL[skillCategoryOf(s)] }}</span>
              <span v-if="s.source === 'gitee'" class="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-500">Gitee</span>
              <span v-if="s.source === 'hub'" class="text-[10px] px-1.5 py-0.5 rounded bg-[#E8ECFB] text-[#1A2FA0]">中台自托管</span>
            </div>
            <p class="text-sm text-gray-500 mt-1">{{ s.description || '' }}</p>
            <div v-if="(s.tags || []).length" class="flex gap-1 mt-1.5 flex-wrap">
              <span v-for="t in (s.tags || []).slice(0, 5)" :key="t" class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">#{{ t }}</span>
            </div>
            <p class="text-xs text-gray-400 mt-1.5">更新于 {{ new Date(s.updatedAt).toLocaleString('zh-CN') }}</p>
          </div>
          <a :href="skillUrl(s)" target="_blank"
 class="text-sm hover:underline whitespace-nowrap text-nec-cyan">查看 SKILL.md{{ s.source === 'gitee' ? ' ⤤' : '' }}</a>
        </div>
      </template>
    </div>
  </section>
</template>
