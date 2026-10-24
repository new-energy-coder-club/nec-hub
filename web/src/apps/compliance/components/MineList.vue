<script setup lang="ts">
// STEP 03 我的申请：GET /api/approvals/mine?type=compliance（仅本人可见 · 最近 20 条）；已通过可回填发布链接
import { store, statusColor, fmtMs, loadMine, doPublish } from '../store'
</script>

<template>
  <section class="nec-card p-5">
    <div class="mb-4 flex items-baseline justify-between gap-2">
      <div>
        <span class="step-badge">STEP 03</span>
        <h2 class="text-lg font-bold text-nec-ink mt-1">我的申请</h2>
        <p class="mono text-xs text-nec-gray tracking-wider">MY APPLICATIONS · 仅本人可见 · 最近 20 条</p>
      </div>
      <button id="mine-refresh" class="text-xs link whitespace-nowrap" @click="loadMine">刷新</button>
    </div>
    <div id="mine-list" class="text-sm text-nec-gray">
      <p v-if="store.mine.state === 'idle' || store.mine.state === 'loading'">加载中…</p>
      <p v-else-if="store.mine.state === 'login'" class="text-nec-gray">登录后可见。</p>
      <p v-else-if="store.mine.state === 'error'" class="text-red-500">加载失败，请稍后重试。</p>
      <p v-else-if="store.mine.state === 'hint'" class="text-nec-gray">{{ store.mine.hint }}：合规审批底表/flows:config 配置完成后，这里会显示你的申请记录。</p>
      <p v-else-if="store.mine.state === 'empty'" class="text-nec-gray">暂无记录，提交第一条合规申请吧。</p>
      <div v-else class="overflow-x-auto">
        <table class="w-full" style="min-width:760px">
          <thead>
 <tr class="text-left text-xs text-nec-gray border-b-[1.5px] border-nec-line">
              <th class="py-2 pr-3 font-medium">单号</th><th class="py-2 pr-3 font-medium">合规类型</th>
              <th class="py-2 pr-3 font-medium">标题</th><th class="py-2 pr-3 font-medium">计划发布时间</th>
              <th class="py-2 pr-3 font-medium">状态</th><th class="py-2 pr-3 font-medium">驳回原因</th>
              <th class="py-2 pr-3 font-medium">审批意见</th><th class="py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
 <tr v-for="r in store.mine.records" :key="r.application_id">class="border-t border-nec-line"
              <td class="py-2 pr-3">
                <a v-if="r.url" :href="r.url" target="_blank" rel="noopener" class="mono text-xs whitespace-nowrap hover:underline">{{ r.fields?.['申请单号'] || r.application_id || '—' }}</a>
                <span v-else class="mono text-xs whitespace-nowrap">{{ r.fields?.['申请单号'] || r.application_id || '—' }}</span>
              </td>
              <td class="py-2 pr-3 whitespace-nowrap">{{ r.fields?.['合规类型'] || '—' }}</td>
              <td class="py-2 pr-3">{{ r.fields?.['标题'] || '—' }}</td>
              <td class="py-2 pr-3 text-nec-gray text-xs whitespace-nowrap">{{ fmtMs(r.fields?.['计划发布时间']) }}</td>
              <td class="py-2 pr-3 whitespace-nowrap"><span class="status-badge" :style="{ background: statusColor(r.status) }">{{ r.status || '—' }}</span></td>
              <td class="py-2 pr-3 text-xs" style="color:#B02323">{{ r.fields?.['驳回原因'] || '—' }}</td>
              <td class="py-2 pr-3 text-nec-gray text-xs">{{ r.fields?.['审批意见'] || '—' }}</td>
              <td class="py-2">
                <button v-if="r.status === '已通过'" class="btn-primary text-xs px-3 py-1.5 whitespace-nowrap" style="padding:5px 12px" @click="doPublish(r.application_id)">回填发布链接</button>
                <span v-else class="text-nec-gray text-xs">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
