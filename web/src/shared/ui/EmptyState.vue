<script setup lang="ts">
// 空状态 / 加载占位：白卡居中一行提示（提炼自各 Tab 列表的「加载中… / 暂无记录 / 登录后可见」同一模式）
withDefaults(defineProps<{ text?: string; tone?: 'muted' | 'danger' }>(), { text: '', tone: 'muted' })
</script>

<template>
  <p class="text-sm bg-white rounded-xl shadow p-8 text-center" :class="tone === 'danger' ? 'text-red-500' : 'text-gray-400'">
    <slot>{{ text }}</slot>
  </p>
</template>
