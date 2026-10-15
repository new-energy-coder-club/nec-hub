<script setup lang="ts">
// 提交成功视图：展示 application_id，可跳我的申请或再提一张
import { store, router, resetForm } from '../store'

function submitAnother() {
  resetForm()
  router('submit')
}
</script>

<template>
  <section id="view-done">
    <div class="nec-card p-8 text-center">
      <p class="text-4xl mb-3">📐</p>
      <h2 class="text-xl font-bold text-nec-ink mb-1">已提交，审批中</h2>
      <p class="mono text-sm text-nec-cyan mb-2" id="done-app-id">{{ store.doneAppId }}</p>
      <p class="text-sm text-nec-gray mb-5">机械组组长会收到飞书群通知；通过后你可以在这里点「开始加工」。</p>
      <div class="flex justify-center gap-3">
        <button class="btn-primary text-sm font-medium px-5 py-2 rounded-lg" @click="router('mine')">查看我的申请</button>
        <button class="nav-btn text-sm px-5 py-2 rounded-lg" @click="submitAnother">再提一张</button>
      </div>
    </div>
  </section>
</template>
