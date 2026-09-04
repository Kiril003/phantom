/**
 * Запрошення — усе, що потрібно, щоб впустити людину, в одному рядку.
 *
 * Раніше, щоб почати розмову, людина мусила окремо роздобути IP чужого вузла
 * і окремо ключ на 355 символів. Тут ті самі байти лежать в одному конверті:
 * ключ, адреса вузла і напис, яким запрошувач себе називає.
 *
 * Конверт двійковий, а не JSON з base64 всередині: вкладати base64 в base64
 * коштувало б третину довжини на порожньому місці.
 *
 *   "PHI" · версія · u16 довжина ключа · ключ · u8+адреса · u8+імʼя
 *
 * Далі все разом — base64url. 266 байтів ключа — це підлога, нижче якої
 * рядок не стиснути: там самі лише ключі й підписи, вони випадкові.
 */

const SCHEME = 'phantom://invite/';
const MAGIC = [0x50, 0x48, 0x49]; // "PHI"
const VERSION = 1;

/** Стислий ключ вузла без конверта — 266 байтів, ~355 символів base64url. */
const COMPACT_MIN_BYTES = 230;

export interface InviteParts {
  /** Ключ у тому вигляді, який приймає вузол (`compact` з /messenger/identity). */
  compact: string;
  /** Адреса вузла запрошувача. Порожньо — лист чекатиме на ретранслятор. */
  address: string;
  /** Як запрошувач себе назвав. Це напис, а не доказ. */
  name: string;
}

export type ParsedInvite =
  | ({ kind: 'invite' } & InviteParts)
  | { kind: 'compact'; compact: string }
  | { kind: 'bundle'; bundle: Record<string, unknown> }
  /**
   * Запрошення З ТЕЛЕФОНА (`PH2:<payload>:<6 hex>`). Це НЕ ключ вузла ПК:
   * телефон і ПК рахують різні простори імен, і вузол на такий рядок
   * відповідає 400. Доти payload проходив як «стислий ключ» (перший байт
   * збігався), людина отримувала «неприйнятний bundle» і не мала жодного
   * способу здогадатись, що вставила код не туди.
   */
  | { kind: 'phone'; token: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function b64urlEncode(raw: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < raw.length; i += 1) bin += String.fromCharCode(raw[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Ріже рядок так, щоб він уліз у 255 байтів і не розвалив кирилицю навпіл. */
function clampBytes(text: string, limit: number): Uint8Array {
  let cut = text;
  let raw = encoder.encode(cut);
  while (raw.length > limit && cut.length > 0) {
    cut = cut.slice(0, -1);
    raw = encoder.encode(cut);
  }
  return raw;
}

export function encodeInvite(parts: InviteParts): string {
  const bundle = b64urlDecode(parts.compact.trim());
  const addr = clampBytes(parts.address.trim(), 255);
  const who = clampBytes(parts.name.trim(), 255);

  const out = new Uint8Array(6 + bundle.length + 1 + addr.length + 1 + who.length);
  out.set(MAGIC, 0);
  out[3] = VERSION;
  out[4] = (bundle.length >> 8) & 0xff;
  out[5] = bundle.length & 0xff;
  let p = 6;
  out.set(bundle, p);
  p += bundle.length;
  out[p] = addr.length;
  p += 1;
  out.set(addr, p);
  p += addr.length;
  out[p] = who.length;
  p += 1;
  out.set(who, p);

  return SCHEME + b64urlEncode(out);
}

/** Версія запрошення новіша за ту, яку вміє цей вузол. */
export class InviteTooNew extends Error {}

function decodeEnvelope(raw: Uint8Array): InviteParts | null {
  if (raw.length < 8) return null;
  if (raw[0] !== MAGIC[0] || raw[1] !== MAGIC[1] || raw[2] !== MAGIC[2]) return null;
  if (raw[3] !== VERSION) throw new InviteTooNew(String(raw[3]));

  const bundleLen = (raw[4] << 8) | raw[5];
  let p = 6;
  if (bundleLen < COMPACT_MIN_BYTES || p + bundleLen + 2 > raw.length) return null;
  const bundle = raw.slice(p, p + bundleLen);
  p += bundleLen;

  const addrLen = raw[p];
  p += 1;
  if (p + addrLen + 1 > raw.length) return null;
  const address = decoder.decode(raw.slice(p, p + addrLen));
  p += addrLen;

  const nameLen = raw[p];
  p += 1;
  if (p + nameLen > raw.length) return null;
  const name = decoder.decode(raw.slice(p, p + nameLen));

  return { compact: b64urlEncode(bundle), address, name };
}

/**
 * Приймає все, що людина могла вставити: посилання, голий base64, ключ без
 * конверта, розгорнутий JSON — і навіть коли навколо лишились слова з чату.
 */
export function parseInvite(text: string): ParsedInvite | null {
  const raw = (text || '').trim();
  if (!raw) return null;

  // Телефонне запрошення розпізнаємо ДО всього іншого: його payload —
  // теж base64url, і за першим байтом він проходив як стислий ключ вузла.
  // Формат: `PH2:<base64url>:<6 hex>` (роздільник — двокрапка), інколи
  // всередині посилання `phantom://invite/PH2:…`.
  const phone = raw.match(/PH2:[A-Za-z0-9\-_]{8,}:[0-9a-fA-F]{6}/);
  if (phone) return { kind: 'phone', token: phone[0] };

  if (raw.startsWith('{')) {
    try {
      return { kind: 'bundle', bundle: JSON.parse(raw) as Record<string, unknown> };
    } catch {
      return null;
    }
  }

  // Люди вставляють запрошення разом із «привіт, ось воно» і переносами рядка.
  // Беремо всі суцільні шматки base64url і пробуємо довші першими.
  const tokens = (raw.match(/[A-Za-z0-9\-_]{40,}/g) ?? []).sort((a, b) => b.length - a.length);
  let tooNew: InviteTooNew | null = null;

  for (const token of tokens) {
    let bytes: Uint8Array;
    try {
      bytes = b64urlDecode(token);
    } catch {
      continue;
    }
    try {
      const parts = decodeEnvelope(bytes);
      if (parts) return { kind: 'invite', ...parts };
    } catch (err) {
      if (err instanceof InviteTooNew) tooNew = err;
      continue;
    }
    // Ключ без конверта: перший байт — версія стислого ключа з crypto/keys.py.
    if (bytes.length >= COMPACT_MIN_BYTES && bytes[0] === 1) {
      return { kind: 'compact', compact: token };
    }
  }

  if (tooNew) throw tooNew;
  return null;
}

/**
 * node_id = sha256(identity_ed)[:32] — так само, як його рахує вузол.
 * Ім’я в запрошенні можна написати будь-яке; це число бере початок у самому
 * ключі, тож підмінити його, не підмінивши ключ, неможливо.
 *
 * Повертає null там, де браузер не дає SubtleCrypto (сторінка не по https і
 * не на localhost) — тоді вузол назветься вже після відкриття розмови.
 */
export async function nodeIdOf(compact: string): Promise<string | null> {
  try {
    const raw = b64urlDecode(compact.trim());
    if (raw.length < 34 || !globalThis.crypto?.subtle) return null;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', raw.slice(2, 34));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32);
  } catch {
    return null;
  }
}

/**
 * Адреса, за якою цей вузол видно ІНШОМУ пристрою.
 *
 * Тут стояв `window.location.origin` — і це найгірший можливий здогад:
 * у розробці він дає `http://127.0.0.1:5175` (петля, для телефона порожнє
 * місце), а в запакованому застосунку — origin asset-протоколу Tauri,
 * який не є мережевою адресою взагалі. Тобто запрошення з ПК носило
 * адресу, за якою до нього НІХТО не міг достукатись, і це не залежало від
 * того, чи все інше в парі справне.
 *
 * Правду про адресу знає лише вузол: `GET /health` віддає
 * `tls_listening.bound` — інтерфейси, на яких слухач СПРАВДІ став, і порт.
 * Тому справжня адреса береться звідти (`selfAddress()`), а ця функція
 * лишається запасним здогадом на випадок, коли ядро мовчить, і людина
 * бачить його в полі, щоб виправити рукою.
 */
export function selfAddressGuess(): string {
  try {
    return window.location.origin;
  } catch {
    return '';
  }
}

/** Копіює в буфер; там, де clipboard API немає (сторінка не по https), — старим способом. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* впадемо на запасний шлях */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Зазирає в буфер обміну. Відмова в дозволі — не помилка, просто null. */
export async function inviteInClipboard(): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) return null;
    const text = await navigator.clipboard.readText();
    if (!text) return null;
    return parseInvite(text) ? text : null;
  } catch {
    return null;
  }
}

/**
 * Адреса вузла зі слів самого вузла: `https://<інтерфейс>:<порт>`.
 *
 * `null` — ядро не відповіло або слухач не став на жоден інтерфейс; тоді
 * викликач лишається зі здогадом `selfAddressGuess()` і мусить сказати
 * людині, що адресу варто перевірити. Петлю (`127.0.0.1`, `::1`) сюди не
 * пускаємо навмисно: для іншого пристрою вона нічого не означає.
 */
export async function selfAddress(): Promise<string | null> {
  try {
    const { fetchHealth } = await import('../services/organismApi');
    const pulse = await fetchHealth();
    if (!pulse.ok) return null;
    const tls = pulse.data.tls_listening;
    if (!tls || !tls.enabled || !tls.port) return null;
    const host = (tls.bound || []).find(
      (h) => h && h !== '127.0.0.1' && h !== '::1' && h !== '0.0.0.0',
    );
    return host ? `https://${host}:${tls.port}` : null;
  } catch {
    return null;
  }
}
