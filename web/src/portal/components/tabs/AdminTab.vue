<script setup lang="ts">
// 管理总览：登录与会话 / 租户与接入 / 模块配置状态 / 成员名单（仅队长·组长·指导·管理员可见，见 useTabs ADMIN_TABS）
import { ref, computed, watch, onMounted } from 'vue'
import { auth, logoutAllDevices } from '@shared/auth'
import { toast, confirmDialog } from '@shared/ui/feedback'

const d = ref<any>(null)
const loadFailed = ref('')
const refreshing = ref(false)
const revoking = ref(false)

// 三个评审模块的配置状态：前端直调各自免登录的 GET /api/<module>/config（module-gateway 统一出口）
const reviewModules = ref<Array<{ key: string; label: string; configured: boolean | null }>>([
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
    toast(`✅ 已退出所有设备（注销 ${revoked} 个会话），请重新登录`)
  } catch (e: any) {
    toast('退出所有设备失败：' + (e.message || e))
  } finally {
    revoking.value = false
  }
}

// ---- 模块配置状态行 ----
interface ModuleRow { label: string; ok: boolean | null; hint?: string }
const CONFIG_HINT = '通过 NEC-MCP 的 config_xxx 工具配置'
const moduleRows = computed<ModuleRow[]>(() => {
  const m = d.value?.modules
  if (!m) return []
  const flowLabels: Array<[string, string]> = [['reimburse', '报销审批流'], ['drawing', '图纸审批流'], ['hardware', '硬件审批流'], ['compliance', '合规审批流']]
  const rows: ModuleRow[] = [
    { label: '数据看板（dashboard:config）', ok: !!m.dashboard?.configured, hint: m.dashboard?.configured ? `已配置 ${m.dashboard.tables.length} 张表` : CONFIG_HINT },
    ...flowLabels.map(([k, label]) => ({ label: `${label}（flows:config）`, ok: !!m.flows?.[k], hint: m.flows?.[k] ? '' : CONFIG_HINT })),
    ...reviewModules.value.map((r) => ({ label: r.label, ok: r.configured, hint: r.configured === false ? CONFIG_HINT : '' })),
    { label: '校验规则（validate:rules）', ok: m.validateRules === 'custom', hint: m.validateRules === 'custom' ? '使用 KV 自定义规则' : '使用内置默认规则' },
  ]
  return rows
})

const members = computed(() => d.value?.members ?? null)
const me = computed(() => auth.me.user)

onMounted(() => { loadOverview(); loadReviewModules() })
watch(() => auth.tick, () => { loadOverview(); loadReviewModules() })
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
          <span>当前用户：<b style="color:var(--nec-navy)">{{ me?.name || '—' }}</b></span>
          <span class="text-gray-500">角色：{{ me?.role || '—' }}</span>
          <span class="text-gray-500">组别：{{ me?.group || '—' }}</span>
          <span class="text-gray-500">全站活跃会话：<b class="mono" style="color:var(--nec-navy)">{{ d.sessions?.active ?? '—' }}</b></span>
        </div>
        <div class="mt-3 flex items-center gap-3">
          <button @click="onLogoutAll" :disabled="revoking" class="text-xs px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style="background:#DC2626">{{ revoking ? '退出中…' : '退出所有设备' }}</button>
          <span class="text-xs text-gray-400">注销你名下全部会话（含其他浏览器/设备），本机同步登出</span>
        </div>
      </div>

      <!-- 租户与接入 -->
      <div class="bg-white rounded-xl shadow p-5">
        <h3 class="font-bold mb-3">租户与接入</h3>
        <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span class="text-gray-500">中台：<b style="color:var(--nec-navy)">{{ d.tenant?.hubName || '—' }}</b></span>
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

      <!-- 模块配置状态 -->
      <div class="bg-white rounded-xl shadow p-5">
        <h3 class="font-bold mb-2">模块配置状态</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-xs text-gray-400">
              <th class="pb-1 font-medium">模块</th><th class="pb-1 font-medium">状态</th><th class="pb-1 font-medium">说明</th>
            </tr></thead>
            <tbody>
              <tr v-for="(r, i) in moduleRows" :key="i" class="border-t border-gray-100">
                <td class="py-2 pr-3 whitespace-nowrap">{{ r.label }}</td>
                <td class="py-2 pr-3 whitespace-nowrap">
                  <span v-if="r.ok === null" class="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-500">未知</span>
                  <span v-else class="px-2 py-0.5 rounded text-xs text-white" :style="`background:${r.ok ? 'var(--nec-navy)' : '#D97706'}`">{{ r.ok ? '✅ 已配置' : '⚠️ 未配置' }}</span>
                </td>
                <td class="py-2 text-xs text-gray-400">{{ r.hint || '—' }}</td>
              </tr>
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
            <span class="text-gray-500">总人数：<b class="mono" style="color:var(--nec-navy)">{{ members.total }}</b></span>
            <span class="text-gray-500">已录 open_id：<b class="mono" style="color:var(--nec-navy)">{{ members.withOpenId }}</b></span>
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
