// 任务排期独立入口（/apps/task-schedule/）：?embedded=1 时隐藏顶栏、收窄边距；门户 Tab 由组件 prop 控制
import { createApp, watch } from 'vue'
import TaskScheduleApp from '@apps/task-schedule/TaskScheduleApp.vue'
import { store } from './store'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1'

createApp(TaskScheduleApp, { embedded }).mount('#app')

// 独立页整页背景跟随白底偏好；内嵌（门户 Tab）时页面归属门户，不干预
if (!embedded) {
  watch(() => store.whiteBg, (w) => {
    const bg = w ? '#f6f7f9' : '#000'
    document.documentElement.style.background = bg
    document.body.style.background = bg
  }, { immediate: true })
}
