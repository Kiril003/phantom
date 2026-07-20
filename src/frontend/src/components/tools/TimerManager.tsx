/**
 * Phase-5 R1 Task C — TimerManager.
 *
 * Operator-facing panel for the timer service:
 *   - Lists every active timer with a live countdown driven by the
 *     `ends_at` timestamp returned by GET /api/v1/tools/timer (no
 *     polling — one client-side `setInterval` ticks all rows).
 *   - "+ New" reveals an inline create form (label + duration via
 *     HH/MM/SS spinners + preset chips for 5m / 15m / 1h /
 *     Pomodoro 25m).
 *   - Per-row: cancel (POST /timer/{id}/cancel) and delete
 *     (DELETE /timer/{id}).
 *   - Empty-state explainer when zero timers.
 *
 * No mocks. The countdown comes from the server's wall-clock; clients
 * with skewed clocks see at most a few seconds drift.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '../../stores/authStore';
import { PhantomIcon } from '../core/PhantomIcon';

const API_PREFIX = '/api/v1';

interface ApiTimer {
  id: string;
  label: string;
  ends_at: string;
  fired: boolean;
}

async function fetchTimers(token: string): Promise<ApiTimer[]> {
  const res = await fetch(`${API_PREFIX}/tools/timer`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET /tools/timer ${res.status}`);
  const body = await res.json();
  return (body.timers ?? []) as ApiTimer[];
}

async function createTimer(token: string, label: string, durationS: number): Promise<void> {
  const res = await fetch(`${API_PREFIX}/tools/timer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, duration_s: durationS }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(typeof detail.detail === 'string' ? detail.detail : `create ${res.status}`);
  }
}

async function cancelTimer(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/tools/timer/${id}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`cancel ${res.status}`);
}

async function deleteTimer(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/tools/timer/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) throw new Error(`delete ${res.status}`);
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const PRESETS: Array<{ label: string; secs: number }> = [
  { label: '5m', secs: 300 },
  { label: '15m', secs: 900 },
  { label: '25m Pomodoro', secs: 1500 },
  { label: '1h', secs: 3600 },
];

export function TimerManager() {
  const token = useAuthStore((s) => s.token);
  const [timers, setTimers] = useState<ApiTimer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const list = await fetchTimers(token);
      // Filter out fired timers — those are history; keep `fired` on the
      // wire but render only active rows here. Fired list could move to
      // a separate "history" tab in a follow-up.
      setTimers(list.filter((t) => !t.fired));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }, [token]);

  useEffect(() => {
    void reload();
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [reload]);

  // Auto-reload when any timer crosses its deadline so the row drops
  // out of the active list cleanly. Throttled — once per natural tick.
  useEffect(() => {
    const expired = timers.some((t) => Date.parse(t.ends_at) <= now);
    if (expired) void reload();
  }, [now, timers, reload]);

  const onPreset = (secs: number) => {
    setShowNew(true);
    // Pre-fill label/duration via DOM event delegation? Keep simple:
    // pass through state via a key on the form.
    setPresetSeed({ label: `Timer ${formatRemaining(secs * 1000)}`, secs });
  };

  const [presetSeed, setPresetSeed] = useState<{ label: string; secs: number } | null>(null);

  const submitNew = async (label: string, secs: number) => {
    if (!token) return;
    setBusy(true);
    try {
      await createTimer(token, label, secs);
      setShowNew(false);
      setPresetSeed(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'create failed');
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async (id: string) => {
    if (!token) return;
    setBusy(true);
    try {
      await cancelTimer(token, id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'cancel failed');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!token) return;
    setBusy(true);
    try {
      await deleteTimer(token, id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass" style={{ padding: 16, borderRadius: 14, marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="eyebrow-amber">ТАЙМЕРИ</span>
        <button
          type="button"
          onClick={() => {
            setPresetSeed(null);
            setShowNew((v) => !v);
          }}
          style={{
            minHeight: 36,
            padding: '6px 12px',
            borderRadius: 10,
            border: '1px solid rgba(244,175,37,0.55)',
            background: showNew
              ? 'rgba(244,175,37,0.18)'
              : 'linear-gradient(135deg, var(--primary), var(--orange))',
            color: showNew ? '#8a5e0a' : '#fff',
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.04em',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <PhantomIcon name={showNew ? 'close' : 'add'} size={16} aria-hidden />
          {showNew ? 'Скасувати' : 'Новий'}
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onPreset(p.secs)}
            style={{
              padding: '4px 10px',
              borderRadius: 'var(--radius-pill)',
              background: 'rgba(255,255,255,0.55)',
              border: '1px solid rgba(0,0,0,0.06)',
              fontSize: 11,
              fontFamily: 'var(--font-display)',
              color: 'var(--ink-secondary)',
              cursor: 'pointer',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            marginBottom: 10,
            padding: '8px 10px',
            borderRadius: 8,
            background: 'rgba(239,68,68,0.10)',
            border: '1px solid rgba(239,68,68,0.32)',
            color: 'var(--coral-deep, #b9201f)',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      <AnimatePresence initial={false}>
        {showNew && (
          <motion.div
            key="new-form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            style={{ overflow: 'hidden' }}
          >
            <NewTimerForm
              key={presetSeed ? presetSeed.label + presetSeed.secs : 'fresh'}
              initialLabel={presetSeed?.label ?? ''}
              initialSeconds={presetSeed?.secs ?? 600}
              busy={busy}
              onSubmit={submitNew}
              onCancel={() => {
                setShowNew(false);
                setPresetSeed(null);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {timers.length === 0 && !showNew && (
        <div
          className="playfair"
          style={{
            padding: '14px 4px',
            color: 'var(--ink-muted)',
            fontStyle: 'italic',
            fontSize: 13,
          }}
        >
          Активних таймерів немає. Запусти один зверху — або скажи фантому: «Постав таймер 25 хвилин».
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {timers.map((t) => (
          <TimerRow
            key={t.id}
            timer={t}
            now={now}
            busy={busy}
            onCancel={() => void onCancel(t.id)}
            onDelete={() => void onDelete(t.id)}
          />
        ))}
      </div>
    </div>
  );
}

function TimerRow({
  timer,
  now,
  busy,
  onCancel,
  onDelete,
}: {
  timer: ApiTimer;
  now: number;
  busy: boolean;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const endsAtMs = useMemo(() => Date.parse(timer.ends_at), [timer.ends_at]);
  const remainingMs = endsAtMs - now;
  const expired = remainingMs <= 0;
  const tint = expired ? 'var(--coral, #ef4444)' : 'var(--primary, #f4af25)';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 12,
        background: 'rgba(255,255,255,0.55)',
        border: `1px solid ${expired ? 'rgba(239,68,68,0.32)' : 'rgba(244,175,37,0.32)'}`,
      }}
    >
      <PhantomIcon
        name={expired ? 'notifications_active' : 'timer'}
        size={22}
        color={tint}
        style={{ flexShrink: 0 }}
        aria-hidden
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--ink-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {timer.label}
        </div>
        <div
          className="tabular"
          style={{
            fontSize: 11,
            color: expired ? 'var(--coral-deep, #b9201f)' : 'var(--ink-secondary)',
            fontFamily: 'var(--font-mono)',
            marginTop: 2,
            fontWeight: 600,
          }}
        >
          {expired ? 'TIME UP' : formatRemaining(remainingMs)}
        </div>
      </div>
      <RowButton
        onClick={onCancel}
        icon="stop_circle"
        label="Скасувати"
        disabled={busy || expired}
      />
      <RowButton
        onClick={onDelete}
        icon="delete"
        label="Видалити"
        disabled={busy}
        tone="alert"
      />
    </div>
  );
}

function NewTimerForm({
  initialLabel,
  initialSeconds,
  busy,
  onSubmit,
  onCancel,
}: {
  initialLabel: string;
  initialSeconds: number;
  busy: boolean;
  onSubmit: (label: string, secs: number) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [hh, setHH] = useState(Math.floor(initialSeconds / 3600));
  const [mm, setMM] = useState(Math.floor((initialSeconds % 3600) / 60));
  const [ss, setSS] = useState(initialSeconds % 60);
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    setErr(null);
    const total = hh * 3600 + mm * 60 + ss;
    if (total <= 0) {
      setErr('Тривалість має бути більше нуля.');
      return;
    }
    if (total > 86400) {
      setErr('Максимум 24 години.');
      return;
    }
    onSubmit(label.trim() || 'Timer', total);
  };

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        background: 'rgba(255,255,255,0.45)',
        border: '1px solid rgba(0,0,0,0.06)',
        marginBottom: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Назва таймера"
        style={{
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid rgba(0,0,0,0.08)',
          background: 'rgba(255,255,255,0.7)',
          fontFamily: 'var(--font-display)',
          fontSize: 13,
          minHeight: 44,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <DurationStep label="год" value={hh} onChange={setHH} max={23} />
        <span style={{ color: 'var(--ink-muted)' }}>:</span>
        <DurationStep label="хв" value={mm} onChange={setMM} max={59} />
        <span style={{ color: 'var(--ink-muted)' }}>:</span>
        <DurationStep label="сек" value={ss} onChange={setSS} max={59} />
      </div>
      {err && (
        <div style={{ color: 'var(--coral-deep, #b9201f)', fontSize: 11 }}>{err}</div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{
            minWidth: 100,
            minHeight: 44,
            borderRadius: 10,
            border: '1px solid rgba(0,0,0,0.08)',
            background: 'rgba(255,255,255,0.6)',
            color: 'var(--ink-secondary)',
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            fontWeight: 600,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          Скасувати
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          style={{
            flex: 1,
            minHeight: 44,
            borderRadius: 10,
            border: '1px solid rgba(244,175,37,0.55)',
            background: busy
              ? 'rgba(244,175,37,0.18)'
              : 'linear-gradient(135deg, var(--primary), var(--orange))',
            color: busy ? 'var(--ink-muted)' : '#fff',
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.04em',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Створення…' : 'Запустити'}
        </button>
      </div>
    </div>
  );
}

function DurationStep({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => {
          const next = Math.min(max, Math.max(0, parseInt(e.target.value, 10) || 0));
          onChange(next);
        }}
        style={{
          width: 64,
          padding: '6px 8px',
          borderRadius: 8,
          border: '1px solid rgba(0,0,0,0.08)',
          background: 'rgba(255,255,255,0.7)',
          fontFamily: 'var(--font-mono)',
          fontSize: 16,
          textAlign: 'center',
          minHeight: 44,
        }}
      />
      <span className="micro-label" style={{ fontSize: 9 }}>{label}</span>
    </div>
  );
}

function RowButton({
  onClick,
  icon,
  label,
  disabled,
  tone = 'default',
}: {
  onClick: () => void;
  icon: string;
  label: string;
  disabled: boolean;
  tone?: 'default' | 'alert';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        width: 44,
        height: 44,
        borderRadius: 10,
        border: '1px solid rgba(0,0,0,0.06)',
        background: tone === 'alert' ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.6)',
        color: disabled
          ? 'var(--ink-muted)'
          : tone === 'alert'
            ? 'var(--coral, #ef4444)'
            : 'var(--ink-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <PhantomIcon name={icon} size={18} aria-hidden />
    </button>
  );
}
