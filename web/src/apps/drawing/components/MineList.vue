<script setup lang="ts">
// 我的申请列表：最近 20 条，状态操作（开始加工 / 归档 / 修改重提）逐条对齐原页 renderActions
import { store, statusStyle, fmtTime, loadMine, doAction, startResubmit } from '../store'
</script>

<template>
  <section id="view-mine">
    <div class="nec-card p-5">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-lg font-bold text-nec-ink">我的申请</h2>
          <p class="mono text-xs text-nec-gray tracking-wider">MY DRAWINGS · 最近 20 条</p>
        </div>
        <button class="text-sm font-medium px-2 link" @click="loadMine">刷新</button>
      </div>
      <div id="mine-list" class="space-y-3">
        <p v-if="store.mineState === 'loading'" class="text-sm text-nec-gray">加载中…</p>
        <p v-else-if="store.mineState === 'error'" class="text-sm" style="color:#C22E2E">加载失败：{{ store.mineError }}</p>
        <p v-else-if="!store.mineRecords.length" class="text-sm text-nec-gray">暂无申请记录，点右上角「提交图纸」发起第一张。</p>
        <template v-else>
          <div v-for="rec in store.mineRecords" :key="rec.application_id" class="rounded-lg p-4" style="border:1px solid var(--nec-line);background:var(--nec-paper)">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p class="font-bold text-nec-ink"><span class="mono text-nec-royal">{{ rec.application_id }}</span> · {{ rec.fields['图纸名称'] }}</p>
                <p class="mono text-xs text-nec-gray mt-0.5">图号 {{ rec.fields['图号'] }} · {{ rec.fields['版本'] }} · {{ rec.fields['所属机构'] }} · {{ rec.fields['加工方式'] }}<template v-if="rec.fields['预估加工费']"> · <span class="mono">¥{{ rec.fields['预估加工费'] }}</span></template><template v-if="rec.fields['紧急程度'] === '加急'"> · <span class="text-xs font-bold" style="color:#B02323">加急</span></template></p>
              </div>
              <span class="status-badge" :style="statusStyle(rec.status)">{{ rec.status || '未知' }}</span>
            </div>
            <p v-if="rec.fields['审批意见']" class="text-sm mt-2" style="color:#B02323">审批意见：{{ rec.fields['审批意见'] }}</p>
            <p v-if="rec.fields['前置版本记录']" class="mono text-xs text-nec-gray mt-1">前置版本：{{ rec.fields['前置版本记录'] }}</p>
            <div class="mt-3 flex gap-3 text-xs items-center flex-wrap">
              <span class="text-nec-gray">提交于 <span class="mono">{{ fmtTime(rec.fields['提交时间']) }}</span></span>
              <span v-if="rec.fields['审批人']" class="text-nec-gray">审批人：<span class="mono">{{ rec.fields['审批人'] }}</span></span>
              <button v-if="rec.status === '已通过'" class="btn-accent text-xs px-3 py-1.5 rounded-lg" @click="doAction(rec.application_id, 'start')">开始加工</button>
              <button v-if="rec.status === '加工中'" class="btn-primary text-xs px-3 py-1.5 rounded-lg" @click="doAction(rec.application_id, 'archive')">归档</button>
              <button v-if="rec.status === '已驳回'" class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:#B04A0F" @click="startResubmit(rec)">修改重提（版本 +0.1）</button>
              <a v-if="rec.url" :href="rec.url" target="_blank" class="text-xs link hover:underline mono self-center">底表详情 →</a>
            </div>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>
