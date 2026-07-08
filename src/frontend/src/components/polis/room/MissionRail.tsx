/** Left rail — every mission at a glance, reactors strip, new-mission CTA. */
import { memo, useMemo, useState } from 'react';
import { Trash2, Check, X } from 'lucide-react';
import { usePolisStore } from '../../../stores/polisStore';
import { DOMAIN_TINT } from '../cityMap';
import type { PolisMission } from '@shared/types';

const STATUS_UA: Record<string, string> = {
  planning: 'планування',
  running: 'у роботі',
  paused: 'пауза',
  awaiting_gate: 'чекає тебе',
  done: 'готово',
  failed: 'зрив',
  killed: 'зупинено',
};

const MissionCard = memo(function MissionCard({
  m,
  active,
}: {
  m: PolisMission;
  active: boolean;
}) {
  const selectMission = usePolisStore((s) => s.selectMission);
  const deleteMission = usePolisStore((s) => s.deleteMission);
  const [confirm, setConfirm] = useState(false);
  const tint = DOMAIN_TINT[m.domain] ?? DOMAIN_TINT.generic;
  const waiting = m.status === 'awaiting_gate';

  return (
    <div
      className="group relative rounded-xl px-3 py-2.5 min-h-[56px] cursor-pointer active:scale-[0.98] transition-transform"
      style={{
        background: active
          ? `color-mix(in srgb, ${tint} 10%, transparent)`
          : 'var(--glass-subtle)',
        border: `1px solid ${
          active
            ? `color-mix(in srgb, ${tint} 40%, transparent)`
            : 'var(--glass-border)'
        }`,
      }}
      onClick={() => selectMission(m.id)}
      data-testid={`rail-mission-${m.id}`}
    >
      <div className="flex items-center gap-2 pr-8">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{
            background: waiting ? 'var(--primary)' : tint,
            boxShadow: m.status === 'running' ? `0 0 8px ${tint}` : 'none',
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
          style={{ background: 'var(--line-subtle)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${Math.round(m.progress * 100)}%`, background: tint }}
          />
        </div>
        <span
          className="font-mono"
          style={{
            fontSize: 'var(--fs-micro)',
            color: waiting ? 'var(--primary)' : 'var(--ink-muted)',
          }}
        >
          {STATUS_UA[m.status] ?? m.status}
        </span>
      </div>

      {confirm ? (
        <div
          className="absolute inset-y-0 right-0 flex items-center gap-1 px-1 rounded-r-xl"
          style={{ background: 'var(--glass-card)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => void deleteMission(m.id)}
            className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center active:scale-90"
            style={{ background: 'var(--signal-alert)', color: 'var(--ink-inverse)' }}
            title="Підтвердити видалення"
            aria-label="підтвердити видалення"
          >
            <Check size={16} strokeWidth={2.5} />
          </button>
          <button
            onClick={() => setConfirm(false)}
            className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center active:scale-90"
            style={{ background: 'var(--glass-subtle)', color: 'var(--ink-muted)' }}
            title="Скасувати"
            aria-label="скасувати"
          >
            <X size={16} strokeWidth={2.5} />
          </button>
        </div>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setConfirm(true);
          }}
          className="absolute top-1/2 right-0 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          style={{ color: 'var(--ink-faint)' }}
          title="Видалити місію"
          aria-label="видалити місію"
          data-testid={`rail-delete-${m.id}`}
        >
          <Trash2 size={14} strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
});

export function MissionRail({ onNewMission }: { onNewMission: () => void }) {
  const missions = usePolisStore((s) => s.missions);
  const selected = usePolisStore((s) => s.selectedMissionId);
  const keys = usePolisStore((s) => s.keys);
  const governor = usePolisStore((s) => s.governor);
  const gates = usePolisStore((s) => s.gates);

  const visible = useMemo(
    () =>
      [...missions].sort((a, b) =>
        (b.created_at ?? '').localeCompare(a.created_at ?? ''),
      ),
    [missions],
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
        {visible.map((m) => (
          <MissionCard key={m.id} m={m} active={m.id === selected} />
        ))}
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
                    ? 'var(--accent)'
                    : k.state === 'invalid'
                      ? 'var(--signal-alert)'
                      : 'var(--primary)',
                opacity: k.state === 'disabled' ? 0.3 : 1,
              }}
            />
          ))}
          {keys.length === 0 && (
            <span
              className="w-1.5 h-4 rounded-sm animate-pulse"
              title="без ключів — Ollama"
              style={{ background: 'var(--signal-alert)' }}
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
              color: 'var(--primary)',
              background: 'color-mix(in srgb, var(--primary) 14%, transparent)',
            }}
          >
            🔔 {gates.length}
          </span>
        )}
      </footer>
    </aside>
  );
}
