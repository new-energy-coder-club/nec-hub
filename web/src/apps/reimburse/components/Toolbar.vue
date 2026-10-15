<script setup lang="ts">
// ERP 工具栏：保存 / 提交 / 提交并新增 / 流程图 / 附件 / 退出 + 单据状态徽章
import { store, canSubmit, saveDraftNow, submitReimburse } from '../store'

const props = defineProps<{ embedded?: boolean }>()
const emit = defineEmits<{ (e: 'exit'): void }>()

const STATUS_BG: Record<string, string> = { '暂存': '#9CA3AF', '审批中': '#1FA9E8' }
</script>

<template>
  <div class="erp-toolbar" :style="{ top: props.embedded ? '0' : '48px' }">
    <div class="max-w-6xl mx-auto px-4 py-2 flex items-center gap-2 flex-wrap">
      <button id="btn-save" class="tool-btn ghost" title="草稿保存在浏览器本地" @click="saveDraftNow">💾 保存</button>
      <button id="btn-submit" class="tool-btn primary" :disabled="!canSubmit" @click="submitReimburse(false)">提交</button>
      <button id="btn-submit-new" class="tool-btn ghost" :disabled="!canSubmit" @click="submitReimburse(true)">提交并新增</button>
      <button id="btn-flow" class="tool-btn ghost" @click="store.flowModalOpen = true">查看流程图</button>
      <button id="btn-attach" class="tool-btn ghost" @click="store.attachModalOpen = true">查看附件</button>
      <button id="btn-exit" class="tool-btn ghost" @click="emit('exit')">退出</button>
      <span class="ml-auto flex items-center gap-3">
        <span class="text-xs text-nec-gray">单据状态</span>
        <span id="doc-status" class="status-badge" :style="{ background: STATUS_BG[store.docStatus] || '#5A6472' }">{{ store.docStatus }}</span>
      </span>
    </div>
  </div>
</template>
