// 域名分发独立入口（/apps/domains/）：?embedded=1 或 iframe 内嵌时隐藏页头（供门户 iframe 嵌入）
import { createApp } from 'vue'
import DomainsApp from '@apps/domains/DomainsApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1' || window.parent !== window

createApp(DomainsApp, { embedded }).mount('#app')
