import { useMapStore } from '../../../stores/mapStore';
import { SearchBar } from './SearchBar';
import { TimeMachineSlider } from './TimeMachineSlider';
import { NavigationToolbar } from './NavigationToolbar';

export function NavigationZone({
  onZoomIn,
  onZoomOut,
  onCenter,
  onAddPoi,
  onSearchResults,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenter: () => void;
  onAddPoi: () => void;
  onSearchResults?: (results: any) => void;
}) {
  const { searchQuery, setSearchQuery, tactical } = useMapStore((s) => ({
    searchQuery: s.searchQuery,
    setSearchQuery: s.setSearchQuery,
    tactical: s.tactical,
  }));

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Search results overlap handling should be here or in SearchBar */}
      <SearchBar 
        value={searchQuery} 
        onChange={setSearchQuery} 
        onResults={onSearchResults}
      />
      
      <div className="flex items-center gap-6">
        <TimeMachineSlider />
        <NavigationToolbar 
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onCenter={onCenter}
          onAddPoi={onAddPoi}
          fix={tactical.fix}
        />
      </div>
    </div>
  );
}
