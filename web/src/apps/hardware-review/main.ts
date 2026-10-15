// 硬件评审独立入口（/apps/hardware-review/）：?embedded=1 或 iframe 内嵌时隐藏 Hero、改用紧凑导航
import { createApp } from 'vue'
import HardwareReviewApp from '@apps/hardware-review/HardwareReviewApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1' || window.parent !== window

createApp(HardwareReviewApp, { embedded }).mount('#app')
