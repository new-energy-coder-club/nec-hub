<script setup lang="ts">
// 审批单列表视图：GET /api/contract-approval，含未登录 / 未配置 / 加载失败三态
import { ref, onMounted, watch } from 'vue'
import { store, router, api, statusBadge, renderType, personLabel, type CsApproval } from '../store'

const list = ref<CsApproval[]>([])
const loading = ref(true)
const errorMsg = ref('')

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

function fmtTime(v?: string): string {
  return v ? new Date(v).toLocaleString('zh-CN') : '—'
}

function approvedCount(r: CsApproval): number {
  return (r.approvers || []).filter(a => a.status === 'approved').length
}

onMounted(loadApprovals)
// 原 router('list') 每次切回列表都会重新加载
watch(() => store.view, v => { if (v === 'list') loadApprovals() })
</script>

<template>
  <div class="nec-card p-5">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-lg font-bold text-nec-ink">审批单</h2>
        <p class="mono text-xs text-nec-gray tracking-wider">CONTRACT APPROVAL PIPELINE</p>
      </div>
      <button class="text-sm font-medium px-2 link" @click="loadApprovals">刷新</button>
    </div>
    <div id="approval-list" class="space-y-3">
      <p v-if="loading" class="text-sm text-nec-gray">加载中…</p>
      <template v-else>
        <p v-if="store.authFailed" class="text-sm text-nec-gray">请先登录后查看审批单。</p>
        <div v-else-if="store.notConfigured" class="rounded-lg p-6 text-center" style="background:var(--nec-fog);border:1px dashed var(--nec-line)">
          <p class="mono text-xs tracking-widest text-nec-cyan mb-2">WAITING FOR CONFIG</p>
          <p class="text-sm text-nec-gray">完成飞书 Base 配置后，合同审批单将在这里展示。</p>
        </div>
        <p v-else-if="errorMsg" class="text-sm" style="color:#C22E2E">加载失败：{{ errorMsg }}</p>
        <template v-else>
          <p v-if="!list.length" class="text-sm text-nec-gray">暂无审批单，点击右上角「新建提交」发起第一份合同审批。</p>
          <div
            v-for="r in list"
            :key="r.approvalId"
            class="rounded-lg p-4 cursor-pointer transition-shadow hover:shadow-md"
            style="border:1px solid var(--nec-line);background:var(--nec-paper)"
            @click="router('detail', r.approvalId)"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <p class="font-bold text-nec-ink truncate"><span class="mono text-nec-royal">{{ r.approvalId }}</span> · {{ r.contractName }}</p>
                <p class="mono text-xs text-nec-gray mt-0.5">{{ r.contractNumber ? r.contractNumber + ' · ' : '' }}{{ renderType(r.contractType) }}</p>
              </div>
              <span class="status-badge" :style="statusBadge(r.status).color">{{ statusBadge(r.status).label }}</span>
            </div>
            <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs items-center text-nec-gray">
              <span>提交人：<span :title="r.submittedBy">{{ personLabel(r.submittedBy) }}</span></span>
              <span>审批人 {{ (r.approvers || []).length }} 名（通过 {{ approvedCount(r) }}）</span>
              <span class="mono">提交于 {{ fmtTime(r.createdAt) }}</span>
            </div>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
