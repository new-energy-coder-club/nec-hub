<script setup lang="ts">
// 报销审批流程图弹窗（静态 SVG）
import Modal from '@shared/ui/Modal.vue'
import { store } from '../store'
</script>

<template>
  <Modal :open="store.flowModalOpen" title="报销审批流程" max-width="640px" body-class="p-6" @close="store.flowModalOpen = false">
    <svg viewBox="0 0 560 240" class="w-full" role="img" aria-label="报销审批流程图">
      <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#1FA9E8"/></marker></defs>
      <g font-family="inherit">
        <rect x="10" y="30" width="96" height="44" rx="6" fill="#E8ECFB" stroke="#141B5E" stroke-width="1.5"/>
        <text x="58" y="56" text-anchor="middle" font-size="13" font-weight="700" fill="#141B5E">提交申请</text>
        <line x1="106" y1="52" x2="146" y2="52" stroke="#1FA9E8" stroke-width="2" marker-end="url(#arr)"/>
        <rect x="150" y="30" width="120" height="44" rx="6" fill="#fff" stroke="#1FA9E8" stroke-width="1.5"/>
        <text x="210" y="48" text-anchor="middle" font-size="13" font-weight="700" fill="#141B5E">财务/队长审批</text>
        <text x="210" y="64" text-anchor="middle" font-size="10" fill="#5A6472">群机器人通知</text>
        <line x1="270" y1="52" x2="310" y2="52" stroke="#1FA9E8" stroke-width="2" marker-end="url(#arr)"/>
        <rect x="314" y="30" width="96" height="44" rx="6" fill="#F0FDF4" stroke="#16A34A" stroke-width="1.5"/>
        <text x="362" y="56" text-anchor="middle" font-size="13" font-weight="700" fill="#15803D">已通过</text>
        <line x1="410" y1="52" x2="450" y2="52" stroke="#1FA9E8" stroke-width="2" marker-end="url(#arr)"/>
        <rect x="454" y="30" width="96" height="44" rx="6" fill="#F0FDF4" stroke="#16A34A" stroke-width="1.5"/>
        <text x="502" y="48" text-anchor="middle" font-size="13" font-weight="700" fill="#15803D">已打款</text>
        <text x="502" y="64" text-anchor="middle" font-size="10" fill="#5A6472">财务标记</text>
        <path d="M210 74 C 210 130, 480 130, 502 80" fill="none" stroke="#DC2626" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#arr)"/>
        <rect x="150" y="150" width="120" height="40" rx="6" fill="#FEF2F2" stroke="#DC2626" stroke-width="1.5"/>
        <text x="210" y="174" text-anchor="middle" font-size="13" font-weight="700" fill="#DC2626">已驳回（附意见）</text>
        <path d="M210 74 L 210 146" fill="none" stroke="#DC2626" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#arr)"/>
        <text x="330" y="220" text-anchor="middle" font-size="11" fill="#5A6472">驳回后修改明细可重新提交（新单号）；状态变更实时推飞书群</text>
      </g>
    </svg>
  </Modal>
</template>
