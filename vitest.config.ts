import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 运行在 Node.js 环境中，模拟 Worker
    environment: 'node',
    // 匹配所有 .test.ts 文件
    include: ['src/**/*.test.ts'],
    // TypeScript 配置
    globals: true,
    typescript: {
      tsconfig: './tsconfig.json',
    },
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'src/index.ts', // 主入口文件，通常不直接测试
      ],
    },
    // 测试超时时间
    testTimeout: 10000,
    // 启用全局变量
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
