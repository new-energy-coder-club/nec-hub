<script setup lang="ts">
// 数据看板：任务/物资/财务/目标四表 + 目标横幅 + 报销卡 + 我的报销 + FE-05 数据健康
import { ref, computed, watch, onMounted } from 'vue'
import { auth } from '@shared/auth'
import { copyText } from '@shared/api'
import { dashStatusColor, fmtDashDate, fmtMoney, goalBarColor, DASH_STATUS_RE } from '@shared/format'
import { renderGoalBanner, type GoalItem } from '@portal/composables/useBanners'
import { DASH_CONFIG_PROMPT } from '@shared/prompts'
import ReimburseForm from '../reimburse/ReimburseForm.vue'
import MyReimburse from './dashboard/MyReimburse.vue'
import ValidateHealth from './dashboard/ValidateHealth.vue'

const d = ref<any>(null)
const loadFailed = ref(false)
const refreshing = ref(false)

function loadDashboard(fresh?: boolean) {
  if (fresh) refreshing.value = true
  fetch('/api/dashboard' + (fresh ? '?fresh=1' : '')).then(r => r.json()).then(data => {
    d.value = data
    loadFailed.value = false
    renderGoalBanner(data.configured ? data.goals : null)
  }).catch(() => {
    loadFailed.value = true
    renderGoalBanner(null)
  }).finally(() => { refreshing.value = false })
}

onMounted(() => loadDashboard())
watch(() => auth.tick, () => loadDashboard())

// ---- FE-04 赛季目标面板 ----
function goalStatusBadge(it: any): { text: string; bg: string } {
  if (it.overdue) return { text: `已逾期 ${Math.abs(it.daysLeft)} 天`, bg: '#DC2626' }
  if (it.done) return { text: it.status || '已完成', bg: 'var(--nec-navy)' }
  if (it.daysLeft !== null && it.daysLeft <= 7) return { text: `T-${it.daysLeft} 天`, bg: '#D97706' }
  return { text: it.status || '进行中', bg: 'var(--nec-cyan)' }
}

// ---- 顶部统计卡 ----
const finVis = computed(() => d.value?.finance?.visibility ?? 'full') // 旧版后端无该字段时按 full 处理

const cards = computed(() => {
  const data = d.value
  if (!data || !data.configured) return []
  // 任务完成率：按状态名归类（取消/关闭也算已终结），逾期数来自后端全量统计
  const doneStates = (data.tasks?.byStatus ?? []).filter((s: any) => DASH_STATUS_RE.done.test(s.name) || DASH_STATUS_RE.cancel.test(s.name))
  const doneCount = doneStates.reduce((a: number, s: any) => a + s.count, 0)
  const taskTotal = data.tasks?.total ?? 0
  const taskExtraParts: Array<{ text: string; danger?: boolean }> = []
  if (taskTotal) taskExtraParts.push({ text: `完成率 ${Math.round(doneCount / taskTotal * 100)}%` })
  if (data.tasks?.overdueCount) taskExtraParts.push({ text: `逾期 ${data.tasks.overdueCount} 项`, danger: true })
  const taskExtra = taskExtraParts.length ? null : data.tasks?.byStatus?.map((s: any) => `${s.name} ${s.count}`).join(' · ')
  // 报销卡：full 显示合计 + 本月环比；summary（队员）只显示笔数，不公开金额
  const fin = data.finance ?? {}
  const mom = fin.prevMonthAmount > 0
    ? ` · 环比 ${fin.monthAmount >= fin.prevMonthAmount ? '+' : ''}${Math.round((fin.monthAmount - fin.prevMonthAmount) / fin.prevMonthAmount * 100)}%`
    : ''
  return [
    { label: '在队队员', value: data.members?.total ?? '—', extra: data.members?.byGroup?.slice(0, 3).map((g: any) => `${g.name} ${g.count}`).join(' · '), danger: false },
    { label: '任务总数', value: data.tasks?.total ?? '—', extra: taskExtra, extraParts: taskExtraParts },
    { label: '物资种类', value: data.inventory?.kinds ?? '—', extra: data.inventory?.totalQty != null ? `共 ${data.inventory.totalQty} 件` : '' },
    finVis.value === 'hidden'
      ? { label: '报销合计', value: '登录可见', extra: '队员可见笔数 · 金额仅队长/财务' }
      : finVis.value === 'summary'
        ? { label: '本月报销', value: `${fin.monthCount ?? fin.records ?? 0} 笔`, extra: '金额合计仅队长/财务可见' }
        : { label: '报销合计（元）', value: fmtMoney(fin.totalAmount), extra: `${fin.records ?? 0} 笔 · 本月 ¥${fmtMoney(fin.monthAmount ?? 0)}${mom}` },
  ]
})

// ---- 任务状态条 ----
const statusBar = computed(() => {
  const total = d.value?.tasks?.total ?? 0
  const st = d.value?.tasks?.byStatus ?? []
  return total && st.length ? { total, st } : null
})

// ---- 即将到期任务：逾期判定在前端做，用本地时区的今日零点，避免服务器时区漂移 ----
const upcoming = computed(() => {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
  const dayStartTs = dayStart.getTime()
  return (d.value?.tasks?.upcoming ?? []).map((t: any) => ({
    ...t,
    overdue: typeof t.deadline === 'number' && t.deadline < dayStartTs,
  }))
})

// ---- 物资台账：前端搜索（名称/库位）+ 缺货标红 ----
const invItems = computed(() => d.value?.inventory?.items ?? [])
const invQ = ref('')
const invFiltered = computed(() => {
  const kw = invQ.value.trim().toLowerCase()
  return kw
    ? invItems.value.filter((it: any) => it.name.toLowerCase().includes(kw) || (it.location || '').toLowerCase().includes(kw))
    : invItems.value
})

// ---- 最近报销 ----
const finRecent = computed(() => d.value?.finance?.recent ?? [])

// ---- 报销卡展开状态持久化：低频写操作折叠为可展开卡，刷新后保持 ----
const reimburseOpen = ref((() => { try { return localStorage.getItem('nec_reimburse_open') === '1' } catch { return false } })())
function onReimburseToggle(ev: Event) {
  const open = (ev.target as HTMLDetailsElement).open
  try { localStorage.setItem('nec_reimburse_open', open ? '1' : '0') } catch { /* ignore */ }
}

const statusText = computed(() => d.value?.configured
  ? `更新于 ${new Date(d.value.generatedAt).toLocaleTimeString('zh-CN')}${d.value.stale ? '（缓存快照）' : ''} · 缓存 5 分钟`
  : d.value ? '数据源未配置' : '')

const goals = computed(() => d.value?.goals)
</script>

<template>
  <section id="tab-dashboard">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">数据看板</h2>
      <div class="flex items-center gap-3">
        <span id="dash-status" class="text-xs text-gray-400">{{ statusText }}</span>
        <button id="dash-refresh" @click="loadDashboard(true)" :disabled="refreshing" title="绕过 5 分钟缓存，立即从飞书拉取最新数据" class="text-xs px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-50">{{ refreshing ? '刷新中…' : '⟳ 刷新' }}</button>
      </div>
    </div>

    <!-- 骨架屏 -->
    <div v-if="!d && !loadFailed" id="dash-body" class="space-y-4">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div v-for="i in 4" :key="i" class="bg-white rounded-xl shadow p-5 animate-pulse"><div class="h-3 w-16 bg-gray-100 rounded"></div><div class="h-8 w-20 bg-gray-100 rounded mt-2"></div></div>
      </div>
      <div class="bg-white rounded-xl shadow p-6 animate-pulse"><div class="h-4 w-32 bg-gray-100 rounded"></div><div class="h-3 bg-gray-100 rounded mt-4"></div><div class="h-3 bg-gray-100 rounded mt-2"></div><div class="h-3 w-2/3 bg-gray-100 rounded mt-2"></div></div>
    </div>

    <div v-else-if="loadFailed" class="bg-white rounded-xl shadow p-6 text-sm text-red-500">看板加载失败，请稍后重试。</div>

    <div v-else-if="!d.configured" class="bg-white rounded-xl shadow p-6 text-sm text-gray-600 space-y-3">
      <p>📊 数据源为飞书多维表格（队员名单 / 任务进度 / 物资台账 / 财务报销），尚未接入。</p>
      <p>把下面的 Prompt 发给你已接入 nec-hub MCP 的 Agent，即可完成配置：</p>
      <pre class="prompt text-sm bg-gray-900 text-green-300 rounded-lg p-4" id="dash-prompt">{{ DASH_CONFIG_PROMPT }}</pre>
      <button @click="copyText(DASH_CONFIG_PROMPT)" class="text-sm text-white px-3 py-1.5 rounded" style="background:var(--nec-navy)">复制配置 Prompt</button>
    </div>

    <div v-else id="dash-body" class="space-y-4">
      <!-- FE-04 赛季目标面板：里程碑时间线 + 各组完成度条形图 + 逾期红色告警 -->
      <div v-if="goals?.configured" class="bg-white rounded-xl shadow p-5">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-bold">赛季目标</h3>
          <div class="text-xs">
            <span v-if="goals.overdueCount" class="px-2 py-0.5 rounded text-white font-bold" style="background:#DC2626">⚠ {{ goals.overdueCount }} 项逾期未达标</span>
            <span class="text-gray-400 ml-2">{{ goals.total ?? 0 }} 项目标</span>
          </div>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div>
            <p class="text-xs text-gray-400 mb-2">里程碑时间线（按截止升序，点击跳转多维表格原始行）</p>
            <div class="space-y-2 max-h-96 overflow-y-auto pr-1">
              <p v-if="!(goals.items ?? []).length" class="text-sm text-gray-400">赛季目标表暂无数据</p>
              <a v-for="(it, i) in (goals.items ?? [])" :key="i" :href="it.link" target="_blank"
                 class="block border rounded-lg p-3 hover:shadow-md transition" :class="it.overdue ? 'border-red-300 bg-red-50' : 'border-gray-100'">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="mono text-xs whitespace-nowrap" :class="it.overdue ? 'text-red-600 font-bold' : 'text-gray-400'">{{ fmtDashDate(it.deadline) }}</span>
                  <span class="font-medium text-sm flex-1 min-w-0 truncate">{{ it.title }}</span>
                  <span class="px-2 py-0.5 rounded text-xs text-white" :style="`background:${goalStatusBadge(it).bg}`">{{ goalStatusBadge(it).text }}</span>
                </div>
                <p v-if="it.kr" class="text-xs text-gray-500 mt-1 truncate">关键结果：{{ it.kr }}</p>
                <div class="flex items-center gap-2 mt-2">
                  <span class="text-xs text-gray-400 w-16 shrink-0">{{ it.group }}</span>
                  <div class="flex-1 h-2 rounded bg-gray-100 overflow-hidden">
                    <div :style="`width:${(it.progress ?? 0).toFixed(0)}%;height:100%;background:${goalBarColor(it)}`"></div>
                  </div>
                  <span class="mono text-xs text-gray-500 w-10 text-right shrink-0">{{ it.progress === null ? '—' : Math.round(it.progress) + '%' }}</span>
                </div>
              </a>
            </div>
          </div>
          <div>
            <p class="text-xs text-gray-400 mb-2">各组平均完成度</p>
            <div class="space-y-2">
              <p v-if="!(goals.byGroup ?? []).length" class="text-sm text-gray-400">暂无分组数据</p>
              <div v-for="(b, i) in (goals.byGroup ?? [])" :key="i" class="flex items-center gap-2">
                <span class="text-xs text-gray-500 w-16 shrink-0 truncate">{{ b.name }}</span>
                <div class="flex-1 h-3 rounded bg-gray-100 overflow-hidden">
                  <div :style="`width:${b.avg}%;height:100%;background:${b.avg >= 100 ? 'var(--nec-navy)' : 'var(--nec-cyan)'}`"></div>
                </div>
                <span class="mono text-xs text-gray-500 w-16 shrink-0">{{ b.avg }}% · {{ b.count }} 项</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div v-for="(c, i) in cards" :key="i" class="bg-white rounded-xl shadow p-5">
          <div class="text-xs text-gray-400">{{ c.label }}</div>
          <div class="text-3xl font-black mt-1" style="color:var(--nec-navy)">{{ c.value }}</div>
          <div v-if="c.extraParts?.length" class="text-xs text-gray-400 mt-1">
            <template v-for="(p, j) in c.extraParts" :key="j"><span v-if="j"> · </span><span :class="{ 'text-red-500 font-bold': p.danger }">{{ p.text }}</span></template>
          </div>
          <div v-else-if="c.extra" class="text-xs text-gray-400 mt-1">{{ c.extra }}</div>
        </div>
      </div>
      <div v-if="d.members?.error" class="text-xs text-amber-600">⚠ 队员名单：{{ d.members.error }}</div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="bg-white rounded-xl shadow p-5">
          <h3 class="font-bold mb-3">任务进度</h3>
          <template v-if="statusBar">
            <div class="flex h-3 rounded overflow-hidden bg-gray-100">
              <div v-for="(s, i) in statusBar.st" :key="i" :style="`width:${(s.count / statusBar.total * 100).toFixed(1)}%;background:${dashStatusColor(s.name)}`" :title="`${s.name} ${s.count}`"></div>
            </div>
            <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
              <span v-for="(s, i) in statusBar.st" :key="i" class="inline-flex items-center"><i class="not-italic inline-block w-2.5 h-2.5 rounded-sm mr-1" :style="`background:${dashStatusColor(s.name)}`"></i>{{ s.name }} {{ s.count }}</span>
            </div>
          </template>
          <p v-else class="text-sm text-gray-400">暂无任务数据</p>
          <template v-if="upcoming.length">
            <p class="text-xs text-gray-400 mt-3">即将到期（点击任务名跳转飞书原始记录）</p>
            <div class="overflow-x-auto">
              <table class="w-full text-sm mt-1">
                <thead><tr class="text-left text-xs text-gray-400">
                  <th class="pb-1 font-medium">任务</th><th class="pb-1 font-medium">负责人</th><th class="pb-1 font-medium">状态</th><th class="pb-1 font-medium">截止</th>
                </tr></thead>
                <tbody>
                  <tr v-for="(t, i) in upcoming" :key="i" class="border-t border-gray-100" :class="{ 'bg-red-50': t.overdue }">
                    <td class="py-2 pr-3">
                      <a v-if="t.link" :href="t.link" target="_blank" class="hover:underline" style="color:var(--nec-cyan)">{{ t.title || '—' }}</a>
                      <template v-else>{{ t.title || '—' }}</template>
                      <span v-if="t.overdue" class="px-1.5 py-0.5 rounded text-[10px] text-white font-bold" style="background:#DC2626">已逾期</span>
                    </td>
                    <td class="py-2 pr-3 text-gray-500 whitespace-nowrap">{{ t.owner || '—' }}</td>
                    <td class="py-2 pr-3 whitespace-nowrap"><span class="px-2 py-0.5 rounded text-xs text-white" :style="`background:${dashStatusColor(t.status)}`">{{ t.status || '未标注' }}</span></td>
                    <td class="py-2 mono text-xs whitespace-nowrap" :class="t.overdue ? 'text-red-600 font-bold' : 'text-gray-400'">{{ fmtDashDate(t.deadline) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
          <div v-if="d.tasks?.error" class="text-xs text-amber-600 mt-2">⚠ {{ d.tasks.error }}</div>
        </div>
        <div class="bg-white rounded-xl shadow p-5">
          <h3 class="font-bold mb-3">物资台账</h3>
          <template v-if="invItems.length">
            <input v-model="invQ" id="inv-search" placeholder="搜索物料 / 库位…" class="w-full border rounded px-2 py-1.5 text-sm mb-2" />
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead><tr class="text-left text-xs text-gray-400">
                  <th class="pb-1 font-medium">物料</th><th class="pb-1 font-medium">数量</th><th class="pb-1 font-medium">位置</th>
                </tr></thead>
                <tbody id="inv-tbody">
                  <tr v-if="!invFiltered.length"><td colspan="3" class="py-3 text-sm text-gray-400">无匹配「{{ invQ.trim().toLowerCase() }}」的物资</td></tr>
                  <tr v-for="(it, i) in invFiltered" :key="i" class="border-t border-gray-100" :class="{ 'bg-red-50': it.qty === 0 }">
                    <td class="py-2 pr-3">{{ it.name }}</td>
                    <td class="py-2 pr-3 mono text-xs whitespace-nowrap" :class="{ 'text-red-600 font-bold': it.qty === 0 }">
                      {{ it.qty ?? '—' }}
                      <span v-if="it.qty === 0" class="px-1 py-0.5 rounded text-[10px] text-white" style="background:#DC2626">缺货</span>
                    </td>
                    <td class="py-2 text-gray-400 text-xs">{{ it.location || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
          <p v-else class="text-sm text-gray-400">暂无物资数据</p>
          <p v-if="(d.inventory?.kinds ?? 0) > (d.inventory?.items?.length ?? 0)" class="text-xs text-gray-400 mt-2">仅展示前 50 条</p>
          <div v-if="d.inventory?.error" class="text-xs text-amber-600 mt-2">⚠ {{ d.inventory.error }}</div>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow p-5">
        <h3 class="font-bold mb-2">最近报销</h3>
        <ul v-if="finVis === 'full' && finRecent.length">
          <li v-for="(f, i) in finRecent" :key="i" class="flex items-baseline gap-2 py-1.5 border-t border-gray-100 text-sm">
            <span class="text-gray-400 mono text-xs whitespace-nowrap">{{ fmtDashDate(f.date) }}</span>
            <span class="flex-1 truncate">{{ f.name }}<i v-if="f.applicant" class="not-italic text-xs text-gray-400 ml-1">{{ f.applicant }}</i></span>
            <span class="mono text-xs whitespace-nowrap text-right">{{ f.amount != null ? '¥' + fmtMoney(f.amount) : '—' }}</span>
          </li>
        </ul>
        <p v-else-if="finVis === 'full'" class="text-sm text-gray-400">暂无报销数据</p>
        <p v-else-if="finVis === 'summary'" class="text-sm text-gray-400">本月已报销 <b style="color:var(--nec-navy)">{{ d.finance?.monthCount ?? d.finance?.records ?? 0 }}</b> 笔 · 金额明细仅队长/财务角色可见。</p>
        <p v-else class="text-sm text-gray-400">报销数据登录后可见：队员可见笔数，金额明细仅队长/财务。</p>
        <div v-if="d.finance?.error" class="text-xs text-amber-600 mt-2">⚠ {{ d.finance.error }}</div>
      </div>

      <!-- 报销提交卡：低频写操作折叠为可展开卡，展开状态存 localStorage，刷新后保持 -->
      <details class="bg-white rounded-xl shadow" :open="reimburseOpen" @toggle="onReimburseToggle">
        <summary class="cursor-pointer select-none p-5 font-bold flex items-center justify-between" style="list-style:none">
          <span>🧾 提交报销</span>
          <span class="text-xs text-gray-400 font-normal">点击展开 · 发票/凭证 OCR 自动识别回填</span>
        </summary>
        <div id="reimburse-slot" class="px-5 pb-5">
          <ReimburseForm v-if="auth.me.authenticated" @submitted="loadDashboard()" />
          <div v-else class="text-sm text-gray-500">🔐 登录后可在线提交报销：上传发票图片/PDF 自动识别金额、日期与发票号，识别均在本地完成。</div>
        </div>
      </details>

      <MyReimburse />

      <p class="text-xs text-gray-400">数据源：飞书多维表格（base {{ d.base }}）· 队员名单 / 任务进度 / 物资台账 / 财务报销{{ d.goals?.configured ? ' / 赛季目标' : '' }} · 5 分钟缓存 · 财务区按登录角色脱敏</p>
    </div>

    <!-- FE-05 数据健康：按类型分组的异常清单 -->
    <ValidateHealth />
  </section>
</template>
