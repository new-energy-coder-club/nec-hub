<script setup lang="ts">
// PRD 看板（动态）：里程碑三列卡片 + 总进度 + 最近提交（GET /api/prd）
// + PRD 文档库在线阅读（/docs/prd/*.md，marked 按需加载）
import { ref, computed, onMounted } from 'vue'
import { loadMarked } from '@shared/cdn'

const PRD_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  done:     { label: '已完成', color: '#16A34A', bg: '#ECFDF5' },
  partial:  { label: '进行中', color: '#1FA9E8', bg: '#EFF8FF' },
  pending:  { label: '待验收', color: '#D97706', bg: '#FFFBEB' },
  todo:     { label: '未开始', color: '#9CA3AF', bg: '#F9FAFB' },
}
function metaOf(status: string) {
  return PRD_STATUS_META[status] ?? PRD_STATUS_META.todo
}

const board = ref<any>(null)
const loadFailed = ref(false)

// 大项卡片的子项（如 FE-04 › FE-18）：悬停浮层展示，不计入里程碑进度
function subList(c: any) {
  return Object.entries(c.subs ?? {}).map(([id, s]: [string, any]) => ({ id, ...s }))
}

// PRD 文档库：docs/ 下全部 PRD 在线阅读（原文同步自 docs/*.md → public/docs/prd/）
// html: true 的条目为独立 HTML 图页（marked 不适用），经 iframe 嵌入阅读器
const PRD_DOCS = [
  { slug: 'team-ai-platform-v2.1',       title: '团队 AI 中台 PRD',              version: 'V2.1', date: '2026-10-16', desc: '中台总纲：M1 地基 / M2 资产与智能 / M3 个性化与自动化 / M4 业务流程域，FE-01 ~ FE-18 需求全景（上方看板的数据来源）' },
  { slug: 'approval-notification-v1.1',  title: '审批与通知中心 PRD',            version: 'V1.1', date: '2026-10-12', desc: '报销 / 机械图纸 / 硬件采购领用 / 合规四条流程，流程即配置的 Plan B 审批引擎' },
  { slug: 'approval-notification-v1.2',  title: '审批与通知中心 PRD（缺口补齐）', version: 'V1.2', date: '2026-10-14', desc: '台账联动、合规申请页、审批时效治理、待办 T-1 标红、邮件通道（飞书邮箱）' },
  { slug: 'contract-signing-oa-v1.0',    title: '协议签署 OA 审批 PRD',          version: 'V1.0', date: '2026-10-14', desc: '合作协议 / 保密协议（NDA）走飞书原生 OA 审批：法务 → 运营 → 合规三级串行审核，全部通过方可签署用章' },
  { slug: 'drawing-review-process-v1.0', title: '新增机图纸评审流程 PRD',         version: 'v1.0', date: '2026-10-14', desc: '图纸评审数字化工作流：在线提交、会议自动预约、BOM/电控/布线评估、询价与发货清单' },
  { slug: '416mes-architecture',         title: '416MES 架构与数据流图',          version: 'V1.0', date: '2026-10-19', desc: '416MES 仓储执行系统全景：门户/中台/飞书多维表格/MES 四层架构与数据流向（宽画布图页）', html: true },
]

const readerSlug = ref('')
const readerTitle = ref('')
const readerHtml = ref('')
const readerLoading = ref(false)

onMounted(() => {
  fetch('/api/prd').then(r => r.json()).then(d => { board.value = d }).catch(() => { loadFailed.value = true })
})

const progress = computed(() => {
  const total = board.value?.progress?.total ?? 0
  const done = board.value?.progress?.done ?? 0
  return { total, done, pct: total ? Math.round(done / total * 100) : 0 }
})

async function openPrdDoc(slug: string) {
  const doc = PRD_DOCS.find(d => d.slug === slug)
  if (!doc) return
  if (readerSlug.value === slug) { closePrdDoc(); return }
  readerSlug.value = slug
  readerTitle.value = `${doc.title} ${doc.version}`
  readerHtml.value = ''
  readerLoading.value = true
  document.getElementById('prd-reader')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // HTML 图页：marked 不适用，iframe 直接嵌入（团队自有静态页，非用户输入）
  if ((doc as { html?: boolean }).html) {
    readerHtml.value = `<iframe src="/docs/prd/${slug}.html" title="${doc.title}" style="width:100%;height:72vh;border:0" loading="lazy"></iframe>`
    readerLoading.value = false
    return
  }
  try {
    const [md] = await Promise.all([
      fetch('/docs/prd/' + slug + '.md').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text() }),
      loadMarked(),
    ])
    if (readerSlug.value !== slug) return
    // marked 渲染团队自有的 markdown 文档（非用户输入）
    readerHtml.value = (window as any).marked.parse(md)
  } catch {
    readerHtml.value = ''
  } finally {
    readerLoading.value = false
  }
}

function closePrdDoc() {
  readerSlug.value = ''
  readerHtml.value = ''
}
</script>

<template>
  <section id="tab-prd">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">PRD 看板</h2>
      <span id="prd-status" class="text-xs text-gray-400">{{ board ? `更新于 ${new Date(board.updatedAt).toLocaleString('zh-CN')}` : '' }}</span>
    </div>
    <div id="prd-progress" class="mb-4">
      <div v-if="board" class="bg-white rounded-xl shadow p-5">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-bold">总进度</span>
 <span class="text-sm font-black text-nec-navy">{{ progress.done }} / {{ progress.total }}（{{ progress.pct }}%）</span>
        </div>
        <div class="h-3 rounded overflow-hidden bg-gray-100">
          <div class="h-3 rounded" :style="`width:${progress.pct}%;background:linear-gradient(90deg,var(--nec-cyan),var(--nec-sky))`"></div>
        </div>
      </div>
    </div>
    <div id="prd-last-commit" class="mb-4">
      <div v-if="board?.lastCommit" class="bg-white rounded-xl shadow p-4 flex items-center gap-3 text-sm">
 <span class="px-2 py-0.5 rounded text-xs text-white bg-nec-navy">最近提交</span>
 <a :href="board.lastCommit.url" target="_blank" class="hover:underline truncate text-nec-cyan">{{ board.lastCommit.message }}</a>
        <span class="text-xs text-gray-400 whitespace-nowrap">{{ board.lastCommit.branch }} · {{ board.lastCommit.author }} · {{ new Date(board.lastCommit.at).toLocaleString('zh-CN') }}</span>
      </div>
    </div>
    <div id="prd-board" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      <div v-if="loadFailed" class="bg-white rounded-xl shadow p-6 text-sm text-red-500">PRD 看板加载失败，请稍后重试。</div>
      <div v-else-if="!board" class="bg-white rounded-xl shadow p-6 text-sm text-gray-400">加载中…</div>
      <div v-else v-for="m in (board.milestones ?? [])" :key="m.id" class="bg-white rounded-xl shadow p-5">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-bold">{{ m.id }} · {{ m.title }}</h3>
          <span class="text-xs text-gray-400">{{ m.done }}/{{ m.total }}</span>
        </div>
        <div class="h-1.5 rounded bg-gray-100 mb-4"><div class="h-1.5 rounded" :style="`width:${m.total ? m.done / m.total * 100 : 0}%;background:var(--nec-cyan)`"></div></div>
        <div class="space-y-2">
          <div v-for="c in m.cards" :key="c.id" class="group relative rounded-lg p-3 border border-gray-100" :style="`background:${metaOf(c.status).bg}`">
            <div class="flex items-center justify-between gap-2">
 <span class="font-bold text-sm text-nec-navy">{{ c.id }}</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded text-white" :style="`background:${metaOf(c.status).color}`">{{ metaOf(c.status).label }}</span>
            </div>
 <p class="text-xs mt-1 text-nec-ink">{{ c.title }}</p>
            <p class="text-[10px] text-gray-400 mt-0.5">{{ c.priority }}{{ c.note ? ' · ' + c.note : '' }}</p>
 <p v-if="subList(c).length" class="text-[10px] mt-1 text-nec-cyan">▸ {{ subList(c).length }} 个子项，悬停查看</p>
            <!-- 子项悬停浮层 -->
            <div v-if="subList(c).length" class="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity duration-150 absolute left-0 right-0 top-full mt-1 z-30 bg-white rounded-lg shadow-lg border border-gray-100 p-2.5 space-y-2">
              <div v-for="s in subList(c)" :key="s.id" class="rounded-lg p-2.5 border border-gray-100" :style="`background:${metaOf(s.status).bg}`">
                <div class="flex items-center justify-between gap-2">
 <span class="font-bold text-[11px] text-nec-navy">{{ s.id }}</span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded text-white" :style="`background:${metaOf(s.status).color}`">{{ metaOf(s.status).label }}</span>
                </div>
 <p class="text-[11px] mt-0.5 text-nec-ink">{{ s.title }}</p>
                <p class="text-[10px] text-gray-400 mt-0.5">{{ s.priority }}{{ s.note ? ' · ' + s.note : '' }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <p class="text-xs text-gray-400 mt-3">状态由 Agent 经 NEC-MCP 的 update_prd 维护（done / partial / pending / todo）；FE-01 ~ FE-18，子项（如 FE-04 › FE-18）悬停大项卡片查看；每次 git 提交会推送飞书群并在上方显示最近提交。</p>

    <!-- PRD 文档库：docs/ 下全部 PRD 在线阅读（markdown 原文静态托管于 /docs/prd/，marked 按需加载） -->
    <div class="mt-8">
      <h3 class="text-base font-bold mb-3">PRD 文档库</h3>
      <div id="prd-docs" class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div v-for="d in PRD_DOCS" :key="d.slug" class="bg-white rounded-xl shadow p-5 flex flex-col">
          <div class="flex items-center gap-2 mb-1.5">
 <span class="text-[10px] px-1.5 py-0.5 rounded text-white bg-nec-navy">{{ d.version }}</span>
            <span class="text-[10px] text-gray-400">更新于 {{ d.date }}</span>
          </div>
 <h4 class="font-bold text-sm text-nec-navy">{{ d.title }}</h4>
          <p class="text-xs text-gray-500 mt-1 flex-1">{{ d.desc }}</p>
 <button @click="openPrdDoc(d.slug)" class="mt-3 self-start text-xs px-3 py-1.5 rounded-lg text-white bg-nec-cyan">在线阅读</button>
        </div>
      </div>
      <div v-show="readerSlug" id="prd-reader" class="mt-4 bg-white rounded-xl shadow p-6">
        <div class="flex items-center justify-between mb-3">
 <h4 id="prd-reader-title" class="font-bold text-sm text-nec-navy">{{ readerTitle }}</h4>
          <button @click="closePrdDoc" class="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">收起</button>
        </div>
        <p v-if="readerLoading" class="text-gray-400 text-sm">加载中…</p>
        <p v-else-if="!readerHtml && readerSlug" class="text-red-500 text-sm">文档加载失败，请稍后重试。</p>
        <!-- marked 渲染团队自有的 markdown 文档（非用户输入） -->
 <div v-else id="prd-reader-body" class="prd-doc text-sm leading-6 text-nec-ink" v-html="readerHtml"></div>
      </div>
    </div>
  </section>
</template>
