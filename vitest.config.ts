import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src'), '@mcp': path.resolve(import.meta.dirname, 'mcp-server') } },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 120000, hookTimeout: 180000, pool: 'forks' },
});
