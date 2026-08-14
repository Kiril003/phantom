import maplibregl from 'maplibre-gl';
// `?url` makes Vite emit the worker as a hashed asset and hand back its path,
// so the worker is same-origin and `default-src 'self'` accepts it. Written as
// a bare path — never a query string — so nothing about the worker's location
// can carry state.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url';

/**
 * `maplibre-gl` resolves to the CSP build (see the alias in vite.config.ts),
 * which ships no embedded worker and refuses to start until told where the
 * worker lives. Every entry point that can reach a map must import this module
 * before the first `new maplibregl.Map()`.
 */
maplibregl.setWorkerUrl(workerUrl);
