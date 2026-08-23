import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronUp, Info, MapPinOff, ShieldAlert, Smartphone } from 'lucide-react';
import { formatDistance } from '../../../services/positioning/fuse';
import { SOURCE_LABEL } from '../../../services/positioning/types';
import type { FusedPosition } from '../../../services/positioning/types';
import { useNow } from '../../../hooks/useLayerObservation';

/** Упевненість словом: відсотки тут нічого не пояснюють. */
function confidenceWord(c: number): { text: string; dot: string } {
  if (c >= 0.7) return { text: 'місце надійне', dot: 'var(--signal-ok)' };
  if (c >= 0.4) return { text: 'місце приблизне', dot: 'var(--signal-warn)' };
  return { text: 'місцю вірити не можна', dot: 'var(--signal-alert)' };
}

/** Вік точки словом: свіжість — частина твердження, не деталь під тапом. */
function ageWord(ageMs: number): string {
  if (ageMs < 10_000) return 'щойно';
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)} с тому`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)} хв тому`;
  return `${Math.round(ageMs / 3_600_000)} год тому`;
}

/**
 * Де я і наскільки цьому можна вірити.
 *
 * Тут раніше стояли самі координати з підписом джерела. Але коли джерел
 * кілька і вони не згодні між собою, одна точка — це вже твердження, а не
 * факт. Чипс показує рішення, а тап розкриває, ЧОМУ саме таке.
 */
export function WhereChip({ position, pairedDevices = 0 }: {
  position: FusedPosition | null;
  /** 0 — телефона немає, і це найкорисніша підказка на цьому екрані. */
  pairedDevices?: number;
}) {
  const [open, setOpen] = useState(false);
  const now = useNow(1000);

  if (!position) {
    return (
      <div className="glass-card flex min-h-[44px] items-center gap-2 rounded-2xl px-3 py-2">
        <MapPinOff size={12} className="text-ink-muted" />
        <span className="text-[11px] font-semibold text-ink-secondary">Позиція</span>
        <span className="text-[11px] text-ink-muted">· джерел немає</span>
      </div>
    );
  }

  const conf = confidenceWord(position.confidence);
  const age = ageWord(Math.max(0, now - position.at));
  const worst = position.findings.reduce<'info' | 'warn' | 'alarm'>(
    (acc, f) => (f.level === 'alarm' ? 'alarm' : f.level === 'warn' && acc !== 'alarm' ? 'warn' : acc),
    'info',
  );

  return (
    <div className="glass-card w-full max-w-[240px] rounded-2xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Сховати, звідки місце' : 'Показати, звідки місце'}
        className="flex min-h-[44px] w-full flex-col items-start gap-0.5 px-3 py-2 text-left"
      >
        <div className="flex w-full items-center gap-2">
          <span className="block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: conf.dot }} aria-hidden />
          {/* Предмет названо: це чип про ПОЗИЦІЮ — щоб він не змагався
              безіменно з чипом приймача праворуч (гонтлет Р1, удар №5). */}
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
            Позиція
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink-primary">
            {position.label || SOURCE_LABEL[position.kind]}
          </span>
          {position.spoofSuspected ? (
            <ShieldAlert size={13} className="shrink-0 text-rose-600" aria-hidden />
          ) : worst === 'warn' ? (
            <AlertTriangle size={13} className="shrink-0 text-amber-600" aria-hidden />
          ) : null}
          {open ? <ChevronUp size={12} className="shrink-0 opacity-60" /> : <ChevronDown size={12} className="shrink-0 opacity-60" />}
        </div>
        <span className="text-[10px] text-ink-muted">
          ±{formatDistance(position.accuracyM)} · {age} · {conf.text}
        </span>
        {position.spoofSuspected && (
          <span className="text-[10px] font-semibold text-rose-600">Схоже на підміну сигналу</span>
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t border-black/5 px-3 py-2">
          <div className="text-[10px] text-ink-muted">
            Взято: <span className="font-semibold text-ink-secondary">{SOURCE_LABEL[position.kind]}</span>
            {position.candidates.length > 1 && ` · порівняно з ${position.candidates.length - 1} інш.`}
          </div>
          {position.findings.length === 0 ? (
            <div className="flex items-start gap-1.5 text-[10px] leading-snug text-ink-muted">
              <Info size={11} className="mt-[1px] shrink-0 opacity-60" />
              Джерела не суперечать одне одному.
            </div>
          ) : (
            position.findings.map((f, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span
                  className="mt-[5px] block h-1 w-1 shrink-0 rounded-full"
                  style={{
                    background:
                      f.level === 'alarm' ? 'var(--signal-alert)'
                        : f.level === 'warn' ? 'var(--signal-warn)' : 'var(--ink-muted)',
                  }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <div className="text-[10px] leading-snug text-ink-secondary">{f.text}</div>
                  {f.hint && <div className="text-[10px] leading-snug text-ink-muted">{f.hint}</div>}
                </div>
              </div>
            ))
          )}
          {/* Порада, якою не можна скористатись, — це не порада. Пара вже
              написана й живе в налаштуваннях; ведемо прямо туди. */}
          {pairedDevices === 0 && (
            <Link
              to="/settings/mobile"
              className="flex min-h-[44px] items-start gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 transition-colors hover:bg-amber-500/20"
            >
              <Smartphone size={11} className="mt-[3px] shrink-0 text-amber-700" />
              <div className="text-[10px] leading-snug text-ink-secondary">
                У цього ПК немає супутникового приймача.
                <span className="text-ink-muted"> Підключити телефон — місце стане точним до метрів.</span>
              </div>
            </Link>
          )}
          <div className="pt-0.5 font-mono text-[10px] tabular-nums text-ink-muted">
            {position.lat.toFixed(5)}, {position.lon.toFixed(5)}
          </div>
        </div>
      )}
    </div>
  );
}
