/**
 * Phase-5 R1 Task B — CalendarManager.
 *
 * Operator-facing month-grid calendar talking to the existing
 * `tools/calendar/events` REST surface. Recurrence is intentionally
 * NOT modelled in this first pass — the backend schema doesn't carry
 * an RRULE column yet (it's a phase-X follow-up). For now: one-off
 * events with start/end, all-day flag, optional description + location.
 *
 * Layout — 1024×600 strict:
 *   - Header row: month label + prev/next + "+ New event"
 *   - Weekday strip (Mon..Sun, Ukrainian locale)
 *   - 6×7 day grid; each cell shows up to 2 event chips + overflow
 *     counter. Tap a day → side panel with all events for that day +
 *     per-event edit/delete.
 *   - "+ New event" + day-tap (without an existing event) opens
 *     `EventEditor` modal.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '../../stores/authStore';

const API_PREFIX = '/api/v1';

interface ApiEvent {
  id: string;
  title: string;
  description: string;
  start_at: string; // ISO
  end_at: string;
  all_day: boolean;
  location: string | null;
}

async function fetchEvents(token: string): Promise<ApiEvent[]> {
  const res = await fetch(`${API_PREFIX}/tools/calendar`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET calendar ${res.status}`);
  const body = await res.json();
  return body.events as ApiEvent[];
}

async function createEvent(token: string, body: NewEventBody): Promise<void> {
  const res = await fetch(`${API_PREFIX}/tools/calendar/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(typeof detail.detail === 'string' ? detail.detail : `create ${res.status}`);
  }
}

async function updateEvent(token: string, id: string, body: Partial<NewEventBody>): Promise<void> {
  const res = await fetch(`${API_PREFIX}/tools/calendar/events/${id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`update ${res.status}`);
}

async function deleteEvent(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/tools/calendar/events/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) throw new Error(`delete ${res.status}`);
}

interface NewEventBody {
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'] as const;
const MONTHS = [
  'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень',
] as const;

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function buildMonthGrid(anchor: Date): Date[] {
  const first = startOfMonth(anchor);
  // weekday: 0 (Sun) .. 6 (Sat). Ukrainian week starts Mon → shift.
  const weekday = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - weekday);
  const grid: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    grid.push(d);
  }
  return grid;
}

export function CalendarManager() {
  const token = useAuthStore((s) => s.token);
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [editing, setEditing] = useState<ApiEvent | null>(null);
  const [creating, setCreating] = useState<{ start: Date } | null>(null);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const list = await fetchEvents(token);
      setEvents(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }, [token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const grid = useMemo(() => buildMonthGrid(anchor), [anchor]);

  const eventsByDay = useMemo(() => {
    const m = new Map<string, ApiEvent[]>();
    for (const e of events) {
      const start = new Date(e.start_at);
      const k = dateKey(start);
      const arr = m.get(k) ?? [];
      arr.push(e);
      m.set(k, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.start_at.localeCompare(b.start_at));
    }
    return m;
  }, [events]);

  const eventsForSelected = selectedDay
    ? eventsByDay.get(dateKey(selectedDay)) ?? []
    : [];

  const goPrev = () => {
    const d = new Date(anchor);
    d.setMonth(anchor.getMonth() - 1);
    setAnchor(d);
  };
  const goNext = () => {
    const d = new Date(anchor);
    d.setMonth(anchor.getMonth() + 1);
    setAnchor(d);
  };
  const goToday = () => {
    setAnchor(new Date());
    setSelectedDay(new Date());
  };

  const onSubmitNew = async (b: NewEventBody) => {
    if (!token) return;
    await createEvent(token, b);
    setCreating(null);
    await reload();
  };
  const onSubmitEdit = async (b: NewEventBody) => {
    if (!token || !editing) return;
    await updateEvent(token, editing.id, b);
    setEditing(null);
    await reload();
  };
  const onDelete = async (id: string) => {
    if (!token) return;
    await deleteEvent(token, id);
    setEditing(null);
    await reload();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      <Header
        anchor={anchor}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
        onNew={() => setCreating({ start: selectedDay ?? new Date() })}
      />
      {error && (
        <div
          role="alert"
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.32)',
            color: 'var(--coral-deep, #b9201f)',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 14, minHeight: 420 }}>
        <MonthGrid
          anchor={anchor}
          grid={grid}
          eventsByDay={eventsByDay}
          selectedDay={selectedDay}
          onPickDay={(d) => setSelectedDay(d)}
        />
        <DayPanel
          day={selectedDay}
          events={eventsForSelected}
          onCreate={() => setCreating({ start: selectedDay ?? new Date() })}
          onEdit={(e) => setEditing(e)}
        />
      </div>

      <AnimatePresence>
        {creating && (
          <EventEditor
            mode="create"
            initial={{
              title: '',
              description: '',
              start_at: floorHour(creating.start).toISOString(),
              end_at: addHour(creating.start, 1).toISOString(),
              all_day: false,
              location: null,
            }}
            onClose={() => setCreating(null)}
            onSubmit={onSubmitNew}
          />
        )}
        {editing && (
          <EventEditor
            mode="edit"
            initial={{
              title: editing.title,
              description: editing.description,
              start_at: editing.start_at,
              end_at: editing.end_at,
              all_day: editing.all_day,
              location: editing.location,
            }}
            onClose={() => setEditing(null)}
            onSubmit={onSubmitEdit}
            onDelete={() => onDelete(editing.id)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function floorHour(d: Date): Date {
  const out = new Date(d);
  out.setMinutes(0, 0, 0);
  return out;
}
function addHour(d: Date, h: number): Date {
  const out = new Date(d);
  out.setHours(out.getHours() + h);
  return out;
}

/* ─────────────────────────────────────────── Header ── */

function Header({
  anchor,
  onPrev,
  onNext,
  onToday,
  onNew,
}: {
  anchor: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onNew: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="eyebrow-amber">КАЛЕНДАР</span>
        <h2
          className="playfair"
          style={{ fontSize: 24, color: 'var(--ink-primary)', margin: 0, fontWeight: 500 }}
        >
          {MONTHS[anchor.getMonth()]} {anchor.getFullYear()}
        </h2>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <NavButton icon="chevron_left" label="Попередній місяць" onClick={onPrev} />
        <button
          type="button"
          onClick={onToday}
          style={{
            minHeight: 44,
            padding: '0 14px',
            borderRadius: 10,
            border: '1px solid rgba(0,0,0,0.06)',
            background: 'rgba(255,255,255,0.6)',
            color: 'var(--ink-secondary)',
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Сьогодні
        </button>
        <NavButton icon="chevron_right" label="Наступний місяць" onClick={onNext} />
        <button
          type="button"
          onClick={onNew}
          style={{
            minHeight: 44,
            padding: '0 14px',
            borderRadius: 10,
            border: '1px solid rgba(244,175,37,0.55)',
            background: 'linear-gradient(135deg, var(--primary), var(--orange))',
            color: '#fff',
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
          <span className="msym" aria-hidden style={{ fontSize: 16 }}>add</span>
          Подія
        </button>
      </div>
    </div>
  );
}

function NavButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        width: 44,
        height: 44,
        borderRadius: 10,
        border: '1px solid rgba(0,0,0,0.06)',
        background: 'rgba(255,255,255,0.6)',
        color: 'var(--ink-secondary)',
        cursor: 'pointer',
      }}
    >
      <span className="msym" aria-hidden style={{ fontSize: 20 }}>{icon}</span>
    </button>
  );
}

/* ─────────────────────────────────────────── MonthGrid ── */

function MonthGrid({
  anchor,
  grid,
  eventsByDay,
  selectedDay,
  onPickDay,
}: {
  anchor: Date;
  grid: Date[];
  eventsByDay: Map<string, ApiEvent[]>;
  selectedDay: Date | null;
  onPickDay: (d: Date) => void;
}) {
  const todayKey = dateKey(new Date());
  return (
    <div className="glass" style={{ padding: 12, borderRadius: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 }}>
        {WEEKDAYS.map((d, i) => (
          <div
            key={d}
            className="micro-label"
            style={{ textAlign: 'center', fontSize: 9, color: i >= 5 ? 'var(--coral, #ef4444)' : 'var(--ink-muted)' }}
          >
            {d}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {grid.map((d) => {
          const k = dateKey(d);
          const inMonth = d.getMonth() === anchor.getMonth();
          const isToday = k === todayKey;
          const isSelected = selectedDay && k === dateKey(selectedDay);
          const dayEvents = eventsByDay.get(k) ?? [];
          return (
            <button
              key={k}
              type="button"
              onClick={() => onPickDay(d)}
              style={{
                minHeight: 56,
                padding: '4px 6px',
                borderRadius: 8,
                background: isSelected
                  ? 'linear-gradient(135deg, rgba(244,175,37,0.18), rgba(251,146,60,0.14))'
                  : isToday
                    ? 'rgba(244,175,37,0.08)'
                    : 'rgba(255,255,255,0.42)',
                border: isSelected
                  ? '1px solid rgba(244,175,37,0.55)'
                  : isToday
                    ? '1px solid rgba(244,175,37,0.32)'
                    : '1px solid rgba(0,0,0,0.04)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 3,
                opacity: inMonth ? 1 : 0.45,
                fontFamily: 'var(--font-display)',
              }}
            >
              <span
                className="tabular"
                style={{
                  fontSize: 12,
                  fontWeight: isToday ? 700 : 500,
                  color: isToday ? '#8a5e0a' : 'var(--ink-primary)',
                }}
              >
                {d.getDate()}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, width: '100%' }}>
                {dayEvents.slice(0, 2).map((e) => (
                  <span
                    key={e.id}
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      color: '#fff',
                      background: e.all_day
                        ? 'linear-gradient(90deg, var(--orange), var(--coral, #ef4444))'
                        : 'linear-gradient(90deg, var(--primary), var(--orange))',
                      borderRadius: 4,
                      padding: '1px 4px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      textAlign: 'left',
                    }}
                  >
                    {e.title}
                  </span>
                ))}
                {dayEvents.length > 2 && (
                  <span style={{ fontSize: 9, color: 'var(--ink-muted)' }}>
                    +{dayEvents.length - 2} ще
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────── DayPanel ── */

function DayPanel({
  day,
  events,
  onCreate,
  onEdit,
}: {
  day: Date | null;
  events: ApiEvent[];
  onCreate: () => void;
  onEdit: (e: ApiEvent) => void;
}) {
  if (!day) {
    return (
      <div
        className="glass"
        style={{
          padding: 16,
          borderRadius: 14,
          color: 'var(--ink-muted)',
          fontStyle: 'italic',
          fontFamily: 'var(--font-display)',
          fontSize: 13,
        }}
      >
        Виберіть день на сітці зліва, щоб переглянути події.
      </div>
    );
  }
  const heading = day.toLocaleDateString('uk-UA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return (
    <div className="glass" style={{ padding: 14, borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <span className="eyebrow-amber">{heading.toUpperCase()}</span>
      </div>
      {events.length === 0 ? (
        <div
          className="playfair"
          style={{ fontStyle: 'italic', color: 'var(--ink-muted)', fontSize: 13 }}
        >
          Жодних подій. Додай нову — чи запитай PHANTOM-а.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
          {events.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => onEdit(e)}
              style={{
                textAlign: 'left',
                padding: '8px 10px',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.55)',
                border: '1px solid rgba(0,0,0,0.05)',
                cursor: 'pointer',
                fontFamily: 'var(--font-display)',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-primary)' }}>
                {e.title}
              </div>
              <div className="tabular" style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 2 }}>
                {e.all_day ? 'весь день' : `${formatHM(e.start_at)} – ${formatHM(e.end_at)}`}
                {e.location ? ` · ${e.location}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={onCreate}
        style={{
          minHeight: 44,
          marginTop: 'auto',
          padding: '8px 14px',
          borderRadius: 10,
          border: '1px dashed rgba(244,175,37,0.55)',
          background: 'rgba(244,175,37,0.06)',
          color: '#8a5e0a',
          fontFamily: 'var(--font-display)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <span className="msym" aria-hidden style={{ fontSize: 16 }}>add</span>
        Нова подія
      </button>
    </div>
  );
}

function formatHM(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/* ─────────────────────────────────────────── EventEditor ── */

interface EventEditorProps {
  mode: 'create' | 'edit';
  initial: NewEventBody;
  onClose: () => void;
  onSubmit: (body: NewEventBody) => Promise<void>;
  onDelete?: () => Promise<void>;
}

function EventEditor({ mode, initial, onClose, onSubmit, onDelete }: EventEditorProps) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [startStr, setStartStr] = useState(toLocalInput(initial.start_at));
  const [endStr, setEndStr] = useState(toLocalInput(initial.end_at));
  const [allDay, setAllDay] = useState(initial.all_day);
  const [location, setLocation] = useState(initial.location ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!title.trim()) {
      setError('Заголовок обов\'язковий.');
      return;
    }
    const start = new Date(startStr);
    const end = new Date(endStr);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setError('Невірна дата/час.');
      return;
    }
    if (end <= start && !allDay) {
      setError('Кінець події має бути після початку.');
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        all_day: allDay,
        location: location.trim() || null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setBusy(false);
    }
  };

  const performDelete = async () => {
    if (!onDelete) return;
    setBusy(true);
    try {
      await onDelete();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 95, background: 'rgba(26,22,18,0.55)', backdropFilter: 'blur(8px)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <div
        className="glass-strong"
        style={{ width: 480, padding: 22, borderRadius: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span className="eyebrow-amber">
            {mode === 'create' ? 'НОВА ПОДІЯ' : 'РЕДАГУВАТИ ПОДІЮ'}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити"
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: 'rgba(0,0,0,0.04)',
              border: '1px solid rgba(0,0,0,0.06)',
              color: 'var(--ink-muted)',
              cursor: 'pointer',
            }}
          >
            <span className="msym" aria-hidden style={{ fontSize: 16 }}>close</span>
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <FormField label="Заголовок">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              style={inputStyle}
            />
          </FormField>
          <FormField label="Опис (необов'язково)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'var(--font-display)' }}
            />
          </FormField>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-secondary)' }}>
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            Весь день
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FormField label="Початок">
              <input
                type={allDay ? 'date' : 'datetime-local'}
                value={allDay ? startStr.slice(0, 10) : startStr}
                onChange={(e) => setStartStr(e.target.value)}
                style={inputStyle}
              />
            </FormField>
            <FormField label="Кінець">
              <input
                type={allDay ? 'date' : 'datetime-local'}
                value={allDay ? endStr.slice(0, 10) : endStr}
                onChange={(e) => setEndStr(e.target.value)}
                style={inputStyle}
              />
            </FormField>
          </div>
          <FormField label="Місце (необов'язково)">
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Київ, кав'ярня…"
              style={inputStyle}
            />
          </FormField>
          {error && (
            <div role="alert" style={{ color: 'var(--coral-deep, #b9201f)', fontSize: 11 }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            {mode === 'edit' && onDelete && (
              <button
                type="button"
                onClick={performDelete}
                disabled={busy}
                style={{
                  minWidth: 100,
                  minHeight: 44,
                  borderRadius: 10,
                  border: '1px solid rgba(239,68,68,0.5)',
                  background: 'rgba(239,68,68,0.10)',
                  color: 'var(--coral, #ef4444)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                Видалити
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
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
                background: busy ? 'rgba(244,175,37,0.18)' : 'linear-gradient(135deg, var(--primary), var(--orange))',
                color: busy ? 'var(--ink-muted)' : '#fff',
                fontFamily: 'var(--font-display)',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '0.04em',
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              {busy ? 'Збереження…' : mode === 'create' ? 'Створити' : 'Зберегти'}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid rgba(0,0,0,0.08)',
  background: 'rgba(255,255,255,0.7)',
  fontFamily: 'var(--font-display)',
  fontSize: 13,
  color: 'var(--ink-primary)',
  width: '100%',
  minHeight: 44,
};

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="micro-label" style={{ fontSize: 9 }}>{label.toUpperCase()}</span>
      {children}
    </label>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
