/**
 * Типізований доступ до єдиного джерела адреси бекенда.
 *
 * Саме джерело — `public/backend-origin.js`, звичайний скрипт, який
 * підключають ОБИДВА входи (`index.html` і `public/splash.html`). Воно не
 * може жити тут, у бандлі, з двох причин: заставка не проходить збірку
 * взагалі, і на неї діє CSP `script-src 'self'`.
 *
 * Навіщо це існує — коротко (докладно в самому `backend-origin.js`):
 * 29.08.2026 запакований AppImage підняв вікно, і смуга організму показала
 * «канал обрив / ядро мовчить / ресурси мовчить» при живому HTTP, а в
 * діалозі вилізла англійська «The string did not match the expected
 * pattern.» — сирий DOMException. Адреси до бекенда будувались від
 * `window.location`, який в asset-протоколі Tauri вказує не на sidecar.
 */

interface PhantomBackend {
  host: string;
  port: number;
  isPackaged(): boolean;
  /** Origin бекенда: абсолютний у пакунку, порожній у розробці. */
  origin(): string;
  /** Повна адреса WebSocket до шляху (`/ws`). */
  ws(path: string): string;
  /** HTTP-адреса: абсолютна в пакунку, відносна в розробці. */
  http(path: string): string;
  /** Безумовно абсолютна адреса — для заставки. */
  absolute(path: string): string;
}

declare global {
  interface Window {
    __PHANTOM_BACKEND__?: PhantomBackend;
  }
}

function source(): PhantomBackend {
  const s = typeof window !== 'undefined' ? window.__PHANTOM_BACKEND__ : undefined;
  if (!s) {
    // Падаємо голосно і по-людськи. Тихий запасний варіант тут був би
    // гіршим за помилку: він відтворив би саме ту ситуацію, коли адреса
    // відома у двох місцях і вони розходяться.
    throw new Error(
      'backend-origin.js не завантажений — додай <script src="/backend-origin.js"> ' +
        'у вхідний HTML ПЕРЕД бандлом. Без нього адреса бекенда невідома, ' +
        'а вгадувати її від window.location — це дефект, через який ' +
        'у пакунку мовчали всі вебсокети.',
    );
  }
  return s;
}

/** `true`, коли застосунок працює всередині оболонки Tauri. */
export const isPackaged = (): boolean => source().isPackaged();

/** Origin бекенда. Порожній рядок у розробці — там проксує vite. */
export const backendOrigin = (): string => source().origin();

/** Адреса WebSocket: `wsUrl('/ws')`. */
export const wsUrl = (path: string): string => source().ws(path);

/** HTTP-адреса до бекенда: `apiUrl('/api/v1/…')`. */
export const apiUrl = (path: string): string => source().http(path);

/**
 * WebSocket ПРЯМО до бекенда, повз будь-який проксі розробки.
 *
 * Потрібен рівно одному місцю — `/ws/voice`. Воно свідомо обходить ws-проксі
 * vite: той падає (EPIPE / 1006) під бінарними PCM-кадрами на 30 мс разом із
 * рештою трафіку на центральному `/ws`.
 *
 * Чому ця функція живе ТУТ, а не в самому голосовому хуку. У розробці пряма
 * адреса мусить вести на ту машину, з якої відкрито сторінку, — тобто на
 * `location.hostname`, а не на `HOST` із джерела (там `127.0.0.1`, і робота
 * з іншого комп'ютера в мережі зламалась би). Тобто одному випадку таки
 * потрібен `window.location`. Хай ця потреба лишається в єдиному модулі,
 * якому це дозволено, замість розповзатися по хуках: інакше сторож
 * `test_frontend_never_trusts_the_address` довелось би послабити, а він
 * єдиний, хто стереже цей клас.
 *
 * У пакунку жодного `location` немає — там адреса відома точно.
 */
export const directWsUrl = (path: string): string => {
  const s = source();
  if (s.isPackaged()) return s.ws(path);
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${proto}//${window.location.hostname}:${s.port}${p}`;
};
