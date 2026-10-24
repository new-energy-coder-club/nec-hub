<script setup lang="ts">
// 审批单列表（主视图）：tabs（全部/待我审批/我提交的/已通过/已驳回，客户端过滤）+ 统计徽标 +
// 搜索（名称/编号）+ 筛选（类型/提交日期起止）+ 表格（hover 高亮 / 新单 3s 高亮 / 临期预警）+ 移动端卡片
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import {
  store, router, api, openSubmit,
  statusBadge, renderType, personLabel, typeMap,
  fmtMoney, fmtDate, daysUntil,
  type CsApproval,
} from '../store'

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '待我审批' },
  { key: 'mine', label: '我提交的' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已驳回' },
] as const
type TabKey = (typeof TABS)[number]['key']

const list = ref<CsApproval[]>([])
const loading = ref(true)
const errorMsg = ref('')
const tab = ref<TabKey>('all')
const q = ref('')
const typeFilter = ref('')
const dateFrom = ref('')
const dateTo = ref('')

const me = computed(() => store.currentUser?.open_id)

async function loadApprovals() {
  loading.value = true
  errorMsg.value = ''
  try {
    const data = await api('/api/contract-approval')
    list.value = Array.isArray(data) ? data : []
  } catch (err: any) {
    if (store.authFailed) {
      errorMsg.value = ''
      list.value = []
      return
    }
    if (/尚未配置/.test(err.message)) {
      store.notConfigured = true
      errorMsg.value = ''
      list.value = []
      return
    }
    errorMsg.value = err.message
  } finally {
    loading.value = false
  }
}

/* ---------- 过滤 ---------- */
function isTodo(r: CsApproval): boolean {
  if (!me.value) return false
  return (r.status === 'pending_approval' || r.status === 'in_review')
    && (r.approvers || []).some(a => a.approverId === me.value)
}

const counts = computed<Record<TabKey, number>>(() => ({
  all: list.value.length,
  todo: list.value.filter(isTodo).length,
  mine: list.value.filter(r => r.submittedBy === me.value).length,
  approved: list.value.filter(r => r.status === 'approved').length,
  rejected: list.value.filter(r => r.status === 'rejected').length,
}))

const filtered = computed(() => {
  const key = q.value.trim().toLowerCase()
  const t = typeFilter.value
  const from = dateFrom.value
  const to = dateTo.value
  const out = list.value.filter(r => {
    if (tab.value === 'todo' && !isTodo(r)) return false
    if (tab.value === 'mine' && (!me.value || r.submittedBy !== me.value)) return false
    if (tab.value === 'approved' && r.status !== 'approved') return false
    if (tab.value === 'rejected' && r.status !== 'rejected') return false
    if (key && !(`${r.contractName} ${r.contractNumber || ''}`.toLowerCase().includes(key))) return false
    if (t && r.contractType !== t) return false
    const d = fmtDate(r.createdAt)
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  })
  // 新提交单置顶（3 秒内）
  if (store.highlightId && Date.now() - store.highlightAt < 3000) {
    const idx = out.findIndex(r => r.approvalId === store.highlightId)
    if (idx > 0) {
      const [hit] = out.splice(idx, 1)
      out.unshift(hit)
    }
  }
  return out
})

/* ---------- 临期提醒 ---------- */
const EXPIRING_STATUSES = ['pending_approval', 'in_review', 'approved']
function expiring(r: CsApproval): boolean {
  if (!EXPIRING_STATUSES.includes(r.status)) return false
  const d = daysUntil(r.expirationDate)
  return d !== null && d >= 0 && d <= 30
}
const expiringCount = computed(() => list.value.filter(expiring).length)

function expiryCell(r: CsApproval): { text: string; cls: string } {
  const d = daysUntil(r.expirationDate)
  const base = fmtDate(r.expirationDate)
  if (d === null) return { text: base, cls: '' }
  if (d < 0) return { text: `${base} · 已过期 ${-d} 天`, cls: 'exp-over' }
  if (expiring(r)) return { text: `${base} · ${d === 0 ? '今天到期' : 'T-' + d + '天'}`, cls: 'exp-soon' }
  return { text: base, cls: '' }
}

/* ---------- 当前审批人列：in_review → pending 审批人列表，否则提交人 ---------- */
function currentApproverLabel(r: CsApproval): string {
  if (r.status === 'in_review') {
    const pending = (r.approvers || []).filter(a => a.status === 'pending')
    if (pending.length) return pending.map(a => personLabel(a.approverId, a.name)).join('、')
    return '—'
  }
  return personLabel(r.submittedBy)
}

/* ---------- 新单置顶高亮 3 秒 ---------- */
const highlightId = ref('')
let hlTimer: ReturnType<typeof setTimeout> | null = null
function armHighlight() {
  highlightId.value = store.highlightId || ''
  if (hlTimer) clearTimeout(hlTimer)
  if (highlightId.value) hlTimer = setTimeout(() => { highlightId.value = '' }, 3000)
}

onMounted(() => {
  armHighlight()
  loadApprovals()
})
onBeforeUnmount(() => { if (hlTimer) clearTimeout(hlTimer) })
watch(() => store.highlightAt, armHighlight)
watch(() => store.listTick, loadApprovals)
// 原 router('list') 每次切回列表都会重新加载
watch(() => store.view, v => { if (v === 'list') loadApprovals() })
</script>

<template>
  <div class="nec-card cs-list">
    <div class="cs-list-head">
      <div>
        <h2 class="text-lg font-bold text-nec-ink">审批单</h2>
        <p class="mono text-xs text-nec-gray tracking-wider">CONTRACT APPROVAL PIPELINE</p>
      </div>
      <button class="btn-primary cs-open-btn" @click="openSubmit()">＋ 提交审批单</button>
    </div>

    <!-- tabs：客户端过滤 + 统计徽标 -->
    <div class="cs-tabs">
      <button v-for="t in TABS" :key="t.key" type="button" class="cs-tab" :class="{ on: tab === t.key }" @click="tab = t.key">
        {{ t.label }} <span class="cs-tab-count mono">{{ counts[t.key] }}</span>
      </button>
    </div>

    <!-- 搜索 + 筛选 -->
    <div class="cs-filters">
      <input v-model="q" type="text" class="cs-filter-input flex-1 min-w-44" placeholder="搜索合同名称 / 编号" />
      <select v-model="typeFilter" class="cs-filter-input bg-white">
        <option value="">全部类型</option>
        <option v-for="(label, value) in typeMap" :key="value" :value="value">{{ label }}</option>
      </select>
      <input v-model="dateFrom" type="date" class="cs-filter-input" title="提交日期起" />
      <span class="text-xs text-nec-gray">至</span>
      <input v-model="dateTo" type="date" class="cs-filter-input" title="提交日期止" />
      <button type="button" class="text-sm font-medium px-2 link" @click="loadApprovals">刷新</button>
    </div>

    <!-- 临期横幅 -->
    <div v-if="expiringCount > 0" class="cs-expiry-banner">
      <b>{{ expiringCount }}</b> 份合同将在 30 天内到期，请尽快处理
    </div>

    <div id="approval-list">
      <p v-if="loading" class="text-sm text-nec-gray py-4">加载中…</p>
      <template v-else>
        <p v-if="store.authFailed" class="text-sm text-nec-gray py-4">请先登录后查看审批单。</p>
 <div v-else-if="store.notConfigured" class="rounded-lg p-6 text-center bg-nec-fog border border-dashed border-nec-line">
          <p class="mono text-xs tracking-widest text-nec-cyan mb-2">WAITING FOR CONFIG</p>
          <p class="text-sm text-nec-gray">完成飞书 Base 配置后，合同审批单将在这里展示。</p>
        </div>
        <p v-else-if="errorMsg" class="text-sm py-4" style="color:#C22E2E">加载失败：{{ errorMsg }}</p>

        <!-- 列表空态（带 CTA）与筛选空态区分 -->
        <div v-else-if="!list.length" class="cs-empty">
          <p>还没有审批单，点击右上角 ＋ 提交审批单 开始</p>
          <button class="btn-primary text-sm font-medium px-5 py-2 rounded-lg" @click="openSubmit()">＋ 提交审批单</button>
        </div>
        <div v-else-if="!filtered.length" class="cs-empty">
          <p>没有符合当前筛选条件的审批单，试试调整筛选或换个关键词</p>
        </div>

        <template v-else>
          <!-- 桌面表格 -->
          <div class="cs-table-wrap">
            <table class="cs-table">
              <thead>
                <tr>
                  <th>合同名称</th><th>合同编号</th><th>金额</th><th>状态</th>
                  <th>当前审批人</th><th>提交时间</th><th>到期日期</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in filtered" :key="r.approvalId" :class="{ 'row-new': r.approvalId === highlightId }" @click="router('detail', r.approvalId)">
                  <td><span class="cs-name-link">{{ r.contractName }}</span></td>
                  <td class="mono">{{ r.contractNumber || '—' }}</td>
                  <td class="mono">{{ fmtMoney(r.amount, r.currency) }}</td>
                  <td><span class="status-badge" :style="statusBadge(r.status).color">{{ statusBadge(r.status).label }}</span></td>
                  <td :title="currentApproverLabel(r)">{{ currentApproverLabel(r) }}</td>
                  <td class="mono">{{ fmtDate(r.createdAt) }}</td>
                  <td class="mono cs-exp" :class="expiryCell(r).cls">{{ expiryCell(r).text }}</td>
                  <td><button type="button" class="cs-view-btn" @click.stop="router('detail', r.approvalId)">查看</button></td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 移动端卡片（≤640px 表格退化） -->
          <div class="cs-card-list">
            <div v-for="r in filtered" :key="r.approvalId" class="cs-card-item" :class="{ 'row-new': r.approvalId === highlightId }" @click="router('detail', r.approvalId)">
              <div class="flex items-start justify-between gap-2">
                <p class="font-bold text-nec-ink text-sm">{{ r.contractName }}</p>
                <span class="status-badge flex-none" :style="statusBadge(r.status).color">{{ statusBadge(r.status).label }}</span>
              </div>
              <p class="mono text-xs text-nec-gray mt-0.5">{{ r.contractNumber || '—' }} · {{ renderType(r.contractType) }}</p>
              <div class="cs-meta">
                <span class="mono">{{ fmtMoney(r.amount, r.currency) }}</span>
                <span>提交 {{ fmtDate(r.createdAt) }}</span>
                <span class="cs-exp" :class="expiryCell(r).cls">{{ expiryCell(r).text }}</span>
              </div>
              <div class="flex items-center justify-between mt-2">
                <span class="text-xs text-nec-gray">审批人：{{ currentApproverLabel(r) }}</span>
                <button type="button" class="cs-view-btn" @click.stop="router('detail', r.approvalId)">查看</button>
              </div>
            </div>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>