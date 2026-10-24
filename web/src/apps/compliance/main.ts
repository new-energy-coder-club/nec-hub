// 合规申请独立入口（/apps/compliance/）：?embedded=1 时隐藏 Hero、改用紧凑导航；门户 Tab 由组件 prop 控制
import { createApp } from 'vue'
import ComplianceApp from '@apps/compliance/ComplianceApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1'

createApp(ComplianceApp, { embedded }).mount('#app')
