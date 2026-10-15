import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))

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
  }
  return entries
}

export default defineConfig({
  // 模板里的 /brand/* 等绝对路径由 Worker 静态托管，交给运行时解析，不进 bundle
  plugins: [vue({ template: { transformAssetUrls: false } })],
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
    outDir: '../public',
    emptyOutDir: false,
    assetsDir: 'portal-assets',
    rollupOptions: { input: discoverEntries() },
  },
})
