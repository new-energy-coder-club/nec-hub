<script setup lang="ts">
// 状态统计条兼筛选器：胶囊按钮组（提炼自图纸评审/硬件评审/合同审批的状态统计条同一模式）
defineProps<{ chips: { key: string; label: string }[]; active: string }>()
const emit = defineEmits<{ (e: 'select', key: string): void }>()
</script>

<template>
  <div class="flex flex-wrap gap-2 mb-4">
    <button v-for="c in chips" :key="c.key" @click="emit('select', c.key)"
            class="text-xs px-3 py-1.5 rounded-full border"
            :class="active === c.key ? 'text-white border-transparent' : 'border-gray-200 text-gray-600'"
            :style="active === c.key ? 'background:var(--nec-navy)' : ''">{{ c.label }}</button>
  </div>
</template>
