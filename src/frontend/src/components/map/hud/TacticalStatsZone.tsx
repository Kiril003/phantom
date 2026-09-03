import { CompassChip, GpsQualityChip, StatusChip, RenderTierChip } from './StatusChips';
import { useMapStore } from '../../../stores/mapStore';
import { useCapabilityStore } from '../../../stores/capabilityStore';

export function TacticalStatsZone() {
  const { tactical, loading, zoom } = useMapStore((s) => ({
    tactical: s.tactical,
    loading: s.loading,
    zoom: s.zoom,
  }));
  const renderTier = useCapabilityStore((s) => s.result?.tier ?? null);

  /* Один послідовний ряд станів, кожен зі своїм предметом (гонтлет Р1,
     удар №5): Мапа → Приймач → Курс → Графіка. Курс відомий лише коли
     є фікс — інакше bearing це неініціалізований нуль.

     Плита ОДНА на всі чотири. Доти кожен чипс ніс власне скло, і по
     правому краю мапи спускались сходами чотири окремі пігулки на 143 px
     висоти — правило форми №7 («скло витрачається двічі: одна плита хрому
     і щонайбільше один Hero») порушувалось вчетверо. Перекриттів не було,
     тобто виміряного дефекту теж; це борг форми, і виправляється він
     оболонкою, а не переписуванням чипсів: кожен уміє `bare`. */
  return (
    <div className="glass-card flex flex-col items-stretch rounded-2xl px-3 py-0.5 divide-y divide-black/5">
      <div className="py-0.5">
        <StatusChip loading={loading} zoom={zoom} bare />
      </div>
      <div className="py-0.5">
        <GpsQualityChip
          satellites={tactical.satellites}
          fix={tactical.fix}
          speed={tactical.speed}
          source={tactical.source}
          bare
        />
      </div>
      <div className="py-0.5">
        <CompassChip bearing={tactical.bearing} known={tactical.fix} bare />
      </div>
      <RenderTierChip tier={renderTier} bare />
    </div>
  );
}
