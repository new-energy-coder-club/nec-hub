<script setup lang="ts">
// 费用报销单据列表（台账，对标 ERP 报销单列表页）：8 列只读表格 + 搜索/排序/状态筛选/分页
// 数据源：队长/财务走 /api/erp/reimburse/manage（全量分页，loadLedger 内选路）；普通成员回退 docs/mine 映射
// 状态筛选为前端过滤；行点击无动作（详情查看仍在「我的报销」视图提供）
import { computed } from 'vue'
import { auth, tryStartLogin } from '@shared/auth'
import { store, loadLedger, searchLedger, gotoForm, fmtMoneyErp, statusColor, type LedgerRow } from '../store'

const STATUS_FILTERS = ['全部', '审批中', '已通过', '已驳回', '已打款', '已完成']

const authed = computed(() => !!(auth.me.authenticated && auth.me.user))
const isLogin = computed(() => !authed.value || store.ledger.state === 'login')
const isLoading = computed(() => store.ledger.state === 'loading')
const isError = computed(() => store.ledger.state === 'error')
const loaded = computed(() => store.ledger.state === 'idle' || store.ledger.state === 'mine')
const rows = computed<LedgerRow[]>(() => {
  const f = store.ledger.statusFilter
  return f === '全部' ? store.ledger.docs : store.ledger.docs.filter(d => d.status === f)
})
const totalPages = computed(() => Math.max(1, Math.ceil((loaded.value ? store.ledger.total : 0) / store.ledger.pageSize)))
const sortLabel = computed(() => (store.ledger.sort === 'desc' ? '日期 ↓' : '日期 ↑'))

function onLoginClick() {
  tryStartLogin()
}

function toggleSort() {
  store.ledger.sort = store.ledger.sort === 'desc' ? 'asc' : 'desc'
  store.ledger.page = 1
  loadLedger()
}

function prevPage() { if (store.ledger.page > 1) { store.ledger.page--; loadLedger() } }
function nextPage() { if (store.ledger.page < totalPages.value) { store.ledger.page++; loadLedger() } }
function fmtDate(ts: number) { return ts ? new Date(ts).toLocaleDateString('zh-CN') : '—' }
</script>

<template>
  <div id="ledger-view" class="space-y-3">
    <section class="erp-section">
      <div class="ledger-head">
        <span>费用报销单据列表</span>
        <span class="text-xs font-normal text-nec-gray ml-auto">财务台账 · 数据只读</span>
      </div>
      <div class="body">
        <!-- 台账工具栏：新增 / 搜索 / 日期排序 / 状态筛选 -->
        <div class="flex items-center gap-2 flex-wrap mb-3">
          <button id="ledger-new" class="tool-btn primary" @click="gotoForm">＋ 新增报销</button>
          <div class="flex items-center gap-2 flex-1" style="min-width:220px; max-width:420px; margin-left:auto">
            <input
              id="ledger-search"
              v-model="store.ledger.q"
              class="ledger-input flex-1"
              style="min-width:0"
              placeholder="单据编号 / 报销事由"
              @keyup.enter="searchLedger"
            />
            <button id="ledger-search-btn" class="tool-btn ghost" @click="searchLedger">搜索</button>
          </div>
          <button id="ledger-sort" class="tool-btn ghost" title="按审核/单据日期排序" @click="toggleSort">{{ sortLabel }}</button>
          <select id="ledger-status" v-model="store.ledger.statusFilter" class="ledger-input" title="状态筛选（前端过滤）">
            <option v-for="s in STATUS_FILTERS" :key="s" :value="s">{{ s === '全部' ? '全部状态' : s }}</option>
          </select>
        </div>

        <!-- 登录引导 -->
        <div v-if="isLogin" id="ledger-login" class="py-10 text-center space-y-3">
          <div class="text-3xl">🔐</div>
          <p class="text-sm text-nec-gray">登录后查看费用报销单据列表（队长/财务可见全员单据）</p>
          <button class="tool-btn primary" @click="onLoginClick">飞书登录</button>
        </div>
        <p v-else-if="isLoading" class="text-sm text-nec-gray py-10 text-center">加载中…</p>
        <p v-else-if="isError" class="text-sm text-red-500 py-10 text-center">
          加载失败，请稍后重试。<button class="link-btn" @click="loadLedger">重试</button>
        </p>

        <!-- 台账表格 -->
        <div v-else>
          <div class="overflow-x-auto">
            <table class="line-table" style="min-width:980px">
              <thead>
                <tr>
                  <th>单据编号</th>
                  <th>报销事由</th>
                  <th>申请人</th>
                  <th>核定金额</th>
                  <th>已付现金额</th>
                  <th>当前处理人</th>
                  <th>单据日期</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="d in rows" :key="d.application_id" style="cursor:default">
                  <td class="mono text-xs whitespace-nowrap">{{ d.application_id }}</td>
                  <td style="max-width:280px"><span class="ledger-title">{{ d.title }}</span><span v-if="d.lines > 1" class="text-xs text-nec-gray"> 等 {{ d.lines }} 项</span></td>
                  <td class="whitespace-nowrap">{{ d.applicant }}</td>
                  <td class="mono whitespace-nowrap">{{ fmtMoneyErp(d.total) }}</td>
                  <td class="mono whitespace-nowrap">{{ d.paid == null ? '—' : fmtMoneyErp(d.paid) }}</td>
                  <td class="whitespace-nowrap">{{ d.handler }}</td>
                  <td class="text-nec-gray text-xs whitespace-nowrap">{{ fmtDate(d.created_at) }}</td>
                  <td class="whitespace-nowrap"><span class="status-badge" :style="{ background: statusColor(d.status) }">{{ d.status || '—' }}</span></td>
                </tr>
              </tbody>
            </table>
            <p v-if="!rows.length" class="text-sm text-nec-gray py-8 text-center">
              暂无报销单据。<button class="link-btn" @click="gotoForm">去填报第一笔 →</button>
            </p>
          </div>

          <!-- 分页：共 N 条 · 20 条/页 · 上一页/下一页 + 当前页/总页数 -->
          <div id="ledger-pager" class="flex items-center justify-end gap-3 mt-3 text-sm text-nec-gray flex-wrap">
            <span>共 {{ loaded ? store.ledger.total : 0 }} 条 · 20 条/页</span>
            <div class="flex items-center gap-2">
              <button class="tool-btn ghost" :disabled="store.ledger.page <= 1" @click="prevPage">上一页</button>
              <span class="mono text-xs">第 {{ store.ledger.page }} / {{ totalPages }} 页</span>
              <button class="tool-btn ghost" :disabled="store.ledger.page >= totalPages" @click="nextPage">下一页</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>