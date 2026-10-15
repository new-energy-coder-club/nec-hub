<script setup lang="ts">
// 附件清单弹窗：待提交的本地文件 + 已存档（R2）的附件 key
import { computed } from 'vue'
import Modal from '@shared/ui/Modal.vue'
import { store, fmtSize } from '../store'

const rows = computed(() => {
  const out: { type: string; name: string; size: string; status: string }[] = []
  if (store.receiptFile) out.push({ type: '发票 / 单据', name: store.receiptFile.name, size: fmtSize(store.receiptFile.size), status: '待提交时上传' })
  if (store.paymentFile) out.push({ type: '付款凭证', name: store.paymentFile.name, size: fmtSize(store.paymentFile.size), status: '待提交时上传' })
  store.lastAttachments.forEach(k => out.push({ type: '已存档（R2）', name: k, size: '—', status: '已上传' }))
  return out
})
</script>

<template>
  <Modal :open="store.attachModalOpen" title="附件清单" max-width="560px" body-class="p-5" @close="store.attachModalOpen = false">
    <p v-if="!rows.length" class="text-nec-gray text-sm">暂无附件。在「附件」区上传发票/付款凭证，或直接 Ctrl+V 粘贴截图。</p>
    <table v-else class="line-table" style="min-width:0">
      <thead><tr><th>类型</th><th>文件 / R2 Key</th><th>大小</th><th>状态</th></tr></thead>
      <tbody>
        <tr v-for="(r, i) in rows" :key="i" style="cursor:default">
          <td class="whitespace-nowrap">{{ r.type }}</td>
          <td class="break-all" :class="{ 'mono text-xs': r.type === '已存档（R2）' }">{{ r.name }}</td>
          <td class="whitespace-nowrap">{{ r.size }}</td>
          <td class="whitespace-nowrap text-nec-gray">{{ r.status }}</td>
        </tr>
      </tbody>
    </table>
  </Modal>
</template>
