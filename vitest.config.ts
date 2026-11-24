import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@cobalix/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@cobalix/db': path.resolve(__dirname, 'packages/db/src/index.ts'),
      '@cobalix/scanners': path.resolve(__dirname, 'packages/scanners/src/index.ts'),
      '@cobalix/ai': path.resolve(__dirname, 'packages/ai/src/index.ts'),
      '@cobalix/agents': path.resolve(__dirname, 'packages/agents/src/index.ts')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 20000,
    server: {
      deps: {
        external: [/^node:/]
      }
    }
  }
});
