<script setup lang="ts">
// 任务排期 Tab：原生复用任务排期视图（替代原 iframe 嵌入；纯本地应用，无登录态依赖）
import TaskScheduleApp from '@apps/task-schedule/TaskScheduleApp.vue'
</script>

<template>
  <section id="tab-task-schedule">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">任务排期</h2>
 <a href="/apps/task-schedule/" target="_blank" class="text-xs hover:underline text-nec-cyan">独立全屏版 /apps/task-schedule/ →</a>
    </div>
    <div class="rounded-xl border border-gray-200 overflow-hidden">
      <TaskScheduleApp embedded />
    </div>
  </section>
</template>
