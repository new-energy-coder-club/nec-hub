// 任务排期独立入口（/apps/task-schedule/）：?embedded=1 或 iframe 内嵌时隐藏顶栏、收窄边距
import { createApp } from 'vue'
import TaskScheduleApp from '@apps/task-schedule/TaskScheduleApp.vue'

const params = new URLSearchParams(location.search)
const embedded = params.get('embedded') === '1' || window.parent !== window

createApp(TaskScheduleApp, { embedded }).mount('#app')
