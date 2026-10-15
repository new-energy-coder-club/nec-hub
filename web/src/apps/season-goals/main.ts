// 赛季目标管理独立入口（/apps/season-goals/）：?embedded=1 或 iframe 内嵌时隐藏顶栏、收窄边距
import { createApp } from 'vue'
import SeasonGoalsApp from '@apps/season-goals/SeasonGoalsApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1' || window.parent !== window
if (embedded) document.body.classList.remove('bg-gray-50')

createApp(SeasonGoalsApp, { embedded }).mount('#app')
