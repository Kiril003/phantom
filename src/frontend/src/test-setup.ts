import '@testing-library/jest-dom';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Ensure each test gets a clean DOM — vitest doesn't auto-cleanup by default.
afterEach(() => {
  cleanup();
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
