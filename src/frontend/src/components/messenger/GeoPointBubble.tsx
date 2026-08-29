import React, { useEffect, useState } from 'react';
import { MapPin, ArrowUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { GeoPoint } from '../../types/messenger';
import { ageLabel, coordsLabel, isStale, mapHref } from '../../services/messengerGeo';
import { soundFx } from '../../utils/messengerSound';

interface GeoPointBubbleProps {
  point: GeoPoint;
  /** Кадр приїхав зі скриньки — за законом №3 точка застаріла завжди. */
  viaMailbox?: boolean;
  isSelf?: boolean;
}

/**
 * Точка «я тут» у стрічці: координати, час ВИМІРУ і чесний вік.
 *
 * Свіжість тут не намальована один раз при завантаженні: бульбашка сама
 * перевіряє годинник, поки точка ще жива, і гасне рівно тоді, коли їй
 * виповнюється 90 секунд. Інакше залишена відкритою вкладка обіцяла б живе
 * положення годинами.
 *
 * Мініатюри мапи тут немає навмисно: полотно малює ATLAS, а друга жива мапа в
 * стрічці порушила б закон «одна поверхня». Кнопка веде на повну.
 */
export const GeoPointBubble: React.FC<GeoPointBubbleProps> = ({ point, viaMailbox, isSelf }) => {
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  const stale = isStale(point, { nowMs: now, viaMailbox });

  useEffect(() => {
    if (stale) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, [stale]);

  return (
    <div
      className={`p-3 rounded-2xl border mt-1 ${
        isSelf ? 'bg-[#FDF4EC] border-[#EBC7AE]' : 'bg-[#FDFCF9] border-[#DFD6C5]'
      } ${stale ? 'opacity-70' : ''}`}
      data-testid="geo-point-bubble"
    >
      <div className="flex items-start gap-2.5">
        <div
          className={`p-2 rounded-xl shrink-0 ${
            stale ? 'bg-[#F1EBDD] text-[#6E7568]' : 'bg-[#FCE7D8] text-[#E87A42]'
          }`}
        >
          <MapPin className="w-4 h-4" strokeWidth={1.75} />
        </div>

        <div className="min-w-0 flex-1">
          <h4 className="font-bold text-xs sm:text-sm truncate">
            {point.label || 'Моє місце'}
          </h4>
          <p className="text-[11px] font-mono tabular-nums opacity-80">
            {coordsLabel(point)}
          </p>
          <div className="flex items-center gap-2 mt-1 text-[10px] font-semibold">
            <span className={stale ? 'text-[#6E7568]' : 'text-[#3E7B44]'}>
              {ageLabel(point, { nowMs: now, viaMailbox })}
            </span>
            {point.accuracyM !== undefined && (
              <span className="text-[#6E7568] tabular-nums">±{point.accuracyM} м</span>
            )}
          </div>
          {viaMailbox && (
            <p className="text-[10px] text-[#6E7568] mt-1">
              Зі скриньки: чекала, поки канал був мертвий
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              soundFx.playTap();
              navigate(mapHref(point));
            }}
            className="mt-2 flex items-center gap-1 text-[11px] font-bold text-[#D96C35] hover:underline"
          >
            Відкрити на мапі
            <ArrowUpRight className="w-3 h-3" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
};
