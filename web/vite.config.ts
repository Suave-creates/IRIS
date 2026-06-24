import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Listen on all interfaces so the dev app is reachable from other LAN devices
    // (e.g. http://<your-lan-ip>:5173). The /api proxy still reaches the backend
    // on localhost, so the browser sees a single origin and CORS is a non-issue.
    host: true,
    port: 5173,
    proxy: {
      // Proxy API + SSE to the backend so the browser sees a single origin in dev.
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});
