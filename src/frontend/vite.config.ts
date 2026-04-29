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
  // Day-5 fix: onnxruntime-web ships ESM modules that reference
  // sibling .wasm/.mjs artifacts via dynamic import (e.g.
  // ort-wasm-simd-threaded.mjs). Vite's dep-optimizer rewrites the
  // .mjs path during esbuild prebundle and the threaded WASM
  // file ends up missing from .vite/deps, blowing the dev server.
  // The runtime is consumed only by useVoiceAlwaysOn (MicVAD); we
  // exclude it from prebundle so Vite serves the package as-is.
  optimizeDeps: {
    exclude: ['onnxruntime-web', '@ricky0123/vad-web'],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    testTimeout: 15000,
    exclude: ['node_modules', 'dist', 'e2e/**', 'playwright-report/**', 'test-results/**'],
  },
});
