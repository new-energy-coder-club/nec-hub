// 域名分发独立入口（/apps/domains/）：?embedded=1 时隐藏页头；门户 Tab 由组件 prop 控制
import { createApp } from 'vue'
import DomainsApp from '@apps/domains/DomainsApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1'

createApp(DomainsApp, { embedded }).mount('#app')
