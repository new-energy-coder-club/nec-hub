// 图纸评审独立入口（/apps/drawing-review/）：?embedded=1 时隐藏 Hero、改用紧凑导航；门户 Tab 由组件 prop 控制
import { createApp } from 'vue'
import DrawingReviewApp from '@apps/drawing-review/DrawingReviewApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1'

createApp(DrawingReviewApp, { embedded }).mount('#app')
