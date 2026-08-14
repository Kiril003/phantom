/**
 * Pins the T0/T1/T2 classification logic against the exact numbers
 * measured in `pc-map-unblock.md` (14 Aug, WebKitGTK 2.52.5 / Intel RPL-P
 * vs a GPU-less bwrap sandbox running llvmpipe). No GPU is used here —
 * these are synthetic/injected timing inputs feeding the pure classifier.
 *
 * The defect this guards against: a future "optimisation" of the probe
 * (a cheaper shader, a nudged threshold) silently collapsing T0 and T1
 * back together, exactly like the originally-shipped 1-fetch blend
 * shader did (see the third test below) — a GPU-less machine would then
 * again be classified fully capable and handed the full 3D map.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyTier,
  summarizeSamples,
  pct,
  T0_MAX_MS_PER_MPX,
  T1_MAX_MS_PER_MPX,
  JANK_RATIO_DEMOTE,
  type ProbeMetrics,
} from '../capabilityProbe';

describe('pct', () => {
  it('returns the requested percentile from an unsorted sample set', () => {
    expect(pct([5, 1, 3, 2, 4], 0.5)).toBe(3);
  });

  it('handles empty input without throwing', () => {
    expect(pct([], 0.5)).toBe(0);
  });
});

describe('summarizeSamples', () => {
  it('normalizes p50 frame time by Mpx/frame into ms/Mpx', () => {
    const metrics = summarizeSamples([10, 10, 10], 5);
    expect(metrics.msPerMpx).toBeCloseTo(2, 5);
    expect(metrics.p50Ms).toBe(10);
  });
});

describe('classifyTier — the ALU-shader separation actually shipped', () => {
  // pc-map-unblock.md, "SETTLED. Final numbers." table, ALU-heavy row.
  const hardwareAlu: ProbeMetrics = { msPerMpx: 2.98, p50Ms: 6, p95Ms: 7, mpxPerFrame: 2.02 };
  const llvmpipeAlu: ProbeMetrics = { msPerMpx: 17.37, p50Ms: 35, p95Ms: 40, mpxPerFrame: 2.02 };

  it('classifies measured hardware as T0', () => {
    expect(classifyTier(hardwareAlu).tier).toBe('T0');
  });

  it('classifies measured llvmpipe (software rasteriser) as T1, not T0', () => {
    expect(classifyTier(llvmpipeAlu).tier).toBe('T1');
  });

  it('the two verdicts differ — the whole point of the ALU shader', () => {
    expect(classifyTier(hardwareAlu).tier).not.toBe(classifyTier(llvmpipeAlu).tier);
  });
});

describe('classifyTier — named regression: the rejected trivial shader', () => {
  it('documents why the original 1-fetch blend shader was replaced: it could not tell a GPU from no GPU at all', () => {
    // Measured with the REJECTED shader (40x overdraw, single texture
    // fetch, alpha blend) — kept here as a fixture, not a spec. It must
    // keep failing to separate; if it ever starts separating under
    // classifyTier, something about the thresholds drifted and needs
    // re-deriving against real hardware, not silent adjustment.
    const hardwareTrivial: ProbeMetrics = { msPerMpx: 0.198, p50Ms: 4, p95Ms: 4, mpxPerFrame: 20.152 };
    const llvmpipeTrivial: ProbeMetrics = { msPerMpx: 1.092, p50Ms: 22, p95Ms: 22, mpxPerFrame: 20.152 };
    expect(classifyTier(hardwareTrivial).tier).toBe('T0');
    expect(classifyTier(llvmpipeTrivial).tier).toBe('T0'); // <- the defect the ALU shader fixes
  });
});

describe('classifyTier — threshold boundaries', () => {
  const metricsFor = (msPerMpx: number): ProbeMetrics => ({
    msPerMpx,
    p50Ms: 10,
    p95Ms: 10,
    mpxPerFrame: 1,
  });

  it(`T0 at exactly the T0 boundary (${T0_MAX_MS_PER_MPX} ms/Mpx)`, () => {
    expect(classifyTier(metricsFor(T0_MAX_MS_PER_MPX)).tier).toBe('T0');
  });

  it('T1 just above the T0 boundary', () => {
    expect(classifyTier(metricsFor(T0_MAX_MS_PER_MPX + 0.01)).tier).toBe('T1');
  });

  it(`T1 at exactly the T1 boundary (${T1_MAX_MS_PER_MPX} ms/Mpx)`, () => {
    expect(classifyTier(metricsFor(T1_MAX_MS_PER_MPX)).tier).toBe('T1');
  });

  it('T2 just above the T1 boundary', () => {
    expect(classifyTier(metricsFor(T1_MAX_MS_PER_MPX + 0.01)).tier).toBe('T2');
  });
});

describe('classifyTier — jank bias (p95/p50)', () => {
  it(`demotes T0 -> T1 when p95/p50 exceeds ${JANK_RATIO_DEMOTE}`, () => {
    const metrics: ProbeMetrics = {
      msPerMpx: 1,
      p50Ms: 5,
      p95Ms: 5 * JANK_RATIO_DEMOTE + 1,
      mpxPerFrame: 1,
    };
    expect(classifyTier(metrics).tier).toBe('T1');
  });

  it('does not demote a stable, low-jank T0 result', () => {
    const metrics: ProbeMetrics = { msPerMpx: 1, p50Ms: 5, p95Ms: 6, mpxPerFrame: 1 };
    expect(classifyTier(metrics).tier).toBe('T0');
  });

  it('never demotes T2 further — it stays T2', () => {
    const metrics: ProbeMetrics = { msPerMpx: 100, p50Ms: 5, p95Ms: 50, mpxPerFrame: 1 };
    expect(classifyTier(metrics).tier).toBe('T2');
  });
});
