// CLA 签署独立入口（/apps/cla-sign/）：?embedded=1 或 iframe 内嵌时隐藏页头（供门户 iframe 嵌入）
import { createApp } from 'vue'
import ClaSignApp from '@apps/cla-sign/ClaSignApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1' || window.parent !== window

createApp(ClaSignApp, { embedded }).mount('#app')
