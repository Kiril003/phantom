/**
 * organismApi — доктрина чесності на рівні фетчів:
 * мовчання замість вигаданих даних, нуль побічних ефектів на 401.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchHealth,
  fetchLinuxResources,
  fetchNodeManifest,
  resolveBackendPort,
} from '../organismApi';
import { readToken, writeToken, clearToken } from '../tokenStore';

const HEALTH_BODY = {
  status: 'ok',
  version: '0.1.0',
  hostname: 'phantom',
  ws_clients: 2,
  esp32_connected: false,
  serial_enabled: true,
  ai_active: 'gemini',
  ai_fallback: 'ollama',
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('organismApi', () => {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
    clearToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('fetchHealth', () => {
    it('віддає виміряне з /health', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(HEALTH_BODY));
      const pulse = await fetchHealth();
      expect(pulse).toEqual({ ok: true, data: HEALTH_BODY });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('/health');
    });

    it('5xx — мовчання unreachable, не кидає', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'boom' }, 500));
      await expect(fetchHealth()).resolves.toEqual({ ok: false, reason: 'unreachable' });
    });

    it('мережевий збій — мовчання unreachable, не кидає', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('failed to fetch'));
      await expect(fetchHealth()).resolves.toEqual({ ok: false, reason: 'unreachable' });
    });
  });

  describe('fetchLinuxResources', () => {
    it('без токена мовчить unauthorized і НЕ ходить у мережу', async () => {
      await expect(fetchLinuxResources()).resolves.toEqual({
        ok: false,
        reason: 'unauthorized',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('з токеном шле Bearer на /api/v1/linux/resources', async () => {
      localStorage.setItem('phantom_token', 'tkn-123');
      const body = {
        cpu_percent: 7.5,
        ram_total: 16e9,
        ram_used: 4e9,
        ram_free: 12e9,
        disk_total: 5e11,
        disk_used: 2e11,
        disk_free: 3e11,
        uptime_s: 3600,
      };
      fetchMock.mockResolvedValueOnce(jsonResponse(body));
      const pulse = await fetchLinuxResources();
      expect(pulse).toEqual({ ok: true, data: body });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/v1/linux/resources');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tkn-123');
    });

    it('401 — unauthorized БЕЗ побічних ефектів: токен лишається', async () => {
      // Клас дефекту, який ловимо: api.ts request() на 401 зносить токен —
      // фоновий пульс вибивав би власника з сесії кожні 5 секунд.
      // Дім токена — sessionStorage (services/tokenStore), і кладемо ми
      // його туди ж, куди кладе застосунок. Раніше тест писав прямо в
      // localStorage і вимагав, щоб він там і лишився, — але саме звідти
      // токен свідомо прибрали (диск переживає перезапуск), і `readToken`
      // переносить спадок у sessionStorage, витираючи копію з диска.
      // Тобто перевіряємо те, про що тест: після 401 токен ЖИВИЙ.
      writeToken('tkn-123');
      fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'no' }, 401));
      await expect(fetchLinuxResources()).resolves.toEqual({
        ok: false,
        reason: 'unauthorized',
      });
      expect(readToken()).toBe('tkn-123');
    });

    it('403 (не operator) — теж unauthorized', async () => {
      writeToken('tkn-123');
      fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'forbidden' }, 403));
      await expect(fetchLinuxResources()).resolves.toEqual({
        ok: false,
        reason: 'unauthorized',
      });
    });
  });

  describe('fetchNodeManifest', () => {
    it('віддає підписану ідентичність вузла', async () => {
      const manifest = {
        id: '689e8a3bb2cfa965',
        name: 'Кузня',
        role: 'forge',
        platform: 'linux-arm64',
        schema: 1,
        capabilities: ['disk'],
        public_key: 'pk',
        alg: 'ed25519',
        signature: 'sig',
      };
      fetchMock.mockResolvedValueOnce(jsonResponse(manifest));
      await expect(fetchNodeManifest()).resolves.toEqual({ ok: true, data: manifest });
      expect(fetchMock.mock.calls[0][0]).toBe('/node/manifest');
    });

    it('404 (dev-проксі без /node) — чесне мовчання', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'Not Found' }, 404));
      await expect(fetchNodeManifest()).resolves.toEqual({
        ok: false,
        reason: 'unreachable',
      });
    });
  });

  describe('resolveBackendPort', () => {
    afterEach(() => {
      delete window.__PHANTOM_BACKEND_PORT__;
    });

    it('без env і window-контракту — чесний null, не вигаданий 8000', () => {
      expect(resolveBackendPort()).toBeNull();
    });

    it('env VITE_PHANTOM_BACKEND_PORT перемагає', () => {
      vi.stubEnv('VITE_PHANTOM_BACKEND_PORT', '8010');
      window.__PHANTOM_BACKEND_PORT__ = 9999;
      expect(resolveBackendPort()).toBe(8010);
    });

    it('window-контракт — запасний шлях', () => {
      window.__PHANTOM_BACKEND_PORT__ = '8010';
      expect(resolveBackendPort()).toBe(8010);
    });

    it('сміття в контракті — null, не NaN', () => {
      window.__PHANTOM_BACKEND_PORT__ = 'не-порт';
      expect(resolveBackendPort()).toBeNull();
    });
  });
});
