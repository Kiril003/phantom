/**
 * GPU capability probe — T0/T1/T2 classification.
 *
 * Ground truth this file ports (does not re-derive), from
 * `map-render-paths.md` §1c/§1d and `pc-map-unblock.md` Job 2:
 *
 *  - `WEBGL_debug_renderer_info` is worthless on this stack: WebKitGTK 2.52
 *    spoofs UNMASKED_RENDERER/VENDOR to "Apple GPU"/"Apple Inc." on real
 *    Intel/NVIDIA Linux hardware, identical for hardware and software
 *    rendering. String-sniffing cannot detect llvmpipe here — this probe
 *    is behavioural (real frame timing on a real draw) and never reads
 *    that extension.
 *  - The naive 40×-overdraw alpha-blended single-texture-fetch shader does
 *    NOT separate software from hardware rendering: measured hardware
 *    0.20 ms/Mpx vs measured llvmpipe 1.09 ms/Mpx — both comfortably
 *    inside a T0 bound of 4 ms/Mpx. A GPU-less machine would be classified
 *    fully capable and handed the full 3D map.
 *  - The ALU-heavy shader (24 dependent texture fetches per pixel) DOES
 *    separate correctly: measured hardware 2.98 ms/Mpx → T0, measured
 *    llvmpipe 17.37 ms/Mpx → T1. That is the shader below. Dependent
 *    texture fetches are the one shape of work llvmpipe cannot vectorise
 *    away, and are what a real vector-map style does constantly.
 *
 * `classifyTier` / `summarizeSamples` / `pct` are pure and unit-tested
 * (see `__tests__/capabilityProbe.test.ts`) — they are what guards against
 * a future "optimisation" silently collapsing T0 and T1 back together.
 * `runCapabilityProbe` touches a real WebGL2 context and is NOT exercised
 * by the test suite (jsdom has no WebGL2, and no discrete-GPU box was
 * available when this shipped — see the shipping report for what was and
 * was not verified on real hardware).
 */

export type RenderTier = 'T0' | 'T1' | 'T2';

export interface ProbeMetrics {
  /** p50 frame time, ms, normalized per megapixel drawn. The classifier's input. */
  msPerMpx: number;
  p50Ms: number;
  p95Ms: number;
  mpxPerFrame: number;
}

export interface ProbeResult {
  tier: RenderTier;
  /** Human/engineer-readable justification — English on purpose (never
   * shown to an operator, only devtools / debug surfaces). */
  reason: string;
  webgl2: boolean;
  metrics: ProbeMetrics | null;
  probedAt: number;
}

// Thresholds from map-render-paths.md §1d, calibrated on the ALU-heavy
// shader's measured numbers (hardware 2.98 → T0, llvmpipe 17.37 → T1).
export const T0_MAX_MS_PER_MPX = 4;
export const T1_MAX_MS_PER_MPX = 25;

/** p95/p50 above this is jank-prone even when the median looks fine — bias
 * one tier down rather than trust a lucky median (§1d signal 3: on the
 * software-composited paths measured 14 Aug, unthrottled/no-vsync frame
 * rates were themselves a degradation signal). */
export const JANK_RATIO_DEMOTE = 3;

/** Percentile of an unsorted sample array (nearest-rank, matches the
 * `pct()` helper in the validated harness — scratchpad/probe/*.html). */
export function pct(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export function summarizeSamples(frameMs: readonly number[], mpxPerFrame: number): ProbeMetrics {
  const p50Ms = pct(frameMs, 0.5);
  const p95Ms = pct(frameMs, 0.95);
  return {
    p50Ms,
    p95Ms,
    mpxPerFrame,
    msPerMpx: mpxPerFrame > 0 ? p50Ms / mpxPerFrame : Number.POSITIVE_INFINITY,
  };
}

/** Pure classification — the exact logic a future regression could silently
 * break. Never touches the DOM or a GPU. */
export function classifyTier(metrics: ProbeMetrics): { tier: RenderTier; reason: string } {
  let tier: RenderTier =
    metrics.msPerMpx <= T0_MAX_MS_PER_MPX
      ? 'T0'
      : metrics.msPerMpx <= T1_MAX_MS_PER_MPX
        ? 'T1'
        : 'T2';

  const jankRatio = metrics.p50Ms > 0 ? metrics.p95Ms / metrics.p50Ms : 1;
  let reason =
    `${metrics.msPerMpx.toFixed(2)} ms/Mpx ` +
    `(p50=${metrics.p50Ms.toFixed(2)}ms p95=${metrics.p95Ms.toFixed(2)}ms ` +
    `over ${metrics.mpxPerFrame.toFixed(2)} Mpx/frame)`;

  if (jankRatio > JANK_RATIO_DEMOTE && tier !== 'T2') {
    const demoted: RenderTier = tier === 'T0' ? 'T1' : 'T2';
    reason += `; jank p95/p50=${jankRatio.toFixed(2)} > ${JANK_RATIO_DEMOTE} -> demoted ${tier}->${demoted}`;
    tier = demoted;
  }
  return { tier, reason };
}

// ---------------------------------------------------------------------
// The actual browser probe. Needs a real WebGL2 context; see file header
// for what is and is not covered by tests.
// ---------------------------------------------------------------------

/** Matches the validated harness's canvas (the phantom-os section canvas
 * at 1024×600 minus StatusBar/FloatingToolbar — map-render-paths.md §1f). */
const PROBE_W = 1024;
const PROBE_H = 492;
/** Draws per measured frame — matches `scratchpad/probe/alu-4.html`. */
const OVERDRAW = 4;
const WARM_FRAMES = 3;
const MEASURE_FRAMES = 12;
/** Safety valve, not the expected cost: measured worst case (GPU-less
 * bwrap sandbox, 14 Aug) was ~525ms for WARM+MEASURE=15 frames; hardware
 * was ~90ms. 1500ms only fires for something slower than anything
 * measured so far, and guarantees the probe can never hang the UI. */
const HARD_TIMEOUT_MS = 1500;

const VERTEX_SHADER = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

/** 24 dependent texture fetches per pixel — the shape of work that
 * separates hardware from llvmpipe (see file header). Ported verbatim
 * from `scratchpad/probe/alu-4.html`. */
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D t; uniform float k;
void main(){
  vec3 c = vec3(0.); vec2 q = uv;
  for (int i = 0; i < 24; i++) {
    c += texture(t, q + k).rgb;
    q = fract(q * 1.017 + c.xy * 0.001 + 0.003);
  }
  o = vec4(c / 24., 0.06);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader failed');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log ?? 'shader compile failed');
  }
  return shader;
}

function nextFrame(cb: (t: number) => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
  return window.setTimeout(() => cb(performance.now()), 16);
}

function immediateResult(
  tier: RenderTier,
  reason: string,
  webgl2: boolean,
  probedAt: number,
): ProbeResult {
  return { tier, reason, webgl2, metrics: null, probedAt };
}

/**
 * Runs the ALU-heavy fill-rate probe on a detached canvas (created via
 * `document.createElement`, never appended to the DOM — functionally
 * offscreen, and known to work under WebKitGTK 2.52; the newer
 * `OffscreenCanvas` API was deliberately not used because its WebKitGTK
 * 2.52 support is unverified and the detached-canvas approach is exactly
 * what the validated harness used) and classifies the result.
 */
export async function runCapabilityProbe(): Promise<ProbeResult> {
  const probedAt = Date.now();

  let gl: WebGL2RenderingContext | null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = PROBE_W;
    canvas.height = PROBE_H;
    gl = canvas.getContext('webgl2', { antialias: false });
  } catch {
    gl = null;
  }

  if (!gl) {
    // Signal 1 of the design (map-render-paths.md §1d): no context at all
    // is an immediate, unambiguous T2 — no timing needed.
    return immediateResult('T2', 'no WebGL2 context', false, probedAt);
  }
  const glCtx: WebGL2RenderingContext = gl;

  try {
    const vs = compileShader(glCtx, glCtx.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compileShader(glCtx, glCtx.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = glCtx.createProgram();
    if (!program) throw new Error('createProgram failed');
    glCtx.attachShader(program, vs);
    glCtx.attachShader(program, fs);
    glCtx.linkProgram(program);
    if (!glCtx.getProgramParameter(program, glCtx.LINK_STATUS)) {
      throw new Error(glCtx.getProgramInfoLog(program) ?? 'program link failed');
    }
    glCtx.useProgram(program);

    const buf = glCtx.createBuffer();
    glCtx.bindBuffer(glCtx.ARRAY_BUFFER, buf);
    glCtx.bufferData(glCtx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), glCtx.STATIC_DRAW);
    const posLoc = glCtx.getAttribLocation(program, 'p');
    glCtx.enableVertexAttribArray(posLoc);
    glCtx.vertexAttribPointer(posLoc, 2, glCtx.FLOAT, false, 0, 0);

    const tex = glCtx.createTexture();
    glCtx.bindTexture(glCtx.TEXTURE_2D, tex);
    const px = new Uint8Array(512 * 512 * 4);
    for (let i = 0; i < px.length; i++) px[i] = (i * 7) & 255;
    glCtx.texImage2D(glCtx.TEXTURE_2D, 0, glCtx.RGBA, 512, 512, 0, glCtx.RGBA, glCtx.UNSIGNED_BYTE, px);
    glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MIN_FILTER, glCtx.LINEAR);
    glCtx.enable(glCtx.BLEND);
    glCtx.blendFunc(glCtx.SRC_ALPHA, glCtx.ONE_MINUS_SRC_ALPHA);

    const kLoc = glCtx.getUniformLocation(program, 'k');
    const readback = new Uint8Array(4);
    const mpxPerFrame = (OVERDRAW * PROBE_W * PROBE_H) / 1e6;
    const frameMs: number[] = [];

    return await new Promise<ProbeResult>((resolve) => {
      let settled = false;
      let frame = 0;

      const finish = (r: ProbeResult) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(r);
      };

      const timeoutId = window.setTimeout(() => {
        finish(immediateResult('T2', 'probe-timeout (hard budget exceeded)', true, probedAt));
      }, HARD_TIMEOUT_MS);

      const tick = () => {
        if (settled) return;
        const t0 = performance.now();
        for (let i = 0; i < OVERDRAW; i++) {
          glCtx.uniform1f(kLoc, (frame * OVERDRAW + i) * 0.001);
          glCtx.drawArrays(glCtx.TRIANGLES, 0, 3);
        }
        // Force completion + double as the anti-lie guard: a context that
        // silently drops draws (context-lost, zombie ANGLE device) would
        // otherwise time as "infinitely fast". Never trust "didn't throw".
        glCtx.readPixels(0, 0, 1, 1, glCtx.RGBA, glCtx.UNSIGNED_BYTE, readback);

        if (glCtx.isContextLost()) {
          finish(immediateResult('T2', 'context lost during probe', true, probedAt));
          return;
        }
        if (
          frame === 0 &&
          readback[0] === 0 &&
          readback[1] === 0 &&
          readback[2] === 0 &&
          readback[3] === 0
        ) {
          finish(immediateResult('T2', 'readback all-zero (draw did not happen)', true, probedAt));
          return;
        }

        const dt = performance.now() - t0;
        if (frame >= WARM_FRAMES) frameMs.push(dt);
        frame++;

        if (frame < WARM_FRAMES + MEASURE_FRAMES) {
          nextFrame(tick);
        } else {
          const metrics = summarizeSamples(frameMs, mpxPerFrame);
          const { tier, reason } = classifyTier(metrics);
          finish({ tier, reason, webgl2: true, metrics, probedAt });
        }
      };

      nextFrame(tick);
    });
  } catch (err) {
    return immediateResult(
      'T2',
      `probe exception: ${err instanceof Error ? err.message : String(err)}`,
      true,
      probedAt,
    );
  }
}
