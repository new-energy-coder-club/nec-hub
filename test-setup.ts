/*
 * 测试设置脚本
 * 用于验证测试环境是否正确配置
 */

console.log('Testing environment setup...');
console.log('Vitest should be available for running tests');
console.log('Run: npm run test to execute all tests');
console.log('Run: npm run test:watch to run tests in watch mode');
console.log('Run: npm run test:coverage to generate coverage report');

// 导出一个简单的函数用于测试
export function getTestEnvironment(): string {
  return 'vitest';
}
