import { CompassChip, GpsQualityChip, StatusChip } from './StatusChips';
import { useMapStore } from '../../../stores/mapStore';

export function TacticalStatsZone() {
  const { tactical, loading, zoom } = useMapStore((s) => ({
    tactical: s.tactical,
    loading: s.loading,
    zoom: s.zoom,
  }));

  return (
    <div className="flex flex-col items-end gap-2">
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
