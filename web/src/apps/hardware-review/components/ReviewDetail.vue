<script setup lang="ts">
// 详情视图：详情卡 + 流程步骤条 + 预约会议（pending_review）+ 状态操作 + 会议纪要 + 评审报告
// 每次 loadDetail 后表单重置为默认值（与原 innerHTML 重渲染一致）
import { reactive, ref, computed, watch } from 'vue'
import {
  store,
  statusOf,
  typeLabel,
  stepOf,
  FLOW_STEPS,
  personLabel,
  defaultMeetingTime,
  scheduleMeeting,
  completeRectify,
  assess,
  archive,
  saveMinutes,
  generateReport,
  loadDetail,
  type MeetingForm,
  type MinutesForm,
  type ReportForm,
} from '../store'

const cur = computed(() => stepOf(store.detail?.status ?? ''))
const hasActions = computed(() => !!store.detail && ['rectifying', 'assessing', 'approved'].includes(store.detail.status))

const meeting = reactive<MeetingForm>({ startTime: '', durationMinutes: 60, attendeeOpenIds: '' })
const minutes = reactive<MinutesForm>({
  meetingTime: '', attendees: '', topics: '', discussion: '',
  issues: '', nextActions: '', conclusion: 'passed', conclusionNotes: '',
})
const report = reactive<ReportForm>({ summary: '', checklist: '' })
const minutesResult = ref({ text: '', ok: false })
const reportResult = ref({ text: '', ok: false })

watch(() => store.detail, r => {
  meeting.startTime = defaultMeetingTime()
  meeting.durationMinutes = 60
  meeting.attendeeOpenIds = r?.designerId || ''
  minutes.meetingTime = ''
  minutes.attendees = [store.currentUser?.open_id, r?.designerId]
    .filter((v): v is string => !!v)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(',')
  minutes.topics = ''
  minutes.discussion = ''
  minutes.issues = ''
  minutes.nextActions = ''
  minutes.conclusion = 'passed'
  minutes.conclusionNotes = ''
  report.summary = ''
  report.checklist = ''
  minutesResult.value = { text: '', ok: false }
  reportResult.value = { text: '', ok: false }
})

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function onSaveMinutes(reviewId: string) {
  try {
    await saveMinutes(reviewId, minutes)
    minutesResult.value = { text: '纪要与结论已保存', ok: true }
    loadDetail(reviewId)
  } catch (err) {
    minutesResult.value = { text: '失败：' + errMsg(err), ok: false }
  }
}

async function onGenerateReport(reviewId: string) {
  try {
    const data = await generateReport(reviewId, report)
    reportResult.value = { text: `报告已生成：${data.reportId}，结果 ${data.result}`, ok: true }
    loadDetail(reviewId)
  } catch (err) {
    reportResult.value = { text: '失败：' + errMsg(err), ok: false }
  }
}
</script>

<template>
  <div id="detail-content" class="space-y-4">
    <p v-if="store.detailState === 'loading'" class="text-sm text-nec-gray">加载中…</p>
    <p v-else-if="store.detailState === 'error'" class="text-sm" style="color:#C22E2E">加载失败：{{ store.detailError }}</p>

    <template v-else-if="store.detail">
      <div class="nec-card p-5" style="border-top:3px solid var(--nec-cyan)">
        <div class="flex items-start justify-between">
          <div>
            <p class="mono text-xs text-nec-cyan tracking-widest mb-1">{{ store.detail.reviewId }}</p>
            <h2 class="text-xl font-bold text-nec-ink">{{ store.detail.hardwareName }}</h2>
            <p class="mono text-xs text-nec-gray mt-1">项目 {{ store.detail.projectId }} · {{ typeLabel(store.detail.hardwareType) }} · {{ store.detail.hardwareVersion }}</p>
          </div>
          <span class="status-badge" :style="statusOf(store.detail.status).color">{{ statusOf(store.detail.status).label }}</span>
        </div>

        <!-- 流程步骤条 -->
        <div class="mt-4 flex items-center gap-2 overflow-x-auto scrollbar-hide py-1">
          <template v-for="(label, i) in FLOW_STEPS" :key="i">
            <span v-if="i > 0" class="flow-conn" :class="{ done: i <= cur }"></span>
            <span class="flow-step" :class="{ done: i < cur || cur >= FLOW_STEPS.length, current: i === cur }">
              <span class="dot">{{ (i < cur || cur >= FLOW_STEPS.length) ? '✓' : String(i + 1).padStart(2, '0') }}</span>
              <span class="lbl">{{ label }}</span>
            </span>
          </template>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div><span class="text-nec-gray">设计负责人：</span><span :title="store.detail.designerId">{{ personLabel(store.detail.designerId) }}</span></div>
          <div><span class="text-nec-gray">创建时间：</span><span class="mono">{{ new Date(store.detail.createdAt).toLocaleString() }}</span></div>
          <div v-if="store.detail.meetingId"><span class="text-nec-gray">会议号：</span><span class="mono">{{ store.detail.meetingId }}</span></div>
          <div v-if="store.detail.meetingStartTime"><span class="text-nec-gray">会议时间：</span><span class="mono">{{ new Date(store.detail.meetingStartTime).toLocaleString() }}</span></div>
        </div>
        <div v-if="store.detail.specification" class="mt-4">
          <h3 class="text-sm font-bold text-nec-navy mb-2">规格参数</h3>
          <p class="text-sm text-nec-gray whitespace-pre-wrap">{{ store.detail.specification }}</p>
        </div>
        <div class="mt-4">
          <h3 class="text-sm font-bold text-nec-navy mb-2">设计说明</h3>
          <p class="text-sm text-nec-gray whitespace-pre-wrap">{{ store.detail.designNotes }}</p>
        </div>
        <div v-if="store.detail.meetingLink" class="mt-4">
          <a :href="store.detail.meetingLink" target="_blank" class="text-sm link hover:underline mono">加入会议 →</a>
        </div>
      </div>

      <!-- 会议预约 -->
      <div v-if="store.detail.status === 'pending_review'" class="nec-card p-5">
        <h3 class="text-sm font-bold text-nec-navy mb-3">预约评审会议</h3>
        <form class="space-y-3" @submit.prevent="scheduleMeeting(store.detail!.reviewId, meeting)">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label class="block text-xs text-nec-gray mb-1">开始时间</label>
              <input type="datetime-local" v-model="meeting.startTime" required class="mono w-full rounded border border-nec-line px-3 py-2 text-sm" />
            </div>
            <div>
              <label class="block text-xs text-nec-gray mb-1">时长（分钟）</label>
              <input type="number" v-model="meeting.durationMinutes" min="15" step="15" class="mono w-full rounded border border-nec-line px-3 py-2 text-sm" />
            </div>
            <div>
              <label class="block text-xs text-nec-gray mb-1">参会人 open_id（逗号分隔）</label>
              <input type="text" v-model="meeting.attendeeOpenIds" class="mono w-full rounded border border-nec-line px-3 py-2 text-sm" />
            </div>
          </div>
          <button type="submit" class="btn-primary text-sm font-medium px-4 py-2 rounded-lg">预约会议</button>
        </form>
      </div>

      <!-- 操作区 -->
      <div class="nec-card p-5">
        <h3 class="text-sm font-bold text-nec-navy mb-3">状态操作</h3>
        <div class="flex flex-wrap gap-2">
          <button v-if="store.detail.status === 'rectifying'" class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:#B04A0F" @click="completeRectify(store.detail!.reviewId)">整改完成</button>
          <template v-if="store.detail.status === 'assessing'">
            <button class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:#177A4C" @click="assess(store.detail!.reviewId, 'pass')">评估通过</button>
            <button class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:#C22E2E" @click="assess(store.detail!.reviewId, 'fail')">评估不通过</button>
          </template>
          <button v-if="store.detail.status === 'approved'" class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:var(--nec-navy)" @click="archive(store.detail!.reviewId)">归档</button>
          <span v-if="!hasActions" class="text-xs text-nec-gray">当前状态无可用操作</span>
        </div>
      </div>

      <!-- 会议纪要 -->
      <div class="nec-card p-5">
        <h3 class="text-sm font-bold text-nec-navy mb-3">保存会议纪要</h3>
        <form class="space-y-3" @submit.prevent="onSaveMinutes(store.detail!.reviewId)">
          <div>
            <label class="block text-xs text-nec-gray mb-1">会议时间</label>
            <input type="datetime-local" v-model="minutes.meetingTime" required class="mono w-full rounded border border-nec-line px-3 py-2 text-sm" />
          </div>
          <div>
            <label class="block text-xs text-nec-gray mb-1">参会人 open_id（逗号分隔）</label>
            <input type="text" v-model="minutes.attendees" class="mono w-full rounded border border-nec-line px-3 py-2 text-sm" placeholder="ou_xxx,ou_yyy" />
          </div>
          <div>
            <label class="block text-xs text-nec-gray mb-1">议题（每行一条）</label>
            <textarea v-model="minutes.topics" rows="2" class="w-full rounded border border-nec-line px-3 py-2 text-sm" placeholder="选型方案确认&#10;关键指标评审"></textarea>
          </div>
          <div>
            <label class="block text-xs text-nec-gray mb-1">讨论记录</label>
            <textarea v-model="minutes.discussion" rows="3" required class="w-full rounded border border-nec-line px-3 py-2 text-sm"></textarea>
          </div>
          <div>
            <label class="block text-xs text-nec-gray mb-1">评审问题（每行一条；结论为「有条件通过」时自动生成整改项）</label>
            <textarea v-model="minutes.issues" rows="2" class="w-full rounded border border-nec-line px-3 py-2 text-sm" placeholder="电源纹波超标，需补充滤波设计"></textarea>
          </div>
          <div>
            <label class="block text-xs text-nec-gray mb-1">待办（每行一条：事项|负责人open_id|截止日期，后两项可省略）</label>
            <textarea v-model="minutes.nextActions" rows="2" class="mono w-full rounded border border-nec-line px-3 py-2 text-sm" placeholder="补充 EMC 测试报告|ou_xxx|2026-10-20"></textarea>
          </div>
          <div>
            <label class="block text-xs text-nec-gray mb-1">评审结论</label>
            <select v-model="minutes.conclusion" class="w-full rounded border border-nec-line px-3 py-2 text-sm bg-white">
              <option value="passed">通过</option>
              <option value="conditional">有条件通过</option>
              <option value="rejected">不通过</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-nec-gray mb-1">结论备注（可选）</label>
            <textarea v-model="minutes.conclusionNotes" rows="2" class="w-full rounded border border-nec-line px-3 py-2 text-sm" placeholder="结论补充说明"></textarea>
          </div>
          <button type="submit" class="btn-primary text-sm font-medium px-4 py-2 rounded-lg">保存纪要并提交结论</button>
        </form>
        <p id="minutes-result" class="mt-2 text-sm" :style="minutesResult.text ? { color: minutesResult.ok ? '#177A4C' : '#C22E2E' } : {}">{{ minutesResult.text }}</p>
      </div>

      <!-- 评审报告生成 -->
      <div class="nec-card p-5">
        <h3 class="text-sm font-bold text-nec-navy mb-3">生成评审报告</h3>
        <form class="space-y-3" @submit.prevent="onGenerateReport(store.detail!.reviewId)">
          <div>
            <label class="block text-xs text-nec-gray mb-1">总结</label>
            <textarea v-model="report.summary" rows="2" class="w-full rounded border border-nec-line px-3 py-2 text-sm" placeholder="评审总结"></textarea>
          </div>
          <div>
            <label class="block text-xs text-nec-gray mb-1">检查清单 JSON</label>
            <textarea v-model="report.checklist" rows="4" required class="mono w-full rounded border border-nec-line px-3 py-2 text-sm" placeholder='[{"item":"电气安全","category":"安全","result":"pass"},{"item":"接口兼容性","result":"na"}]'></textarea>
          </div>
          <button type="submit" class="btn-accent text-sm font-medium px-4 py-2 rounded-lg">生成报告</button>
        </form>
        <p id="report-result" class="mt-2 text-sm" :style="reportResult.text ? { color: reportResult.ok ? '#177A4C' : '#C22E2E' } : {}">{{ reportResult.text }}</p>
      </div>
    </template>
  </div>
</template>
