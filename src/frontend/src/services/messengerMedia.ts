/**
 * Шифрування і розшифрування вкладень — у браузері, не на вузлі.
 *
 * Це не прикраса архітектури, а те, що робить обіцянку правдою: вузол
 * одержувача зберігає файл, якого не може прочитати, бо ключ ніколи туди не
 * потрапляв. Ключ їде в тілі повідомлення — тим самим наскрізним кадром, що
 * й текст, — і живе лише в памʼяті цієї вкладки.
 *
 * Відбиток звіряємо ДО розшифрування. Якщо байти по дорозі підмінили, людина
 * побачить чесну помилку, а не биту картинку і не тишу.
 */

import type { SecureMedia } from '../types/messenger';

/** Стеля вузла — та сама, що в messenger/blobs.py. */
export const MEDIA_LIMIT_BYTES = 25 * 1024 * 1024;

export class MediaNotArrived extends Error {
  constructor() {
    super('вкладення ще не доїхало на цей вузол');
    this.name = 'MediaNotArrived';
  }
}

export class MediaTampered extends Error {
  constructor() {
    super('відбиток вкладення не збігся');
    this.name = 'MediaTampered';
  }
}

const hex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/** Повертаємо саме ArrayBuffer: WebCrypto хоче BufferSource з певним сховищем. */
const unhex = (s: string): ArrayBuffer => {
  const buf = new ArrayBuffer(s.length / 2);
  const out = new Uint8Array(buf);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return buf;
};

/** Об'єктні URL живуть до перезавантаження вкладки; двічі дешифрувати те саме не треба. */
const ready = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

export function cachedMediaUrl(blobId: string): string | undefined {
  return ready.get(blobId);
}

/** Шифрує файл перед завантаженням. Ключ і одноразове число повертаємо викликачу — вузол їх не бачить. */
export async function encryptForUpload(
  file: File,
): Promise<{ ciphertext: Blob; keyHex: string; nonceHex: string; sha256: string }> {
  const plain = await file.arrayBuffer();
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain);
  const digest = await crypto.subtle.digest('SHA-256', ct);
  return {
    ciphertext: new Blob([ct], { type: 'application/octet-stream' }),
    keyHex: hex(raw.buffer as ArrayBuffer),
    nonceHex: hex(nonce.buffer as ArrayBuffer),
    sha256: hex(digest),
  };
}

async function fetchAndDecrypt(media: SecureMedia): Promise<string> {
  const token = localStorage.getItem('phantom_token');
  const res = await fetch(`/api/v1/messenger/files/${media.blobId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  // 404 — не помилка, а чесний стан: блоб ще не приїхав на цей вузол.
  if (res.status === 404) throw new MediaNotArrived();
  if (!res.ok) throw new Error(`вузол не віддав вкладення: ${res.status}`);

  const ct = await res.arrayBuffer();
  const digest = hex(await crypto.subtle.digest('SHA-256', ct));
  if (digest !== media.sha256) throw new MediaTampered();

  const key = await crypto.subtle.importKey(
    'raw',
    unhex(media.keyHex),
    'AES-GCM',
    false,
    ['decrypt'],
  );
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unhex(media.nonceHex) },
      key,
      ct,
    );
  } catch {
    // Тег AEAD не зійшовся — ключ не той або байти биті. Обидва варіанти
    // означають те саме: показувати нічого.
    throw new MediaTampered();
  }
  const url = URL.createObjectURL(new Blob([plain], { type: media.mime || 'application/octet-stream' }));
  ready.set(media.blobId, url);
  return url;
}

/** Розшифроване вкладення як object URL. Той самий блоб не дешифрується двічі. */
export function loadMedia(media: SecureMedia): Promise<string> {
  const done = ready.get(media.blobId);
  if (done) return Promise.resolve(done);

  const running = inflight.get(media.blobId);
  if (running) return running;

  const task = fetchAndDecrypt(media).finally(() => inflight.delete(media.blobId));
  inflight.set(media.blobId, task);
  return task;
}

/** Після «Запитати ще раз» треба спробувати заново, а не віддати стару відмову. */
export function forgetMedia(blobId: string): void {
  const url = ready.get(blobId);
  if (url) URL.revokeObjectURL(url);
  ready.delete(blobId);
  inflight.delete(blobId);
}

export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : 'ФАЙЛ';
}
