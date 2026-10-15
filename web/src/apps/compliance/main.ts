// 合规申请独立入口（/apps/compliance/）：?embedded=1 或 iframe 内嵌时隐藏 Hero、改用紧凑导航
import { createApp } from 'vue'
import ComplianceApp from '@apps/compliance/ComplianceApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1' || window.parent !== window

createApp(ComplianceApp, { embedded }).mount('#app')
