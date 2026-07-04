/** Left rail — every mission at a glance, reactors strip, new-mission CTA. */
import { usePolisStore } from '../../../stores/polisStore';
import { DOMAIN_TINT } from '../cityMap';

const STATUS_UA: Record<string, string> = {
  planning: 'планування',
  running: 'у роботі',
  paused: 'пауза',
  awaiting_gate: 'чекає тебе',
  done: 'готово',
  failed: 'зрив',
  killed: 'зупинено',
};

export function MissionRail({ onNewMission }: { onNewMission: () => void }) {
  const missions = usePolisStore((s) => s.missions);
  const selected = usePolisStore((s) => s.selectedMissionId);
  const selectMission = usePolisStore((s) => s.selectMission);
  const keys = usePolisStore((s) => s.keys);
  const governor = usePolisStore((s) => s.governor);
  const gates = usePolisStore((s) => s.gates);

  const visible = [...missions].sort((a, b) =>
    (b.created_at ?? '').localeCompare(a.created_at ?? ''),
  );

  return (
    <aside
      className="h-full flex flex-col glass-panel rounded-2xl overflow-hidden"
      data-testid="mission-rail"
    >
      <button
        onClick={onNewMission}
        className="m-3 min-h-[48px] rounded-xl font-medium active:scale-[0.98]"
        style={{
          background: 'var(--accent)',
          color: 'var(--ink-inverse)',
          fontSize: 'var(--fs-sm)',
        }}
        data-testid="polis-new-mission"
      >
        + Нова місія
      </button>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 flex flex-col gap-2 pb-2">
        {visible.length === 0 && (
          <p
            className="px-1 pt-2"
            style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}
          >
            Поліс чекає першого наказу.
          </p>
        )}
        {visible.map((m) => {
          const tint = DOMAIN_TINT[m.domain] ?? DOMAIN_TINT.generic;
          const active = m.id === selected;
          const waiting = m.status === 'awaiting_gate';
          return (
            <button
              key={m.id}
              onClick={() => selectMission(m.id)}
              className="rounded-xl px-3 py-2.5 text-left min-h-[56px] active:scale-[0.98]"
              style={{
                background: active ? `${tint}18` : 'var(--glass-subtle)',
                border: `1px solid ${active ? `${tint}66` : 'var(--glass-border)'}`,
              }}
              data-testid={`rail-mission-${m.id}`}
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    background: waiting ? '#f4af25' : tint,
                    boxShadow:
                      m.status === 'running' ? `0 0 8px ${tint}` : 'none',
                  }}
                />
                <span
                  className="flex-1 truncate"
                  style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}
                >
                  {m.title}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <div
                  className="flex-1 h-1 rounded-full overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.07)' }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.round(m.progress * 100)}%`,
                      background: tint,
                    }}
                  />
                </div>
                <span
                  className="font-mono"
                  style={{
                    fontSize: 'var(--fs-micro)',
                    color: waiting ? '#f4af25' : 'var(--ink-muted)',
                  }}
                >
                  {STATUS_UA[m.status] ?? m.status}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <footer
        className="px-3 py-2 flex items-center gap-2"
        style={{ borderTop: '1px solid var(--glass-border)' }}
        data-testid="rail-footer"
      >
        <div className="flex gap-1">
          {keys.slice(0, 5).map((k) => (
            <span
              key={k.id}
              className="w-1.5 h-4 rounded-sm"
              title={`${k.provider} ${k.label}: ${k.state}`}
              style={{
                background:
                  k.state === 'active'
                    ? '#22d3ee'
                    : k.state === 'invalid'
                      ? '#f43f5e'
                      : '#f4af25',
                opacity: k.state === 'disabled' ? 0.3 : 1,
              }}
            />
          ))}
          {keys.length === 0 && (
            <span
              className="w-1.5 h-4 rounded-sm animate-pulse"
              title="без ключів — Ollama"
              style={{ background: '#f43f5e' }}
            />
          )}
        </div>
        <span
          className="font-mono flex-1"
          style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-muted)' }}
        >
          хвиля {governor.running_nodes}/{governor.max_wave}
        </span>
        {gates.length > 0 && (
          <span
            className="font-mono px-2 py-0.5 rounded-full"
            style={{
              fontSize: 'var(--fs-micro)',
              color: '#f4af25',
              background: 'rgba(244,175,37,0.12)',
            }}
          >
            🔔 {gates.length}
          </span>
        )}
      </footer>
    </aside>
  );
}
