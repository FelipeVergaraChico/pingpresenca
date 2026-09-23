import { defineConfig } from 'vitest/config';
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: { include: ['frontend/src/academic/ReviewRegressions.test.tsx'], environment: 'jsdom', testTimeout: 5000 },
});
