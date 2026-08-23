import React from 'react';

/**
 * CockpitCell — спільна оболонка чарунки «Кокпіта» (Ф4).
 *
 * Доктрина Ф4 на рівні оболонки:
 * - кожна картка НАЗИВАЄ джерело (чіп) і час зрізу («станом на») —
 *   число без джерела і віку тут не існує;
 * - live-барва (пульсуюча крапка) — ЛИШЕ коли фід справді живий
 *   (проп live=true ставить його власник чарунки, який знає, чи
 *   з'єднання тримається просто зараз); мертвий фід — сіра крапка.
 */

export function CockpitCell({
  title,
  source,
  asOf,
  live,
  actions,
  children,
}: {
  /** Слово-назва чарунки. */
  title: string;
  /** Звідки живуть числа — назва джерела, не вигадка. */
  source: string;
  /** «станом на …» — час останнього успішного зрізу; null — зрізу ще не було. */
  asOf: Date | null;
  /**
   * true — фід живий просто зараз (WS тримається / останній полінг
   * щойно відповів). undefined — чарунка взагалі не претендує на live.
   */
  live?: boolean;
  /** Правий край хедера: кнопки чарунки. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="flex flex-col min-h-0 rounded-2xl border backdrop-blur-xl shadow-xl overflow-hidden"
      style={{ background: 'var(--surface-raised)', borderColor: 'var(--glass-border)' }}
    >
      <header
        className="flex items-center gap-2 px-4 py-2.5 border-b shrink-0"
        style={{ borderColor: 'var(--glass-border)' }}
      >
        {live !== undefined && (
          <span
            aria-label={live ? 'фід живий' : 'фід не живий'}
            className={`w-2 h-2 rounded-full shrink-0 ${live ? 'bg-emerald-400 animate-pulse' : ''}`}
            style={live ? undefined : { background: 'var(--ink-faint)' }}
          />
        )}
        <h3
          className="text-sm font-medium truncate"
          style={{ color: 'var(--ink-primary)' }}
        >
          {title}
        </h3>
        <span
          className="text-[10px] uppercase px-1.5 py-0.5 rounded border truncate"
          style={{
            color: 'var(--ink-muted)',
            borderColor: 'var(--glass-border)',
            letterSpacing: 'var(--tracking-widest, 0.15em)',
          }}
          title={`джерело: ${source}`}
        >
          {source}
        </span>
        <span className="flex-1" />
        {asOf !== null && (
          <span className="text-[11px] whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>
            станом на {hhmmss(asOf)}
          </span>
        )}
        {actions}
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">{children}</div>
    </section>
  );
}

/** Слово-відмова на всю чарунку — коли джерело мовчить або порожнє. */
export function CellWord({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full min-h-[96px] flex items-center justify-center text-center px-6 py-4">
      <span className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        {children}
      </span>
    </div>
  );
}

/* ── Форматери ────────────────────────────────────────────────────────── */

export function hhmmss(d: Date): string {
  return d.toLocaleTimeString('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const GIB = 1024 ** 3;

export function gib(bytes: number): string {
  return `${(bytes / GIB).toFixed(1)} ГіБ`;
}

/** Аптайм словами: 3д 4г 07хв / 2г 05хв / 7хв. */
export function uptimeWord(totalS: number): string {
  const d = Math.floor(totalS / 86400);
  const h = Math.floor((totalS % 86400) / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  if (d > 0) return `${d}д ${h}г ${String(m).padStart(2, '0')}хв`;
  if (h > 0) return `${h}г ${String(m).padStart(2, '0')}хв`;
  return `${m}хв`;
}

/** Вік від ISO-мітки словами: щойно / 5 хв тому / 3 г тому / 2 д тому. */
export function ageWord(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'щойно';
  if (s < 3600) return `${Math.floor(s / 60)} хв тому`;
  if (s < 86400) return `${Math.floor(s / 3600)} г тому`;
  return `${Math.floor(s / 86400)} д тому`;
}
