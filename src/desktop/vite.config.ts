import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // The backend's CORS allow-list has no entry for a Vite dev port, so REST
    // goes same-origin through here. The packaged build talks to 8000 direct
    // from tauri://localhost, which the allow-list does cover.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false },
    },
  },
  envPrefix: ['VITE_', 'AEGIS_'],
  build: {
    target: 'es2021',
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: {
        film: resolve(root, 'index.html'),
        breath: resolve(root, 'breath.html'),
      },
    },
  },
});
