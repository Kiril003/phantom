import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted fonts (OFL-1.1). Replaces the Google Fonts CDN <link>s that
// broke offline/air-gapped/Tauri-webview cold start and violated the
// project's own no-CDN canon. Material Symbols is NOT yet self-hosted —
// it is still CDN-loaded in index.html until the msym→lucide sweep lands.
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
import { applyBootstrapTheme } from './services/settingsBootstrap';
import './styles/globals.css';

// phase-5-R0-3-THEME-NIGHT — flip <html data-theme> to the cached or
// time-of-day default BEFORE React renders. This kills the
// cream → amber-night flash for night users on cold-start.
applyBootstrapTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
