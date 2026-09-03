import '@testing-library/jest-dom';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Mock localStorage if missing or incomplete in Node 22 jsdom environment
const createLocalStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
};

if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage?.getItem) {
  const localStorageMock = createLocalStorageMock();
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
  }
}

// Ensure each test gets a clean DOM and fresh localStorage — vitest doesn't auto-cleanup by default.
afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* noop */
  }
});

// Mock HTMLCanvasElement.getContext for jsdom (canvas-based components)
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

// jsdom doesn't implement scrollIntoView
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {
    /* noop for tests */
  };
}

// Stub clipboard API for jsdom
if (typeof navigator !== 'undefined' && !navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async () => {} },
    writable: true,
    configurable: true,
  });
}

// jsdom lacks ResizeObserver, used by some Recharts paths
if (typeof globalThis.ResizeObserver === 'undefined') {
  class RO {
    observe() {
      /* noop */
    }
    unobserve() {
      /* noop */
    }
    disconnect() {
      /* noop */
    }
  }
   
  (globalThis as any).ResizeObserver = RO;
}

// jsdom lacks URL.createObjectURL — maplibre-gl references it at import time
if (typeof URL !== 'undefined' && typeof URL.createObjectURL !== 'function') {
   
  (URL as any).createObjectURL = () => 'blob:phantom-test';
}
if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL !== 'function') {
   
  (URL as any).revokeObjectURL = () => {};
}


// У браузері адресу бекенда дає `public/backend-origin.js`, підключений
// обома входами. У jsdom того скрипта немає, а `services/backendOrigin.ts`
// навмисно падає голосно замість вгадувати — тож тести мусять поставити те
// саме єдине джерело, що й застосунок. Підміняти його на `window.location`
// тут не можна: тоді тест перевіряв би поведінку, якої в продукті немає.
if (typeof window !== 'undefined' && !window.__PHANTOM_BACKEND__) {
  const HOST = '127.0.0.1';
  const PORT = 8000;
  const norm = (p: string) => (p.startsWith('/') ? p : `/${p}`);
  window.__PHANTOM_BACKEND__ = {
    host: HOST,
    port: PORT,
    isPackaged: () => false,
    origin: () => '',
    ws: (p: string) => `ws://${window.location.host}${norm(p)}`,
    http: (p: string) => norm(p),
    absolute: (p: string) => `http://${HOST}:${PORT}${norm(p)}`,
  };
}
