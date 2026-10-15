<script setup lang="ts">
// 详情视图：审批单详情 + 审批人进度 + 操作（开始审批/同意/拒绝/要求修改/归档/重新提交）+ 评论
import { ref, computed, onMounted } from 'vue'
import {
  store, router, api,
  statusBadge, renderType, renderLevel, decisionBadge, personLabel, formatSize,
  stepBar, parseFileBatch, parseApproverBatch,
  type CsApproval, type CsComment,
} from '../store'

const props = defineProps<{ approvalId: string }>()

const detail = ref<CsApproval | null>(null)
const loading = ref(true)
const errorMsg = ref('')
const comments = ref<CsComment[] | null>(null)
const commentsError = ref('')
const actionComment = ref('')
const resubmit = ref({ summary: '', filesBatch: '', approversBatch: '' })
const resubmitMsg = ref('')

const me = computed(() => store.currentUser?.open_id)
const isSubmitter = computed(() => !!(me.value && detail.value && detail.value.submittedBy === me.value))
const myApproverEntry = computed(() => me.value ? (detail.value?.approvers || []).find(a => a.approverId === me.value) || null : null)
const isParticipant = computed(() => isSubmitter.value || !!myApproverEntry.value)

function fmtTime(v?: string): string {
  return v ? new Date(v).toLocaleString('zh-CN') : '—'
}

async function loadDetail() {
  loading.value = true
  errorMsg.value = ''
  comments.value = null
  commentsError.value = ''
  try {
    detail.value = await api(`/api/contract-approval/${encodeURIComponent(props.approvalId)}`)
    resubmit.value.summary = detail.value.summary || ''
    loadComments()
  } catch (err: any) {
    errorMsg.value = err.message
  } finally {
    loading.value = false
  }
}

async function loadComments() {
  try {
    const data = await api(`/api/contract-approval/${encodeURIComponent(props.approvalId)}/comments`)
    comments.value = Array.isArray(data) ? data : []
  } catch (err: any) {
    comments.value = []
    commentsError.value = err.message
  }
}

/* ---------- 操作调用 ---------- */
async function startReview() {
  try {
    await api(`/api/contract-approval/${encodeURIComponent(props.approvalId)}/start-review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    loadDetail()
  } catch (err: any) {
    alert('操作失败：' + err.message)
  }
}

async function takeAction(action: 'approve' | 'reject' | 'revise') {
  const comment = actionComment.value.trim()
  if ((action === 'reject' || action === 'revise') && !comment && !confirm('未填写审批意见，仍要继续吗？')) return
  try {
    await api(`/api/contract-approval/${encodeURIComponent(props.approvalId)}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...(comment ? { comment } : {}) }),
    })
    actionComment.value = ''
    loadDetail()
  } catch (err: any) {
    alert('操作失败：' + err.message)
  }
}

async function archiveApproval() {
  try {
    await api(`/api/contract-approval/${encodeURIComponent(props.approvalId)}/archive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    loadDetail()
  } catch (err: any) {
    alert('操作失败：' + err.message)
  }
}

async function resubmitApproval() {
  resubmitMsg.value = ''
  const summary = resubmit.value.summary.trim()
  const files = parseFileBatch(resubmit.value.filesBatch)
  const approvers = parseApproverBatch(resubmit.value.approversBatch)
  try {
    await api(`/api/contract-approval/${encodeURIComponent(props.approvalId)}/resubmit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(summary ? { summary } : {}),
        ...(files.length ? { contractFiles: files } : {}),
        ...(approvers.length ? { approvers } : {}),
      }),
    })
    loadDetail()
  } catch (err: any) {
    resubmitMsg.value = '失败：' + err.message
  }
}

onMounted(loadDetail)
</script>

<template>
  <div>
    <div class="mb-4">
      <button class="text-sm link hover:underline mono" @click="router('list')">← 返回审批单</button>
    </div>
    <div id="detail-content" class="space-y-4">
      <p v-if="loading" class="text-sm text-nec-gray">加载中…</p>
      <p v-else-if="errorMsg" class="text-sm" style="color:#C22E2E">加载失败：{{ errorMsg }}</p>
      <template v-else-if="detail">
        <div class="nec-card p-5" style="border-top:3px solid var(--nec-cyan)">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="mono text-xs text-nec-cyan tracking-widest mb-1">{{ detail.approvalId }}</p>
              <h2 class="text-xl font-bold text-nec-ink">{{ detail.contractName }}</h2>
              <p class="mono text-xs text-nec-gray mt-1">{{ detail.contractNumber ? detail.contractNumber + ' · ' : '' }}{{ renderType(detail.contractType) }}</p>
            </div>
            <span class="status-badge" :style="statusBadge(detail.status).color">{{ statusBadge(detail.status).label }}</span>
          </div>
          <div class="mt-4 flex items-center gap-2 overflow-x-auto scrollbar-hide py-1">
            <template v-for="(s, i) in stepBar(detail.status)" :key="i">
              <span v-if="i" class="flow-conn" :class="{ done: s.connDone }"></span>
              <span class="flow-step" :class="s.cls"><span class="dot">{{ s.dot }}</span><span class="lbl">{{ s.label }}</span></span>
            </template>
          </div>
          <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div><span class="text-nec-gray">提交人：</span><span :title="detail.submittedBy">{{ personLabel(detail.submittedBy) }}</span></div>
            <div><span class="text-nec-gray">创建时间：</span><span class="mono">{{ fmtTime(detail.createdAt) }}</span></div>
            <div v-if="detail.effectiveDate"><span class="text-nec-gray">生效日期：</span><span class="mono">{{ detail.effectiveDate }}</span></div>
            <div v-if="detail.expirationDate"><span class="text-nec-gray">到期日期：</span><span class="mono">{{ detail.expirationDate }}</span></div>
            <div v-if="(detail.parties || []).length" class="sm:col-span-2"><span class="text-nec-gray">合同各方：</span>{{ (detail.parties || []).join('、') }}</div>
          </div>
          <div v-if="detail.summary" class="mt-4">
            <h3 class="text-sm font-bold text-nec-navy mb-2">合同摘要</h3>
            <p class="text-sm text-nec-gray whitespace-pre-wrap">{{ detail.summary }}</p>
          </div>
          <div class="mt-4">
            <h3 class="text-sm font-bold text-nec-navy mb-2">合同文件</h3>
            <div class="space-y-2">
              <template v-if="(detail.contractFiles || []).length">
                <div v-for="(f, i) in detail.contractFiles" :key="i" class="flex items-center gap-2 rounded-lg border border-nec-line bg-white px-3 py-2 text-sm">
                  <span class="mono text-xs text-nec-royal font-bold">FILE</span>
                  <a v-if="f.url" :href="f.url" target="_blank" class="link hover:underline truncate">{{ f.name }}</a>
                  <span v-else class="text-nec-ink truncate">{{ f.name }}</span>
                  <span v-if="f.size" class="mono text-xs text-nec-gray flex-none">{{ formatSize(f.size) }}</span>
                </div>
              </template>
              <p v-else class="text-xs text-nec-gray">无</p>
            </div>
          </div>
        </div>

        <!-- 审批人进度 -->
        <div class="nec-card p-5">
          <h3 class="text-sm font-bold text-nec-navy mb-3">审批人进度（会签：全部同意才通过）</h3>
          <div class="space-y-2">
            <template v-for="(a, i) in detail.approvers || []" :key="i">
              <div class="flex items-center gap-3 rounded-lg border border-nec-line bg-white px-3 py-2 text-sm flex-wrap">
                <span class="status-badge" style="background:var(--nec-royal-100);color:var(--nec-royal)">{{ renderLevel(a.level) }}</span>
                <span class="text-nec-ink font-medium" :title="a.approverId">{{ personLabel(a.approverId, a.name) }}</span>
                <span class="status-badge ml-auto" :style="decisionBadge(a.status).color">{{ decisionBadge(a.status).label }}</span>
              </div>
              <p v-if="a.comment" class="text-xs text-nec-gray pl-3 -mt-1">意见：{{ a.comment }}<template v-if="a.actedAt"> · <span class="mono">{{ fmtTime(a.actedAt) }}</span></template></p>
            </template>
          </div>
        </div>

        <!-- 操作区 -->
        <div class="nec-card p-5">
          <h3 class="text-sm font-bold text-nec-navy mb-3">操作</h3>
          <div class="flex flex-wrap gap-2 items-start">
            <button v-if="detail.status === 'pending_approval' && isParticipant" class="btn-primary text-sm font-medium px-4 py-2 rounded-lg" @click="startReview">开始审批</button>
            <div v-if="detail.status === 'in_review' && myApproverEntry && myApproverEntry.status === 'pending'" class="w-full">
              <label class="block text-xs text-nec-gray mb-1">审批意见（拒绝 / 要求修改时建议填写）</label>
              <textarea v-model="actionComment" rows="2" class="w-full rounded border border-nec-line px-3 py-2 text-sm" placeholder="审批意见，将同步到评论区"></textarea>
              <div class="mt-2 flex flex-wrap gap-2">
                <button class="text-sm font-medium px-4 py-2 rounded-lg text-white" style="background:#177A4C" @click="takeAction('approve')">同意</button>
                <button class="text-sm font-medium px-4 py-2 rounded-lg text-white" style="background:#C22E2E" @click="takeAction('reject')">拒绝</button>
                <button class="text-sm font-medium px-4 py-2 rounded-lg text-white" style="background:#B04A0F" @click="takeAction('revise')">要求修改</button>
              </div>
            </div>
            <button v-if="(detail.status === 'approved' || detail.status === 'rejected') && isParticipant" class="text-sm font-medium px-4 py-2 rounded-lg text-white" style="background:var(--nec-navy)" @click="archiveApproval">归档</button>
            <p v-if="detail.status === 'revised' && isSubmitter" class="text-xs text-nec-gray w-full">审批人要求修改，请在下方「重新提交」区域更新材料后重新发起审批。</p>
            <span
              v-if="!(detail.status === 'pending_approval' && isParticipant)
                && !(detail.status === 'in_review' && myApproverEntry && myApproverEntry.status === 'pending')
                && !((detail.status === 'approved' || detail.status === 'rejected') && isParticipant)
                && !(detail.status === 'revised' && isSubmitter)"
              class="text-xs text-nec-gray"
            >当前状态下你可用的操作以列表为准（部分操作仅限提交人或审批人）。</span>
          </div>
        </div>

        <!-- 重新提交（仅提交人，待修改状态） -->
        <div v-if="detail.status === 'revised' && isSubmitter" class="nec-card p-5">
          <h3 class="text-sm font-bold text-nec-navy mb-3">重新提交（仅提交人）</h3>
          <form class="space-y-3" @submit.prevent="resubmitApproval">
            <div>
              <label class="block text-xs text-nec-gray mb-1">更新后的合同摘要（留空则保持原摘要）</label>
              <textarea v-model="resubmit.summary" rows="3" class="w-full rounded border border-nec-line px-3 py-2 text-sm" placeholder="留空则不修改"></textarea>
            </div>
            <div>
              <label class="block text-xs text-nec-gray mb-1">替换合同文件（名称|文件token|链接，每行一条；留空则保持原文件）</label>
              <textarea v-model="resubmit.filesBatch" rows="2" class="mono w-full rounded border border-nec-line px-3 py-2 text-sm" placeholder="采购合同 V1.1.pdf|file_token_xxx"></textarea>
            </div>
            <div>
              <label class="block text-xs text-nec-gray mb-1">替换审批人（层级|open_id|姓名，每行一条；留空则沿用原审批人并重置为待审批）</label>
              <textarea v-model="resubmit.approversBatch" rows="2" class="mono w-full rounded border border-nec-line px-3 py-2 text-sm" placeholder="team_lead|ou_xxx|张三&#10;finance|ou_yyy|李四"></textarea>
            </div>
            <button type="submit" class="btn-primary text-sm font-medium px-4 py-2 rounded-lg">重新提交审批</button>
            <p id="resubmit-result" class="text-sm" style="color:#C22E2E">{{ resubmitMsg }}</p>
          </form>
        </div>

        <!-- 评论区 -->
        <div class="nec-card p-5">
          <h3 class="text-sm font-bold text-nec-navy mb-3">评论</h3>
          <div id="comment-list" class="space-y-3">
            <p v-if="comments === null" class="text-xs text-nec-gray">加载中…</p>
            <p v-else-if="commentsError" class="text-xs" style="color:#C22E2E">评论加载失败：{{ commentsError }}</p>
            <p v-else-if="!comments.length" class="text-xs text-nec-gray">暂无评论，审批意见会自动出现在这里。</p>
            <template v-else>
              <div v-for="(c, i) in comments" :key="i" class="rounded-lg border border-nec-line bg-white px-3 py-2">
                <div class="flex items-center gap-2 text-xs text-nec-gray">
                  <span class="font-medium text-nec-navy" :title="c.reviewerId">{{ personLabel(c.reviewerId) }}</span>
                  <span class="mono">{{ c.timestamp ? fmtTime(c.timestamp) : '' }}</span>
                </div>
                <p class="text-sm text-nec-ink mt-1 whitespace-pre-wrap">{{ c.content }}</p>
              </div>
            </template>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
