<script setup lang="ts">
// 收款信息（存 D1，可存为默认账户下次自动带出）
import { store } from '../store'
</script>

<template>
  <details class="erp-section" open>
    <summary>收款信息</summary>
    <div class="body">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-4">
        <div class="ef">
          <label>支付方式</label>
          <select id="p-method" class="ef-ctl" v-model="store.payee.method">
            <option value="">请选择</option><option>电汇</option><option>微信</option><option>支付宝</option><option>现金</option>
          </select>
        </div>
        <div class="ef">
          <label>收款人</label>
          <input id="p-name" class="ef-ctl" v-model="store.payee.account_name" placeholder="默认本人" />
        </div>
        <div class="ef">
          <label>收款账号</label>
          <input id="p-account" class="ef-ctl mono" v-model="store.payee.account_no" placeholder="银行卡号 / 微信 / 支付宝账号" />
        </div>
        <div class="ef">
          <label>开户银行</label>
          <input id="p-bank" class="ef-ctl" v-model="store.payee.bank" placeholder="电汇必填" />
        </div>
      </div>
      <label class="flex items-center gap-2 mt-3 text-xs text-nec-gray select-none">
        <input id="p-save-default" type="checkbox" v-model="store.saveDefault" /> 存为我的默认收款账户（提交成功后保存，下次自动带出）
      </label>
    </div>
  </details>
</template>
