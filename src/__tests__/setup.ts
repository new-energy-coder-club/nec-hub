// Vitest setup file
import { expect, vi } from 'vitest';

// 全局配置
vi.mock('node:crypto', async () => {
  const actual = await vi.importActual('node:crypto');
  return {
    ...actual,
    randomUUID: vi.fn().mockReturnValue('test-uuid'),
  };
});

// 全局 expect 配置
expect.extend({
  toBeDefinedInObject(received, property) {
    if (received && typeof received === 'object' && property in received) {
      return {
        message: () => `expected ${this.utils.printReceived(received)} to have property ${this.utils.printReceived(property)}`,
        pass: true,
      };
    }
    return {
      message: () => `expected ${this.utils.printReceived(received)} to have property ${this.utils.printReceived(property)}`,
      pass: false,
    };
  },
});
