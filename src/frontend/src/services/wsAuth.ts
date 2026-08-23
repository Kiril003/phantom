/**
 * Токен для WebSocket їде під-протоколом, а не в `?token=`.
 *
 * Адресний рядок — не секретне місце: uvicorn пише повний шлях запиту в
 * access-лог (`"WebSocket /ws?token=…" [accepted]`), його бачить кожен
 * проксі по дорозі. Заголовок рукостискання `Sec-WebSocket-Protocol` у
 * лог не потрапляє.
 *
 * Формат: клієнт пропонує рівно дві позиції — маркер і одразу за ним сам
 * токен. Вузол мусить підтвердити маркер у відповіді, інакше браузер
 * розірве зʼєднання. Алфавіт JWT (base64url + крапка) цілком лежить у
 * дозволених RFC 6455 символах, тож токен їде як є.
 *
 * Бекенд: `src/backend/security/ws_auth.py`.
 */
export const BEARER_SUBPROTOCOL = 'phantom.bearer.v1';

/** Аргумент `protocols` для конструктора WebSocket. */
export function bearerProtocols(token: string | null | undefined): string[] | undefined {
  return token ? [BEARER_SUBPROTOCOL, token] : undefined;
}

/** `new WebSocket(url, …)` з токеном у під-протоколі, коли він є. */
export function openAuthedSocket(url: string, token: string | null | undefined): WebSocket {
  const protocols = bearerProtocols(token);
  return protocols ? new WebSocket(url, protocols) : new WebSocket(url);
}
