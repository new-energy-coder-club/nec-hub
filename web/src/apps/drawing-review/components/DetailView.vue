<script setup lang="ts">
// 评审单详情（原 #view-detail）：概要卡、状态操作、会议纪要、BOM 生成、询价面板
import { ref, onMounted } from 'vue'
import { apiDr } from '@shared/api'
import { drStatus, type Review } from '../types'
import InquiryPanel from './InquiryPanel.vue'
import { toast } from '@shared/ui/feedback'

const props = defineProps<{ reviewId: string }>()

const review = ref<Review | null>(null)
const error = ref('')

// 会议纪要表单
const minutes = ref({ meetingTime: '', discussion: '', conclusion: 'passed' })
const minutesResult = ref<{ ok: boolean; text: string } | null>(null)

// BOM 表单
const bomItems = ref('')
const bomResult = ref<{ ok: boolean; text: string } | null>(null)

async function load() {
  error.value = ''
  try {
    review.value = await apiDr(`/${props.reviewId}`)
  } catch (err) {
    error.value = (err as Error).message
  }
}

async function scheduleMeeting() {
  try {
    const data = await apiDr(`/${props.reviewId}/meeting`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (data.meeting?.mock) {
      toast(`会议 API 未打通（${data.meeting.mockReason || '权限/网络'}），已生成占位会议号 ${data.meeting.meetingId}\n请人工建会后把真实会议链接补录进评审单，流程不受影响`)
    } else {
      toast(`会议已创建：${data.meeting?.meetingLink}`)
    }
    load()
  } catch (err) {
    toast('预约失败：' + (err as Error).message)
  }
}

async function completeRectify() {
  try {
    await apiDr(`/${props.reviewId}/rectify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    load()
  } catch (err) {
    toast('操作失败：' + (err as Error).message)
  }
}

async function saveMinutes() {
  try {
    await apiDr(`/${props.reviewId}/minutes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        meetingTime: new Date(minutes.value.meetingTime).toISOString(),
        discussion: minutes.value.discussion,
        attendees: [],
        topics: [],
        issues: [],
        nextActions: [],
        conclusion: minutes.value.conclusion,
        attachments: [],
      }),
    })
    await apiDr(`/${props.reviewId}/conclusion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conclusion: minutes.value.conclusion }),
    })
    minutesResult.value = { ok: true, text: '纪要与结论已保存' }
    load()
  } catch (err) {
    minutesResult.value = { ok: false, text: '失败：' + (err as Error).message }
  }
}

async function generateBOM() {
  try {
    const items = JSON.parse(bomItems.value)
    const data = await apiDr(`/${props.reviewId}/bom/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items }),
    })
    bomResult.value = { ok: true, text: `BOM 已生成：${data.bom.bomId}，共 ${data.items.length} 项` }
    load()
  } catch (err) {
    bomResult.value = { ok: false, text: '失败：' + (err as Error).message }
  }
}

onMounted(load)
</script>

<template>
  <div id="detail-content" class="space-y-4">
    <p v-if="error" class="text-sm" style="color:#C22E2E">加载失败：{{ error }}</p>
    <p v-else-if="!review" class="text-sm text-nec-gray">加载中…</p>

    <template v-else>
      <div class="nec-card p-5" style="border-top:3px solid var(--nec-cyan)">
        <div class="flex items-start justify-between">
          <div>
            <p class="mono text-xs text-nec-cyan tracking-widest mb-1">{{ review.reviewId }}</p>
            <h2 class="text-xl font-bold text-nec-ink">{{ review.machineName }}</h2>
            <p class="mono text-xs text-nec-gray mt-1">项目 {{ review.projectId }} · 版本 {{ review.drawingVersion }}</p>
          </div>
          <span class="status-badge" :style="drStatus(review.status).color">{{ drStatus(review.status).label }}</span>
        </div>
        <div class="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div><span class="text-nec-gray">设计负责人：</span><span class="mono">{{ review.designerId }}</span></div>
          <div><span class="text-nec-gray">创建时间：</span><span class="mono">{{ new Date(review.createdAt).toLocaleString() }}</span></div>
          <div v-if="review.meetingId"><span class="text-nec-gray">会议号：</span><span class="mono">{{ review.meetingId }}</span></div>
          <div v-if="review.meetingStartTime"><span class="text-nec-gray">会议时间：</span><span class="mono">{{ new Date(review.meetingStartTime).toLocaleString() }}</span></div>
        </div>
        <div class="mt-4">
          <h3 class="text-sm font-bold text-nec-navy mb-2">设计说明</h3>
          <p class="text-sm text-nec-gray whitespace-pre-wrap">{{ review.designNotes }}</p>
        </div>
        <div v-if="review.meetingLink" class="mt-4"><a :href="review.meetingLink" target="_blank" class="text-sm link hover:underline mono">加入腾讯会议 →</a></div>
      </div>

      <!-- 操作区 -->
      <div class="nec-card p-5">
        <h3 class="text-sm font-bold text-nec-navy mb-3">状态操作</h3>
        <div class="flex flex-wrap gap-2">
          <button v-if="review.status === 'pending_review'" class="btn-primary text-xs px-3 py-1.5 rounded-lg" @click="scheduleMeeting">预约会议</button>
          <button v-if="review.status === 'rectifying'" class="text-xs px-3 py-1.5 rounded-lg text-white" style="background:#B04A0F" @click="completeRectify">整改完成</button>
          <span v-if="review.status !== 'pending_review' && review.status !== 'rectifying'" class="text-xs text-nec-gray">当前状态无可用操作</span>
        </div>
      </div>

      <!-- 会议纪要 -->
      <div class="nec-card p-5">
        <h3 class="text-sm font-bold text-nec-navy mb-3">保存会议纪要</h3>
        <form class="space-y-3" @submit.prevent="saveMinutes">
          <div>
            <label class="block text-xs text-nec-gray mb-1">会议时间</label>
            <input type="datetime-local" v-model="minutes.meetingTime" required class="mono w-full rounded border border-nec-line px-3 py-2 text-sm" />
          </div>
          <div>
            <label class="block text-xs text-nec-gray mb-1">讨论记录</label>
            <textarea v-model="minutes.discussion" rows="3" required class="w-full rounded border border-nec-line px-3 py-2 text-sm"></textarea>
          </div>
          <div>
            <label class="block text-xs text-nec-gray mb-1">评审结论</label>
            <select v-model="minutes.conclusion" class="w-full rounded border border-nec-line px-3 py-2 text-sm bg-white">
              <option value="passed">通过</option>
              <option value="conditional">有条件通过</option>
              <option value="rejected">不通过</option>
            </select>
          </div>
          <button type="submit" class="btn-primary text-sm font-medium px-4 py-2 rounded-lg">保存纪要并提交结论</button>
        </form>
        <p v-if="minutesResult" id="minutes-result" class="mt-2 text-sm" :class="minutesResult.ok ? 'text-green-600' : 'text-red-600'">{{ minutesResult.text }}</p>
      </div>

      <!-- BOM 生成 -->
      <div class="nec-card p-5">
        <h3 class="text-sm font-bold text-nec-navy mb-3">生成 BOM</h3>
        <form class="space-y-3" @submit.prevent="generateBOM">
          <div>
            <label class="block text-xs text-nec-gray mb-1">BOM JSON（首期可粘贴简单数组）</label>
            <textarea v-model="bomItems" rows="4" required class="mono w-full rounded border border-nec-line px-3 py-2 text-sm" placeholder='[{"materialName":"电机支架","quantity":2,"unit":"件","source":"self-made","process":"machining"}]'></textarea>
          </div>
          <button type="submit" class="btn-accent text-sm font-medium px-4 py-2 rounded-lg">生成 BOM</button>
        </form>
        <p v-if="bomResult" id="bom-result" class="mt-2 text-sm" :class="bomResult.ok ? 'text-green-600' : 'text-red-600'">{{ bomResult.text }}</p>
      </div>

      <!-- 询价（外购/标准件） -->
      <InquiryPanel :review-id="review.reviewId" />
    </template>
  </div>
</template>
