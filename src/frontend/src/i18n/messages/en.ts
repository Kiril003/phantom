import type { MessageKey } from './uk';

/**
 * English catalogue — the wired seam.
 *
 * `Partial` is deliberate: English is a real, selectable locale but it is not
 * the source language, so it is allowed to lag behind. Anything missing here
 * resolves to the Ukrainian source string (see ../index), which means a
 * half-translated UI degrades to readable Ukrainian rather than to raw keys.
 * The `MessageKey` constraint still catches stale/typo'd keys at build time.
 */
export const en: Partial<Record<MessageKey, string>> = {
  // ── Chat: sessions sidebar ────────────────────────────────────────────────
  'chat.sessions.title': 'Sessions',
  'chat.sessions.empty': 'No sessions yet',
  'chat.sessions.listening': 'PHANTOM is listening.',
  'chat.sessions.new': 'New session',
  'chat.sessions.open': 'Open sessions',
  'chat.sessions.close': 'Close sessions',
  'chat.sessions.toggle': 'Toggle session menu',
  'chat.sessions.rename': 'Rename session',
  'chat.sessions.renameHint': 'Double-click to rename',
  'chat.sessions.delete': 'Delete session',
  'chat.sessions.count': '{count} msg',
  'chat.sessions.preview': 'Session · {id}',
  'chat.sessions.newShort': 'NEW',

  // ── Chat: header ──────────────────────────────────────────────────────────
  'chat.header.untitled': 'New Conversation',

  // ── Chat: empty state + quick prompts ─────────────────────────────────────
  'chat.empty.new': 'New conversation',
  'chat.empty.loaded': 'Session loaded',
  'chat.quick.aria': 'Quick chat actions',
  'chat.empty.body':
    'Pick an action or just type. PHANTOM answers better when it can see the context, the goal and the format you want.',
  'chat.quick.plan.label': 'Plan the day',
  'chat.quick.plan.prompt':
    'Help me put together a short plan for the day: priorities, risks, the next 3 actions.',
  'chat.quick.risks.label': 'Check the risks',
  'chat.quick.risks.prompt':
    'Look at the current system state and tell me what needs attention first.',
  'chat.quick.settings.label': 'Explain the settings',
  'chat.quick.settings.prompt':
    'Explain the key PHANTOM settings in plain words, and what is worth changing first.',

  // ── Chat: input ───────────────────────────────────────────────────────────
  'chat.input.placeholder': 'Message PHANTOM…',
  'chat.input.sending': 'PHANTOM is typing…',
  'chat.voice.stopSpeaking': 'Stop PHANTOM speaking',

  // ── Chat: live indicators ─────────────────────────────────────────────────
  'chat.thinking': 'Thinking',
  'chat.thinking.aria': 'PHANTOM is thinking',
  'chat.transcribing': 'Transcription in progress',
  'chat.thoughtStream': 'Thought Stream',

  // ── Settings: language picker ─────────────────────────────────────────────
  'settings.language.label': 'Interface language',
  'settings.language.hint': 'Ukrainian is primary; English is the fallback.',
};
