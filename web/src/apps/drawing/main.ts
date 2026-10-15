// 机械图纸审批独立入口（/apps/drawing/）：?embedded=1 或 iframe 内嵌时隐藏 Hero、改用紧凑导航
import { createApp } from 'vue'
import DrawingApp from '@apps/drawing/DrawingApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1' || window.parent !== window

createApp(DrawingApp, { embedded }).mount('#app')
