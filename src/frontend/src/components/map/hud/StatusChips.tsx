import { useState } from 'react';
import { Compass, Satellite, Eye, EyeOff, Gauge, MonitorDown } from 'lucide-react';
import { useSystemStore } from '../../../stores/systemStore';
import type { RenderTier } from '../../../stores/capabilityStore';

/**
 * Чипси стану мапи.
 *
 * Тут стояв інженерний вивід: широта й довгота з п'ятьма знаками в окремій
 * панелі, «Пн · 000°», «06 | 0 км/год» і «z15». Людина від мапи хоче знати
 * не координати, а ДЕ вона і НАСКІЛЬКИ точно це відомо. Координати нікуди
 * не зникли — вони під тапом, коли справді потрібні.
 */

const SOURCE_LABELS: Record<string, string> = {
  ip_estimate: 'приблизно, за IP',
  gps: 'супутники',
  gps_hardware: 'супутники',
  network: 'за мережею',
  fused: 'зведено',
  manual: 'вказано вручну',
  browser_geolocation: 'за браузером',
  user_stated: 'з твоїх слів',
};

/** Точність словом: метри самі по собі мало кому щось кажуть. */
function accuracyWord(m: number | null | undefined): { text: string; dot: string } {
  if (m == null) return { text: 'точність невідома', dot: 'var(--ink-muted)' };
  if (m <= 15) return { text: `до ${Math.round(m)} м`, dot: 'var(--signal-ok)' };
  if (m <= 100) return { text: `близько ${Math.round(m)} м`, dot: 'var(--signal-warn)' };
  if (m < 1000) return { text: `розкид ${Math.round(m)} м`, dot: 'var(--signal-alert)' };
  return { text: `розкид ${(m / 1000).toFixed(1)} км`, dot: 'var(--signal-alert)' };
}

/**
 * Оболонка чипса стану. `bare` — коли чипс стоїть УСЕРЕДИНІ спільної
 * плити (TacticalStatsZone): скло малюється один раз навколо всіх, а не
 * чотири рази поспіль. Правило форми №7 — одна плита хрому на кадр.
 */
function shell(extra: string, bare?: boolean): string {
  return bare ? `flex items-center gap-2 ${extra}` : `glass-card flex items-center gap-2 px-3 rounded-full ${extra}`;
}

export function CoordinateReadout({ lat, lon, source }: {
  lat: number | null;
  lon: number | null;
  source: string;
}) {
  const where = useSystemStore((s) => s.context?.where);
  const [showRaw, setShowRaw] = useState(false);

  if (lat == null || lon == null || source === 'none') {
    return (
      <div className="glass-card flex items-center gap-2 px-3 py-2 rounded-full opacity-70">
        <EyeOff size={11} className="text-ink-muted" />
        <span className="text-[10px] font-semibold text-ink-secondary">Місце невідоме</span>
      </div>
    );
  }

  const acc = accuracyWord(where?.accuracy_m);
  const place = where?.place_name?.trim();
  const how = SOURCE_LABELS[source] ?? source.replace(/_/g, ' ');

  return (
    <button
      type="button"
      onClick={() => setShowRaw((v) => !v)}
      className="glass-card flex flex-col items-start gap-0.5 px-3 py-2 rounded-2xl min-h-[44px] text-left"
      aria-label={showRaw ? 'Сховати координати' : 'Показати координати'}
      title={showRaw ? 'Сховати координати' : 'Показати координати'}
    >
      <div className="flex items-center gap-2">
        <span
          className="block w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: acc.dot }}
          aria-hidden
        />
        <span className="text-[12px] font-semibold text-ink-primary truncate max-w-[190px]">
          {place || 'Десь тут'}
        </span>
      </div>
      <span className="text-[10px] text-ink-muted">
        {acc.text} · {how}
      </span>
      {showRaw && (
        <span className="font-mono text-[10px] text-ink-secondary tabular-nums pt-0.5">
          {lat.toFixed(5)}, {lon.toFixed(5)}
        </span>
      )}
    </button>
  );
}

/** Румб словом — «Пн · 000°» вимагало читати число, щоб зрозуміти напрямок. */
const RHUMB = ['Пн', 'Пн-Сх', 'Сх', 'Пд-Сх', 'Пд', 'Пд-Зх', 'Зх', 'Пн-Зх'];

/**
 * «Пн · 0°» поруч із «Приймача немає» — неініціалізований нуль у костюмі
 * показу (гонтлет Р1, удар №8/№11). Коли курс нема кому виміряти,
 * чип каже прочерк: прочерк — теж чесне слово.
 */
export function CompassChip({ bearing, known = true, bare }: { bearing: number; known?: boolean; bare?: boolean }) {
  if (!known) {
    return (
      <div
        className={shell('h-[30px]', bare)}
        title="Приймача немає — курс невідомий"
        data-testid="compass-chip"
        data-known="false"
      >
        <Compass size={14} strokeWidth={1.75} className="text-ink-muted" aria-hidden />
        <span className="text-[10px] font-semibold text-ink-secondary">Курс</span>
        <span className="text-[10px] text-ink-muted">· —</span>
      </div>
    );
  }
  const deg = ((Math.round(bearing) % 360) + 360) % 360;
  const word = RHUMB[Math.round(deg / 45) % 8];
  return (
    <div
      className={shell('h-[30px]', bare)}
      data-testid="compass-chip"
      data-known="true"
    >
      <Compass
        size={14}
        strokeWidth={1.75}
        className="text-amber-600"
        style={{ transform: `rotate(${bearing}deg)` }}
        aria-hidden
      />
      <span className="text-[10px] font-semibold text-ink-secondary">Курс</span>
      <span className="text-[10px] font-semibold text-ink-primary tabular-nums">
        · {word} · {deg}°
      </span>
    </div>
  );
}

/** Джерела, які супутників не бачать узагалі — це не «слабкий сигнал». */
const NO_RECEIVER = new Set(['browser_geolocation', 'ip_estimate', 'network', 'manual', 'user_stated', 'none']);

export function GpsQualityChip({ satellites, fix, speed, source = 'none', bare }: {
  satellites: number;
  fix: boolean;
  speed: number;
  source?: string;
  bare?: boolean;
}) {
  // Рухається — показуємо швидкість; стоїть — вона тільки шумить нулем.
  const moving = fix && speed >= 1;
  const satTone =
    satellites >= 6 ? 'text-emerald-600' : satellites >= 4 ? 'text-amber-600' : 'text-rose-600';

  // «0 супутників» читалось як несправний приймач. Приймача тут немає
  // взагалі: ESP32 з GNSS не підключений, місце приходить від браузера.
  // Це різні речі, і людина має бачити, яка саме. Предмет чипа — ПРИЙМАЧ:
  // правду про позицію тримає WhereChip унизу, і два бейджі про одне й те
  // саме воювали б між собою (гонтлет Р1, удар №5).
  if (!fix && NO_RECEIVER.has(source)) {
    return (
      <div
        className={shell('h-[30px]', bare)}
        title="Супутникового приймача на цьому ПК немає; позиція складається з мережевих джерел — див. чип позиції внизу ліворуч"
      >
        <Satellite size={12} strokeWidth={1.75} className="text-ink-muted" aria-hidden />
        <span className="text-[10px] font-semibold text-ink-secondary">Приймач</span>
        <span className="text-[10px] text-ink-muted">
          · немає · {source === 'none' ? 'місце невідоме' : 'місце за мережею'}
        </span>
      </div>
    );
  }

  return (
    <div className={shell('h-[30px]', bare)}>
      <span className="flex items-center gap-1.5">
        <Satellite size={12} strokeWidth={1.75} className="text-ink-muted" aria-hidden />
        <span className="text-[10px] font-semibold text-ink-secondary">Приймач</span>
        <span className={`text-[10px] font-semibold tabular-nums ${satTone}`}>
          · {satellites}
        </span>
        <span className="text-[10px] text-ink-muted">
          {satellites === 1 ? 'супутник' : satellites >= 2 && satellites <= 4 ? 'супутники' : 'супутників'}
        </span>
      </span>
      {moving && (
        <>
          <span className="text-ink-muted/40">·</span>
          <span className="flex items-center gap-1">
            <Gauge size={12} strokeWidth={1.75} className="text-ink-muted" aria-hidden />
            <span className="text-[10px] font-semibold text-ink-primary tabular-nums">
              {speed.toFixed(0)} км/год
            </span>
          </span>
        </>
      )}
    </div>
  );
}

/**
 * GPU capability-probe verdict (T0/T1/T2 — capabilityProbe.ts), rendered
 * as a state chip, never a dialog (render-paths.md §1d / map-plan.md R6:
 * "a small «спрощена графіка» state chip — state visibility, never an
 * apology dialog"). Silent for T0 (full quality, the common case).
 */
export function RenderTierChip({ tier, bare }: { tier: RenderTier | null; bare?: boolean }) {
  if (tier === null || tier === 'T0') return null;
  const hint =
    tier === 'T1'
      ? 'Слабка відеокарта: мапа малює менше деталей, щоб лишатись швидкою.'
      : 'Апаратне прискорення недоступне: мапа працює у спрощеному режимі.';
  return (
    <div
      className={shell('h-[30px]', bare)}
      title={hint}
      data-testid="render-tier-chip"
      data-tier={tier}
    >
      <MonitorDown size={12} strokeWidth={1.75} className="text-amber-600" aria-hidden />
      <span className="text-[10px] font-semibold text-ink-secondary">Графіка</span>
      <span className="text-[10px] font-semibold text-amber-700">· спрощена</span>
    </div>
  );
}

/**
 * «Наживо» без предмета воювало з «Приймача немає» та «стан невідомий» на
 * одному екрані (гонтлет Р1, удар №5). Предмет цього чипа — МАПА:
 * живість підложки, не позиції і не тривог.
 */
export function StatusChip({ loading, zoom, bare }: { loading: boolean; zoom: number; bare?: boolean }) {
  // z15 — жаргон рендерера. Людині корисніше знати, наскільки близько вона
  // дивиться: місто, район чи вулиця.
  const scale =
    zoom < 6 ? 'країна' : zoom < 9 ? 'область' : zoom < 12 ? 'місто' :
    zoom < 15 ? 'район' : zoom < 17 ? 'вулиці' : 'будинки';
  return (
    <div className={shell('h-[30px]', bare)}>
      {loading ? (
        <EyeOff size={12} strokeWidth={1.75} className="text-amber-600" aria-hidden />
      ) : (
        <Eye size={12} strokeWidth={1.75} className="text-emerald-600" aria-hidden />
      )}
      <span className="text-[10px] font-semibold text-ink-secondary">Мапа ·</span>
      <span
        className={`text-[10px] font-semibold ${loading ? 'text-amber-700' : 'text-emerald-700'}`}
      >
        {loading ? 'Синхронізую' : 'Наживо'}
      </span>
      <span className="text-[10px] text-ink-muted">· {scale}</span>
    </div>
  );
}
