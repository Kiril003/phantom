/** Ключі — те, чим корпорація дихає. Досі вони були у знімку, у типах і навіть
 * у 3D як реактори, але жодного екрана не мали: коли ключ вичерпувався, місто
 * гальмувало без пояснень. Тут видно, який саме ключ і коли повернеться. */
import { useEffect, useState } from 'react';
import { usePolisStore } from '../../../stores/polisStore';
import type { ManagedKeyPublic, ManagedKeyState } from '@shared/types';

const STATE_LABEL: Record<ManagedKeyState, string> = {
  active: 'у роботі',
  cooling: 'холоне',
  exhausted: 'вичерпано',
  invalid: 'недійсний',
  disabled: 'вимкнено',
};

const STATE_VAR: Record<ManagedKeyState, string> = {
  active: '--signal-ok',
  cooling: '--signal-warn',
  exhausted: '--signal-alert',
  invalid: '--signal-alert',
  disabled: '--ink-faint',
};

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} млн`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} тис`;
  return String(n);
}

/** Скільки лишилось холонути — рахуємо від тіку, бо cooldown збігає сам. */
function useCountdown(until?: number): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!until) {
      setLeft(null);
      return;
    }
    const tick = () => setLeft(Math.max(0, Math.round(until - Date.now() / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [until]);
  return left;
}

function KeyCard({ k }: { k: ManagedKeyPublic }) {
  const left = useCountdown(k.cooldown_until);
  const tint = `var(${STATE_VAR[k.state]})`;
  const load = k.metrics.requests_1h;

  return (
    <div
      className="rounded-2xl px-3 py-2.5"
      style={{ background: 'var(--glass-subtle)', border: '1px solid var(--glass-border)' }}
      data-testid={`key-${k.id}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${k.state === 'active' ? 'animate-pulse' : ''}`}
          style={{ background: tint, boxShadow: `0 0 8px ${tint}` }}
        />
        <span
          className="truncate min-w-0"
          style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}
        >
          {k.label}
        </span>
        <span className="font-mono shrink-0" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
          {k.provider}
        </span>
        <div className="flex-1" />
        <span className="font-mono shrink-0" style={{ fontSize: 10, color: tint }}>
          {STATE_LABEL[k.state]}
          {left !== null && left > 0 ? ` · ${left} с` : ''}
        </span>
      </div>

      <div
        className="grid grid-cols-4 gap-2 mt-2 font-mono"
        style={{ fontSize: 9, color: 'var(--ink-muted)' }}
      >
        <div>
          <div style={{ color: 'var(--ink-faint)' }}>за хв</div>
          <div style={{ color: 'var(--ink-secondary)' }}>{k.metrics.requests_1m}</div>
        </div>
        <div>
          <div style={{ color: 'var(--ink-faint)' }}>за год</div>
          <div style={{ color: 'var(--ink-secondary)' }}>{load}</div>
        </div>
        <div>
          <div style={{ color: 'var(--ink-faint)' }}>токени 24г</div>
          <div style={{ color: 'var(--ink-secondary)' }}>{compact(k.metrics.tokens_24h)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--ink-faint)' }}>зриви 24г</div>
          <div
            style={{
              color: k.metrics.failures_24h > 0 ? 'var(--signal-alert)' : 'var(--ink-secondary)',
            }}
          >
            {k.metrics.failures_24h}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <span className="font-mono" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>
          пріоритет {k.priority} · {k.key_hint}
        </span>
      </div>
    </div>
  );
}

export function KeysPanel() {
  const keys = usePolisStore((s) => s.keys);
  const refreshKeys = usePolisStore((s) => s.refreshKeys);

  useEffect(() => {
    void refreshKeys();
  }, [refreshKeys]);

  const active = keys.filter((k) => k.state === 'active').length;
  const down = keys.filter((k) => k.state === 'exhausted' || k.state === 'invalid').length;

  return (
    <div className="h-full flex flex-col min-h-0" data-testid="keys-panel">
      <header
        className="shrink-0 flex items-center gap-2 px-4 h-[42px]"
        style={{ borderBottom: '1px solid var(--glass-border)' }}
      >
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}>Ключі</span>
        <span className="font-mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}>
          {active} у роботі
          {down > 0 ? ` · ${down} лежить` : ''}
        </span>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {keys.length === 0 && (
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-muted)' }}>
            Ключів не видно. Місто працює на тому, що дав бекенд.
          </p>
        )}
        {[...keys]
          // спершу те, що болить: лежачі й холонучі — угорі
          .sort((a, b) => {
            const rank = (s: ManagedKeyState) =>
              s === 'exhausted' || s === 'invalid' ? 0 : s === 'cooling' ? 1 : 2;
            return rank(a.state) - rank(b.state) || a.priority - b.priority;
          })
          .map((k) => (
            <KeyCard key={k.id} k={k} />
          ))}
      </div>
    </div>
  );
}
