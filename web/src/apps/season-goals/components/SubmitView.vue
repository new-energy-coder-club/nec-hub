<script setup lang="ts">
// 提交目标视图（收集单表单）
import { store, submit, submitGoal } from '../store'
</script>

<template>
  <section id="view-submit" class="view" :class="{ active: store.view === 'submit' }">
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <h2 class="text-lg font-bold text-slate-800 mb-4">提交赛季目标（收集单）</h2>
      <form id="submit-form" class="space-y-4" @submit.prevent="submitGoal()">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">目标</label>
          <input v-model="submit.title" type="text" name="title" required class="w-full rounded-lg border-gray-300 border px-3 py-2 text-sm" placeholder="例：完成新赛季底盘迭代" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">关键结果（KR）</label>
          <textarea v-model="submit.krs" name="krs" rows="4" required class="w-full rounded-lg border-gray-300 border px-3 py-2 text-sm" placeholder="每行一条关键结果"></textarea>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">负责组</label>
            <select v-model="submit.group" name="group" required class="w-full rounded-lg border-gray-300 border px-3 py-2 text-sm">
              <option value="硬件组">硬件组</option>
              <option value="软件组">软件组</option>
              <option value="运营组">运营组</option>
              <option value="其他">其他</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">截止日期</label>
            <input v-model="submit.deadline" type="date" name="deadline" required class="w-full rounded-lg border-gray-300 border px-3 py-2 text-sm" />
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">备注（可选）</label>
          <input v-model="submit.note" type="text" name="note" class="w-full rounded-lg border-gray-300 border px-3 py-2 text-sm" />
        </div>
        <div class="flex justify-end">
          <button type="submit" class="text-white text-sm font-medium px-5 py-2 rounded-lg" style="background:var(--nec-royal)">提交收集单</button>
        </div>
      </form>
      <p v-if="submit.result" id="submit-result" class="mt-3 text-sm" :class="submit.resultOk ? 'text-green-600' : 'text-red-600'">{{ submit.result }}</p>
    </div>
  </section>
</template>
