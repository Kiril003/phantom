import { useEffect, useMemo, useState } from 'react';
import { Flame, RefreshCw, Square } from 'lucide-react';
import type { BakeSnapshot } from '@shared/types';
import { isTerminal, useBakeStore } from '../../../stores/bakeStore';
import {
  Bar,
  BakeStage,
  DoneView,
  DownloadStage,
  FailedView,
  MUTED,
  StageRail,
} from './bakeStageViews';
import { formatBytesUa as fmtBytes, formatDurationUa as fmtDuration } from '../../../utils/format';

/**
 * Картка печі дорожніх пакетів у панелі «Офлайн», реєстр «Дороги».
 *
 * Своєї правди не тримає: знімок приходить із бекенда повним і ЗАМІНЮЄ
 * попередній. Тому перезавантаження сторінки посеред випікання країни
 * нічого не губить — при монтуванні читаємо `GET /bake/jobs/current`, а
 * «триває» рахується від `started_at` бекенда, не від відкриття вкладки.
 *
 * Малювання стадій — у `bakeStageViews.tsx`; там же правило про смугу,
 * відсоток і знак «%».
 */

interface PickerRow {
  id: string;
  label: string;
  eligible: boolean;
  blockers: string[];
  sourceId: string | null;
}

function usePickerRows(): { rows: PickerRow[]; estimate: boolean } {
  const catalog = useBakeStore((s) => s.catalog);
  const capability = useBakeStore((s) => s.capability);
  return useMemo(() => {
    if (catalog) {
      const rows = catalog.scopes.map((s) => ({
        id: s.id,
        label: s.label_ua,
        eligible: s.eligible,
        blockers: s.blockers,
        sourceId: s.source_id,
      }));
      return { estimate: catalog.estimate, rows };
    }
    if (!capability) return { rows: [], estimate: false };
    // Запасний шлях: `/bake/scopes` іще немає. Стеля машини — все, що ми
    // знаємо, і перепони доводиться зіставляти за префіксом «{назва}: ».
    // Ні розміру завантаження, ні хоста звідси не дізнатись — і ми їх не
    // друкуємо, замість того щоб вигадати.
    const rows = capability.scopes.map((s) => {
      const mine = capability.blockers.filter((b) => b.startsWith(`${s.label_ua}: `));
      return { id: s.id, label: s.label_ua, eligible: mine.length === 0, blockers: mine, sourceId: null };
    });
    return { estimate: capability.estimate, rows };
  }, [catalog, capability]);
}

/** Ціна ПЕРЕД натисканням: гігабайт не має відкриватись після кнопки. */
function CostLine({ sourceId }: { sourceId: string | null }): JSX.Element {
  const src = useBakeStore((s) => s.catalog?.sources.find((x) => x.id === sourceId) ?? null);
  if (!src) {
    return <p className={MUTED}>Спершу завантажиться повний витяг OSM; його розміру бекенд не назвав.</p>;
  }
  const text = src.on_disk
    ? `Витяг «${src.label_ua}» уже на диску · ${fmtBytes(src.on_disk.bytes)} — завантаження не буде.`
    : src.remote.measured && src.remote.bytes != null
      ? `Завантажу «${src.label_ua}» · ${fmtBytes(src.remote.bytes)} з ${src.host}.`
      : `Потрібне завантаження з ${src.host}; розмір не поміряно.`;
  return (
    <p className={MUTED} data-testid="bake-cost">
      {text}
      {src.partial ? ` Недокачано ${fmtBytes(src.partial.bytes)}.` : ''}
    </p>
  );
}

function JobView(props: {
  job: BakeSnapshot;
  now: number;
  changedAt: number;
  root: string | null;
  busy: boolean;
  onCancel: () => void;
  onBack: () => void;
}): JSX.Element {
  const { job, now, changedAt, root, busy } = props;
  const done = isTerminal(job);
  const s = job.stage;
  // Вік знімка — за СТАРШИМ із двох свідків: коли бекенд востаннє писав і
  // коли лічильники востаннє зрушили. Бекенд може писати щосекунди, поки
  // піч стоїть — тоді бреше перший; сторінку могли щойно перезавантажити —
  // тоді бреше другий. Діагнозу не ставимо: людина сама вирішує, чекати чи ні.
  const ageS = Math.round((now - Math.min(Date.parse(job.updated_at) || now, changedAt || now)) / 1000);
  const elapsedS = Math.round((now - (Date.parse(job.started_at) || now)) / 1000);
  // `verifying` належить до «Завантаження», а не до «Випікання», і це не
  // косметика. Під ним малюється СПРАВЖНЯ смуга (розмір файла на диску —
  // чесний знаменник), а «Випікання» — єдиний сегмент, під яким смуги не буває
  // ніколи. Тримати звірку під словом «Випікання» означало показати рівно ту
  // картину, заради унеможливлення якої весь цей екран і збудований.
  const at =
    s === 'preflight' || s === 'downloading' || s === 'verifying' ? 0
      : s === 'done' ? 2
        : 1;

  return (
    <div className="flex flex-col gap-3">
      <StageRail at={at} pulse={changedAt > 0 && now - changedAt < 2000} />
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold">{job.label_ua}</span>
        <span className="tabular text-[10px] text-[color:var(--ink-muted)]">
          триває {fmtDuration(elapsedS)}
        </span>
      </div>

      {s === 'preflight' && <p className={MUTED}>Готуюсь.</p>}
      {s === 'downloading' && <DownloadStage d={job.download} />}
      {s === 'verifying' && (
        <Bar label="звірка контрольної суми" done={job.verify.bytes_hashed} total={job.verify.bytes_total} />
      )}
      {(s === 'indexing' || s === 'baking' || s === 'finalizing') && <BakeStage job={job} />}
      {s === 'done' && <DoneView job={job} root={root} />}
      {(s === 'failed' || s === 'cancelled') && <FailedView job={job} />}

      {!done && (
        <span className={MUTED} data-testid="bake-age">
          {ageS < 10 ? 'оновлено щойно' : `лічильники не змінюються ${fmtDuration(ageS)}`}
        </span>
      )}

      <button
        disabled={busy}
        onClick={done ? props.onBack : props.onCancel}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-black/[0.05] border border-black/10 text-[11px] font-semibold uppercase tracking-wider disabled:opacity-40"
      >
        {done ? 'До вибору обсягу' : <><Square size={11} /> Зупинити</>}
      </button>
    </div>
  );
}

export interface RoadPackBakerProps {
  className?: string;
}

export function RoadPackBaker({ className = '' }: RoadPackBakerProps): JSX.Element {
  const { snapshot, error, busy, countersChangedAt, refresh, loadCatalog, start, cancel, acknowledge } =
    useBakeStore();
  const root = useBakeStore((s) => s.catalog?.pack_root_abs ?? null);
  const { rows, estimate } = usePickerRows();
  const [picked, setPicked] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const running = snapshot != null && !isTerminal(snapshot);

  useEffect(() => {
    void loadCatalog();
    void refresh();
  }, [loadCatalog, refresh]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    // Сокет лише пришвидшує; правду тримає HTTP. Без цього перепиту
    // зачинений сокет виглядав би як спинена робота.
    if (!running) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [running, refresh]);

  const row = rows.find((r) => r.id === picked) ?? null;

  return (
    <div
      data-testid="road-pack-baker"
      className={`flex flex-col gap-3 p-4 w-[320px] rounded-2xl glass-elevated text-[color:var(--ink-primary)] ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame size={16} className="text-amber-600" />
          <span className="text-xs font-semibold uppercase tracking-wider">Дорожні пакети</span>
        </div>
        <button
          onClick={() => void refresh()}
          className="p-1.5 rounded-full hover:bg-black/10 transition-colors"
          title="Перечитати стан із бекенда"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="max-h-[336px] overflow-y-auto custom-scrollbar pr-1 flex flex-col gap-3">
        {snapshot ? (
          <JobView
            job={snapshot}
            now={now}
            changedAt={countersChangedAt}
            root={root}
            busy={busy}
            onCancel={() => void cancel()}
            onBack={acknowledge}
          />
        ) : (
          <>
            {estimate && <p className={MUTED}>Пороги — оцінки з запасом, не поміряні стелі.</p>}
            {rows.length === 0 && (
              <p className="py-6 text-center text-[color:var(--ink-muted)] italic text-xs">
                Бекенд не назвав жодного обсягу.
              </p>
            )}
            {rows.map((r) => (
              <div key={r.id} className="flex flex-col gap-1">
                <button
                  disabled={!r.eligible}
                  onClick={() => setPicked(r.id)}
                  data-testid={`bake-scope-${r.id}`}
                  className={`w-full text-left px-2.5 py-2 rounded-xl border text-[11px] font-medium transition-all ${
                    picked === r.id ? 'bg-amber-500/20 border-amber-500/40' : 'bg-black/[0.04] border-black/5'
                  } ${r.eligible ? 'hover:border-black/15' : 'opacity-45 cursor-not-allowed'}`}
                >
                  {r.label}
                </button>
                {/* Речення бекенда — дослівно, з його мірою і його причиною. */}
                {r.blockers.map((b) => (
                  <p key={b} className={`${MUTED} pl-1`}>
                    {b}
                  </p>
                ))}
              </div>
            ))}
            {row && <CostLine sourceId={row.sourceId} />}
            <button
              disabled={!row || busy}
              onClick={() => row && void start(row.id)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-700 text-[11px] font-semibold uppercase tracking-wider transition-all active:scale-[0.98] disabled:opacity-40"
            >
              <Flame size={14} />
              {row ? `Пекти «${row.label}»` : 'Оберіть обсяг'}
            </button>
          </>
        )}
        {error && <p className="text-[10px] text-rose-600 leading-snug">{error}</p>}
      </div>
    </div>
  );
}
