<script setup lang="ts">
// 管理总览：登录与会话（含会话清单与强制下线）/ 租户与接入 / 模块配置状态（含内联配置表单）/ 成员名单
// 仅队长·组长·指导·管理员可见（见 useTabs ADMIN_TABS；真正鉴权以后端 /api/admin/* 为准）
import { ref, computed, watch, onMounted } from 'vue'
import { auth, logoutAllDevices, clearLocalSession } from '@shared/auth'
import { toast, confirmDialog } from '@shared/ui/feedback'
import { switchTab } from '@portal/composables/useTabs'
import {
  fetchAdminSessions, revokeUserSessions,
  saveDashboardConfig, saveFlowConfig, saveReviewModuleConfig,
  type AdminSessionUser,
} from '@portal/composables/useAdmin'

const d = ref<any>(null)
const loadFailed = ref('')
const refreshing = ref(false)
const revoking = ref(false)

// 三个评审模块的配置状态：前端直调各自免登录的 GET /api/<module>/config（module-gateway 统一出口）
const reviewModules = ref<Array<{ key: 'drawing-review' | 'hardware-review' | 'contract-approval'; label: string; configured: boolean | null }>>([
  { key: 'drawing-review', label: '图纸评审模块', configured: null },
  { key: 'hardware-review', label: '硬件评审模块', configured: null },
  { key: 'contract-approval', label: '合同审批模块', configured: null },
])

async function loadOverview() {
  if (!auth.me.authenticated) { d.value = null; return }
  refreshing.value = true
  loadFailed.value = ''
  try {
    const resp = await fetch('/api/admin/overview')
    const data = await resp.json()
    if (!resp.ok || data.error) throw new Error(data.error || ('HTTP ' + resp.status))
    d.value = data
  } catch (e: any) {
    d.value = null
    loadFailed.value = e.message || String(e)
  } finally {
    refreshing.value = false
  }
}

async function loadReviewModules() {
  await Promise.all(reviewModules.value.map(async (m) => {
    try {
      const resp = await fetch(`/api/${m.key}/config`)
      const data = await resp.json()
      m.configured = !!data.configured
    } catch {
      m.configured = null // 读取失败按未知处理
    }
  }))
}

async function onLogoutAll() {
  if (revoking.value) return
  if (!await confirmDialog('退出所有设备？\n将删除你名下全部登录会话（含本机与其他设备），需要重新登录。')) return
  revoking.value = true
  try {
    const revoked = await logoutAllDevices()
    switchTab('home') // 登出后管理 Tab 已不可见，回首页避免停在 401 卡片
    toast(`✅ 已退出所有设备（注销 ${revoked} 个会话），请重新登录`)
  } catch (e: any) {
    toast('退出所有设备失败：' + (e.message || e))
  } finally {
    revoking.value = false
  }
}

// ---- 会话清单 ----
const sessions = ref<AdminSessionUser[]>([])
const sessionsFailed = ref('')
const revokingOpenId = ref('')

async function loadSessions() {
  if (!auth.me.authenticated) { sessions.value = []; return }
  try {
    sessions.value = (await fetchAdminSessions()).users
    sessionsFailed.value = ''
  } catch (e: any) {
    sessions.value = []
    sessionsFailed.value = e.message || String(e)
  }
}

const myOpenId = computed(() => auth.me.user?.open_id ?? '')

async function onRevoke(u: AdminSessionUser) {
  const isSelf = u.open_id === myOpenId.value
  const msg = isSelf
    ? '下线本人会话？\n你在所有设备上的登录都会失效（含本机），需要重新登录。'
    : `强制下线 ${u.name}？\n将删除其名下的 ${u.sessions} 个会话，该用户所有设备立即登出。`
  if (!await confirmDialog(msg)) return
  revokingOpenId.value = u.open_id
  try {
    const n = await revokeUserSessions(u.open_id)
    if (isSelf) {
      clearLocalSession()
      switchTab('home')
      toast(`已下线本人全部会话（${n} 个），请重新登录`)
    } else {
      toast(`✅ 已强制下线 ${u.name}（${n} 个会话）`)
      await Promise.all([loadSessions(), loadOverview()])
    }
  } catch (e: any) {
    toast('强制下线失败：' + (e.message || e))
  } finally {
    revokingOpenId.value = ''
  }
}

function fmtTime(v: string | number): string {
  if (!v) return '—'
  return new Date(v).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ---- 模块配置状态行 + 内联配置表单 ----
interface ModuleRow { key: string; label: string; ok: boolean | null; hint?: string }
const CONFIG_HINT = '点右侧「配置」在线设置，或用 NEC-MCP 的 config_xxx 工具'
const FLOW_LABELS: Array<[string, string]> = [['reimburse', '报销审批流'], ['drawing', '图纸审批流'], ['hardware', '硬件审批流'], ['compliance', '合规审批流']]
const moduleRows = computed<ModuleRow[]>(() => {
  const m = d.value?.modules
  if (!m) return []
  return [
    { key: 'dashboard', label: '数据看板（dashboard:config）', ok: !!m.dashboard?.configured, hint: m.dashboard?.configured ? `已配置 ${m.dashboard.tables.length} 张表` : CONFIG_HINT },
    ...FLOW_LABELS.map(([k, label]) => ({ key: `flow:${k}`, label: `${label}（flows:config）`, ok: !!m.flows?.[k] as boolean | null, hint: m.flows?.[k] ? '' : CONFIG_HINT })),
    ...reviewModules.value.map((r) => ({ key: `mod:${r.key}`, label: r.label, ok: r.configured, hint: r.configured === false ? CONFIG_HINT : '' })),
    { key: 'validate-rules', label: '校验规则（validate:rules）', ok: m.validateRules === 'custom', hint: m.validateRules === 'custom' ? '使用 KV 自定义规则' : '使用内置默认规则' },
  ]
})

interface TableField { key: string; label: string }
interface ConfigFormSpec {
  /** 提交：base + 清洗后的 tables 映射 */
  submit: (base: string, tables: Record<string, string>) => Promise<void>
  tableFields: TableField[]
  /** false 时表单不含 base 输入框（flows 单流程补丁需要 base，故目前都为 true） */
  successText: string
}
const DASH_TABLE_FIELDS: TableField[] = [
  { key: 'members', label: '队员名单' }, { key: 'tasks', label: '任务进度' }, { key: 'inventory', label: '物资台账' },
  { key: 'finance', label: '财务报销' }, { key: 'goals', label: '赛季目标' },
]
const CONFIG_FORMS: Record<string, ConfigFormSpec> = {
  dashboard: { submit: (base, t) => saveDashboardConfig(base, t), tableFields: DASH_TABLE_FIELDS, successText: '数据看板配置已保存' },
  'mod:drawing-review': {
    submit: (base, t) => saveReviewModuleConfig('drawing-review', base, t),
    tableFields: [
      { key: 'reviews', label: '评审单' }, { key: 'minutes', label: '会议纪要' }, { key: 'rectifications', label: '整改项' },
      { key: 'bom', label: 'BOM 清单' }, { key: 'assessments', label: '评估报告' }, { key: 'inventory', label: '库存查询' },
      { key: 'delivery', label: '发货清单' }, { key: 'schedule', label: '排期任务' }, { key: 'inquiries', label: '询价单' }, { key: 'events', label: '流程事件' },
    ],
    successText: '图纸评审模块配置已保存',
  },
  'mod:hardware-review': {
    submit: (base, t) => saveReviewModuleConfig('hardware-review', base, t),
    tableFields: [
      { key: 'reviews', label: '评审单' }, { key: 'minutes', label: '会议纪要' }, { key: 'rectifications', label: '整改项' },
      { key: 'reports', label: '评审报告' }, { key: 'events', label: '流程事件' },
    ],
    successText: '硬件评审模块配置已保存',
  },
  'mod:contract-approval': {
    submit: (base, t) => saveReviewModuleConfig('contract-approval', base, t),
    tableFields: [{ key: 'approvals', label: '审批单' }, { key: 'comments', label: '审批评论' }, { key: 'events', label: '流程事件' }],
    successText: '合同审批模块配置已保存',
  },
}
// flows 四个流程：单流程补丁 {tableId, base}（服务端深合并，不影响其他流程）
for (const [k, label] of FLOW_LABELS) {
  CONFIG_FORMS[`flow:${k}`] = {
    submit: (base, t) => saveFlowConfig(k, { tableId: t.tableId ?? '', base }),
    tableFields: [{ key: 'tableId', label: '底表' }],
    successText: `${label}配置已保存`,
  }
}

const openForm = ref('')
const formBase = ref('')
const formTables = ref<Record<string, string>>({})
const formErr = ref('')
const formSaving = ref(false)

function toggleForm(key: string) {
  if (openForm.value === key) { openForm.value = ''; return }
  openForm.value = key
  formBase.value = ''
  formTables.value = {}
  formErr.value = ''
}

async function submitForm(key: string) {
  const spec = CONFIG_FORMS[key]
  if (!spec || formSaving.value) return
  const base = formBase.value.trim()
  const tables: Record<string, string> = {}
  for (const f of spec.tableFields) {
    const v = (formTables.value[f.key] ?? '').trim()
    if (v) tables[f.key] = v
  }
  if (!base) { formErr.value = '请填写多维表格 base（URL 中 /base/ 后的 app_token）'; return }
  if (Object.keys(tables).length === 0) { formErr.value = '至少填写一张表的 table_id（tbl 开头）'; return }
  formSaving.value = true
  formErr.value = ''
  try {
    await spec.submit(base, tables)
    toast(`✅ ${spec.successText}`)
    openForm.value = ''
    await Promise.all([loadOverview(), loadReviewModules()])
  } catch (e: any) {
    formErr.value = e.message || String(e) // 400 校验失败 / 403 无权限，内联展示
  } finally {
    formSaving.value = false
  }
}

const members = computed(() => d.value?.members ?? null)
const me = computed(() => auth.me.user)

onMounted(() => { loadOverview(); loadReviewModules(); loadSessions() })
watch(() => auth.tick, () => { loadOverview(); loadReviewModules(); loadSessions() })
</script>

<template>
  <section id="tab-admin">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">管理总览</h2>
      <button @click="loadOverview" :disabled="refreshing" class="text-xs px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-50">{{ refreshing ? '刷新中…' : '⟳ 刷新' }}</button>
    </div>

    <!-- 骨架屏 -->
    <div v-if="!d && !loadFailed" class="space-y-4">
      <div v-for="i in 2" :key="i" class="bg-white rounded-xl shadow p-6 animate-pulse">
        <div class="h-4 w-24 bg-gray-100 rounded"></div>
        <div class="h-3 bg-gray-100 rounded mt-4"></div>
        <div class="h-3 w-2/3 bg-gray-100 rounded mt-2"></div>
      </div>
    </div>

    <div v-else-if="loadFailed" class="bg-white rounded-xl shadow p-6 text-sm text-red-500">管理总览加载失败：{{ loadFailed }}</div>

    <div v-else-if="!auth.me.authenticated" class="bg-white rounded-xl shadow p-6 text-sm text-gray-500">🔐 登录后可查看管理总览（限队长/组长/指导/管理员）。</div>

    <div v-else-if="d" class="space-y-4">
      <!-- 登录与会话 -->
      <div class="bg-white rounded-xl shadow p-5">
        <h3 class="font-bold mb-3">登录与会话</h3>
        <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
 <span>当前用户：<b>class="text-nec-navy"{{ me?.name || '—' }}</b></span>
          <span class="text-gray-500">角色：{{ me?.role || '—' }}</span>
          <span class="text-gray-500">组别：{{ me?.group || '—' }}</span>
          <span class="text-gray-500">全站活跃会话：<b class="mono text-nec-navy">{{ d.sessions?.active ?? '—' }}</b></span>
        </div>
        <div class="mt-3 flex items-center gap-3">
          <button @click="onLogoutAll" :disabled="revoking" class="text-xs px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style="background:#DC2626">{{ revoking ? '退出中…' : '退出所有设备' }}</button>
          <span class="text-xs text-gray-400">注销你名下全部会话（含其他浏览器/设备），本机同步登出</span>
        </div>

        <!-- 会话清单：按 open_id 聚合，可强制下线 -->
        <div class="mt-4 overflow-x-auto">
          <p v-if="sessionsFailed" class="text-sm text-red-500">会话清单加载失败：{{ sessionsFailed }}</p>
          <table v-else-if="sessions.length" class="w-full text-sm">
            <thead><tr class="text-left text-xs text-gray-400">
              <th class="pb-1 font-medium">用户</th><th class="pb-1 font-medium">open_id</th><th class="pb-1 font-medium">会话数</th>
              <th class="pb-1 font-medium">最近登录</th><th class="pb-1 font-medium">最晚到期</th><th class="pb-1 font-medium">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="u in sessions" :key="u.open_id" class="border-t border-gray-100" :class="{ 'bg-amber-50': u.open_id === myOpenId }">
                <td class="py-2 pr-3 whitespace-nowrap">
                  {{ u.name || '—' }}
 <span v-if="u.open_id === myOpenId" class="px-1.5 py-0.5 rounded text-[10px] text-white ml-1 bg-nec-cyan">本人</span>
                </td>
                <td class="py-2 pr-3 mono text-xs text-gray-400 whitespace-nowrap" :title="u.open_id">…{{ u.open_id.slice(-6) }}</td>
                <td class="py-2 pr-3 mono text-xs">{{ u.sessions }}</td>
                <td class="py-2 pr-3 mono text-xs text-gray-500 whitespace-nowrap">{{ fmtTime(u.latestCreatedAt) }}</td>
                <td class="py-2 pr-3 mono text-xs text-gray-500 whitespace-nowrap">{{ fmtTime(u.latestExpiresAt) }}</td>
                <td class="py-2 whitespace-nowrap">
                  <button @click="onRevoke(u)" :disabled="revokingOpenId === u.open_id"
                          class="text-xs px-2 py-1 rounded border disabled:opacity-50"
                          :class="u.open_id === myOpenId ? 'border-red-200 text-red-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'">
                    {{ revokingOpenId === u.open_id ? '下线中…' : u.open_id === myOpenId ? '下线本人会话' : '强制下线' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="text-sm text-gray-400">暂无活跃会话。</p>
        </div>
      </div>

      <!-- 租户与接入 -->
      <div class="bg-white rounded-xl shadow p-5">
        <h3 class="font-bold mb-3">租户与接入</h3>
        <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span class="text-gray-500">中台：<b class="text-nec-navy">{{ d.tenant?.hubName || '—' }}</b></span>
          <span class="text-gray-500">飞书 App ID：<span class="mono text-xs">{{ d.tenant?.feishuAppId || '未配置' }}</span></span>
          <span class="inline-flex items-center gap-1 text-gray-500">飞书登录
            <span class="px-2 py-0.5 rounded text-xs text-white" :style="`background:${d.tenant?.loginEnabled ? 'var(--nec-navy)' : '#D97706'}`">{{ d.tenant?.loginEnabled ? '已启用' : '未配置' }}</span>
          </span>
          <span class="inline-flex items-center gap-1 text-gray-500">NEC-MCP
            <span class="px-2 py-0.5 rounded text-xs text-white" :style="`background:${d.tenant?.mcpEnabled ? 'var(--nec-navy)' : '#D97706'}`">{{ d.tenant?.mcpEnabled ? '已启用' : '未配置' }}</span>
          </span>
        </div>
        <p class="text-xs text-gray-400 mt-3">当前中台绑定单一飞书企业；租户迁移按《PRD_租户迁移_常州工NEC并入天合同创_V1.0》（docs/ 目录）执行。</p>
      </div>

      <!-- 模块配置状态（可展开内联配置表单） -->
      <div class="bg-white rounded-xl shadow p-5">
        <h3 class="font-bold mb-2">模块配置状态</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-xs text-gray-400">
              <th class="pb-1 font-medium">模块</th><th class="pb-1 font-medium">状态</th><th class="pb-1 font-medium">说明</th><th class="pb-1 font-medium">操作</th>
            </tr></thead>
            <tbody>
              <template v-for="r in moduleRows" :key="r.key">
                <tr class="border-t border-gray-100">
                  <td class="py-2 pr-3 whitespace-nowrap">{{ r.label }}</td>
                  <td class="py-2 pr-3 whitespace-nowrap">
                    <span v-if="r.ok === null" class="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-500">未知</span>
                    <span v-else class="px-2 py-0.5 rounded text-xs text-white" :style="`background:${r.ok ? 'var(--nec-navy)' : '#D97706'}`">{{ r.ok ? '✅ 已配置' : '⚠️ 未配置' }}</span>
                  </td>
                  <td class="py-2 pr-3 text-xs text-gray-400">{{ r.hint || '—' }}</td>
                  <td class="py-2 whitespace-nowrap">
                    <button v-if="CONFIG_FORMS[r.key]" @click="toggleForm(r.key)"
                            class="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">
                      {{ openForm === r.key ? '收起 ▴' : '配置' }}
                    </button>
                  </td>
                </tr>
                <tr v-if="openForm === r.key && CONFIG_FORMS[r.key]" class="border-t border-gray-100 bg-gray-50">
                  <td colspan="4" class="py-3 px-2">
                    <div class="space-y-2">
                      <div class="flex items-center gap-2">
                        <label class="text-xs text-gray-500 w-16 shrink-0">base</label>
                        <input v-model="formBase" placeholder="多维表格 URL 中 /base/ 后的 app_token" class="flex-1 border rounded px-2 py-1.5 text-sm mono" />
                      </div>
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div v-for="f in CONFIG_FORMS[r.key].tableFields" :key="f.key" class="flex items-center gap-2">
                          <label class="text-xs text-gray-500 w-16 shrink-0">{{ f.label }}</label>
                          <input v-model="formTables[f.key]" placeholder="table_id（tbl 开头）" class="flex-1 border rounded px-2 py-1.5 text-sm mono" />
                        </div>
                      </div>
                      <p v-if="formErr" class="text-xs text-red-500">{{ formErr }}</p>
                      <div class="flex items-center gap-3">
                        <button @click="submitForm(r.key)" :disabled="formSaving"
 class="text-xs px-3 py-1.5 rounded-lg text-white disabled:opacity-50 bg-nec-navy">
                          {{ formSaving ? '保存中…' : '保存配置' }}
                        </button>
                        <span class="text-xs text-gray-400">只填要配置的表，留空不写入；校验失败会在此提示</span>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 成员名单 -->
      <div class="bg-white rounded-xl shadow p-5">
        <h3 class="font-bold mb-3">成员名单</h3>
        <p v-if="!members" class="text-sm text-gray-400">队员名单未配置（dashboard:config 缺失或拉取失败）。</p>
        <template v-else>
          <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span class="text-gray-500">总人数：<b class="mono text-nec-navy">{{ members.total }}</b></span>
            <span class="text-gray-500">已录 open_id：<b class="mono text-nec-navy">{{ members.withOpenId }}</b></span>
            <span class="text-gray-500">缺 open_id：<b class="mono" :class="{ 'text-red-600': members.missingOpenId > 0 }">{{ members.missingOpenId }}</b></span>
          </div>
          <p v-if="members.missingOpenId > 0" class="text-xs text-amber-600 mt-2">⚠ 有 {{ members.missingOpenId }} 名成员缺 open_id，角色匹配将退化为姓名匹配，租户迁移前须补录。</p>
          <div v-if="Object.keys(members.roleCounts ?? {}).length" class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
            <span v-for="(count, role) in members.roleCounts" :key="role">{{ role }} {{ count }}</span>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>
