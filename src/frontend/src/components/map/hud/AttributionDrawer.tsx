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

  // Білий на 30% висів голим текстом просто над мапою: на світлому стилі
  // його не було видно взагалі. Плашка та сама, що й у повного варіанта.
  if (lines.length === 0 && !error) {
    return (
      <div
        data-testid="attribution-drawer-empty"
        className={`glass-card pointer-events-none select-none rounded-full px-2.5 py-1 text-[10px] text-[color:var(--ink-muted)] ${className}`}
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
      /* Темна плашка з білим текстом лишалась від старого «тактичного»
         вигляду. На світлій мапі вона була найконтрастнішим об'єктом на
         екрані — тобто найважливішим. Ліцензія важлива, але не настільки. */
      className={`glass-card select-none rounded-full text-[10px] text-[color:var(--ink-secondary)] ${className}`}
    >
      <button
        type="button"
        data-testid="attribution-drawer-toggle"
        aria-expanded={open}
        aria-label={open ? 'Згорнути джерела карти' : 'Розгорнути джерела карти'}
        onClick={() => setOpen((v) => !v)}
        /* Згорнутий вигляд був плашкою на 280 px і 44 px заввишки — вона
           накривала правий верх мапи щоразу. Ліцензія лишається на екрані
           завжди, але як чипс у ряд із рештою, а не як банер. Область
           дотику домальована псевдоелементом, щоб палець не схибив. */
        className="relative flex min-h-[26px] w-full max-w-[168px] items-center gap-1.5 px-2.5 py-1 transition-colors hover:bg-white/5 after:absolute after:inset-x-0 after:-inset-y-[9px] after:content-['']"
      >
        <Info size={12} strokeWidth={1.75} className="shrink-0 opacity-70" />
        {/* Лічильник джерел жив тут другим написом і розтягував чипс до
            190 px — той наповзав на поле пошуку. Він нікуди не подівся,
            просто чекає у розгорнутому списку.
            Довгий кредит ПЕРЕНОСИТЬСЯ, а не ріжеться: «© OpenStreetMap
            co…» — ліцензійний борг ODbL (гонтлет Р1, удар №8), повний
            текст атрибуції мусить бути видимим завжди. */}
        <span className="min-w-0 flex-1 text-left leading-tight">
          {lines[0] ? lines[0].text : summary}
        </span>
        <span className="sr-only">{summary}</span>
        {open ? (
          <ChevronUp size={12} strokeWidth={1.75} className="opacity-70" />
        ) : (
          <ChevronDown size={12} strokeWidth={1.75} className="opacity-70" />
        )}
      </button>
      {open && (
        <ul
          data-testid="attribution-drawer-list"
          className="max-w-[280px] space-y-1 border-t border-black/5 px-2.5 py-1.5"
        >
          {lines.map((line) => (
            <li key={line.text} className="flex items-baseline gap-1.5">
              <span className="flex-1 leading-snug">{line.text}</span>
              <span className="whitespace-nowrap text-[9px] text-[color:var(--ink-muted)]">
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
