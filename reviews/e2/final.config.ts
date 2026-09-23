import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: { include: ['frontend/src/attendance/Settings.test.tsx'], environment: 'jsdom' },
});
