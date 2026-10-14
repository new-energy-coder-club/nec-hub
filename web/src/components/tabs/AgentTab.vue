<script setup lang="ts">
// 我的 Agent：NEC-MCP 接入指引 + JSON-RPC ping 连通性测试
import { ref } from 'vue'
import { ORIGIN, copyText } from '../../api'
import { JOIN_PROMPT } from '../../prompts'

const mcpEndpoint = ORIGIN + '/mcp'

const testLabel = ref('测试连接')

// NEC-MCP 连通性测试：直接对 /mcp 发 JSON-RPC ping
async function testConnection() {
  const orig = '测试连接'
  testLabel.value = '⏳ 连接中…'
  try {
    const resp = await fetch(ORIGIN + '/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    const data = await resp.json()
    if (resp.ok && data.jsonrpc === '2.0' && !data.error) {
      testLabel.value = '✅ 连接正常'
    } else if (resp.status === 401) {
      testLabel.value = '🔑 需配置 MCP_TOKEN'
    } else {
      throw new Error(data.error?.message || ('HTTP ' + resp.status))
    }
  } catch (e: any) {
    testLabel.value = '❌ 连接失败'
    alert('NEC-MCP 连接测试失败：' + (e.message || e))
  }
  setTimeout(() => { testLabel.value = orig }, 3000)
}
</script>

<template>
  <section id="tab-agent">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-2xl font-black flex items-center gap-3" style="color:var(--nec-navy)">
          <span class="bg-gradient-to-r from-[#1A2FA0] to-[#1FA9E8] bg-clip-text text-transparent">NEC-MCP</span>
          <span class="text-sm font-normal text-gray-500">AI Agent</span>
        </h2>
        <p class="text-sm text-gray-500 mt-1">智能协作中枢 · 飞书生态深度集成</p>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-3 h-3 rounded-full bg-green-400 animate-pulse"></div>
        <span class="text-xs text-gray-500">在线</span>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="bg-gradient-to-br from-[#F4F6FB] to-[#E6ECF5] border border-[#D9DFF0] rounded-2xl p-6 shadow-sm">
        <h3 class="font-bold text-lg mb-3 flex items-center gap-2" style="color:var(--nec-navy)">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm1 3a7 7 0 11-14 0 7 7 0 0114 0zm-.707-4.707a1 1 0 00-1.414-1.414L9 10.586l-1.293-1.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
          </svg>
          快速接入
        </h3>
        <p class="text-sm text-gray-600 mb-4">一键连接 NEC 团队 AI 中台，开启智能协作新体验</p>
        <div class="bg-white rounded-xl shadow-sm p-4">
          <h4 class="font-medium mb-2 text-gray-700">接入步骤：</h4>
          <ol class="list-decimal list-inside space-y-2 text-sm text-gray-600">
            <li>安装 MCP 客户端（Claude Code / Kimi CLI / Codex）</li>
            <li>添加 NEC-MCP 服务器：<code id="mcp-endpoint" class="bg-gray-100 px-2 py-1 rounded text-xs">{{ mcpEndpoint }}</code></li>
            <li>验证连接并开始使用</li>
          </ol>
        </div>
      </div>

      <div class="bg-gradient-to-br from-[#1A2FA0] to-[#141B5E] rounded-2xl p-6 text-white shadow-lg">
        <h3 class="font-bold text-lg mb-3 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 111.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
          接入 Prompt
        </h3>
        <p class="text-sm text-blue-100 mb-4">复制以下指令到你的 AI Agent 客户端</p>
        <div class="bg-black/20 rounded-xl p-4">
          <pre class="prompt text-sm text-green-200 font-mono leading-relaxed" id="join-prompt">{{ JOIN_PROMPT }}</pre>
        </div>
        <div class="mt-4 flex gap-3">
          <button @click="copyText(JOIN_PROMPT)" class="flex items-center gap-2 text-sm bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg transition-all duration-200">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
              <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
            </svg>
            复制指令
          </button>
          <button @click="testConnection" class="flex items-center gap-2 text-sm bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg transition-all duration-200">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
            </svg>
            {{ testLabel }}
          </button>
        </div>
      </div>
    </div>

    <div class="mt-8 bg-white/50 backdrop-blur-sm rounded-2xl p-6 border border-[#D9DFF0] shadow-sm">
      <h3 class="font-bold text-lg mb-4 flex items-center gap-2" style="color:var(--nec-navy)">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm1 3a7 7 0 11-14 0 7 7 0 0114 0zm-.707-4.707a1 1 0 00-1.414-1.414L9 10.586l-1.293-1.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
        </svg>
        智能交互优化
      </h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="bg-white rounded-xl p-4 border border-gray-100">
          <div class="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3-3a1 1 0 111.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
          </div>
          <h4 class="font-medium text-gray-800 mb-1">精准指令识别</h4>
          <p class="text-sm text-gray-600">支持自然语言指令，自动解析意图与参数</p>
        </div>
        <div class="bg-white rounded-xl p-4 border border-gray-100">
          <div class="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-purple-600" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd" />
            </svg>
          </div>
          <h4 class="font-medium text-gray-800 mb-1">实时状态反馈</h4>
          <p class="text-sm text-gray-600">每步操作都有可视化反馈与进度指示</p>
        </div>
        <div class="bg-white rounded-xl p-4 border border-gray-100">
          <div class="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-600" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
            </svg>
          </div>
          <h4 class="font-medium text-gray-800 mb-1">智能错误处理</h4>
          <p class="text-sm text-gray-600">自动诊断问题并提供修复建议</p>
        </div>
      </div>
    </div>
  </section>
</template>
