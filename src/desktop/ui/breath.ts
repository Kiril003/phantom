import '@fontsource/space-grotesk/400.css';
import '@fontsource/playfair-display/400-italic.css';
import './tokens.css';
import './breath.css';

// Vanilla IPC via withGlobalTauri — no framework, no bundle weight.
const tauri = (window as { __TAURI__?: any }).__TAURI__;
const invoke: (cmd: string, args?: unknown) => Promise<unknown> =
  tauri?.core?.invoke ?? (async () => '');

const line = document.getElementById('line') as HTMLInputElement;
const answer = document.getElementById('answer') as HTMLDivElement;
line.placeholder = 'Спитай, познач, поклич…';

function setMode(mode: 'idle' | 'thinking'): void {
  document.body.dataset.mode = mode;
}

function clearAnswer(): void {
  answer.hidden = true;
  answer.textContent = '';
  setMode('idle');
}

// Clear + focus the input. The Conduit (Rust) calls this via webview eval each
// summon; the several attempts race the OS-focus handoff (the input can't take
// DOM focus until the window is focused, a frame or two later).
function focusLine(): void {
  line.value = '';
  clearAnswer();
  line.focus();
  requestAnimationFrame(() => line.focus());
  setTimeout(() => line.focus(), 60);
}
(window as { __breathFocus?: () => void }).__breathFocus = focusLine;

let inFlight = false;

async function submit(): Promise<void> {
  const text = line.value.trim();
  if (!text || inFlight) return;
  inFlight = true;

  setMode('thinking');
  answer.hidden = false;
  answer.textContent = '…';

  try {
    const reply = (await invoke('submit_breath', { text })) as string;
    answer.textContent = reply?.trim() || '—';
  } catch (e) {
    answer.textContent =
      typeof e === 'string' && e ? e : 'Мовчання. Зв’язку немає.';
  }

  setMode('idle');
  // The line clears so a follow-up can be typed immediately (the Rust side
  // threads the session); the answer stays until Esc recedes the line.
  line.value = '';
  line.focus();
  inFlight = false;
}

// Listen on the window (capture) so Esc/Enter act regardless of focus target.
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      void invoke('dismiss_breath');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  },
  true,
);

// Refocus the input whenever the window regains focus (summon).
window.addEventListener('focus', () => line.focus());
