import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { BakeDownload, BakeOutcomeReason, BakeSnapshot } from '@shared/types';
import { formatBytesUa as fmtBytes, formatDurationUa as fmtDuration, pluralUa } from '../../../utils/format';

/**
 * Чисті малювальники стадій печі. Стану вони не мають і бекенда не чіпають —
 * усе, що вони показують, приходить у props зі знімка. Саме тому їх можна
 * перевірити фікстурою, і саме тому вони живуть окремо від картки.
 *
 * Дві стадії несиметричні, і вся будова саме про це.
 *
 * ЗАВАНТАЖЕННЯ має знаменник — `Content-Length`. Смуга й відсоток там ФАКТ.
 * Немає знаменника (`bytes_total === null`) — немає ні смуги, ні відсотка:
 * байти й швидкість, і все.
 *
 * ВИПІКАННЯ знаменника не має й мати не може: скільки доріг у файлі,
 * невідомо, доки файл не прочитано. Тому тут ЖОДНОГО відсотка, смуги чи
 * ETA — паливний покажчик проти одометра. Одометр не зламаний від того, що
 * в нього немає кінця: він доводить рух тим, що число росте. Числа
 * стрибають між знімками й НЕ анімуються до значення — плавність
 * намалювала б дані між вимірами, яких не існує.
 *
 * Знак «%» тут зарезервований за єдиним місцем, де відсоток є мірою
 * просування. Вільна памʼять — теж відсоток, але не просування, тож
 * пишеться словом; так стадія випікання не містить «%» у принципі.
 * Стереже це `__tests__/roadPackBaker.test.tsx`.
 */

const fmtCount = (n: number): string => n.toLocaleString('uk-UA');

/** Заголовок за причиною; саме пояснення завжди приходить із бекенда. */
const REASON_TITLE: Record<BakeOutcomeReason, string> = {
  low_memory: 'Піч зупинилась сама',
  low_disk: 'Забракло місця на диску',
  network: 'Мережа обірвалась',
  checksum: 'Контрольна сума не збіглась',
  worker_crashed: 'Робітник печі впав',
  worker_error: 'Робітник печі спинився з помилкою',
  corrupt: 'Витяг пошкоджений',
  unknown: 'Причина не названа',
  osmium_missing: 'Немає інструмента osmium',
  offline: 'Джерело недосяжне',
  unknown_scope: 'Невідомий обсяг',
  shutdown: 'Систему вимкнули',
  user: 'Зупинено вами',
};

export const LABEL = 'text-[9px] uppercase tracking-widest text-[color:var(--ink-muted)]';
export const ROW = 'flex items-baseline justify-between gap-2 text-[11px]';
export const MUTED = 'text-[10px] text-[color:var(--ink-muted)] leading-snug';

export const KV = ({ k, v }: { k: string; v: string }): JSX.Element => (
  <div className={ROW}>
    <span className={LABEL}>{k}</span>
    <span className="tabular">{v}</span>
  </div>
);

/** Смуга існує ЛИШЕ там, де є знаменник. Немає його — немає й повернення. */
export function Bar({ label, done, total }: { label: string; done: number; total: number | null }) {
  if (total == null) return null;
  const pct = Math.floor((done / Math.max(1, total)) * 100);
  return (
    <>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuenow={done}
        aria-valuemax={total}
        className="h-1.5 w-full bg-black/10 rounded-full overflow-hidden"
      >
        <div className="h-full bg-amber-500 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className={ROW}>
        <span className="tabular">{pct}%</span>
        <span className="tabular text-[color:var(--ink-muted)]">
          {fmtBytes(done)} з {fmtBytes(total)}
        </span>
      </div>
    </>
  );
}

/** Положення в трьох стадіях. Заповнення тут немає ніде — це не міра. */
export function StageRail({ at, pulse }: { at: 0 | 1 | 2; pulse: boolean }): JSX.Element {
  return (
    <div className="flex items-center gap-1.5" data-testid="bake-stage-rail" data-rail={at}>
      {['Завантаження', 'Випікання', 'Готово'].map((n, i) => (
        <div key={n} className="flex-1 flex flex-col gap-1">
          <div
            className="h-[3px] rounded-full"
            style={{
              background: i <= at ? 'var(--accent)' : 'var(--line-default)',
              // Сегмент випікання не наповнюється — він пульсує, коли
              // зрушив бодай один лічильник. Це доказ руху, не міра шляху.
              opacity: i === at ? (i === 1 ? (pulse ? 1 : 0.5) : 0.95) : i < at ? 0.85 : 0.45,
              transition: 'opacity 300ms linear',
            }}
          />
          <span className={LABEL} style={{ opacity: i === at ? 1 : 0.6 }}>
            {n}
          </span>
        </div>
      ))}
    </div>
  );
}

export function DownloadStage({ d }: { d: BakeDownload }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <Bar label="завантаження витягу" done={d.bytes_done} total={d.bytes_total} />
      {d.bytes_total == null && (
        // Не зникла функція — відсутнє число: сервер не назвав довжини.
        <div className={ROW}>
          <span className="tabular">{fmtBytes(d.bytes_done)}</span>
          <span className="text-[color:var(--ink-muted)]">сервер не назвав розміру</span>
        </div>
      )}
      <KV k="Швидкість" v={d.rate_bps != null ? `${fmtBytes(d.rate_bps)}/с` : 'не поміряно'} />
      {d.resumed_from_bytes > 0 && <KV k="Продовжено з" v={fmtBytes(d.resumed_from_bytes)} />}
      {d.from_cache && <p className={MUTED}>Витяг узято з диска.</p>}
    </div>
  );
}

/** Одометр: ані смуги, ані відсотка, ані ETA — і жодного знака «%». */
export function BakeStage({ job }: { job: BakeSnapshot }): JSX.Element {
  const b = job.bake;
  const rows: Array<[string, string]> = [
    ['Доріг прочитано', fmtCount(b.ways_seen)],
    ['Доріг узято', fmtCount(b.ways_kept)],
    ['Рядків записано', fmtCount(b.rows_written)],
    ['Клітин', fmtCount(b.cells)],
    ['Вхідний файл', fmtBytes(b.input_bytes)],
    ['У печі', fmtDuration(b.elapsed_s)],
    // Словом, не знаком: відсоток памʼяті — не міра просування, і сплутати
    // їх на одному екрані коштувало б довіри до обох.
  ];
  // Памʼять — рядок УМОВНИЙ. `null` означає «не поміряли», і намалювати тут
  // «null відсотків» (як робив старий нениций тип) або «0» — два різні способи
  // збрехати про те саме. Рядка просто немає, доки немає виміру.
  if (b.ram_available_pct !== null) {
    rows.push([
      'Вільної памʼяті',
      `${b.ram_available_pct} ${pluralUa(b.ram_available_pct, 'відсоток', 'відсотки', 'відсотків')}`,
    ]);
  }
  return (
    <div className="flex flex-col gap-1" data-testid="bake-counters">
      {rows.map(([k, v]) => (
        <KV key={k} k={k} v={v} />
      ))}
    </div>
  );
}

export function DoneView({ job, root }: { job: BakeSnapshot; root: string | null }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const p = job.pack;
  const name = p?.rel_path ?? p?.filename ?? p?.pack_id ?? null;
  const full = root && p?.rel_path ? `${root}/${p.rel_path}` : name;
  return (
    <div className="flex flex-col gap-2" data-testid="bake-done">
      <span className="text-[11px] font-semibold">Пакет «{job.label_ua}» спечено</span>
      {p && (
        <div className="flex flex-col gap-1">
          <KV k="Формат" v={String(p.format_version)} />
          <KV k="Доріг" v={fmtCount(p.way_count)} />
          <KV k="Розмір" v={fmtBytes(p.bytes)} />
          <KV k="SHA-256" v={`${p.sha256.slice(0, 16)}…`} />
        </div>
      )}
      {full && (
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(full);
            setCopied(true);
          }}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-black/[0.05] border border-black/5 text-[10px] text-left break-all"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          <span className="flex-1">{full}</span>
        </button>
      )}
      {/*
        Кожне слово цього шляху прочитане в дереві телефона, не вигадане.
        Посилання тут не для гарного тону: підписи живуть в ІНШОМУ репозиторії
        з іншим темпом релізів і колись поїдуть. З ними наступний зможе
        перевірити шлях за хвилину замість того, щоб вірити на слово.

          «Стратегія»              — feature-stream/…/values/strings_intel.xml:36
                                     (`nav_tab_strategy`), вхід зі Скрині:
                                     app/…/ui/ChestSheet.kt:97
          «РЕБ та Супутники»       — feature-stream/…/values/strings_strategy.xml:8-9
                                     (`strategy_section_telemetry`), картка веде
                                     на Routes.Precision:
                                     feature-stream/…/ui/strategy/StrategyScreen.kt:135
          «ОФЛАЙН-ДОРОГИ»          — feature-precision/…/PrecisionScreen.kt:316
          «Внести файл пакета…»    — feature-precision/…/PrecisionScreen.kt:449

        Звірено 05.09.2026 на двох деревах phantom-companion — `rebuild/mobile-day1`
        і `integration/beta` (з якого зібрано бету); підписи збіглись.

        Чого тут бути НЕ може: «готовий для телефона», «в мережі», «синхронізовано»
        чи зелена крапка. Чи прийме пакет застосунок, вирішує його версія формату,
        а ПК іще не віддає пакети телефону — тож єдина чесна відповідь на «і що
        далі?» це дорога, якою людина понесе файл руками.
      */}
      <p className="text-[11px] leading-snug">Перенесіть файл на телефон і внесіть його:</p>
      <p className="text-[11px] leading-snug font-medium" data-testid="bake-phone-path">
        Скриня → «Стратегія» → «РЕБ та Супутники» → «ОФЛАЙН-ДОРОГИ» → «Внести файл пакета
        вручну»
      </p>
    </div>
  );
}

export function FailedView({ job }: { job: BakeSnapshot }): JSX.Element {
  const o = job.outcome;
  if (!o) return <p className="text-[11px]">Робота скінчилась, але бекенд не сказав чим.</p>;
  return (
    <div className="flex flex-col gap-1.5" data-testid={`bake-outcome-${o.reason ?? 'none'}`}>
      {/* `reason` — null РІВНО коли все вийшло. Індексувати ним Record не можна
          ні типом, ні змістом: вийшло б `undefined` саме в мить успіху. */}
      <span className="text-[11px] font-semibold">
        {o.reason ? REASON_TITLE[o.reason] : 'Робота спинилась'}
      </span>
      {/* Зупинка за памʼяттю — очікуваний вихід, не аварія. Чому саме так і
          за якою межею — каже бекенд у `detail_ua`; тут ЖОДНОГО числа. */}
      {o.reason === 'low_memory' && <span className={MUTED}>Це передбачений вихід, а не збій.</span>}
      <p className="text-[11px] leading-snug" data-testid="bake-detail-ua">
        {o.detail_ua}
      </p>
    </div>
  );
}
