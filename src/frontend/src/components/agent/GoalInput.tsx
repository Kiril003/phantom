import { useState } from 'react';
import { Send } from 'lucide-react';

interface Props {
  disabled: boolean;
  onSubmit: (goal: string) => Promise<void>;
}

export function GoalInput({ disabled, onSubmit }: Props) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col gap-2" data-testid="goal-input">
      <div className="flex gap-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
          }}
          placeholder="Tell PHANTOM what to do… (Ctrl+Enter to run)"
          disabled={disabled || busy}
          rows={3}
          className="flex-1 px-3 py-2 font-mono"
          style={{
            background: 'var(--glass-subtle)',
            border: '1px solid var(--glass-border)',
            borderRadius: 12,
            color: 'var(--ink-primary)',
            fontSize: 'var(--fs-sm)',
            resize: 'none',
            minHeight: 88,
            opacity: disabled ? 0.5 : 1,
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || busy || !value.trim()}
          className="flex items-center justify-center"
          style={{
            width: 64,
            minWidth: 64,
            borderRadius: 12,
            background: 'color-mix(in srgb, var(--accent) 16%, transparent)',
            color: 'var(--accent)',
            border: '1px solid color-mix(in srgb, var(--accent) 32%, transparent)',
            opacity: disabled || busy || !value.trim() ? 0.4 : 1,
            cursor: disabled || busy || !value.trim() ? 'not-allowed' : 'pointer',
          }}
          aria-label="Run goal"
        >
          <Send size={20} />
        </button>
      </div>
      {error && (
        <span style={{ color: 'var(--signal-alert)', fontSize: 'var(--fs-xs)' }}>{error}</span>
      )}
    </div>
  );
}
