import { useState } from 'react';
import {
  Activity, BookOpen, Clock, Flame, HardDrive, Layers, Library, MapPin, Pentagon,
  Radar, Route, Ruler, Shield, Sparkles, Wifi,
} from 'lucide-react';
import { ScaleBar } from './ScaleBar';
import { MapRail, type RailItem } from './MapRail';
import { ViewControls } from './ViewControls';
import { TacticalStatsZone } from './TacticalStatsZone';
import { SearchBar } from './SearchBar';
import { NavigationToolbar } from './NavigationToolbar';
import { TimeMachineSlider } from './TimeMachineSlider';
import { WhereChip } from './WhereChip';
import { usePosition } from '../../../hooks/usePosition';
import { AttributionDrawer } from './AttributionDrawer';
import { CoordReadout } from './CoordReadout';
import { RoutingTool } from './RoutingTool';
import { RulerTool } from './RulerTool';
import { GeofenceDrawTool } from './GeofenceDrawTool';
import { AirRaidLayer } from '../layers/AirRaidLayer';
import { NearbyPanel } from '../NearbyPanel';

import { useMapStore, type MapLayerKey } from '../../../stores/mapStore';
import { useMapAgentBridge } from '../../../hooks/useMapAgentBridge';
import type { RouteAlternative } from '../../../services/api';

/** "12.4 км · 18 хв" — відстань округлена, час у цілих хвилинах. */
function formatRouteSummary(alt: RouteAlternative): string {
  const km = alt.distance_m / 1000;
  const distance = km >= 10 ? `${Math.round(km)} км` : `${km.toFixed(1)} км`;
  return `${distance} · ${Math.max(1, Math.round(alt.duration_s / 60))} хв`;
}

/**
 * Каркас HUD мапи для екрана 1024×600.
 *
 * До цього тут було вісім незалежних островів: стан системи (вдруге, він уже
 * є у верхній панелі), рейка на п'ятнадцять кнопок із власним скролом, три
 * горизонтальні смуги одна над одною внизу і чотири окремі речі праворуч на
 * чотирьох різних відступах. Жоден елемент не був вирівняний по жодному
 * іншому.
 *
 * Тепер це система з чотирьох місць і однієї відстані (12 px):
 *   згори   — камера ліворуч, тривога по центру, стан праворуч;
 *   рейки   — ліворуч ЩО намальовано, праворуч ЩО з цим робити;
 *   знизу   — де я, чим керую, що поруч: один рядок між рейками;
 *   панелі  — висуваються поверх, а не живуть на екрані постійно.
 */

export interface HudShellProps {
  bearing?: number | null;
  mapStyle: string;
  onCycleStyle: () => void;
  onResetBearing: () => void;
  onToggleTilt: () => void;
  tilted: boolean;
  timelineOpen: boolean;
  onToggleTimeline: () => void;
  offlineOpen: boolean;
  onToggleOffline: () => void;
  analysisOpen: boolean;
  onToggleAnalysis: () => void;
  storyOpen: boolean;
  onToggleStory: () => void;
  ghostOpen: boolean;
  onToggleGhost: () => void;

  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenter: () => void;
  onAddPoi: () => void;

  bridgeAgent?: boolean;
  /**
   * Обовʼязковий навмисно. Поки він був необовʼязковим, його загубила
   * деструктуризація — і TypeScript мовчав, бо мовчати йому дозволяв
   * саме знак питання.
   */
  onOpenLibrary: () => void;
  onSearchResults?: (results: unknown) => void;
  className?: string;
}

const LAYERS: Array<{ key: MapLayerKey; icon: JSX.Element; label: string; short: string }> = [
  { key: 'base', icon: <Layers size={18} strokeWidth={1.75} />, label: 'Основа', short: 'Основа' },
  { key: 'presence', icon: <Radar size={18} strokeWidth={1.75} />, label: 'Присутність', short: 'Поруч' },
  { key: 'wardriving', icon: <Wifi size={18} strokeWidth={1.75} />, label: 'Мережі', short: 'Мережі' },
  { key: 'heatmap', icon: <Flame size={18} strokeWidth={1.75} />, label: 'Теплокарта', short: 'Тепло' },
  { key: 'intel', icon: <MapPin size={18} strokeWidth={1.75} />, label: 'Місця', short: 'Місця' },
  { key: 'recon', icon: <Route size={18} strokeWidth={1.75} />, label: 'Розвідка', short: 'Розвідка' },
  { key: 'facts', icon: <Sparkles size={18} strokeWidth={1.75} />, label: 'Спогади', short: 'Спогади' },
];

export function HudShell({
  bearing = null,
  mapStyle,
  onCycleStyle,
  onResetBearing,
  onToggleTilt,
  tilted,
  timelineOpen,
  onToggleTimeline,
  offlineOpen,
  onToggleOffline,
  analysisOpen,
  onToggleAnalysis,
  storyOpen,
  onToggleStory,
  ghostOpen,
  onToggleGhost,
  onZoomIn,
  onZoomOut,
  onCenter,
  onAddPoi,
  bridgeAgent = true,
  onOpenLibrary,
  onSearchResults,
  className = '',
}: HudShellProps): JSX.Element {
  useMapAgentBridge({ skip: !bridgeAgent });
  const [routingActive, setRoutingActive] = useState(false);
  const [geofenceActive, setGeofenceActive] = useState(false);
  // Ф2 метрологія: лінійка теж міряє кліки по мапі, тому інструменти,
  // що слухають клік, взаємовиключні — інакше одна дія двом хазяям.
  const [rulerActive, setRulerActive] = useState(false);

  const tactical = useMapStore((s) => s.tactical);
  const zoom = useMapStore((s) => s.zoom);
  const center = useMapStore((s) => s.center);
  const { position, pairedDevices } = usePosition();
  const layers = useMapStore((s) => s.layers);
  const toggleLayer = useMapStore((s) => s.toggleLayer);
  const searchQuery = useMapStore((s) => s.searchQuery);
  const setSearchQuery = useMapStore((s) => s.setSearchQuery);
  const setToast = useMapStore((s) => s.setToast);
  const pois = useMapStore((s) => s.pois);
  const wardrivingRecords = useMapStore((s) => s.wardrivingRecords);
  const heatmap = useMapStore((s) => s.heatmap);
  const track = useMapStore((s) => s.track);
  const geoTaggedFacts = useMapStore((s) => s.geoTaggedFacts);
  const route = useMapStore((s) => s.route);
  const routing = useMapStore((s) => s.routing);
  const routeError = useMapStore((s) => s.routeError);
  const planRoute = useMapStore((s) => s.planRoute);
  const clearRoute = useMapStore((s) => s.clearRoute);

  const lat = tactical.lat ?? 50.45;

  /**
   * Скільки записів справді стоїть за кожним шаром. П'ять із семи кнопок
   * вмикали порожнечу — світились бурштином і не малювали нічого, бо
   * малювати не було чого. Кнопка мусить казати правду про свій шар.
   */
  const counts: Partial<Record<MapLayerKey, number>> = {
    presence: null as unknown as number,
    wardriving: wardrivingRecords.length,
    heatmap: heatmap.length,
    intel: pois.length,
    recon: track.length,
    facts: geoTaggedFacts.length,
  };

  const layerItems: RailItem[] = [
    ...LAYERS.map((item) => ({
      key: item.key,
      icon: item.icon,
      label: item.label,
      short: item.short,
      active: layers[item.key],
      count: item.key === 'base' || item.key === 'presence' ? null : counts[item.key] ?? 0,
      onClick: () => {
        const n = counts[item.key];
        if (typeof n === 'number' && n === 0) {
          setToast(`${item.label}: записів ще немає`);
          return;
        }
        toggleLayer(item.key);
      },
    })),
    /**
     * Сім кнопок вище — улюблені шари. Реєстр знає ще двадцять шість, і
     * доти вони не мали жодних дверей: панель була змонтована, але
     * відкрити її не міг ніхто. Питання те саме — що на мапі, — тому
     * вхід стоїть на цій рейці, а не серед інструментів.
     */
    {
      key: 'library',
      icon: <Library size={18} strokeWidth={1.75} />,
      label: 'Бібліотека шарів',
      short: 'Реєстр',
      count: null,
      onClick: onOpenLibrary,
    },
  ];

  const toolItems: RailItem[] = [
    {
      key: 'route',
      icon: <Route size={18} strokeWidth={1.75} />,
      label: 'Прокласти маршрут',
      short: 'Маршрут',
      active: routingActive,
      onClick: () => {
        setRoutingActive((v) => !v);
        setGeofenceActive(false);
        setRulerActive(false);
      },
    },
    {
      key: 'geofence',
      icon: <Pentagon size={18} strokeWidth={1.75} />,
      label: 'Окреслити зону',
      short: 'Зона',
      active: geofenceActive,
      onClick: () => {
        setGeofenceActive((v) => !v);
        setRoutingActive(false);
        setRulerActive(false);
      },
    },
    {
      key: 'ruler',
      icon: <Ruler size={18} strokeWidth={1.75} />,
      label: 'Лінійка — відстань і азимут',
      short: 'Лінійка',
      active: rulerActive,
      onClick: () => {
        setRulerActive((v) => !v);
        setRoutingActive(false);
        setGeofenceActive(false);
      },
    },
    { key: 'time', icon: <Clock size={18} strokeWidth={1.75} />, label: 'Машина часу', short: 'Час', active: timelineOpen, onClick: onToggleTimeline },
    { key: 'analysis', icon: <Activity size={18} strokeWidth={1.75} />, label: 'Аналіз', short: 'Аналіз', active: analysisOpen, onClick: onToggleAnalysis },
    { key: 'story', icon: <BookOpen size={18} strokeWidth={1.75} />, label: 'Історія', short: 'Історія', active: storyOpen, onClick: onToggleStory },
    { key: 'ghost', icon: <Shield size={18} strokeWidth={1.75} />, label: 'Привид', short: 'Привид', active: ghostOpen, onClick: onToggleGhost },
    { key: 'offline', icon: <HardDrive size={18} strokeWidth={1.75} />, label: 'Офлайн', short: 'Офлайн', active: offlineOpen, onClick: onToggleOffline },
  ];

  return (
    <div data-testid="hud-shell" className={`pointer-events-none absolute inset-0 z-30 ${className}`}>
      <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-3">
        <div className="pointer-events-auto">
          <ViewControls
            bearing={tactical.bearing ?? bearing ?? 0}
            mapStyle={mapStyle}
            tilted={tilted}
            onCycleStyle={onCycleStyle}
            onToggleTilt={onToggleTilt}
            onResetBearing={onResetBearing}
          />
        </div>
        {/* «стан невідомий · дані не надходили» висіло без предмета і
            воювало з «Наживо» сусіднього чипа (гонтлет Р1, удар №5).
            Сам бейдж — нутрощі шару, тому предмет підписує каркас;
            has-гард ховає підпис, якщо шар нічого не намалював. */}
        <div className="pointer-events-auto hidden items-center gap-1.5 pt-1 has-[[data-alert-state]]:flex">
          <span
            className="flex items-center rounded-md border border-white/5 bg-black/55 px-2 py-1 text-[10px] uppercase tracking-wider text-white/85 backdrop-blur-md"
            title="Повітряні тривоги по Україні · alerts.in.ua"
          >
            Тривоги
          </span>
          <AirRaidLayer />
        </div>
        <div className="pointer-events-auto">
          <TacticalStatsZone />
        </div>
      </div>

      <div className="pointer-events-auto absolute left-3 top-1/2 -translate-y-1/2">
        <MapRail items={layerItems} ariaLabel="Шари мапи" />
      </div>

      <div className="pointer-events-auto absolute right-3 top-1/2 -translate-y-1/2">
        <MapRail items={toolItems} ariaLabel="Інструменти мапи" />
      </div>

      {/* Інструмент відкривається біля своєї кнопки на рейці, а не висить
          окремим островом посеред правого краю. */}
      {routingActive && (
        <div className="pointer-events-auto absolute right-[80px] top-1/2 -translate-y-1/2">
          <RoutingTool
            active
            onToggle={() => setRoutingActive(false)}
            onPlan={(from, to) => void planRoute(from, to)}
            loading={routing}
            error={routeError}
            summary={route ? formatRouteSummary(route.result.primary) : null}
            onClear={clearRoute}
          />
        </div>
      )}
      {geofenceActive && (
        <div className="pointer-events-auto absolute right-[80px] top-1/2 -translate-y-1/2">
          <GeofenceDrawTool active onToggle={() => setGeofenceActive(false)} />
        </div>
      )}
      {rulerActive && <RulerTool onClose={() => setRulerActive(false)} />}

      {/* Машина часу з'являється разом зі своєю панеллю, а не стоїть на
          екрані завжди — постійний степер із датою нікуди не вів. */}
      {timelineOpen && (
        <div className="pointer-events-auto absolute bottom-[146px] left-1/2 -translate-x-1/2">
          <TimeMachineSlider />
        </div>
      )}

      {/* Один рядок замість трьох смуг. Живе МІЖ рейками, тому 76 px.
          Бічні колонки однакової ширини — інакше `justify-between` ставить
          «центр» будь-де, тільки не по центру. */}
      <div className="absolute bottom-[84px] left-[76px] right-[76px] flex items-end gap-3">
        {/* Атрибуція переїхала сюди з правого верху: там вона лягала на
            рейку інструментів на 54×38 px. Місце ліворуч унизу — те саме,
            де її тримає кожна мапа світу. */}
        <div className="pointer-events-auto flex w-[168px] shrink-0 flex-col items-start gap-1.5">
          <WhereChip position={position} pairedDevices={pairedDevices} />
          <ScaleBar zoom={zoom} lat={lat} />
          <AttributionDrawer />
        </div>

        <div className="pointer-events-auto flex min-w-0 flex-1 items-center justify-center gap-2">
          <SearchBar value={searchQuery} onChange={setSearchQuery} onResults={onSearchResults} />
          <NavigationToolbar
            onZoomIn={onZoomIn}
            onZoomOut={onZoomOut}
            onCenter={onCenter}
            onAddPoi={onAddPoi}
            fix={tactical.fix}
          />
        </div>

        {/* «Поруч» шукало біля позиції з браузера — а вона на цій машині
            за 8 км від того, що на екрані. Поруч — це поруч із тим, на що
            людина дивиться. */}
        <div className="pointer-events-auto flex w-[168px] shrink-0 justify-end">
          <NearbyPanel lat={center?.[1] ?? tactical.lat} lon={center?.[0] ?? tactical.lon} zoom={zoom} onSelect={() => {}} />
        </div>
      </div>

      {/* Метрологія (Ф2, У6): координата під курсором — нижній край
          пейна, під головним рядком, який стоїть на 84 px. */}
      <div className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2">
        <CoordReadout />
      </div>
    </div>
  );
}
