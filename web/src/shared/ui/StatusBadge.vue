<script setup lang="ts">
// 状态徽章：列表行的状态小圆牌（提炼自图纸评审/硬件评审/合同审批列表行的同一模式）
defineProps<{ label: string; cls?: string }>()
</script>

<template>
  <span class="text-xs px-2 py-1 rounded-full whitespace-nowrap" :class="cls || 'bg-gray-100 text-gray-600'">{{ label }}</span>
</template>
