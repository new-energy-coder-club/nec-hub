<script setup lang="ts">
// 我的报销（最近 20 条 · 仅本人可见）：优先 D1 单据快照（含查看/复制），无快照时回退审批底表列表
import { store, loadMine, openDoc, fmtMoneyErp, statusColor } from '../store'
</script>

<template>
  <details class="erp-section" open>
    <summary>我的报销（最近 20 条 · 仅本人可见）</summary>
    <div class="body">
      <div class="flex justify-end mb-2"><button id="mine-refresh" class="link-btn" @click="loadMine">刷新</button></div>
      <div id="mine-list" class="text-sm text-nec-gray">
        <p v-if="store.mine.state === 'loading' || store.mine.state === 'idle'">加载中…</p>
        <p v-else-if="store.mine.state === 'login'">登录后可见。</p>
        <p v-else-if="store.mine.state === 'error'" class="text-red-500">加载失败，请稍后重试。</p>
        <p v-else-if="store.mine.state === 'hint'">{{ store.mine.hint }}：财务报销底表/flows:config 配置完成后，这里会显示你的申请记录。</p>
        <div v-else-if="store.mine.state === 'erp'" class="overflow-x-auto">
          <table class="line-table" style="min-width:680px">
            <thead><tr><th>单号</th><th>首项 / 明细</th><th>合计</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="d in store.mine.docs" :key="d.application_id" style="cursor:default">
                <td class="mono text-xs whitespace-nowrap">{{ d.application_id }}</td>
                <td>{{ d.firstItem || '—' }}<span v-if="d.lines > 1" class="text-xs text-nec-gray"> 等 {{ d.lines }} 项</span></td>
                <td class="mono whitespace-nowrap">{{ fmtMoneyErp(d.total) }}</td>
                <td class="whitespace-nowrap"><span class="status-badge" :style="{ background: statusColor(d.status) }">{{ d.status || '—' }}</span></td>
                <td class="text-nec-gray text-xs whitespace-nowrap">{{ d.created_at ? new Date(d.created_at).toLocaleString('zh-CN') : '—' }}</td>
                <td class="whitespace-nowrap">
                  <button class="link-btn" @click="openDoc(d.application_id, false)">查看</button>
                  <button class="link-btn" @click="openDoc(d.application_id, true)">复制</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <template v-else-if="store.mine.state === 'bitable'">
          <p v-if="!store.mine.records.length">暂无记录，提交第一笔报销吧。</p>
          <div v-else class="overflow-x-auto">
            <table class="line-table" style="min-width:640px">
              <thead><tr><th>单号</th><th>事项</th><th>金额</th><th>状态</th><th>提交时间</th><th>审批意见</th></tr></thead>
              <tbody>
                <tr v-for="(r, i) in store.mine.records" :key="i" style="cursor:default">
                  <td class="mono text-xs whitespace-nowrap">{{ r.fields?.['申请单号'] || r.application_id || '—' }}</td>
                  <td style="white-space:pre-line">{{ r.fields?.['事项'] || '—' }}</td>
                  <td class="mono whitespace-nowrap">{{ r.fields?.['金额'] != null ? '¥' + String(r.fields['金额']) : '—' }}</td>
                  <td class="whitespace-nowrap"><span class="status-badge" :style="{ background: statusColor(r.status) }">{{ r.status || '—' }}</span></td>
                  <td class="text-nec-gray text-xs whitespace-nowrap">{{ r.fields?.['提交时间'] ? new Date(r.fields['提交时间']).toLocaleDateString('zh-CN') : '—' }}</td>
                  <td class="text-nec-gray text-xs">{{ r.fields?.['审批意见'] || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>
    </div>
  </details>
</template>
