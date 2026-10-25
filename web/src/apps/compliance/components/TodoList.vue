<script setup lang="ts">
// STEP 02 待我审批：GET /api/approvals/pending?type=compliance；通过（prompt 意见）/ 驳回（手风琴面板，标准化原因）
import { store, REJECT_REASONS, fmtMs, loadTodos, toggleRejectPanel, doApprove, doReject } from '../store'
</script>

<template>
  <section class="nec-card p-5">
    <div class="mb-4 flex items-baseline justify-between gap-2">
      <div>
        <span class="step-badge">STEP 02</span>
        <h2 class="text-lg font-bold text-nec-ink mt-1">待我审批</h2>
        <p class="mono text-xs text-nec-gray tracking-wider">PENDING APPROVALS · 仅审批人角色有内容</p>
      </div>
      <button id="todos-refresh" class="text-xs link whitespace-nowrap" @click="loadTodos">刷新</button>
    </div>
    <div id="todos-list" class="text-sm text-nec-gray">
      <p v-if="store.todos.state === 'idle' || store.todos.state === 'loading'">加载中…</p>
      <p v-else-if="store.todos.state === 'login'" class="text-nec-gray">登录后可见。</p>
      <p v-else-if="store.todos.state === 'error'" class="text-red-500">加载失败，请稍后重试。</p>
      <p v-else-if="store.todos.state === 'empty'" class="text-nec-gray">暂无待你审批的合规申请（仅审批人可见待审列表）。</p>
      <div v-else class="space-y-3">
 <div v-for="r in store.todos.records" :key="r.application_id" class="rounded-lg p-4 border border-nec-line">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p class="font-bold text-nec-ink"><span class="mono text-nec-royal">{{ r.application_id || '' }}</span> · {{ r.title || '—' }}</p>
              <p class="mono text-xs text-nec-gray mt-0.5">申请人 {{ r.applicant || '—' }} · 提交于 {{ r.submitted_at ? fmtMs(r.submitted_at) : '—' }}</p>
            </div>
            <div class="flex gap-2 items-center">
              <a v-if="r.url" :href="r.url" target="_blank" rel="noopener" class="text-xs link hover:underline mono">底表详情 →</a>
              <button class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:#16A34A" @click="doApprove(r.application_id)">通过</button>
              <button class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:#DC2626" @click="toggleRejectPanel(r.application_id)">驳回</button>
            </div>
          </div>
          <div v-show="r.rejectOpen" class="mt-3 rounded-lg p-3" style="border:1px solid #F0A8A8;background:#FEF7F7">
            <label class="block text-xs font-medium text-nec-navy">驳回原因 <span class="text-red-500">*</span>
              <select class="field-input text-xs" v-model="r.rejectReason">
                <option value="">请选择驳回原因</option>
                <option v-for="o in REJECT_REASONS" :key="o">{{ o }}</option>
              </select>
            </label>
            <label class="block text-xs font-medium text-nec-navy mt-2">审批意见（选「其他」时必填；驳回均建议填写）
              <textarea rows="2" class="field-input text-xs" v-model="r.rejectComment" placeholder="驳回的具体说明，将通知申请人"></textarea>
            </label>
            <p v-show="r.rejectErr" class="mt-2 text-xs text-red-600">{{ r.rejectErr }}</p>
            <div class="mt-2 flex gap-2">
              <button class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:#DC2626" @click="doReject(r.application_id)">确认驳回</button>
              <button class="text-xs px-3 py-1.5 rounded-lg link" @click="toggleRejectPanel(r.application_id)">取消</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
