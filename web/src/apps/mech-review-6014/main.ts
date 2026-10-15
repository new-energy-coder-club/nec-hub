// 6014 电机机械评审纪要独立入口（/apps/mech-review-6014/）：?embedded=1 或 iframe 内嵌时隐藏页头与返回门户链接
import { createApp } from 'vue'
import MechReviewApp from '@apps/mech-review-6014/MechReviewApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1' || window.parent !== window

createApp(MechReviewApp, { embedded }).mount('#app')
