import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: { include: ['frontend/src/attendance/ReviewRegressions.test.tsx'], environment: 'jsdom' },
});
