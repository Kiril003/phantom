/** ШТАБ — command deck: mission river, key reactors, approvals queue. */
import { motion, AnimatePresence } from 'framer-motion';
import { usePolisStore } from '../../stores/polisStore';
import type { PolisMission, ManagedKeyPublic, PolisGate } from '@shared/types';
import { DOMAIN_TINT } from './cityMap';

function etaLabel(min: number): string {
  if (min <= 0) return 'зараз';
  if (min < 60) return `~${min} хв`;
  if (min < 60 * 24) return `~${Math.round(min / 60)} год`;
  return `~${Math.round(min / 60 / 24)} дн`;
}

const STATUS_UA: Record<string, string> = {
  planning: 'планування',
  running: 'у роботі',
  paused: 'пауза',
  awaiting_gate: 'чекає рішення',
  done: 'виконано',
  failed: 'зрив',
  killed: 'зупинено',
};

export function StaffDeck() {
  const missions = usePolisStore((s) => s.missions);
  const keys = usePolisStore((s) => s.keys);
  const gates = usePolisStore((s) => s.gates);
  const citizens = usePolisStore((s) => s.citizens);
  const governor = usePolisStore((s) => s.governor);
  const focusMission = usePolisStore((s) => s.focusMission);
  const resolveGate = usePolisStore((s) => s.resolveGate);

  const active = missions.filter((m) => m.status !== 'killed');
  const inField = citizens.filter((c) => c.activity !== 'idle').length;

  return (
    <div className="w-full h-full flex flex-col gap-3 p-4" data-testid="polis-staff">
      <section className="glass-panel rounded-2xl p-4 flex-[3] min-h-0 overflow-hidden">
        <header className="flex items-baseline justify-between mb-3">
          <span
            className="uppercase font-mono"
            style={{
              fontSize: 'var(--fs-micro)',
              letterSpacing: 'var(--tracking-widest)',
              color: 'var(--ink-secondary)',
            }}
          >
            Ріка місій
          </span>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}>
            хвиля {governor.running_nodes}/{governor.max_wave} · черга{' '}
            {governor.queued_nodes}
          </span>
        </header>
        <div className="flex flex-col gap-2 overflow-y-auto max-h-full pb-6">
          {active.length === 0 && (
            <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-sm)' }}>
              Місто спить. Дай Полісу першу місію.
            </p>
          )}
          {active.map((m) => (
            <MissionRow key={m.id} mission={m} onOpen={() => focusMission(m.id)} />
          ))}
        </div>
      </section>

      <div className="flex gap-3 flex-[2] min-h-0">
        <section className="glass-panel rounded-2xl p-4 flex-1 overflow-hidden">
          <header
            className="uppercase font-mono mb-3"
            style={{
              fontSize: 'var(--fs-micro)',
              letterSpacing: 'var(--tracking-widest)',
              color: 'var(--ink-secondary)',
            }}
          >
            Реактори · ключі
          </header>
          <div className="flex flex-col gap-2 overflow-y-auto max-h-[calc(100%-28px)]">
            {keys.length === 0 && (
              <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xs)' }}>
                Жодного ключа — живлення від локального Ollama. Додай ключі в
                Налаштуваннях.
              </p>
            )}
            {keys.map((k) => (
              <ReactorRow key={k.id} k={k} />
            ))}
          </div>
        </section>

        <section className="glass-panel rounded-2xl p-4 flex-1 overflow-hidden">
          <header
            className="uppercase font-mono mb-3"
            style={{
              fontSize: 'var(--fs-micro)',
              letterSpacing: 'var(--tracking-widest)',
              color: gates.length ? 'var(--primary)' : 'var(--ink-secondary)',
            }}
          >
            Рішення оператора {gates.length ? `· ${gates.length}` : ''}
          </header>
          <div className="flex flex-col gap-2 overflow-y-auto max-h-[calc(100%-28px)]">
            <AnimatePresence>
              {gates.length === 0 && (
                <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-xs)' }}>
                  Дзвін мовчить — рішень не чекають.
                </p>
              )}
              {gates.map((g) => (
                <GateCard key={g.id} gate={g} onResolve={resolveGate} />
              ))}
            </AnimatePresence>
          </div>
        </section>

        <section className="glass-panel rounded-2xl p-4 w-[210px] shrink-0">
          <header
            className="uppercase font-mono mb-3"
            style={{
              fontSize: 'var(--fs-micro)',
              letterSpacing: 'var(--tracking-widest)',
              color: 'var(--ink-secondary)',
            }}
          >
            Населення
          </header>
          <p
            className="font-mono"
            style={{ fontSize: 'var(--fs-2xl)', color: 'var(--ink-primary)', lineHeight: 1 }}
          >
            {citizens.length}
          </p>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-secondary)' }}>
            громадян · {inField} у полі
          </p>
          {governor.night_mode && (
            <p className="mt-2" style={{ fontSize: 'var(--fs-xs)', color: 'var(--primary)' }}>
              нічна хвиля активна
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function MissionRow({
  mission: m,
  onOpen,
}: {
  mission: PolisMission;
  onOpen: () => void;
}) {
  const tint = DOMAIN_TINT[m.domain] ?? DOMAIN_TINT.generic;
  const pressure = m.budget.max_tokens
    ? Math.min(1, m.budget.spent_tokens / m.budget.max_tokens)
    : 0;
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-xl px-3 py-2 min-h-[44px] active:scale-[0.98] transition-transform"
      style={{ background: 'var(--glass-subtle)', border: '1px solid var(--glass-border)' }}
      data-testid={`mission-row-${m.id}`}
    >
      <div className="flex items-center gap-3">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{
            background: tint,
            boxShadow: m.status === 'running' ? `0 0 8px ${tint}` : 'none',
          }}
        />
        <span
          className="flex-1 truncate"
          style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}
        >
          {m.title}
        </span>
        <span
          className="font-mono shrink-0"
          style={{
            fontSize: 'var(--fs-xs)',
            color: m.status === 'awaiting_gate' ? 'var(--primary)' : 'var(--ink-muted)',
          }}
        >
          {STATUS_UA[m.status] ?? m.status} · {etaLabel(m.eta_minutes)}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--line-subtle)' }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${Math.round(m.progress * 100)}%`, background: tint }}
          />
        </div>
        <span
          className="font-mono shrink-0"
          style={{
            fontSize: 'var(--fs-micro)',
            color: pressure > 0.8 ? 'var(--signal-alert)' : 'var(--ink-faint)',
          }}
        >
          ₿{Math.round(pressure * 100)}%
        </span>
      </div>
    </button>
  );
}

function ReactorRow({ k }: { k: ManagedKeyPublic }) {
  const stateTint: Record<string, string> = {
    active: 'var(--accent)',
    cooling: 'var(--primary)',
    exhausted: 'var(--primary)',
    invalid: 'var(--signal-alert)',
    disabled: 'var(--ink-faint)',
  };
  const tint = stateTint[k.state] ?? 'var(--ink-faint)';
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-2 py-1.5"
      style={{ background: 'var(--glass-subtle)' }}
      data-testid={`reactor-${k.id}`}
    >
      <span
        className="w-2 h-5 rounded-sm shrink-0"
        style={{
          background: tint,
          boxShadow: k.state === 'active' ? `0 0 6px ${tint}` : 'none',
        }}
      />
      <div className="flex-1 min-w-0">
        <p className="truncate" style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-primary)' }}>
          {k.provider} · {k.label}{' '}
          <span className="font-mono" style={{ color: 'var(--ink-faint)' }}>
            {k.key_hint}
          </span>
        </p>
        <p className="font-mono" style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-muted)' }}>
          {k.metrics.requests_1h}/год · {Math.round(k.metrics.tokens_24h / 1000)}k
          токенів/24г · {k.metrics.failures_24h} відмов
        </p>
      </div>
      <span className="font-mono shrink-0" style={{ fontSize: 'var(--fs-micro)', color: tint }}>
        {k.state}
      </span>
    </div>
  );
}

function GateCard({
  gate,
  onResolve,
}: {
  gate: PolisGate;
  onResolve: (id: string, approved: boolean) => Promise<void>;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 60 }}
      className="rounded-xl p-3"
      style={{ background: 'var(--glass-card)', border: '1px solid color-mix(in srgb, var(--primary) 35%, transparent)' }}
      data-testid={`gate-${gate.id}`}
    >
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}>
        {gate.question}
      </p>
      {gate.payload_preview && (
        <p
          className="mt-1 line-clamp-2"
          style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}
        >
          {gate.payload_preview}
        </p>
      )}
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => void onResolve(gate.id, true)}
          className="flex-1 min-h-[44px] rounded-lg font-medium active:scale-[0.97]"
          style={{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)', fontSize: 'var(--fs-sm)' }}
        >
          Схвалити
        </button>
        <button
          onClick={() => void onResolve(gate.id, false)}
          className="flex-1 min-h-[44px] rounded-lg font-medium active:scale-[0.97]"
          style={{ background: 'color-mix(in srgb, var(--signal-alert) 14%, transparent)', color: 'var(--signal-alert)', fontSize: 'var(--fs-sm)' }}
        >
          Відхилити
        </button>
      </div>
    </motion.div>
  );
}
