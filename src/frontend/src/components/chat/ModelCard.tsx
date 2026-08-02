/**
 * Day-4 Wave-2 W-3 — ModelCard echo.
 *
 * Compact badge above the chat input that names the active AI provider
 * + STT engine the next message will route through. The user sees
 * "gemini · whisper" before they hit Send — no surprise about which
 * stack handles their query.
 *
 * Day-4 reads from the existing `context.system` snapshot (already
 * driven by `/ws/context` and the systemStore). When Z-1 (AI Hub
 * routing) lands the badge will display the *resolved* provider for
 * the next-turn locality decision rather than the static config
 * default.
 */
import { Sparkles, Mic } from 'lucide-react';

export interface ModelCardProps {
  /** Active AI provider; `null` shows the dash placeholder. */
  provider: string | null | undefined;
  /** Active STT engine; `null` hides the chip altogether. */
  sttEngine?: string | null;
  /** Optional wall-clock or context-token overlay (e.g. "ctx 2.4k tok"). */
  overlay?: string;
}

const PROVIDER_DOT = (provider: string | null | undefined): string => {
  switch (provider) {
    case 'gemini':
      return 'var(--signal-info)';
    case 'ollama':
      return 'var(--signal-ok)';
    default:
      return 'var(--ink-muted)';
  }
};

/**
 * Назва рушія розпізнавання нічого не каже власникові пристрою — важливо,
 * чи слух точний, чи швидкий. Тут стояло сире «whisper».
 */
function sttLabel(engine: string): string {
  const key = engine.toLowerCase();
  if (key.includes('whisper')) return 'точний слух';
  if (key.includes('vosk')) return 'швидкий слух';
  return engine;
}

export function ModelCard({ provider, sttEngine, overlay }: ModelCardProps) {
  return (
    <div
      className="flex items-center gap-2"
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--fs-micro)',
        color: 'var(--ink-muted)',
        letterSpacing: 'var(--tracking-wide)',
      }}
      aria-label="Активна модель"
      data-testid="model-card"
      data-provider={provider ?? 'unknown'}
      data-stt={sttEngine ?? 'none'}
    >
      <span className="inline-flex items-center gap-1">
        <Sparkles size={11} strokeWidth={1.75} color="var(--accent)" aria-hidden />
        <span
          aria-hidden
          className="block rounded-full"
          style={{
            width: 6,
            height: 6,
            background: PROVIDER_DOT(provider),
          }}
        />
        <span style={{ color: 'var(--ink-secondary)' }} className="capitalize">
          {provider ?? '—'}
        </span>
      </span>
      {sttEngine && (
        <span className="inline-flex items-center gap-1">
          <Mic size={10} strokeWidth={1.75} aria-hidden />
          <span style={{ color: 'var(--ink-secondary)' }}>{sttLabel(sttEngine)}</span>
        </span>
      )}
      {overlay && (
        <span style={{ color: 'var(--ink-muted)' }}>{overlay}</span>
      )}
    </div>
  );
}
