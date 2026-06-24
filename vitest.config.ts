import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests run in Node against pure server/web logic. The server uses NodeNext
// ".js" import specifiers, so map ".js" → ".ts" for resolution; the "@" alias mirrors
// the web app so web helper tests resolve the same way.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./web/src', import.meta.url)) },
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
  test: {
    environment: 'node',
    include: ['server/src/**/*.test.ts', 'web/src/**/*.test.ts'],
  },
});
