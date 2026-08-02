import { useMemo, useState } from 'react';
import { Info, ChevronDown, ChevronUp } from 'lucide-react';
import { useAttribution } from '../../../hooks/useAttribution';
import type { AttributionLine } from '../../../services/api';

/**
 * Phase 24-A — OmniMap AttributionDrawer.
 *
 * Top-right collapsible chip that surfaces the deduplicated attribution
 * union of every active map layer. Doctrine §1.6 (Map Doctrine in
 * `docs/phases/PHASE_24_OMNIMAP.md`): "Attribution accumulator is
 * always visible. … Жодна ліцензія не порушена жодного разу." This
 * component is the load-bearing UI for that promise.
 *
 * Collapsed: a single chip showing the count + the first credit. The
 * full list opens on tap. We never gate the visibility on user
 * preference — operators may shrink it but cannot hide it entirely,
 * matching the legal contract layer manifests imply.
 */

export interface AttributionDrawerProps {
  className?: string;
  /** Override polling cadence; tests pass 0 for manual control. */
  pollMs?: number;
}

export function AttributionDrawer({
  className = '',
  pollMs,
}: AttributionDrawerProps): JSX.Element {
  const { lines: rawLines, error } = useAttribution({ pollMs });
  const [open, setOpen] = useState(false);

  // Belt-and-suspenders: backend already dedupes by `text`, but render
  // with a unique key set anyway so a misbehaving server can never
  // produce duplicated React entries.
  const lines = useMemo<AttributionLine[]>(() => {
    const seen = new Set<string>();
    const out: AttributionLine[] = [];
    for (const line of rawLines) {
      if (seen.has(line.text)) continue;
      seen.add(line.text);
      out.push(line);
    }
    return out;
  }, [rawLines]);

  if (lines.length === 0 && !error) {
    return (
      <div
        data-testid="attribution-drawer-empty"
        className={`pointer-events-none select-none text-[10px] text-white/30 ${className}`}
      >
        джерел немає
      </div>
    );
  }

  const summary =
    error !== null
      ? 'джерела недоступні'
      : `джерел: ${lines.length}`;

  return (
    <div
      data-testid="attribution-drawer"
      className={`select-none rounded-md bg-black/55 backdrop-blur-md text-[10px] text-white/85 shadow-lg shadow-black/40 border border-white/5 ${className}`}
    >
      <button
        type="button"
        data-testid="attribution-drawer-toggle"
        aria-expanded={open}
        aria-label={open ? 'Згорнути джерела карти' : 'Розгорнути джерела карти'}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 min-h-[44px] hover:bg-white/5 transition-colors w-full"
      >
        <Info size={12} strokeWidth={1.75} className="opacity-70" />
        <span className="truncate max-w-[160px]" title={lines[0]?.text ?? summary}>
          {lines[0] ? lines[0].text : summary}
        </span>
        <span className="ml-auto text-white/45">{summary}</span>
        {open ? (
          <ChevronUp size={12} strokeWidth={1.75} className="opacity-70" />
        ) : (
          <ChevronDown size={12} strokeWidth={1.75} className="opacity-70" />
        )}
      </button>
      {open && (
        <ul
          data-testid="attribution-drawer-list"
          className="border-t border-white/5 px-2.5 py-1.5 space-y-1 max-w-[280px]"
        >
          {lines.map((line) => (
            <li key={line.text} className="flex items-baseline gap-1.5">
              <span className="flex-1 leading-snug">{line.text}</span>
              <span className="text-[9px] text-white/40 whitespace-nowrap">
                {line.license}
              </span>
            </li>
          ))}
          {error !== null && (
            <li className="text-[9px] text-amber-300/80">⚠ {error}</li>
          )}
        </ul>
      )}
    </div>
  );
}
