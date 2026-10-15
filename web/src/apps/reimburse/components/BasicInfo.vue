<script setup lang="ts">
// 基本信息：单据编号 / 申请日期 / 申请人 / 价税合计 / 无票说明 / 备注
import { auth } from '@shared/auth'
import { store, lineTotal, fmtMoneyErp } from '../store'
</script>

<template>
  <details class="erp-section" open>
    <summary>基本信息</summary>
    <div class="body">
      <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-x-8 gap-y-4">
        <div class="ef">
          <label>单据编号<span class="req">*</span></label>
          <div id="doc-no" class="ef-static mono" :class="store.docStatus === '暂存' ? 'text-nec-gray' : ''">{{ store.docNo }}</div>
        </div>
        <div class="ef">
          <label>单据类型<span class="req">*</span></label>
          <div class="ef-static">标准报销单</div>
        </div>
        <div class="ef">
          <label>申请日期<span class="req">*</span></label>
          <input id="doc-date" type="date" class="ef-ctl" readonly :value="store.docDate" />
        </div>
        <div class="ef">
          <label>申请人<span class="req">*</span></label>
          <div id="doc-applicant" class="ef-static">{{ auth.me.user?.name || '—' }}</div>
        </div>
        <div class="ef">
          <label>所属组别</label>
          <div id="doc-group" class="ef-static">{{ auth.me.user?.group || '—' }}</div>
        </div>
        <div class="ef">
          <label>价税合计（人民币）</label>
          <div id="doc-total" class="ef-static mono font-black text-nec-navy">{{ fmtMoneyErp(lineTotal) }}</div>
        </div>
        <div class="ef">
          <label>结算币别</label>
          <div class="ef-static">人民币（CNY）</div>
        </div>
        <div class="ef">
          <label>审批人</label>
          <div class="ef-static">财务 / 队长</div>
        </div>
        <div class="ef col-span-2 md:col-span-3 xl:col-span-2">
          <label>无票说明（整单无发票时必填）</label>
          <input id="doc-noinv" class="ef-ctl" v-model="store.noinv" placeholder="如：小额收据无发票，已附付款截图" />
        </div>
        <div class="ef col-span-2 md:col-span-3 xl:col-span-5">
          <label>备注</label>
          <input id="doc-note" class="ef-ctl" v-model="store.note" placeholder="补充说明，如关联任务 / 机构 / 项目" />
        </div>
      </div>
    </div>
  </details>
</template>
