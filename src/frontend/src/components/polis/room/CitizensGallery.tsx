/** Населення — the citizens who live and work in the Polis. Each card is
 * a real specialist whose reputation grew from actual mission outcomes;
 * tap for a dossier (record, mastered domains, recent deeds). */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { polisApi } from '../../../services/polisApi';
import { usePolisStore } from '../../../stores/polisStore';
import type { CitizenDossier } from '@shared/types';
import { DOMAIN_TINT } from '../cityMap';

const TIER_TINT: Record<string, string> = {
  майстер: 'var(--signal-ok)',
  досвідчений: 'var(--accent)',
  стабільний: 'var(--primary)',
  нестабільний: 'var(--signal-alert)',
  новачок: 'var(--ink-muted)',
};

export function CitizensGallery() {
  const [citizens, setCitizens] = useState<CitizenDossier[]>([]);
  const [openRole, setOpenRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const liveCitizens = usePolisStore((s) => s.citizens);

  useEffect(() => {
    let alive = true;
    void polisApi
      .citizens()
      .then((r) => alive && setCitizens(r.citizens))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const activityOf = (role: string) =>
    liveCitizens.find((c) => c.role === role)?.activity ?? 'idle';

  const open = citizens.find((c) => c.role === openRole);

  return (
    <div className="h-full overflow-y-auto p-4" data-testid="citizens-gallery">
      {loading && (
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-muted)' }}>
          Скликаю населення…
        </p>
      )}
      <div className="grid grid-cols-3 gap-3">
        {citizens.map((c) => {
          const tint = TIER_TINT[c.tier] ?? 'var(--ink-muted)';
          const domainTint = c.top_domain
            ? DOMAIN_TINT[c.top_domain] ?? 'var(--ink-muted)'
            : 'var(--ink-faint)';
          const act = activityOf(c.role);
          const working = act === 'working' || act === 'reviewing';
          return (
            <button
              key={c.role}
              onClick={() => setOpenRole(c.role)}
              className="rounded-2xl p-3 text-left active:scale-[0.98]"
              style={{
                background: 'var(--glass-card)',
                border: `1px solid color-mix(in srgb, ${working ? `${domainTint} 40%, transparent)` : 'var(--glass-border)'}`,
              }}
              data-testid={`citizen-${c.role}`}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: `color-mix(in srgb, ${domainTint} 14%, transparent)`,
                    border: `1.5px solid ${domainTint}`,
                    boxShadow: working ? `0 0 10px color-mix(in srgb, ${domainTint} 40%, transparent)` : 'none',
                  }}
                >
                  <span style={{ fontSize: 'var(--fs-sm)', color: domainTint }}>
                    {c.name.slice(0, 1).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate capitalize"
                    style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-primary)' }}
                  >
                    {c.name}
                  </p>
                  <p
                    className="font-mono"
                    style={{ fontSize: 'var(--fs-micro)', color: tint }}
                  >
                    {c.tier}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <div
                  className="flex-1 h-1 rounded-full overflow-hidden"
                  style={{ background: 'var(--line-subtle)' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.round(c.reliability * 100)}%`, background: tint }}
                  />
                </div>
                <span
                  className="font-mono"
                  style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-muted)' }}
                >
                  {c.successes}✓ {c.failures ? `${c.failures}✗` : ''}
                </span>
              </div>
              {working && (
                <p
                  className="font-mono mt-1 animate-pulse"
                  style={{ fontSize: 'var(--fs-micro)', color: domainTint }}
                >
                  ● {act === 'reviewing' ? 'рецензує' : 'працює'}
                </p>
              )}
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex items-center justify-center p-6"
            style={{ background: 'rgba(20,15,8,0.72)' }}
            onClick={() => setOpenRole(null)}
            data-testid="citizen-dossier"
          >
            <motion.div
              initial={{ scale: 0.95, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.97 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-elevated rounded-2xl w-[520px] max-w-full max-h-full overflow-y-auto p-5"
            >
              <Dossier c={open} onClose={() => setOpenRole(null)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Dossier({ c, onClose }: { c: CitizenDossier; onClose: () => void }) {
  const tint = TIER_TINT[c.tier] ?? 'var(--ink-muted)';
  const domainTint = c.top_domain ? DOMAIN_TINT[c.top_domain] ?? 'var(--ink-muted)' : 'var(--ink-faint)';
  return (
    <>
      <div className="flex items-center gap-3">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: `color-mix(in srgb, ${domainTint} 14%, transparent)`, border: `2px solid ${domainTint}` }}
        >
          <span style={{ fontSize: 'var(--fs-lg)', color: domainTint }}>
            {c.name.slice(0, 1).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="capitalize" style={{ fontSize: 'var(--fs-lg)', color: 'var(--ink-primary)' }}>
            {c.name}
          </h2>
          <p className="font-mono" style={{ fontSize: 'var(--fs-xs)', color: tint }}>
            {c.tier} · {c.department ?? '—'} · надійність{' '}
            {Math.round(c.reliability * 100)}%
          </p>
        </div>
        <button
          onClick={onClose}
          className="min-w-[44px] min-h-[44px] rounded-xl active:scale-[0.95]"
          style={{ background: 'var(--glass-subtle)', color: 'var(--ink-secondary)' }}
          aria-label="закрити"
        >
          ✕
        </button>
      </div>

      {c.description && (
        <p className="mt-3" style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)' }}>
          {c.description}
        </p>
      )}

      <div className="grid grid-cols-4 gap-2 mt-4">
        <Stat label="виконано" value={String(c.successes)} tint="var(--signal-ok)" />
        <Stat label="зривів" value={String(c.failures)} tint="var(--signal-alert)" />
        <Stat label="ревізій" value={String(c.revisions)} tint="var(--primary)" />
        <Stat label="токенів" value={`${Math.round(c.tokens_produced / 1000)}k`} tint="var(--accent)" />
      </div>

      {Object.keys(c.domains).length > 0 && (
        <div className="mt-4">
          <p className="micro-label mb-2" style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-muted)' }}>
            ОПАНОВАНІ СФЕРИ
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(c.domains)
              .sort((a, b) => b[1] - a[1])
              .map(([d, n]) => (
                <span
                  key={d}
                  className="px-2 py-1 rounded-lg font-mono"
                  style={{
                    fontSize: 'var(--fs-micro)',
                    background: `color-mix(in srgb, ${DOMAIN_TINT[d] ?? 'var(--ink-faint)'} 10%, transparent)`,
                    color: DOMAIN_TINT[d] ?? 'var(--ink-muted)',
                  }}
                >
                  {d} ×{n}
                </span>
              ))}
          </div>
        </div>
      )}

      {c.recent_titles.length > 0 && (
        <div className="mt-4">
          <p className="micro-label mb-2" style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-muted)' }}>
            ОСТАННІ СПРАВИ
          </p>
          <ul className="flex flex-col gap-1">
            {c.recent_titles.slice().reverse().map((t, i) => (
              <li
                key={i}
                className="truncate"
                style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-secondary)' }}
              >
                · {t}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <div
      className="rounded-xl p-2 text-center"
      style={{ background: 'var(--glass-subtle)' }}
    >
      <p className="font-mono" style={{ fontSize: 'var(--fs-lg)', color: tint, lineHeight: 1.1 }}>
        {value}
      </p>
      <p style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-muted)' }}>{label}</p>
    </div>
  );
}
