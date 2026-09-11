import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';


// Локальний вхід для розробки: PIN читається з диска на боці dev-сервера,
// тож у бандл не потрапляє і в прод-збірці цього маршруту не існує.
const devLogin = {
  name: 'phantom-dev-login',
  apply: 'serve' as const,
  configureServer(server: { middlewares: { use: (p: string, h: unknown) => void } }) {
    server.middlewares.use('/__dev/login', (_req: unknown, res: {
      setHeader: (k: string, v: string) => void;
      statusCode: number;
      end: (b?: string) => void;
    }) => {
      res.setHeader('Content-Type', 'application/json');
      try {
        const pin = readFileSync(
          resolve(__dirname, '../../.phantom-data/identity/bootstrap_pin'),
          'utf8',
        ).trim();
        res.end(JSON.stringify({ username: 'phantom', pin }));
      } catch {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  },
};

// Ф0: на одній машині живе кілька бекендів (спільне дерево — 8000, worktree
// pc-universe — 8010). Захардкожений 8000 означав, що фронтенд worktree
// МОВЧКИ говорить із чужим бекендом і виглядає живим — найгірший клас
// дефекту. Порт бекенда береться з env; дефолт 8000 лишаємо, щоб не зламати
// запуски зі спільного дерева. Наші launch-записи передають 8010 явно.
const backendPort = Number(process.env.PHANTOM_BACKEND_PORT ?? 8000);
const backendHttp = `http://127.0.0.1:${backendPort}`;
const backendWs = `ws://127.0.0.1:${backendPort}`;
// Хост dev-сервера: дефолт історично 0.0.0.0 (телефонні перевірки зі
// спільного дерева); стенд worktree ставить 127.0.0.1 — бо разом із
// dev-сервером на LAN виїжджає і /__dev/login з PIN'ом.
const devHost = process.env.PHANTOM_DEV_HOST ?? '0.0.0.0';

export default defineConfig({
  plugins: [devLogin, react()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: '@shared', replacement: path.resolve(__dirname, '../shared') },
      // The default maplibre-gl build starts its workers from a blob: URL.
      // The packaged Tauri CSP declares no worker-src, so workers fall back to
      // `default-src 'self'` and a blob: worker is refused — the map dies in the
      // shipped app while `npm run dev` (a plain browser, no CSP) looks fine.
      // maplibre ships this build for exactly that case; the worker is then a
      // same-origin asset. See src/lib/maplibreWorker.ts for the URL wiring.
      {
        find: /^maplibre-gl$/,
        replacement: 'maplibre-gl/dist/maplibre-gl-csp.js',
      },
    ],
  },
  server: {
    host: devHost,
    port: 5173,
    proxy: {
      '/api': {
        target: backendHttp,
        changeOrigin: true,
      },
      '/ws': {
        target: backendWs,
        ws: true,
        changeOrigin: true,
      },
      '/health': {
        target: backendHttp,
        changeOrigin: true,
      },
      '/docs': {
        target: backendHttp,
        changeOrigin: true,
      },
      '/redoc': {
        target: backendHttp,
        changeOrigin: true,
      },
      '/openapi.json': {
        target: backendHttp,
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
    // Мап джерел у зібраному пакунку НЕМА, і це не гігієна, а вимір.
    // 04.09.2026 на артефакті `.build/out/PHANTOM OS_0.20.0_cc10f419_amd64.AppImage`:
    // Tauri вкладає всю теку `dist/` у бінарник оболонки `usr/bin/phantom-os-shell`,
    // і в його таблиці ресурсів лежало 143 ключі `…js.map` — рівно стільки,
    // скільки мап було в `dist/`. Тобто 21,7 МБ із 36,1 МБ теки — це ВЕСЬ
    // вихідний код веба, який читає будь-хто, хто розпакує AppImage.
    // Дев-сервер мапи має завжди й від цього рядка не залежить.
    // Ворота на самому пакунку: `scripts/package_carries_no_sources.py`.
    sourcemap: false,
    // Vite inlines assets under 4 kB as data: URIs. For the tiny @fontsource
    // unicode-range subsets that turns 21 self-hosted fonts into `data:` fonts,
    // which the packaged CSP refuses (no font-src, so `default-src 'self'`).
    // Emitting them as files keeps every font same-origin and keeps `data:` out
    // of the policy. Other asset types keep the default behaviour.
    assetsInlineLimit: (filePath) =>
      /\.(woff2?|ttf|otf|eot)$/i.test(filePath) ? false : undefined,
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
