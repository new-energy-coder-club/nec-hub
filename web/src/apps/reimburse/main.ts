// 报销助手独立入口（/apps/reimburse/）：?embedded=1 或 iframe 内嵌时隐藏顶栏、工具栏贴顶
import { createApp } from 'vue'
import ReimburseApp from '@apps/reimburse/ReimburseApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1' || window.parent !== window

createApp(ReimburseApp, {
  embedded,
  onExit: () => { location.href = '/' },
}).mount('#app')
