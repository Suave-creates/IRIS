import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Bundle workspace deps; keep node_modules external.
  noExternal: ['@iris/shared'],
  dts: false,
});
