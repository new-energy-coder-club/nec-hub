<script setup lang="ts">
// 单据详情弹窗（查看 / 复制为新增）
import { computed } from 'vue'
import Modal from '@shared/ui/Modal.vue'
import { store, copyDocToForm, fmtMoneyErp, statusColor } from '../store'

const doc = computed(() => store.docModal.doc)
const payload = computed(() => doc.value?.payload || {})
const lines = computed(() => payload.value.lines || [])
const payee = computed(() => payload.value.payee || {})
const total = computed(() => lines.value.reduce((s: number, l: any) => s + (Number(l.amount) || 0), 0))
const attachments = computed(() => (payload.value.attachments || []) as string[])
</script>

<template>
  <Modal :open="store.docModal.open" :title="'单据详情 ' + (doc?.application_id || '')" max-width="760px" body-class="p-5" @close="store.docModal.open = false">
    <template v-if="doc">
      <div class="flex items-center gap-3 mb-3">
        <span class="status-badge" :style="{ background: statusColor(doc.status) }">{{ doc.status || '—' }}</span>
        <span class="text-nec-gray text-xs">申请人 {{ doc.applicant }} · {{ new Date(doc.created_at).toLocaleString('zh-CN') }}</span>
      </div>
      <table class="line-table" style="min-width:560px">
        <thead><tr><th>#</th><th>费用项目</th><th>事项</th><th>开票日期</th><th>发票号</th><th>金额</th></tr></thead>
        <tbody>
          <tr v-for="(l, i) in lines" :key="i" style="cursor:default">
            <td class="mono text-nec-gray">{{ i + 1 }}</td>
            <td>{{ l.cat }}</td>
            <td>{{ l.item }}<span v-if="l.note" class="text-xs text-nec-gray"> ({{ l.note }})</span></td>
            <td class="mono text-xs">{{ l.date || '—' }}</td>
            <td class="mono text-xs">{{ l.invno || '—' }}</td>
            <td class="mono">{{ fmtMoneyErp(l.amount) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="mt-2 text-right font-black text-nec-navy">合计 {{ fmtMoneyErp(total) }}</p>
      <div class="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-nec-gray">
        <span>支付方式：{{ payee.method || '—' }}</span><span>收款人：{{ payee.account_name || '—' }}</span>
        <span>收款账号：{{ payee.account_no || '—' }}</span><span>开户银行：{{ payee.bank || '—' }}</span>
        <span v-if="payload.noinv" class="col-span-2">无票说明：{{ payload.noinv }}</span>
        <span v-if="payload.note" class="col-span-2">备注：{{ payload.note }}</span>
        <span class="col-span-2">附件：{{ attachments.length ? attachments.join('；') : '无' }}</span>
      </div>
    </template>
    <template #footer>
      <span class="text-xs text-nec-gray">复制为新增会带出明细与收款信息，附件需重新上传</span>
      <div class="flex gap-2">
        <button id="doc-copy" class="tool-btn primary" @click="doc && copyDocToForm(doc)">复制为新增</button>
        <button id="doc-close-2" class="tool-btn ghost" @click="store.docModal.open = false">关闭</button>
      </div>
    </template>
  </Modal>
</template>
