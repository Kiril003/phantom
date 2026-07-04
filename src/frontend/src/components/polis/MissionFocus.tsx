/** Фокус — third zoom level: one mission, its node graph, its controls. */
import { motion } from 'framer-motion';
import { usePolisStore } from '../../stores/polisStore';
import type { PolisNode } from '@shared/types';
import { DOMAIN_TINT } from './cityMap';

const NODE_STATUS_UA: Record<string, string> = {
  pending: 'у черзі',
  ready: 'готовий',
  running: 'виконується',
  blocked: 'заблоковано',
  review: 'на рішенні',
  done: 'виконано',
  failed: 'зрив',
  skipped: 'пропущено',
};

const NODE_TINT: Record<string, string> = {
  running: 'var(--accent)',
  review: 'var(--primary)',
  done: 'var(--signal-ok)',
  failed: 'var(--signal-alert)',
  blocked: 'var(--signal-alert)',
  skipped: 'var(--ink-faint)',
  pending: 'var(--ink-muted)',
  ready: 'var(--ink-muted)',
};

export function MissionFocus() {
  const missionId = usePolisStore((s) => s.focusMissionId ?? s.selectedMissionId);
  const mission = usePolisStore((s) =>
    s.missions.find((m) => m.id === (s.focusMissionId ?? s.selectedMissionId)),
  );
  const focusMission = usePolisStore((s) => s.focusMission);
  const pause = usePolisStore((s) => s.pauseMission);
  const resume = usePolisStore((s) => s.resumeMission);
  const kill = usePolisStore((s) => s.killMission);
  const setRoomTab = usePolisStore((s) => s.setRoomTab);

  if (!missionId || !mission) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <p style={{ color: 'var(--ink-muted)' }}>Місію не знайдено.</p>
      </div>
    );
  }

  const tint = DOMAIN_TINT[mission.domain] ?? DOMAIN_TINT.generic;
  const onCritical = new Set(mission.critical_path);

  return (
    <div className="w-full h-full flex flex-col p-4 gap-3" data-testid="polis-focus">
      <header className="glass-panel rounded-2xl px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => {
            focusMission(null);
            setRoomTab('talk');
          }}
          className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center active:scale-[0.95]"
          style={{ background: 'var(--glass-subtle)', color: 'var(--ink-secondary)' }}
          aria-label="до розмови"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <h1
            className="truncate"
            style={{ fontSize: 'var(--fs-lg)', color: 'var(--ink-primary)' }}
          >
            {mission.title}
          </h1>
          <p className="font-mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}>
            {mission.pipeline} · прогрес {Math.round(mission.progress * 100)}% ·
            бюджет {mission.budget.spent_llm_calls}/{mission.budget.max_llm_calls} викликів
          </p>
        </div>
        {mission.status === 'running' ? (
          <button
            onClick={() => void pause(mission.id)}
            className="min-h-[44px] px-4 rounded-xl active:scale-[0.97]"
            style={{ background: 'color-mix(in srgb, var(--primary) 18%, transparent)', color: 'var(--primary)' }}
          >
            Пауза
          </button>
        ) : mission.status === 'paused' ? (
          <button
            onClick={() => void resume(mission.id)}
            className="min-h-[44px] px-4 rounded-xl active:scale-[0.97]"
            style={{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)' }}
          >
            Продовжити
          </button>
        ) : null}
        {!['done', 'killed', 'failed'].includes(mission.status) && (
          <button
            onClick={() => void kill(mission.id)}
            className="min-h-[44px] px-4 rounded-xl active:scale-[0.97]"
            style={{ background: 'color-mix(in srgb, var(--signal-alert) 14%, transparent)', color: 'var(--signal-alert)' }}
          >
            Зупинити
          </button>
        )}
      </header>

      <div className="glass-panel rounded-2xl p-4 flex-1 min-h-0 overflow-y-auto">
        <ol className="flex flex-col gap-2">
          {mission.nodes.map((n) => (
            <NodeRow key={n.id} node={n} tint={tint} critical={onCritical.has(n.id)} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function NodeRow({
  node: n,
  tint,
  critical,
}: {
  node: PolisNode;
  tint: string;
  critical: boolean;
}) {
  const st = NODE_TINT[n.status] ?? 'var(--ink-muted)';
  return (
    <motion.li
      layout
      className="rounded-xl px-3 py-2.5 flex items-center gap-3"
      style={{
        background: 'var(--glass-subtle)',
        border: `1px solid color-mix(in srgb, ${critical ? `${tint} 28%, transparent)` : 'var(--glass-border)'}`,
      }}
      data-testid={`node-${n.id}`}
    >
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{
          background: st,
          boxShadow: n.status === 'running' ? `0 0 10px ${st}` : 'none',
        }}
      />
      <div className="flex-1 min-w-0">
        <p className="truncate" style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}>
          {n.title}
          {critical && (
            <span className="ml-2" style={{ fontSize: 'var(--fs-micro)', color: tint }}>
              критичний шлях
            </span>
          )}
        </p>
        {(n.output_summary || n.error) && (
          <p
            className="truncate"
            style={{
              fontSize: 'var(--fs-xs)',
              color: n.error ? 'var(--signal-alert)' : 'var(--ink-muted)',
            }}
          >
            {n.error ?? n.output_summary}
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="font-mono" style={{ fontSize: 'var(--fs-xs)', color: st }}>
          {NODE_STATUS_UA[n.status] ?? n.status}
        </p>
        {n.crew?.roles?.length ? (
          <p className="font-mono" style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-faint)' }}>
            {n.crew.roles.join(' · ').replace(/_/g, ' ')}
          </p>
        ) : null}
      </div>
    </motion.li>
  );
}
