import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const configuredBase = loadEnv(mode, '.', 'VITE_').VITE_BASE_PATH?.trim() || '/';
  if (!configuredBase.startsWith('/') || configuredBase.startsWith('//') || /[?#\\]/.test(configuredBase)) {
    throw new Error('VITE_BASE_PATH must be a local absolute path such as / or /WriEng/.');
  }
  return {
    base: configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`,
    plugins: [react()],
    test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'], restoreMocks: true },
  };
});
