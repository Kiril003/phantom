/** Народження місії — brief + pipeline picker, slide-over sheet. */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePolisStore } from '../../stores/polisStore';
import { DOMAIN_TINT } from './cityMap';

const PIPELINE_CARDS = [
  { id: 'generic', name: 'Універсальна', hint: 'Поліс сам розкладе на кроки', domain: 'generic' },
  { id: 'dev_studio', name: 'Кузня', hint: 'застосунок командою розробників', domain: 'dev' },
  { id: 'research_library', name: 'Бібліотека', hint: 'глибоке дослідження з синтезом', domain: 'research' },
  { id: 'observatory', name: 'Обсерваторія', hint: 'аналітика і прогнози', domain: 'analytics' },
  { id: 'scriptorium', name: 'Скрипторій', hint: 'великі документи, консистентно', domain: 'document' },
  { id: 'game_studio', name: 'Студія', hint: 'гра від GDD до playable', domain: 'game' },
];

export function NewMissionSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [brief, setBrief] = useState('');
  const [pipeline, setPipeline] = useState('generic');
  const [busy, setBusy] = useState(false);
  const createMission = usePolisStore((s) => s.createMission);

  const submit = async () => {
    if (brief.trim().length < 3 || busy) return;
    setBusy(true);
    try {
      await createMission(brief.trim(), pipeline);
      setBrief('');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-40 flex items-end"
          style={{ background: 'rgba(20,15,8,0.64)' }}
          onClick={onClose}
          data-testid="new-mission-sheet"
        >
          <motion.div
            initial={{ y: 380 }}
            animate={{ y: 0 }}
            exit={{ y: 380 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="glass-elevated rounded-t-3xl w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 'var(--fs-md)', color: 'var(--ink-primary)' }}>
              Нова місія для Поліса
            </h2>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Опиши, що збудувати, дослідити чи передбачити…"
              rows={3}
              className="w-full mt-3 rounded-xl p-3 resize-none outline-none"
              style={{
                background: 'var(--glass-subtle)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink-primary)',
                fontSize: 'var(--fs-sm)',
              }}
              data-testid="mission-brief-input"
            />
            <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
              {PIPELINE_CARDS.map((p) => {
                const active = pipeline === p.id;
                const tint = DOMAIN_TINT[p.domain] ?? DOMAIN_TINT.generic;
                return (
                  <button
                    key={p.id}
                    onClick={() => setPipeline(p.id)}
                    className="shrink-0 rounded-xl px-3 py-2 min-h-[56px] text-left active:scale-[0.97]"
                    style={{
                      background: active ? `color-mix(in srgb, ${tint} 12%, transparent)` : 'var(--glass-subtle)',
                      border: `1px solid ${active ? tint : 'var(--glass-border)'}`,
                      minWidth: 132,
                    }}
                    data-testid={`pipeline-${p.id}`}
                  >
                    <p style={{ fontSize: 'var(--fs-sm)', color: active ? tint : 'var(--ink-primary)' }}>
                      {p.name}
                    </p>
                    <p style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-muted)' }}>
                      {p.hint}
                    </p>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => void submit()}
              disabled={brief.trim().length < 3 || busy}
              className="w-full mt-4 min-h-[52px] rounded-xl font-medium active:scale-[0.98] disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--ink-inverse)', fontSize: 'var(--fs-base)' }}
              data-testid="mission-launch"
            >
              {busy ? 'Планувальник будує граф…' : 'Запустити місію'}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
