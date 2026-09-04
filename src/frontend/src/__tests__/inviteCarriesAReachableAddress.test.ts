/**
 * Запрошення з ПК мусить нести адресу, за якою до ПК можна достукатись.
 *
 * `selfAddressGuess()` віддавав `window.location.origin` — у розробці це
 * `http://127.0.0.1:5175` (петля: для телефона порожнє місце), а в
 * запакованому застосунку — origin asset-протоколу Tauri, який не є
 * мережевою адресою взагалі. Тобто запрошення з ПК носило адресу, за якою
 * до нього НІХТО не міг достукатись, і це не залежало від того, чи все
 * інше в парі справне: телефон читав код, брав адресу — і йшов у нікуди.
 *
 * Правду знає лише вузол: `GET /health` віддає `tls_listening.bound` —
 * інтерфейси, на яких слухач СПРАВДІ став, і порт. Звідти й беремо.
 *
 * Тут же тримаємо круговий доказ, якого просив штаб: рядок, що його
 * покаже ПК, мусить розібратись тим самим розбором — з адресою, портом і
 * ключем на місці.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/organismApi', () => ({ fetchHealth: vi.fn() }));

import { fetchHealth } from '../services/organismApi';
import { selfAddress, encodeInvite, parseInvite, b64urlEncode } from '../utils/messengerInvite';

const health = fetchHealth as unknown as ReturnType<typeof vi.fn>;

const base = {
  status: 'ok',
  version: '0.20.0',
  hostname: 'phantom',
  ws_clients: 1,
  esp32_connected: false,
  serial_enabled: true,
  ai_active: 'ollama',
  ai_fallback: 'ollama',
};

/** Стислий ключ-заглушка потрібної довжини (перший байт — версія 1). */
function fakeCompact(): string {
  const bytes = new Uint8Array(256);
  bytes[0] = 1;
  for (let i = 1; i < bytes.length; i++) bytes[i] = (i * 13) % 251;
  return b64urlEncode(bytes);
}

describe('адреса вузла в запрошенні', () => {
  beforeEach(() => health.mockReset());

  it('береться з інтерфейсу, на якому СТОЇТЬ слухач', async () => {
    health.mockResolvedValue({
      ok: true,
      data: { ...base, tls_listening: { bound: ['158.196.237.8'], port: 8443, enabled: true } },
    });

    await expect(selfAddress()).resolves.toBe('https://158.196.237.8:8443');
  });

  it('петля не є адресою для іншого пристрою', async () => {
    health.mockResolvedValue({
      ok: true,
      data: { ...base, tls_listening: { bound: ['127.0.0.1', '::1'], port: 8443, enabled: true } },
    });

    await expect(selfAddress()).resolves.toBeNull();
  });

  it('слухач не став → null, а не вигадана адреса', async () => {
    health.mockResolvedValue({
      ok: true,
      data: { ...base, tls_listening: { bound: [], port: 8443, enabled: false } },
    });

    await expect(selfAddress()).resolves.toBeNull();
  });

  it('ядро не відповіло → null (мовчання не є адресою)', async () => {
    health.mockResolvedValue({ ok: false, reason: 'unreachable' });

    await expect(selfAddress()).resolves.toBeNull();
  });
});

describe('круговий доказ: що ПК показав, те й розбирається', () => {
  it('рядок несе адресу З ПОРТОМ, імʼя і ключ — і читається назад', () => {
    const compact = fakeCompact();
    const link = encodeInvite({
      compact,
      address: 'https://158.196.237.8:8443',
      name: 'Кирило · ПК',
    });

    expect(link.startsWith('phantom://invite/'), `рядок: ${link.slice(0, 24)}…`).toBe(true);

    const parsed = parseInvite(link);
    expect(parsed?.kind).toBe('invite');
    if (parsed?.kind !== 'invite') throw new Error('не розібралось');

    expect(parsed.address).toBe('https://158.196.237.8:8443');
    // Порт — окремою умовою: без нього телефон відкидає запрошення.
    expect(parsed.address).toMatch(/:\d{2,5}$/);
    expect(parsed.name).toBe('Кирило · ПК');
    expect(parsed.compact).toBe(compact);
  });

  it('адреса без порту помітна одразу — і це видно з розбору', () => {
    const link = encodeInvite({
      compact: fakeCompact(),
      address: 'https://158.196.237.8',
      name: 'ПК',
    });
    const parsed = parseInvite(link);
    if (parsed?.kind !== 'invite') throw new Error('не розібралось');

    expect(parsed.address).not.toMatch(/:\d{2,5}$/);
  });
});
