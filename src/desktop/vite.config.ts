import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
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
