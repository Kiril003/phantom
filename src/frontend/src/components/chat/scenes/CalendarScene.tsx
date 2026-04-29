/**
 * Phase-5 R1 — CalendarScene (B-17).
 *
 * Inline glass card returned from `calendar.peek` / `calendar.add`. Mirrors
 * the design DNA from `docs/design-handoff/project/screen-8-inline.jsx`
 * → `SceneCalendar`: 7-column day strip with date headers, absolute-
 * positioned event blocks per day with category colour mapping, and
 * a NEXUS suggestion footer with an "Add" affordance.
 *
 * Pure render; events are positioned by percentage so the design adapts
 * to the 1024×600 chassis (≤ 144 px column height as in prototype).
 */
import type { CalendarEvent, CalendarSceneData, CalendarEventCategory } from '@shared/types';

interface CalendarSceneProps {
  data: CalendarSceneData;
}

const CATEGORY_COLOURS: Record<
  CalendarEventCategory,
  { bg: string; border: string; text: string }
> = {
  amber: { bg: 'rgba(244,175,37,0.45)', border: 'rgba(244,175,37,0.7)', text: '#7a4f08' },
  work: { bg: 'rgba(176,122,16,0.18)', border: 'rgba(176,122,16,0.35)', text: 'var(--ink-primary)' },
  personal: { bg: 'rgba(132,180,90,0.25)', border: 'rgba(132,180,90,0.5)', text: '#3d5b1c' },
  coral: { bg: 'rgba(239,68,68,0.18)', border: 'rgba(239,68,68,0.4)', text: '#9b1a1a' },
};

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d
    .getDate()
    .toString()
    .padStart(2, '0')}`;
}

export function CalendarScene({ data }: CalendarSceneProps) {
  const today = data.today_iso || isoToday();
  // Resolve which day_index corresponds to "today" — use ms-of-week.
  const monday = new Date(`${data.week_start_iso}T00:00:00`);
  const todayDate = new Date(`${today}T00:00:00`);
  const daysFromMonday = Math.floor(
    (todayDate.getTime() - monday.getTime()) / (24 * 60 * 60 * 1000),
  );
  const todayIndex =
    daysFromMonday >= 0 && daysFromMonday <= 6 ? daysFromMonday : -1;

  const grouped: CalendarEvent[][] = [[], [], [], [], [], [], []];
  for (const ev of data.events) {
    const idx = ev.day_index;
    if (idx >= 0 && idx <= 6) grouped[idx].push(ev);
  }

  return (
    <div
      className="glass lift"
      style={{ width: 504, padding: 16, position: 'relative', overflow: 'hidden' }}
      data-testid="scene-calendar"
      data-week-start={data.week_start_iso}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="msym" aria-hidden style={{ fontSize: 14, color: 'var(--primary-deep)' }}>
            calendar_view_week
          </span>
          <span className="eyebrow-amber">WEEK · {data.date_labels[0]}–{data.date_labels[6]}</span>
        </div>
        <span style={{ fontSize: 9, color: 'var(--ink-muted)' }}>
          {data.total_count} events
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 4,
          marginTop: 10,
          height: 144,
        }}
      >
        {data.weekday_labels.map((day, i) => {
          const isToday = i === todayIndex;
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ textAlign: 'center', marginBottom: 4 }}>
                <div
                  className="micro-label"
                  style={{
                    fontSize: 8,
                    color: isToday ? 'var(--coral-deep)' : 'var(--ink-muted)',
                  }}
                >
                  {day}
                </div>
                <div
                  className="tabular"
                  style={{
                    fontSize: 12,
                    fontWeight: isToday ? 700 : 500,
                    color: isToday ? 'var(--coral-deep)' : 'var(--ink-secondary)',
                  }}
                >
                  {data.date_labels[i]}
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  position: 'relative',
                  background: isToday
                    ? 'rgba(239,68,68,0.04)'
                    : 'rgba(255,255,255,0.35)',
                  borderRadius: 6,
                  border: isToday
                    ? '1px dashed rgba(239,68,68,0.3)'
                    : '1px solid rgba(255,255,255,0.4)',
                }}
              >
                {grouped[i].map((ev) => {
                  const c = CATEGORY_COLOURS[ev.category];
                  return (
                    <div
                      key={ev.event_id}
                      title={ev.label}
                      style={{
                        position: 'absolute',
                        left: 2,
                        right: 2,
                        top: `${ev.y_pct}%`,
                        height: `${ev.h_pct}%`,
                        background: c.bg,
                        border: `1px solid ${c.border}`,
                        borderRadius: 4,
                        fontSize: 8,
                        fontWeight: 600,
                        color: c.text,
                        padding: '1px 3px',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        lineHeight: 1,
                      }}
                    >
                      {ev.label}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {data.ai_suggestion && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 10px',
            borderRadius: 8,
            background: 'rgba(244,175,37,0.06)',
            border: '1px solid rgba(244,175,37,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span className="msym" aria-hidden style={{ fontSize: 12, color: 'var(--primary-deep)' }}>
            auto_awesome
          </span>
          <div style={{ flex: 1 }}>
            <div className="micro-label" style={{ fontSize: 8, marginBottom: 1 }}>
              NEXUS SUGGESTS
            </div>
            <div
              className="playfair"
              style={{
                fontSize: 12,
                fontStyle: 'italic',
                color: 'var(--ink-secondary)',
                lineHeight: 1.25,
              }}
            >
              “{data.ai_suggestion}”
            </div>
          </div>
          <button
            type="button"
            data-calendar-action="add"
            style={{
              minHeight: 44,
              padding: '5px 12px',
              borderRadius: 'var(--radius-pill)',
              background: 'linear-gradient(135deg,var(--primary),var(--orange))',
              border: 'none',
              cursor: 'pointer',
              color: 'white',
              fontSize: 10,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              fontFamily: 'var(--font-display)',
            }}
          >
            <span className="msym" aria-hidden style={{ fontSize: 11 }}>
              add
            </span>
            Add
          </button>
        </div>
      )}
    </div>
  );
}
