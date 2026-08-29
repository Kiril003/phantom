// Must precede anything that can construct a map — the CSP build refuses to
// start its workers until it is told where the worker lives.
import './lib/maplibreWorker';
import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted fonts (OFL-1.1). Replaces the Google Fonts CDN <link>s that
// broke offline/air-gapped/Tauri-webview cold start and violated the
// project's own no-CDN canon.
import '@fontsource/manrope/300.css';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@fontsource/space-grotesk/300.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/playfair-display/500-italic.css';
import '@fontsource/playfair-display/600-italic.css';
import '@fontsource/playfair-display/700-italic.css';
import { App } from './app/App';
import { applyBootstrapLanguage, applyBootstrapTheme } from './services/settingsBootstrap';
import { ensureCapabilityProbed } from './stores/capabilityStore';
import './styles/globals.css';

// phase-5-R0-3-THEME-NIGHT — flip <html data-theme> to the cached or
// time-of-day default BEFORE React renders. This kills the
// cream → amber-night flash for night users on cold-start.
applyBootstrapTheme();
// Same for <html lang> — the cached locale has to be on the element before
// the first paint, or the UI renders in Ukrainian and swaps to English once
// `/settings` resolves.
applyBootstrapLanguage();

// Kicks off the GPU capability probe (T0/T1/T2) as early as possible so a
// verdict is usually ready before TacticalMap first constructs its map.
// Bounded to ~1.5s worst case (see capabilityProbe.ts), never blocks
// render — fire-and-forget. TacticalMap also calls this (idempotent) so
// it still gets a verdict if this module ever loads without main.tsx
// (tests, alternate entry points).
void ensureCapabilityProbed();

import { useMessengerStore } from './stores/messengerStore';
import { globalP2PMesh } from './services/globalP2PMesh';

if (typeof window !== 'undefined') {
  (window as any).__phantom_messenger_store = useMessengerStore;
  (window as any).__phantom_p2p_mesh = globalP2PMesh;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
