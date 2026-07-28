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

// Mock HTMLCanvasElement.getContext for jsdom (Avatar uses canvas)
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = RO;
}

// jsdom lacks URL.createObjectURL — maplibre-gl references it at import time
if (typeof URL !== 'undefined' && typeof URL.createObjectURL !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (URL as any).createObjectURL = () => 'blob:phantom-test';
}
if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (URL as any).revokeObjectURL = () => {};
}

