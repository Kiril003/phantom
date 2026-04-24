/// <reference types="vite/client" />

// Phase 11b — AudioWorklet is loaded via Vite's `?url` suffix which
// returns the bundled asset URL as a string. Declare the suffix so
// TypeScript's module resolver doesn't 2307 on the import.
declare module '*.js?url' {
  const src: string;
  export default src;
}
