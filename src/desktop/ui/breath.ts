import '@fontsource/space-grotesk/400.css';
import '@fontsource/playfair-display/400-italic.css';
import './tokens.css';
import './breath.css';

// Vanilla IPC via withGlobalTauri — no framework, no bundle weight.
const tauri = (window as { __TAURI__?: any }).__TAURI__;
const invoke = tauri?.core?.invoke ?? (async () => {});

const line = document.getElementById('line') as HTMLInputElement;
line.placeholder = 'Спитай, познач, поклич…';

// Clear + focus the input. The Conduit (Rust) calls this via webview eval each
// summon; the several attempts race the OS-focus handoff (the input can't take
// DOM focus until the window is focused, a frame or two later).
function focusLine(): void {
  line.value = '';
  line.focus();
  requestAnimationFrame(() => line.focus());
  setTimeout(() => line.focus(), 60);
}
(window as { __breathFocus?: () => void }).__breathFocus = focusLine;

// Listen on the window (capture) so Esc/Enter recede the line regardless of
// which element holds focus inside the page.
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      void invoke('dismiss_breath');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void invoke('submit_breath', { text: line.value });
    }
  },
  true,
);

// Refocus the input whenever the window regains focus (summon).
window.addEventListener('focus', () => line.focus());
