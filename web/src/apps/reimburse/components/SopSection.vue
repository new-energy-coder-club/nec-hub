<script setup lang="ts">
// SOP 校验清单 + 提交按钮 + 成功卡片
import { store, sopList, canSubmit, submitReimburse, resetAll } from '../store'
</script>

<template>
  <details class="erp-section" open>
    <summary>SOP 校验（财务报销规范 · 全部通过后方可提交）</summary>
    <div class="body">
      <div id="sop-list">
        <p class="mono text-[11px] text-nec-gray tracking-wider mb-1">SOP CHECKLIST · {{ sopList.filter(c => c.pass).length }}/{{ sopList.length }} 通过</p>
        <div v-for="c in sopList" :key="c.key" class="sop-item" :class="c.pass ? 'pass' : 'fail'">
          <span class="sop-dot" :class="c.pass ? 'sop-pass' : 'sop-fail'">{{ c.pass ? '✓' : '✕' }}</span>
          <span>{{ c.label }}</span>
        </div>
      </div>
 <div class="flex items-center gap-3 mt-4 pt-3 border-t border-nec-line">
        <button id="btn-submit-2" class="tool-btn primary" :disabled="!canSubmit" @click="submitReimburse(false)">提交报销申请</button>
        <span id="submit-status" aria-live="polite" class="text-xs text-nec-gray">{{ store.submitStatus }}</span>
      </div>
      <div v-if="store.successVisible" id="success-card" class="mt-4 rounded-lg p-5" style="border:1.5px solid #16A34A;background:#F0FDF4">
        <div class="flex items-center gap-2 text-green-700 font-bold">✅ 已提交，审批中</div>
        <p class="mt-2 text-sm text-nec-ink">申请单号：<span id="success-id" class="mono font-black text-nec-navy">{{ store.successId }}</span></p>
        <p class="mt-1 text-xs text-nec-gray">审批由财务/队长处理，结果将通过飞书群机器人通知；可在下方「我的报销」随时查看状态。</p>
        <button id="success-again" class="mt-3 link-btn" @click="resetAll">再报一笔 →</button>
      </div>
    </div>
  </details>
</template>
