// 6014 电机机械评审纪要独立入口（/apps/mech-review-6014/）：?embedded=1 时隐藏页头与返回门户链接；门户 Tab 由组件 prop 控制
import { createApp } from 'vue'
import MechReviewApp from '@apps/mech-review-6014/MechReviewApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1'

createApp(MechReviewApp, { embedded }).mount('#app')
