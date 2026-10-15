// 图纸评审独立入口（/apps/drawing-review/）：?embedded=1 或 iframe 内嵌时隐藏 Hero、改用紧凑导航
import { createApp } from 'vue'
import DrawingReviewApp from '@apps/drawing-review/DrawingReviewApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1' || window.parent !== window

createApp(DrawingReviewApp, { embedded }).mount('#app')
