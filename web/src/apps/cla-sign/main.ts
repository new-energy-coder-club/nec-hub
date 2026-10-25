// CLA 签署独立入口（/apps/cla-sign/）：?embedded=1 时隐藏页头；门户 Tab 由组件 prop 控制
import { createApp } from 'vue'
import ClaSignApp from '@apps/cla-sign/ClaSignApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1'

createApp(ClaSignApp, { embedded }).mount('#app')
