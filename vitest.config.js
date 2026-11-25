import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./web/test/setup.js'],
    include: ['web/test/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      include: ['web/src/**/*.{js,jsx}'],
      exclude: ['web/src/main.jsx'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90
      }
    }
  }
});
