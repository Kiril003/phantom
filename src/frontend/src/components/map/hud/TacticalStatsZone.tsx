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
     є фікс — інакше bearing це неініціалізований нуль. */
  return (
    <div className="flex flex-col items-end gap-2">
      <StatusChip loading={loading} zoom={zoom} />
      <GpsQualityChip
        satellites={tactical.satellites}
        fix={tactical.fix}
        speed={tactical.speed}
        source={tactical.source}
      />
      <CompassChip bearing={tactical.bearing} known={tactical.fix} />
      <RenderTierChip tier={renderTier} />
    </div>
  );
}
