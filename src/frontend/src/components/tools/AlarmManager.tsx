/**
 * Phase-5 R1 Task C-bonus — AlarmManager.
 *
 * Operator panel for HH:MM alarms (daily / weekdays / once). Wraps the
 * existing GET /tools/alarm + new POST /tools/alarm + new
 * PUT /tools/alarm/{id}/active + DELETE /tools/alarm/{id} added in
 * the Task C backend pass.
 */
import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '../../stores/authStore';

const API_PREFIX = '/api/v1';

type RepeatMode = 'once' | 'daily' | 'weekdays';

interface ApiAlarm {
  id: string;
  label: string;
  time: string; // HH:MM
  repeat: RepeatMode;
  active: boolean;
}

const REPEAT_LABEL: Record<RepeatMode, string> = {
  once: 'один раз',
  daily: 'щодня',
  weekdays: 'будні',
};

async function fetchAlarms(token: string): Promise<ApiAlarm[]> {
  const res = await fetch(`${API_PREFIX}/tools/alarm`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET alarm ${res.status}`);
  const body = await res.json();
  return body.alarms as ApiAlarm[];
}

async function createAlarm(
  token: string,
  body: { time: string; repeat: RepeatMode; label: string },
): Promise<void> {
  const res = await fetch(`${API_PREFIX}/tools/alarm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(typeof detail.detail === 'string' ? detail.detail : `create ${res.status}`);
  }
}

async function setActive(token: string, id: string, active: boolean): Promise<void> {
  const res = await fetch(`${API_PREFIX}/tools/alarm/${id}/active`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ active }),
  });
  if (!res.ok) throw new Error(`active ${res.status}`);
}

async function deleteAlarm(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/tools/alarm/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) throw new Error(`delete ${res.status}`);
}

export function AlarmManager() {
  const token = useAuthStore((s) => s.token);
  const [alarms, setAlarms] = useState<ApiAlarm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const list = await fetchAlarms(token);
      setAlarms(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }, [token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submitNew = async (body: { time: string; repeat: RepeatMode; label: string }) => {
    if (!token) return;
    setBusy(true);
    try {
      await createAlarm(token, body);
      setShowNew(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'create failed');
    } finally {
      setBusy(false);
    }
  };

  const onToggle = async (a: ApiAlarm) => {
    if (!token) return;
    setBusy(true);
    try {
      await setActive(token, a.id, !a.active);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'toggle failed');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (a: ApiAlarm) => {
    if (!token) return;
    setBusy(true);
    try {
      await deleteAlarm(token, a.id);
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
        <span className="eyebrow-amber">БУДИЛЬНИКИ</span>
        <button
          type="button"
          onClick={() => setShowNew((v) => !v)}
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
          <span className="msym" aria-hidden style={{ fontSize: 16 }}>
            {showNew ? 'close' : 'add'}
          </span>
          {showNew ? 'Скасувати' : 'Новий'}
        </button>
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
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            style={{ overflow: 'hidden' }}
          >
            <NewAlarmForm busy={busy} onSubmit={submitNew} onCancel={() => setShowNew(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {alarms.length === 0 && !showNew && (
        <div
          className="playfair"
          style={{
            padding: '14px 4px',
            color: 'var(--ink-muted)',
            fontStyle: 'italic',
            fontSize: 13,
          }}
        >
          Будильників немає. Додай новий — або скажи: «Розбуди мене о 7:30».
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: showNew ? 10 : 0 }}>
        {alarms.map((a) => (
          <AlarmRow
            key={a.id}
            alarm={a}
            busy={busy}
            onToggle={() => void onToggle(a)}
            onDelete={() => void onDelete(a)}
          />
        ))}
      </div>
    </div>
  );
}

function AlarmRow({
  alarm,
  busy,
  onToggle,
  onDelete,
}: {
  alarm: ApiAlarm;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 12,
        background: alarm.active ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.03)',
        border: `1px solid ${alarm.active ? 'rgba(244,175,37,0.32)' : 'rgba(0,0,0,0.06)'}`,
        opacity: alarm.active ? 1 : 0.55,
      }}
    >
      <span
        className="msym"
        aria-hidden
        style={{
          fontSize: 22,
          color: alarm.active ? 'var(--primary, #f4af25)' : 'var(--ink-muted)',
        }}
      >
        alarm
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="tabular"
          style={{
            fontSize: 18,
            fontWeight: 600,
            fontFamily: 'var(--font-mono)',
            color: 'var(--ink-primary)',
          }}
        >
          {alarm.time}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>
          {alarm.label || '—'} · {REPEAT_LABEL[alarm.repeat]}
        </div>
      </div>
      <Toggle on={alarm.active} disabled={busy} onClick={onToggle} />
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        aria-label="Видалити"
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          border: '1px solid rgba(0,0,0,0.06)',
          background: 'rgba(239,68,68,0.08)',
          color: 'var(--coral, #ef4444)',
          cursor: busy ? 'not-allowed' : 'pointer',
        }}
      >
        <span className="msym" aria-hidden style={{ fontSize: 18 }}>delete</span>
      </button>
    </div>
  );
}

function Toggle({
  on,
  disabled,
  onClick,
}: {
  on: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      style={{
        width: 50,
        height: 28,
        borderRadius: 14,
        border: '1px solid rgba(0,0,0,0.06)',
        background: on ? 'linear-gradient(90deg, var(--primary), var(--orange))' : 'rgba(0,0,0,0.08)',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 200ms',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 24 : 2,
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'left 200ms',
        }}
      />
    </button>
  );
}

function NewAlarmForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (b: { time: string; repeat: RepeatMode; label: string }) => void;
  onCancel: () => void;
}) {
  const [time, setTime] = useState('07:30');
  const [repeat, setRepeat] = useState<RepeatMode>('weekdays');
  const [label, setLabel] = useState('');

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
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        style={{
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid rgba(0,0,0,0.08)',
          background: 'rgba(255,255,255,0.7)',
          fontFamily: 'var(--font-mono)',
          fontSize: 24,
          textAlign: 'center',
          minHeight: 56,
          fontWeight: 600,
        }}
      />
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Назва (необов'язково)"
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
      <div style={{ display: 'flex', gap: 6 }}>
        {(['once', 'daily', 'weekdays'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setRepeat(m)}
            aria-pressed={repeat === m}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 10,
              border: repeat === m
                ? '1px solid rgba(244,175,37,0.55)'
                : '1px solid rgba(0,0,0,0.08)',
              background: repeat === m
                ? 'linear-gradient(135deg, rgba(244,175,37,0.18), rgba(251,146,60,0.14))'
                : 'rgba(255,255,255,0.55)',
              color: repeat === m ? '#8a5e0a' : 'var(--ink-secondary)',
              fontFamily: 'var(--font-display)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {REPEAT_LABEL[m]}
          </button>
        ))}
      </div>
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
          onClick={() => onSubmit({ time, repeat, label })}
          disabled={busy}
          style={{
            flex: 1,
            minHeight: 44,
            borderRadius: 10,
            border: '1px solid rgba(244,175,37,0.55)',
            background: busy ? 'rgba(244,175,37,0.18)' : 'linear-gradient(135deg, var(--primary), var(--orange))',
            color: busy ? 'var(--ink-muted)' : '#fff',
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.04em',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Створення…' : 'Створити'}
        </button>
      </div>
    </div>
  );
}
