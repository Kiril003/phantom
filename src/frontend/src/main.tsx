import React from 'react';
import ReactDOM from 'react-dom/client';
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
