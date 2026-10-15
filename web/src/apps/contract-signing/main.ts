// 协议签署 OA 审批独立入口（/apps/contract-signing/）：?embedded=1 或 iframe 内嵌时隐藏 Hero、改用紧凑导航
import { createApp } from 'vue'
import ContractSigningApp from '@apps/contract-signing/ContractSigningApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1' || window.parent !== window

createApp(ContractSigningApp, { embedded }).mount('#app')
