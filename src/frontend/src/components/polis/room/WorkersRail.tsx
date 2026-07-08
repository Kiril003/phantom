/** Right rail — live workers: streaming tails per node, tap = inspector
 * with the full transcript following in real time. */
import { memo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePolisStore } from '../../../stores/polisStore';
import { DOMAIN_TINT } from '../cityMap';
import type { PolisNode } from '@shared/types';

const STATUS_TINT: Record<string, string> = {
  running: 'var(--accent)',
  review: 'var(--primary)',
  done: 'var(--signal-ok)',
  failed: 'var(--signal-alert)',
  blocked: 'var(--signal-alert)',
  pending: 'var(--ink-muted)',
  ready: 'var(--ink-muted)',
  skipped: 'var(--ink-faint)',
};

const STATUS_LABEL: Record<string, string> = {
  running: 'у роботі',
  review: 'рев’ю',
  done: 'готово',
  failed: 'зрив',
  blocked: 'блок',
  pending: 'черга',
  ready: 'готовий',
  skipped: '—',
};

/** One node card; subscribes to its own transcript tail so a streaming
 * delta re-renders only the card that is actually streaming. */
const WorkerCard = memo(function WorkerCard({
  n,
  missionId,
  tint,
}: {
  n: PolisNode;
  missionId: string;
  tint: string;
}) {
  const tail = usePolisStore(
    (s) => s.transcripts[`${missionId}:${n.id}`]?.slice(-160) ?? '',
  );
  const openInspector = usePolisStore((s) => s.openInspector);
  const st = STATUS_TINT[n.status] ?? 'var(--ink-muted)';
  const live = n.status === 'running';
  const role = n.crew?.roles?.[0]?.replace(/_/g, ' ');
  const preview = live
    ? tail
    : n.status === 'done'
      ? n.output_summary || 'готово'
      : n.status === 'failed'
        ? n.error || 'зрив'
        : n.status === 'pending' || n.status === 'ready'
          ? 'очікує своєї хвилі'
          : STATUS_LABEL[n.status] ?? '';
  return (
    <motion.button
      layout
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      onClick={() => openInspector(n.id)}
      className="rounded-xl p-3 text-left flex flex-col gap-1.5 active:scale-[0.98]"
      style={{
        background: live
          ? `color-mix(in srgb, ${tint} 8%, transparent)`
          : 'var(--glass-subtle)',
        border: `1px solid ${
          live
            ? `color-mix(in srgb, ${tint} 34%, transparent)`
            : 'var(--glass-border)'
        }`,
      }}
      data-testid={`worker-${n.id}`}
    >
      <div className="flex items-center gap-2">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: st, boxShadow: live ? `0 0 8px ${st}` : 'none' }}
        />
        <span
          className="flex-1 truncate font-medium"
          style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}
        >
          {n.title}
        </span>
        <span
          className="shrink-0"
          style={{ fontSize: 'var(--fs-micro)', color: st, opacity: 0.9 }}
        >
          {STATUS_LABEL[n.status] ?? n.status}
        </span>
      </div>
      {role && (
        <div className="flex items-center gap-1.5 pl-4">
          <span
            className="truncate"
            style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-faint)' }}
          >
            {role}
          </span>
        </div>
      )}
      <p
        className="line-clamp-2 break-words pl-4"
        style={{
          fontSize: 'var(--fs-xs)',
          color: live ? 'var(--ink-secondary)' : 'var(--ink-muted)',
          lineHeight: 'var(--lh-snug)',
          minHeight: '2.4em',
          fontStyle: live ? 'normal' : 'italic',
          opacity: live || n.status === 'done' || n.status === 'failed' ? 1 : 0.7,
        }}
      >
        {preview}
        {live && (
          <span className="animate-pulse" style={{ color: tint }}> ▍</span>
        )}
      </p>
    </motion.button>
  );
});

export function WorkersRail() {
  const mission = usePolisStore((s) =>
    s.missions.find((m) => m.id === s.selectedMissionId),
  );

  if (!mission) {
    return (
      <aside className="h-full glass-panel rounded-2xl p-4" data-testid="workers-rail">
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}>
          Обери місію — тут з'являться її воркери.
        </p>
      </aside>
    );
  }

  const tint = DOMAIN_TINT[mission.domain] ?? DOMAIN_TINT.generic;
  const nodes = mission.nodes.filter(
    (n) => n.status !== 'skipped',
  );

  return (
    <aside
      className="h-full glass-panel rounded-2xl flex flex-col overflow-hidden"
      data-testid="workers-rail"
    >
      <header
        className="px-4 py-2.5 uppercase font-mono"
        style={{
          fontSize: 'var(--fs-micro)',
          letterSpacing: 'var(--tracking-widest)',
          color: 'var(--ink-secondary)',
          borderBottom: '1px solid var(--glass-border)',
        }}
      >
        Воркери · {nodes.filter((n) => n.status === 'running').length} у полі
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {nodes.map((n) => (
            <WorkerCard key={n.id} n={n} missionId={mission.id} tint={tint} />
          ))}
        </AnimatePresence>
      </div>
    </aside>
  );
}

export function WorkerInspector() {
  const missionId = usePolisStore((s) => s.selectedMissionId);
  const nodeId = usePolisStore((s) => s.inspectorNodeId);
  const mission = usePolisStore((s) =>
    s.missions.find((m) => m.id === s.selectedMissionId),
  );
  const transcript = usePolisStore((s) =>
    nodeId && missionId ? (s.transcripts[`${missionId}:${nodeId}`] ?? '') : '',
  );
  const openInspector = usePolisStore((s) => s.openInspector);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const node = mission?.nodes.find((n) => n.id === nodeId);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && node?.status === 'running') el.scrollTop = el.scrollHeight;
  }, [transcript, node?.status]);

  return (
    <AnimatePresence>
      {nodeId && node && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-40 flex items-center justify-center p-6"
          style={{ background: 'rgba(20,15,8,0.72)' }}
          onClick={() => openInspector(null)}
          data-testid="worker-inspector"
        >
          <motion.div
            initial={{ scale: 0.95, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 10 }}
            className="glass-elevated rounded-2xl w-full h-full flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header
              className="flex items-center gap-3 px-4 py-3"
              style={{ borderBottom: '1px solid var(--glass-border)' }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{
                  background: STATUS_TINT[node.status] ?? 'var(--ink-muted)',
                  boxShadow:
                    node.status === 'running'
                      ? `0 0 10px ${STATUS_TINT.running}`
                      : 'none',
                }}
              />
              <div className="flex-1 min-w-0">
                <p
                  className="truncate"
                  style={{ fontSize: 'var(--fs-md)', color: 'var(--ink-primary)' }}
                >
                  {node.title}
                </p>
                <p
                  style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-muted)' }}
                >
                  {node.crew?.roles?.join(' · ').replace(/_/g, ' ') || 'воркер'} ·{' '}
                  {node.budget.spent_llm_calls} виклик(ів) ·{' '}
                  {Math.round(transcript.length / 4)} ток. вихід
                </p>
              </div>
              <button
                onClick={() => openInspector(null)}
                className="min-w-[44px] min-h-[44px] rounded-xl active:scale-[0.95]"
                style={{ background: 'var(--glass-subtle)', color: 'var(--ink-secondary)' }}
                aria-label="закрити"
              >
                ✕
              </button>
            </header>
            <div
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto px-5 py-4 whitespace-pre-wrap break-words"
              style={{
                fontSize: 'var(--fs-sm)',
                color: 'var(--ink-secondary)',
                lineHeight: 1.7,
              }}
              data-testid="inspector-transcript"
            >
              {transcript ||
                (node.status === 'pending' || node.status === 'ready'
                  ? 'Воркер ще не почав — чекає своєї хвилі.'
                  : 'Транскрипт порожній.')}
              {node.status === 'running' && (
                <span className="animate-pulse" style={{ color: 'var(--accent)' }}>
                  ▍
                </span>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
