import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // 模板里的 /brand/* 等绝对路径由 Worker 静态托管，交给运行时解析，不进 bundle
  plugins: [vue({ template: { transformAssetUrls: false } })],
  build: {
    // 绝不许指到 ../public——曾两次把生产门户 index.html 冲成 18 行 Vue 壳
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'portal-assets',
  },
})
