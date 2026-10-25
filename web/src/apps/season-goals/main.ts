// 赛季目标管理独立入口（/apps/season-goals/）：?embedded=1 时隐藏顶栏、收窄边距；门户 Tab 由组件 prop 控制
import { createApp } from 'vue'
import SeasonGoalsApp from '@apps/season-goals/SeasonGoalsApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1'
if (embedded) document.body.classList.remove('bg-gray-50')

createApp(SeasonGoalsApp, { embedded }).mount('#app')
