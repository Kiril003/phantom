import '@fontsource/space-grotesk/400.css';
import '@fontsource/playfair-display/400-italic.css';
import './tokens.css';
import './breath.css';

import { parseDepth, parseSpawn, resolveKey } from './facet/keymap';

// Vanilla IPC via withGlobalTauri — no framework, no bundle weight.
const tauri = (window as { __TAURI__?: any }).__TAURI__;
const invoke: (cmd: string, args?: unknown) => Promise<unknown> =
  tauri?.core?.invoke ?? (async () => '');

const line = document.getElementById('line') as HTMLInputElement;
const answer = document.getElementById('answer') as HTMLDivElement;
const target = document.getElementById('target') as HTMLDivElement;
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

// The Film names the shard now holding the aim (§ objective 3): the operator
// reads what a verb will strike before striking it.
(window as unknown as { __breathTarget?: (p: { label: string | null }) => void }).__breathTarget = (
  p,
) => {
  if (p?.label) {
    target.textContent = `▸ ${p.label}`;
    target.hidden = false;
    // A bare textContent swap leaves stale glyphs on this software-GL webkit
    // stack (transparent window, compositing off): the region never invalidates
    // and the old label paints through the new one. Re-triggering the animation
    // forces a clean repaint — and reads as the aim shifting.
    target.classList.remove('shift');
    void target.offsetWidth;
    target.classList.add('shift');
  } else {
    target.hidden = true;
  }
};

let inFlight = false;
/** The last exchange, so `Enter` on an empty line can promote it to a Facet. */
let lastQuestion = '';
/** Whether the live delta stream has replaced the `…` placeholder this turn. */
let streamStarted = false;

// The Conduit (Rust) types the reply in beneath the line as the backend streams
// it, one `chat/stream` delta at a time (ask.rs → spawn_delta_stream). The first
// delta clears the thinking ellipsis; the rest append. The awaited `submit_breath`
// body stays authoritative and overwrites this with the clean final text, so a
// dropped socket degrades to answer-at-once — never a half-typed reply left behind.
(window as unknown as { __breathDelta?: (p: { delta?: string }) => void }).__breathDelta = (
  p,
) => {
  if (!inFlight) return;
  const d = p?.delta ?? '';
  if (!d) return;
  if (!streamStarted) {
    answer.textContent = '';
    answer.hidden = false;
    streamStarted = true;
  }
  answer.textContent += d;
};

async function ask(text: string): Promise<void> {
  inFlight = true;
  streamStarted = false;
  setMode('thinking');
  answer.hidden = false;
  answer.textContent = '…';
  lastQuestion = text;
  try {
    const reply = (await invoke('submit_breath', { text })) as string;
    const finalText = reply?.trim();
    // Prefer the authoritative final body; fall back to whatever streamed in if
    // the POST returned empty but deltas did arrive; else the silence dash.
    answer.textContent = finalText || (streamStarted ? answer.textContent : '—');
  } catch (e) {
    answer.textContent = typeof e === 'string' && e ? e : 'Мовчання. Зв’язку немає.';
  }
  streamStarted = false;
  setMode('idle');
  line.value = '';
  line.focus();
  inFlight = false;
}

function spawn(kind: string, text?: string, question?: string): void {
  void invoke('facet_command', { action: 'spawn', kind, text, question });
}

async function submit(): Promise<void> {
  if (inFlight) return;
  const text = line.value.trim();

  // Empty line with an answer resting beneath it: Enter promotes that answer
  // out of the Breath Line and into a Facet of its own (§4.2).
  if (!text) {
    if (!answer.hidden && answer.textContent && answer.textContent !== '…') {
      spawn('answer', answer.textContent, lastQuestion);
      clearAnswer();
    }
    return;
  }

  // `/deep` and `/surface` are navigation, not questions: semantic zoom is the
  // only way to move, so the dive is a word typed into the same one line.
  const depth = parseDepth(text);
  if (depth) {
    void invoke('facet_command', { action: 'depth', dir: depth });
    line.value = '';
    clearAnswer();
    return;
  }

  // `/` is the verb sigil: the line calls a Facet into being instead of asking.
  const spawnable = parseSpawn(text);
  if (spawnable) {
    spawn(spawnable.kind);
    line.value = '';
    clearAnswer();
    return;
  }

  await ask(text);
}

// Everything is captured *locally*, inside the one window that legitimately owns
// focus. No global grab exists, and the Film never takes the keyboard — so the
// host OS keeps every keystroke that isn't ours.
window.addEventListener(
  'keydown',
  (e) => {
    // Alt-modified keys are the Facet grammar; they never reach the text input.
    const cmd = resolveKey(e);
    if (cmd) {
      e.preventDefault();
      if (cmd.action === 'target') {
        void invoke('facet_command', { action: 'target', dir: cmd.dir });
      } else {
        // Feed hands the typed line to the shard as material, then empties it.
        const text = cmd.verb === 'feed' ? line.value.trim() : undefined;
        void invoke('facet_command', { action: 'verb', verb: cmd.verb, text });
        if (cmd.verb === 'feed') line.value = '';
      }
      return;
    }

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
