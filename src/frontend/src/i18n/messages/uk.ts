/**
 * Ukrainian message catalogue — the source of truth.
 *
 * `MessageKey` is derived from this object's keys, so every other locale is
 * type-checked against it (a typo'd or stale key in en.ts fails the build) and
 * this catalogue is, by construction, always complete. Keys are dotted by
 * surface (`chat.*`, `settings.*`); values may carry `{var}` placeholders that
 * the runtime interpolates (see ../index).
 */
export const uk = {
  // ── Chat: sessions sidebar ────────────────────────────────────────────────
  'chat.sessions.title': 'Сесії',
  'chat.sessions.empty': 'Ще немає сесій',
  'chat.sessions.listening': 'PHANTOM слухає.',
  'chat.sessions.new': 'Нова сесія',
  'chat.sessions.open': 'Відкрити сесії',
  'chat.sessions.close': 'Закрити сесії',
  'chat.sessions.toggle': 'Перемкнути меню сесій',
  'chat.sessions.rename': 'Перейменувати сесію',
  'chat.sessions.renameHint': 'Подвійний клік — перейменувати',
  'chat.sessions.delete': 'Видалити сесію',
  'chat.sessions.count': '{count} повідом.',
  'chat.sessions.preview': 'Сесія · {id}',
  'chat.sessions.newShort': 'НОВА',

  // ── Chat: header ──────────────────────────────────────────────────────────
  'chat.header.untitled': 'Нова розмова',

  // ── Chat: empty state + quick prompts ─────────────────────────────────────
  'chat.empty.new': 'Нова розмова',
  'chat.empty.loaded': 'Сесію завантажено',
  'chat.quick.aria': 'Швидкі дії чату',
  'chat.empty.body':
    'Обери дію або напиши напряму. PHANTOM краще відповідає, коли бачить контекст, ціль і бажаний формат.',
  'chat.quick.plan.label': 'План дня',
  'chat.quick.plan.prompt':
    'Допоможи зібрати короткий план дня: пріоритети, ризики, наступні 3 дії.',
  'chat.quick.risks.label': 'Перевір ризики',
  'chat.quick.risks.prompt':
    'Подивись на поточний стан системи й скажи, що потребує уваги першим.',
  'chat.quick.settings.label': 'Поясни налаштування',
  'chat.quick.settings.prompt':
    'Поясни ключові налаштування PHANTOM простими словами і що варто змінити спочатку.',

  // ── Chat: live indicators ─────────────────────────────────────────────────
  'chat.thinking': 'Мислю',
  'chat.thinking.aria': 'PHANTOM мислить',
  'chat.transcribing': 'Розпізнавання у процесі',
  'chat.thoughtStream': 'Потік Свідомості',

  // ── Settings: language picker ─────────────────────────────────────────────
  'settings.language.label': 'Мова інтерфейсу',
  'settings.language.hint': 'Українська — основна; English — запасна.',
} as const;

export type MessageKey = keyof typeof uk;
