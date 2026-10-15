<script setup lang="ts">
// 弹窗：遮罩 + 白盒 + 标题栏（✕ 关闭 / 点遮罩关闭），提炼自报销助手四个弹窗的同一模式
withDefaults(defineProps<{ open: boolean; title: string; maxWidth?: string; bodyClass?: string }>(), { maxWidth: '880px', bodyClass: '' })
const emit = defineEmits<{ (e: 'close'): void }>()
</script>

<template>
  <div v-if="open" class="ui-modal-mask" @click.self="emit('close')">
    <div class="ui-modal-box" :style="{ maxWidth }">
      <div class="ui-modal-head">
        <h3 class="font-bold" style="color:var(--nec-ink)">{{ title }}</h3>
        <slot name="head-extra" />
        <button class="text-lg leading-none px-1" style="color:var(--nec-gray)" @click="emit('close')">✕</button>
      </div>
      <div class="ui-modal-body" :class="bodyClass">
        <slot />
      </div>
      <div v-if="$slots.footer" class="ui-modal-head" style="border-top:1px solid var(--nec-line);border-bottom:none">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.ui-modal-mask {
  position: fixed; inset: 0; background: rgba(11,16,51,.45); z-index: 50;
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.ui-modal-box {
  background: #fff; border-radius: 8px; width: 100%;
  max-height: 86vh; display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 20px 60px rgba(11,16,51,.3);
}
.ui-modal-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 16px; border-bottom: 1px solid var(--nec-line);
}
.ui-modal-body { padding: 20px; overflow-y: auto; }
</style>
