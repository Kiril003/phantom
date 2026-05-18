/**
 * GoalInput — premium-warm goal/objective bar for the OPERATOR screen.
 *
 * Sunrise redesign (phase-5-R1-FE-OPERATOR-1).
 *
 * Behaviour:
 *   - Type a goal → press Enter (or Ctrl/Cmd+Enter from textarea) → calls
 *     onSubmit (which is wired to agentStore.startTask in OperatorLayout).
 *   - Voice mic → uses the existing `useVoiceRecorder` hook to capture
 *     audio and POSTs it to `/api/voice/transcribe` so the resulting text
 *     fills the input. Operator hits Run to submit. No new BE wiring,
 *     no plumbing changes — just reuses voiceApi.transcribe.
 *   - Reduced-motion safe; touch targets ≥ 44 px (mic & Run button).
 */
import { useState, useRef } from 'react';
import { ArrowRight, Mic, MicOff, Loader2 } from 'lucide-react';
import { useVoiceRecorder } from '../../../hooks/useVoiceRecorder';
import { voiceApi } from '../../../services/voiceApi';

interface Props {
  disabled: boolean;
  onSubmit: (goal: string) => Promise<void>;
}

export function GoalInput({ disabled, onSubmit }: Props) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const recorder = useVoiceRecorder();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = async () => {
    const goal = value.trim();
    if (!goal || busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(goal);
      setValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to start task');
    } finally {
      setBusy(false);
    }
  };

  const onMicPress = async () => {
    setError(null);
    if (recorder.state === 'recording') {
      // Stop and transcribe.
      try {
        const blob = await recorder.stop();
        if (!blob) return;
        setTranscribing(true);
        const result = await voiceApi.transcribe(blob);
        const text = (result?.text ?? '').trim();
        if (text) {
          setValue((prev) => (prev ? `${prev.trimEnd()} ${text}` : text));
          textareaRef.current?.focus();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'mic capture failed');
      } finally {
        setTranscribing(false);
      }
      return;
    }
    if (recorder.state === 'idle') {
      try {
        await recorder.start();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'mic permission denied');
      }
    }
  };

  const recording = recorder.state === 'recording' || recorder.state === 'requesting';
  const micDisabled = disabled || busy || transcribing;

  return (
    <div className="flex flex-col gap-2" data-testid="goal-input">
      <div
        className="flex items-center gap-2 px-2 py-2"
        style={{
          background: 'var(--glass-elevated, rgba(255,255,255,0.78))',
          border: '1px solid var(--glass-border-hover, rgba(255,255,255,0.75))',
          borderRadius: 14,
          boxShadow: 'var(--shadow-md, 0 4px 14px rgba(120,70,10,0.10))',
          minHeight: 60,
        }}
      >
        {/* Mic button — touch ≥ 44 */}
        <button
          type="button"
          onClick={onMicPress}
          disabled={micDisabled}
          aria-label={recording ? 'Stop voice capture' : 'Start voice capture'}
          aria-pressed={recording}
          className="flex items-center justify-center"
          style={{
            width: 44,
            height: 44,
            minWidth: 44,
            minHeight: 44,
            borderRadius: 12,
            background: recording
              ? 'color-mix(in srgb, var(--signal-alert, #ef4444) 22%, transparent)'
              : 'color-mix(in srgb, var(--primary, #f4af25) 18%, transparent)',
            border: `1px solid color-mix(in srgb, ${recording ? 'var(--signal-alert, #ef4444)' : 'var(--primary, #f4af25)'} 40%, transparent)`,
            color: recording
              ? 'var(--signal-alert, #ef4444)'
              : 'var(--primary-shadow, #8a5e0a)',
            cursor: micDisabled ? 'not-allowed' : 'pointer',
            opacity: micDisabled ? 0.5 : 1,
            flexShrink: 0,
            transition: 'background 200ms ease, border-color 200ms ease',
          }}
        >
          {transcribing ? (
            <Loader2 size={18} className="animate-spin" />
          ) : recording ? (
            <MicOff size={18} strokeWidth={2} />
          ) : (
            <Mic size={18} strokeWidth={2} />
          )}
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            recording
              ? 'Listening… tap mic again to transcribe'
              : 'Tell PHANTOM what to do…'
          }
          disabled={disabled || busy}
          rows={1}
          className="flex-1 px-2 py-1"
          style={{
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--ink-primary)',
            fontSize: 'var(--fs-sm)',
            fontFamily: 'var(--font-display)',
            resize: 'none',
            minHeight: 36,
            maxHeight: 96,
            lineHeight: 1.4,
            opacity: disabled ? 0.5 : 1,
          }}
          data-testid="goal-input-textarea"
        />

        {/* Hint chip — keyboard shortcut */}
        <span
          className="font-mono hidden sm:inline-flex"
          style={{
            fontSize: 'var(--fs-xxs, 11px)',
            color: 'var(--ink-muted)',
            padding: '3px 8px',
            borderRadius: 6,
            background: 'rgba(0,0,0,0.05)',
            flexShrink: 0,
          }}
        >
          ↵ run
        </span>

        {/* Run button — touch ≥ 44 */}
        <button
          type="button"
          onClick={submit}
          disabled={disabled || busy || !value.trim()}
          aria-label="Run goal"
          className="flex items-center justify-center gap-1.5"
          style={{
            height: 44,
            minHeight: 44,
            minWidth: 96,
            padding: '0 18px',
            borderRadius: 12,
            background:
              disabled || busy || !value.trim()
                ? 'rgba(0,0,0,0.06)'
                : 'linear-gradient(135deg, var(--primary, #f4af25), var(--orange, #fb923c))',
            color:
              disabled || busy || !value.trim() ? 'var(--ink-muted)' : '#ffffff',
            border: 'none',
            fontSize: 'var(--fs-xs)',
            fontWeight: 700,
            letterSpacing: 'var(--tracking-wider)',
            cursor:
              disabled || busy || !value.trim() ? 'not-allowed' : 'pointer',
            boxShadow:
              disabled || busy || !value.trim()
                ? 'none'
                : '0 4px 12px color-mix(in srgb, var(--primary, #f4af25) 40%, transparent)',
            flexShrink: 0,
            transition: 'box-shadow 200ms ease',
          }}
          data-testid="goal-input-run"
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <>
              <span>RUN</span>
              <ArrowRight size={14} strokeWidth={2.2} />
            </>
          )}
        </button>
      </div>

      {(error || recorder.error) && (
        <span
          className="font-mono"
          style={{
            color: 'var(--signal-alert, #ef4444)',
            fontSize: 'var(--fs-xxs, 11px)',
            paddingLeft: 12,
          }}
        >
          {error ?? recorder.error}
        </span>
      )}
    </div>
  );
}
