import { defineConfig } from 'vite';

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
  },
});
