// 硬件评审独立入口（/apps/hardware-review/）：?embedded=1 时隐藏 Hero、改用紧凑导航；门户 Tab 由组件 prop 控制
import { createApp } from 'vue'
import HardwareReviewApp from '@apps/hardware-review/HardwareReviewApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1'

createApp(HardwareReviewApp, { embedded }).mount('#app')
