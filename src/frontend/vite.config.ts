/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/docs': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/redoc': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/openapi.json': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  // onnxruntime-web тягне сусідні .wasm динамічним імпортом — оптимізатор їх губить.
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Weak-device-first: three.js (~600 kB) and recharts/d3 (~170 kB) sit
    // behind lazy boundaries (PhantomFamiliar summon, chart/diagram render),
    // but Vite hoists the static deps of App.tsx's entry-level React.lazy
    // imports into `<link rel="modulepreload">` in index.html — so the browser
    // downloads them during first paint even when the operator never summons
    // the familiar or renders a chart. Drop just those two vendor chunks from
    // the preload manifest; the runtime `__vitePreload` still fetches them the
    // instant their lazy boundary actually mounts, so nothing loads slower in
    // practice — it just no longer taxes the initial waterfall. framer-motion
    // (used at App root) and the rest stay preloaded.
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter((dep) => !/vendor-(three|charts)-/.test(dep)),
    },
    rollupOptions: {
      output: {
        // Split heavy libraries into their own cacheable chunks. Combined
        // with lazy-loading their sole consumers (three.js via
        // PhantomFamiliar, maplibre via MapLayout, recharts/d3 via the
        // Dialogue chat renderers), this keeps the entry chunk lean and
        // lets a chat with no charts never download recharts/d3.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.match(/[\\/]node_modules[\\/](three|@react-three)[\\/]/)) return 'vendor-three';
          if (id.match(/[\\/]node_modules[\\/](recharts|d3-|d3[\\/]|victory-)/)) return 'vendor-charts';
          if (id.includes('@codesandbox/sandpack')) return 'vendor-sandpack';
          if (id.includes('maplibre-gl')) return 'vendor-maplibre';
          if (id.includes('framer-motion')) return 'vendor-motion';
          if (id.match(/[\\/]node_modules[\\/](onnxruntime-web|@ricky0123)/)) return 'vendor-voice';
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    testTimeout: 15000,
    exclude: ['node_modules', 'dist', 'e2e/**', 'playwright-report/**', 'test-results/**'],
  },
});
