// 报销助手独立入口（/apps/reimburse/）：?embedded=1 时隐藏顶栏、工具栏贴顶；门户 Tab 由组件 prop 控制
import { createApp } from 'vue'
import ReimburseApp from '@apps/reimburse/ReimburseApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1'

createApp(ReimburseApp, {
  embedded,
  onExit: () => { location.href = '/' },
}).mount('#app')
