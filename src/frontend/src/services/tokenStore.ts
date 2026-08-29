/**
 * Єдине місце, де фронт тримає сесійний токен.
 *
 * Було: `localStorage.phantom_token` — тобто відкритий JWT на диску, який
 * переживає перезапуск і читається одним рядком скрипта. Панель раунду 4
 * зняла його зі сторінки за довжиною 264 символи.
 *
 * Стало: `sessionStorage`. Чесно кажучи, чим це є і чим не є:
 *
 *   • Це НЕ захист від XSS. Скрипт, який виконався на сторінці, читає
 *     sessionStorage так само легко, як читав localStorage. Хто обіцяє
 *     інше — бреше.
 *   • Це скорочення вікна. Токен більше не лежить на диску між запусками:
 *     закрив вікно — токен помер разом із вкладкою. Крадіжка вимагає XSS
 *     у ЖИВІЙ сесії, а не доступу до профілю браузера, бекапу, чужого
 *     облікового запису на тій самій машині чи забутого ноутбука.
 *
 * Чому не httpOnly-cookie (справжнє рішення): фронт живе у Tauri-обгортці
 * (`src-tauri/`) і ходить на вузол з іншого origin, а вузол у локальній
 * мережі говорить по HTTP. Cross-origin cookie в такій зв'язці вимагає
 * `SameSite=None; Secure`, тобто HTTPS — його тут немає. Плюс мобільний
 * клієнт (OkHttp, `PhantomLink.kt`) взагалі не має cookie-jar і носить
 * токен у заголовку. Тобто httpOnly зламав би і десктоп, і телефон заради
 * вебу, якого в цій системі окремо не існує. Тому — менше зло і чесний
 * запис про те, що це менше зло.
 *
 * Ціна: перезапуск застосунку тепер просить PIN. Це навмисно.
 */

const TOKEN_KEY = 'phantom_token';
const EXPIRES_KEY = 'phantom_token_expires';

function session(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

function local(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Разова міграція: власник, який уже ввійшов, не має бути викинутий оновленням.
 * Переносимо токен у sessionStorage і ОДРАЗУ прибираємо з диска — інакше
 * весь сенс переїзду зникає.
 */
function migrateOnce(): void {
  const from = local();
  const to = session();
  if (!from || !to) return;
  const legacy = from.getItem(TOKEN_KEY);
  if (legacy !== null) {
    if (to.getItem(TOKEN_KEY) === null) to.setItem(TOKEN_KEY, legacy);
    from.removeItem(TOKEN_KEY);
  }
  const legacyExpires = from.getItem(EXPIRES_KEY);
  if (legacyExpires !== null) {
    if (to.getItem(EXPIRES_KEY) === null) to.setItem(EXPIRES_KEY, legacyExpires);
    from.removeItem(EXPIRES_KEY);
  }
}

migrateOnce();

export function readToken(): string | null {
  // Міграція повторюється при кожному читанні навмисно: інші вкладки й
  // старий код можуть покласти токен у localStorage вже після завантаження
  // модуля, і він не має там залишитися.
  migrateOnce();
  return session()?.getItem(TOKEN_KEY) ?? null;
}

export function writeToken(token: string, expiresAt?: string): void {
  const store = session();
  if (!store) return;
  store.setItem(TOKEN_KEY, token);
  if (expiresAt !== undefined) store.setItem(EXPIRES_KEY, expiresAt);
}

export function readTokenExpiry(): string | null {
  migrateOnce();
  return session()?.getItem(EXPIRES_KEY) ?? null;
}

export function clearToken(): void {
  session()?.removeItem(TOKEN_KEY);
  session()?.removeItem(EXPIRES_KEY);
  // Підчищаємо і диск: раптом щось поклало туди токен в обхід цього модуля.
  local()?.removeItem(TOKEN_KEY);
  local()?.removeItem(EXPIRES_KEY);
}

/** `Authorization: Bearer …` або `{}`, коли токена немає. */
export function authHeader(): Record<string, string> {
  const token = readToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
