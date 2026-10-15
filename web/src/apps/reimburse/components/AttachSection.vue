<script setup lang="ts">
// 附件：发票/单据 + 付款凭证两个上传槽，选中即 OCR 识别回填选中行
import { store, recognizeFile } from '../store'

function onPick(kind: 1 | 2, ev: Event) {
  const input = ev.target as HTMLInputElement
  recognizeFile(kind, input.files && input.files[0] ? input.files[0] : null)
}
</script>

<template>
  <details class="erp-section" open>
    <summary>附件（发票 / 付款凭证 · 本地 OCR 识别回填选中行 · 支持 Ctrl+V 粘贴）</summary>
    <div class="body">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div id="slot-receipt" class="attach-slot" :class="{ has: !!store.receiptFile }" @click="($refs.receiptInput as HTMLInputElement).click()">
            <input :key="'r' + store.fileGen" ref="receiptInput" id="f-receipt" type="file" accept="image/*,application/pdf" class="hidden" @change="onPick(1, $event)" />
            <div class="text-2xl mb-1">🧾</div>
            <div class="text-sm font-semibold text-nec-navy">发票 / 单据</div>
            <div class="text-xs text-nec-gray mt-1">点击上传，自动识别金额、日期与发票号（≤10MB）</div>
          </div>
          <div id="f-receipt-status" aria-live="polite" class="text-xs text-nec-gray mt-2 min-h-4">{{ store.receiptStatus }}</div>
        </div>
        <div>
          <div id="slot-payment" class="attach-slot" :class="{ has: !!store.paymentFile }" @click="($refs.paymentInput as HTMLInputElement).click()">
            <input :key="'p' + store.fileGen" ref="paymentInput" id="f-payment" type="file" accept="image/*,application/pdf" class="hidden" @change="onPick(2, $event)" />
            <div class="text-2xl mb-1">💳</div>
            <div class="text-sm font-semibold text-nec-navy">付款凭证（选填）</div>
            <div class="text-xs text-nec-gray mt-1">微信/支付宝付款截图，可识别金额（≤10MB）</div>
          </div>
          <div id="f-payment-status" aria-live="polite" class="text-xs text-nec-gray mt-2 min-h-4">{{ store.paymentStatus }}</div>
        </div>
      </div>
    </div>
  </details>
</template>
