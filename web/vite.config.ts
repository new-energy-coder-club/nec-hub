import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))

// 构建前清空旧 hash 产物：emptyOutDir 只清 outDir 根（会误删 brand/ docs/ assets/ 手写资源），故只清 portal-assets
function cleanPortalAssets() {
  return {
    name: 'clean-portal-assets',
    apply: 'build' as const,
    buildStart() {
      fs.rmSync(path.resolve(ROOT, '../public/portal-assets'), { recursive: true, force: true })
    },
  }
}

// MPA 入口自动发现：门户 index.html + apps/*/index.html，新增子应用零配置（避免并行开发改 vite.config 冲突）
function discoverEntries() {
  const entries: Record<string, string> = { main: path.resolve(ROOT, 'index.html') }
  const appsDir = path.resolve(ROOT, 'apps')
  if (fs.existsSync(appsDir)) {
    for (const name of fs.readdirSync(appsDir)) {
      const html = path.join(appsDir, name, 'index.html')
      if (fs.statSync(path.join(appsDir, name)).isDirectory() && fs.existsSync(html)) {
        entries['apps/' + name] = html
      }
    }
    // 非 index 的独立静态页（task-schedule/animated.html 动态版）也进构建，彻底下线 Tailwind CDN
    const animated = path.join(appsDir, 'task-schedule', 'animated.html')
    if (fs.existsSync(animated)) entries['apps/task-schedule/animated'] = animated
  }
  return entries
}

export default defineConfig({
  // 模板里的 /brand/* 等绝对路径由 Worker 静态托管，交给运行时解析，不进 bundle
  plugins: [vue({ template: { transformAssetUrls: false } }), tailwindcss(), cleanPortalAssets()],
  resolve: {
    alias: {
      '@shared': path.resolve(ROOT, 'src/shared'),
      '@portal': path.resolve(ROOT, 'src/portal'),
      '@apps': path.resolve(ROOT, 'src/apps'),
    },
  },
  build: {
    // 直出到 Worker 静态目录：public/index.html（门户）+ public/apps/<name>/index.html（子应用）
    // emptyOutDir=false：绝不清空 public/（brand/ docs/ assets/ 与其余子应用静态资源共存）
    // 旧 hash 文件由 cleanPortalAssets 插件在 buildStart 清除，无需人工删除
    outDir: '../public',
    emptyOutDir: false,
    assetsDir: 'portal-assets',
    rollupOptions: { input: discoverEntries() },
  },
})
