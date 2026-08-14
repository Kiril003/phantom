/**
 * capabilityStore: run-once-per-session + sessionStorage cache semantics.
 *
 * Each test gets its own fresh module instance (vi.resetModules +
 * dynamic import) because `ensureCapabilityProbed`'s run-once guard is a
 * module-level variable — without a fresh module per test, the second
 * test's "should this hit cache or probe" question is already answered
 * by the first test's leftover state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProbeResult } from '../../lib/capabilityProbe';

const makeResult = (tier: ProbeResult['tier']): ProbeResult => ({
  tier,
  reason: `test-${tier}`,
  webgl2: true,
  metrics: null,
  probedAt: 1234,
});

beforeEach(() => {
  vi.resetModules();
  window.sessionStorage.clear();
});

async function loadStoreWithMockedProbe(probeImpl: ReturnType<typeof vi.fn>) {
  vi.doMock('../../lib/capabilityProbe', async () => {
    const actual =
      await vi.importActual<typeof import('../../lib/capabilityProbe')>('../../lib/capabilityProbe');
    return { ...actual, runCapabilityProbe: probeImpl };
  });
  return import('../capabilityStore');
}

describe('ensureCapabilityProbed', () => {
  it('probes exactly once even when called concurrently from two mounts', async () => {
    const result = makeResult('T1');
    const probeFn = vi.fn().mockResolvedValue(result);
    const { ensureCapabilityProbed, useCapabilityStore } = await loadStoreWithMockedProbe(probeFn);

    const [a, b] = await Promise.all([ensureCapabilityProbed(), ensureCapabilityProbed()]);

    expect(probeFn).toHaveBeenCalledTimes(1);
    expect(a).toEqual(result);
    expect(b).toEqual(result);
    expect(useCapabilityStore.getState()).toMatchObject({ status: 'done', result });
  });

  it('reuses a cached verdict from sessionStorage instead of re-probing', async () => {
    const cached = makeResult('T2');
    window.sessionStorage.setItem('phantom.capabilityProbe.v1', JSON.stringify(cached));
    const probeFn = vi.fn();
    const { ensureCapabilityProbed, useCapabilityStore } = await loadStoreWithMockedProbe(probeFn);

    const result = await ensureCapabilityProbed();

    expect(probeFn).not.toHaveBeenCalled();
    expect(result).toEqual(cached);
    expect(useCapabilityStore.getState()).toMatchObject({ status: 'done', result: cached });
  });

  it('persists a freshly measured verdict to sessionStorage for the next reload', async () => {
    const result = makeResult('T0');
    const probeFn = vi.fn().mockResolvedValue(result);
    const { ensureCapabilityProbed } = await loadStoreWithMockedProbe(probeFn);

    await ensureCapabilityProbed();

    const raw = window.sessionStorage.getItem('phantom.capabilityProbe.v1');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual(result);
  });

  it('ignores a corrupt sessionStorage entry and probes instead', async () => {
    window.sessionStorage.setItem('phantom.capabilityProbe.v1', '{not json');
    const result = makeResult('T0');
    const probeFn = vi.fn().mockResolvedValue(result);
    const { ensureCapabilityProbed } = await loadStoreWithMockedProbe(probeFn);

    const resolved = await ensureCapabilityProbed();

    expect(probeFn).toHaveBeenCalledTimes(1);
    expect(resolved).toEqual(result);
  });
});
