// Phase 11b — AudioWorklet for always-on voice capture.
//
// Runs inside AudioWorkletGlobalScope, which does NOT support ES module
// imports in every browser, so this file is intentionally plain JS
// (no TypeScript, no imports, no framework sugar).
//
// Responsibilities:
//   * Consume the 128-frame Float32 blocks the Web Audio API hands to
//     `process()` (~2.67 ms at 48 kHz).
//   * Down-sample from the AudioContext rate (typically 44 100 or
//     48 000 Hz on consumer hardware) to the backend's 16 000 Hz
//     target with a simple linear-interpolation resampler.
//   * Convert Float32 [-1, 1] → Int16 little-endian PCM.
//   * Batch samples into ~30 ms chunks (480 samples @ 16 kHz =
//     960 bytes) and post them to the main thread via
//     port.postMessage with an ArrayBuffer transfer so the main
//     thread's WebSocket can forward them as binary frames with zero
//     copy.
//
// The worklet never signals silence — let the backend's Silero VAD
// do that. Our job is just to feed clean PCM upstream.

const TARGET_SAMPLE_RATE = 16000;
// 480 samples @ 16 kHz = 30 ms. Matches what the backend Silero VAD
// is tuned for: its native window is 512 samples @ 16 kHz, so 30 ms
// frames overlap cleanly across consecutive inferences.
const FRAME_SAMPLES = 480;

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Int16 ring buffer large enough to hold one outgoing frame.
    this._buffer = new Int16Array(FRAME_SAMPLES);
    this._bufferFilled = 0;
    // Fractional index into the current Float32 input block (for
    // linear-interpolation resample between consecutive blocks).
    this._resampleCursor = 0;
    this._resampleRatio = sampleRate / TARGET_SAMPLE_RATE;
    this._lastSample = 0;
    this._muted = false;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data && typeof data === 'object') {
        if (data.type === 'mute') {
          this._muted = true;
        } else if (data.type === 'unmute') {
          this._muted = false;
        }
      }
    };
  }

  _floatToInt16(sample) {
    const s = Math.max(-1, Math.min(1, sample));
    return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    // Mix to mono — take channel 0 and bail if it's absent. Two-mic
    // arrays (ReSpeaker) will still deliver a usable signal via the
    // first channel; upstream can switch to real beamforming later.
    const channel = input[0];
    if (!channel) return true;

    if (this._muted) {
      // Keep node alive but skip emit.
      return true;
    }

    // Linear interpolation resample. `this._lastSample` is the last
    // sample of the *previous* render block so the interpolation
    // crosses block boundaries smoothly.
    for (let i = 0; i < channel.length; ) {
      // Compute destination index for next target-rate sample.
      const nextSrcIdx = i + this._resampleRatio - this._resampleCursor;
      if (nextSrcIdx > channel.length - 1) {
        // Need more input samples — leftover interpolation state is
        // preserved in _resampleCursor and _lastSample.
        this._resampleCursor = nextSrcIdx - (channel.length - 1) - 1;
        this._lastSample = channel[channel.length - 1];
        break;
      }
      const srcIdx = nextSrcIdx;
      const floor = Math.floor(srcIdx);
      const frac = srcIdx - floor;
      const a = floor === 0 ? this._lastSample : channel[floor - 1];
      const b = channel[floor];
      const sample = a + (b - a) * frac;

      this._buffer[this._bufferFilled++] = this._floatToInt16(sample);

      if (this._bufferFilled >= FRAME_SAMPLES) {
        // Copy out so the next iteration can refill without aliasing
        // the transferred buffer.
        const out = new Int16Array(FRAME_SAMPLES);
        out.set(this._buffer);
        this.port.postMessage(out.buffer, [out.buffer]);
        this._bufferFilled = 0;
      }

      i = floor + 1;
      this._resampleCursor = 1 - frac;
    }

    return true;
  }
}

registerProcessor('voice-capture-processor', VoiceCaptureProcessor);
