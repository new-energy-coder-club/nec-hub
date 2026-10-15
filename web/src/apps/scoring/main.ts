// 评分看板独立入口（/apps/scoring/）：?embedded=1 或 iframe 内嵌时隐藏 Hero、改用紧凑导航
import { createApp } from 'vue'
import ScoringApp from '@apps/scoring/ScoringApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1' || window.parent !== window

createApp(ScoringApp, { embedded }).mount('#app')
