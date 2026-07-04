import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    // Windows 上 forks pool 更稳定,避免 threads 模式的偶发崩溃
    pool: 'forks',
    // 每个测试前自动恢复 mock,防止测试间状态泄漏
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // 不强制阈值(避免为达标写无意义测试),但生成报告供查看
    },
  },
});
