<script setup lang="ts">
// 收集单视图：列表 + 采纳/拒绝
import { store, loadCollect, approve, reject, statusColor } from '../store'
</script>

<template>
  <section id="view-collect" class="view" :class="{ active: store.view === 'collect' }">
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold text-slate-800">收集单</h2>
        <button class="text-sm text-blue-600 hover:text-blue-700 font-medium px-2" @click="loadCollect()">刷新</button>
      </div>
      <div id="collect-list" class="overflow-x-auto">
        <p v-if="store.collect.error" class="text-sm text-red-500">加载失败：{{ store.collect.error }}</p>
        <p v-else-if="store.collect.items === null" class="text-sm text-gray-400">加载中…</p>
        <p v-else-if="!store.collect.items.length" class="text-sm text-gray-400">暂无收集单</p>
        <table v-else class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs text-gray-500 border-b border-gray-100">
              <th class="py-2 pr-3">提交人</th>
              <th class="py-2 pr-3">目标</th>
              <th class="py-2 pr-3">负责组</th>
              <th class="py-2 pr-3">截止</th>
              <th class="py-2 pr-3">来源</th>
              <th class="py-2 pr-3">状态</th>
              <th class="py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in store.collect.items" :key="s.recordId" class="border-b border-gray-50">
              <td class="py-2 pr-3">{{ s.submitter || '—' }}</td>
              <td class="py-2 pr-3 font-medium text-slate-800" :title="s.krs">{{ s.title }}</td>
              <td class="py-2 pr-3">{{ s.group }}</td>
              <td class="py-2 pr-3">{{ s.deadline || '—' }}</td>
              <td class="py-2 pr-3">{{ s.source }}</td>
              <td class="py-2 pr-3"><span class="status-badge" :class="statusColor(s.status)">{{ s.status || '—' }}</span></td>
              <td class="py-2 whitespace-nowrap">
                <template v-if="s.status === '待评审'">
                  <button class="text-xs text-green-600 hover:underline mr-2" @click="approve(s.recordId)">采纳</button>
                  <button class="text-xs text-red-500 hover:underline" @click="reject(s.recordId)">拒绝</button>
                </template>
                <span v-else class="text-xs text-gray-300">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
