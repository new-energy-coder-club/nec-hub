<script setup lang="ts">
// 域名列表表格：mine=true（我的域名，带重试/释放操作列）与 mine=false（公开目录，带持有人列）共用
import type { DomainRow } from '../store'
import { statusOf, delDomain, retryDomain } from '../store'

defineProps<{ rows: DomainRow[]; mine: boolean; loading: boolean }>()
</script>

<template>
  <p v-if="loading" class="text-sm text-gray-400">加载中…</p>
  <p v-else-if="!rows.length" class="text-sm text-gray-400">暂无记录</p>
  <table v-else class="w-full text-sm">
    <thead>
      <tr class="text-left text-xs text-gray-500 border-b border-gray-100">
        <th class="py-2 pr-3">域名</th><th class="py-2 pr-3">解析</th><th class="py-2 pr-3">用途</th>
        <th v-if="!mine" class="py-2 pr-3">持有人</th><th class="py-2 pr-3">状态</th><th v-if="mine"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="d in rows" :key="d.fqdn" class="border-b border-gray-50">
        <td class="py-2 pr-3 mono"><a class="text-blue-700 hover:underline" :href="'https://' + d.fqdn" target="_blank" rel="noopener">{{ d.fqdn }}</a>{{ d.deep ? ' ' : '' }}<span v-if="d.deep" class="status-badge bg-sky-50 text-sky-700">四级</span></td>
        <td class="py-2 pr-3 mono text-xs">{{ d.type }} → {{ d.target }}</td>
        <td class="py-2 pr-3 text-xs text-gray-500">{{ d.description || '—' }}</td>
        <td v-if="!mine" class="py-2 pr-3 text-xs text-gray-500">{{ d.owner }}</td>
        <td class="py-2 pr-3"><span class="status-badge" :class="statusOf(d.status)[0]">{{ statusOf(d.status)[1] }}</span></td>
        <td v-if="mine" class="py-2 text-right whitespace-nowrap">
          <button v-if="d.status !== 'active'" class="text-xs text-blue-600 hover:underline mr-2" @click="retryDomain(d.subdomain)">重试同步</button>
          <button class="text-xs text-red-500 hover:underline" @click="delDomain(d.subdomain)">释放</button>
        </td>
      </tr>
    </tbody>
  </table>
</template>
