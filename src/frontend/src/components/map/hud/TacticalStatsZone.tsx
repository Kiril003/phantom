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

  return (
    <div className="flex flex-col items-end gap-2">
      <RenderTierChip tier={renderTier} />
      <CompassChip bearing={tactical.bearing} />
      <GpsQualityChip
        satellites={tactical.satellites}
        fix={tactical.fix}
        speed={tactical.speed}
        source={tactical.source}
      />
      <StatusChip loading={loading} zoom={zoom} />
    </div>
  );
}
