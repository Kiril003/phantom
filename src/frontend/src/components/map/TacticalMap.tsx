import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { MapContext } from './MapContext';
import { BaseLayer } from './layers/BaseLayer';
import { PresenceLayer } from './layers/PresenceLayer';
import { RouteLayer } from './layers/RouteLayer';
import { WardrivingLayer } from './layers/WardrivingLayer';
import { IntelLayer } from './layers/IntelLayer';
import { ReconLayer } from './layers/ReconLayer';
import { FactMarkerLayer } from './layers/FactMarkerLayer';
import { GeofencesLayer } from './layers/GeofencesLayer';
import { HeatmapLayer } from './HeatmapLayer';
import { MarkerCard } from './MarkerCard';
import { useMapStore } from '../../stores/mapStore';
import { useSystemStore } from '../../stores/systemStore';
import { getMapTokens, preserveOverlayLayers, type PhantomMapStyle } from './mapTokens';
import { buildPhantomMapStyle, sunFor, DEM_TERRAIN_ID } from './phantomStyle';
import { sunLight } from './style/sun';
import { useSettingsStore } from '../../stores/settingsStore';
import { settingsApi, type Bounds } from '../../services/api';

interface TacticalMapProps {
  initialCenter?: [number, number];
  initialZoom?: number;
  className?: string;
  onResetBearing?: (fn: () => void) => void;
  onZoomIn?: (fn: () => void) => void;
  onZoomOut?: (fn: () => void) => void;
  onCenterToMe?: (fn: () => void) => void;
  onAddPoi?: (fn: () => void) => void;
  /** Перемикач об'єму: нахил камери + рельєф. */
  onToggleTilt?: (fn: () => void) => void;
  onTiltChange?: (pitch: number) => void;
}

/**
 * Every `PhantomMapStyle` value that a persisted `ui_map_style` setting may
 * legally hold — includes the retired 'satellite' value so old settings
 * don't silently reset to 'dark'; `buildPhantomStyle` resolves it to the
 * 'streets' style URL at render time (see mapTokens.ts).
 */
const MAP_STYLE_VALUES: readonly PhantomMapStyle[] = ['dark', 'satellite', 'streets'];

/** Values the style-cycle button walks through — 'satellite' removed (no
 * free-for-commercial-use satellite source; see mapTokens.ts). */
const CYCLABLE_MAP_STYLES: readonly PhantomMapStyle[] = ['dark', 'streets'];

function resolveMapStyle(raw: unknown): PhantomMapStyle {
  return typeof raw === 'string' && (MAP_STYLE_VALUES as readonly string[]).includes(raw)
    ? (raw as PhantomMapStyle)
    : 'dark';
}

if (typeof window !== 'undefined' && !(maplibregl as any)._pmtilesRegistered) {
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  (maplibregl as any)._pmtilesRegistered = true;
}


/**
 * Mirrors the container background/filter that OpenFreeMap's own style no
 * longer needs a `bg` layer for (the vector styles paint their own
 * background), but we still want the pre-tile-load flash to match the
 * theme, and GHOST mode still wants its washed-out look — vector styles
 * don't expose per-pixel raster-opacity/brightness paint tricks, so GHOST
 * is now a CSS filter on the map container instead.
 */
function applyContainerTheming(container: HTMLDivElement, tokens: ReturnType<typeof getMapTokens>): void {
  container.style.backgroundColor = tokens.mapBackdrop;
  container.style.filter = tokens.theme === 'ghost' ? 'grayscale(1) brightness(0.4)' : '';
}

function computeBounds(map: MapLibreMap | null): Bounds {
  if (!map || typeof map.getBounds !== 'function') {
    return { lat1: 0, lon1: 0, lat2: 0, lon2: 0 };
  }
  try {
    const b = map.getBounds();
    if (!b) return { lat1: 0, lon1: 0, lat2: 0, lon2: 0 };
    return {
      lat1: typeof b.getSouth === 'function' ? b.getSouth() : 0,
      lon1: typeof b.getWest === 'function' ? b.getWest() : 0,
      lat2: typeof b.getNorth === 'function' ? b.getNorth() : 0,
      lon2: typeof b.getEast === 'function' ? b.getEast() : 0,
    };
  } catch (err) {
    console.error('Failed to compute bounds:', err);
    return { lat1: 0, lon1: 0, lat2: 0, lon2: 0 };
  }
}

export function TacticalMap({
  initialCenter,
  initialZoom = 15,
  className = '',
  onResetBearing,
  onZoomIn,
  onZoomOut,
  onCenterToMe,
  onAddPoi,
  onToggleTilt,
  onTiltChange,
}: TacticalMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const seenTheme = useRef<string | null>(null);
  const styleReady = useRef(false);
  const [ready, setReady] = useState(false);
  const [bearing, setBearing] = useState(0);
  const [styleLoadFailed, setStyleLoadFailed] = useState(false);
  const [slowLoad, setSlowLoad] = useState(false);
  const [webglSupported, setWebglSupported] = useState(true);
  const [retryNonce, setRetryNonce] = useState(0);

  const mapStyleSetting = useSettingsStore((s) => s.values.ui_map_style);
  const mapStyle = resolveMapStyle(mapStyleSetting);
  const setSettingValue = useSettingsStore((s) => s.setValue);

  const cycleMapStyle = useCallback(() => {
    const idx = CYCLABLE_MAP_STYLES.indexOf(mapStyle);
    const next = CYCLABLE_MAP_STYLES[(idx + 1) % CYCLABLE_MAP_STYLES.length];
    setSettingValue('ui_map_style', next);
    settingsApi.set('ui_map_style', next).catch(() => {});
  }, [mapStyle, setSettingValue]);

  const layers = useMapStore((s) => s.layers);
  const select = useMapStore((s) => s.select);
  const setCenter = useMapStore((s) => s.setCenter);
  const setZoom = useMapStore((s) => s.setZoom);
  const context = useSystemStore((s) => s.context);
  const systemState = useSystemStore((s) => s.state);

  const loadWardriving = useMapStore((s) => s.loadWardriving);
  const loadHeatmap = useMapStore((s) => s.loadHeatmap);
  const loadPOIs = useMapStore((s) => s.loadPOIs);
  const loadTrack = useMapStore((s) => s.loadTrack);
  const loadGeoTaggedFacts = useMapStore((s) => s.loadGeoTaggedFacts);
  const savePOI = useMapStore((s) => s.savePOI);
  const toast = useMapStore((s) => s.toast);
  const setToast = useMapStore((s) => s.setToast);
  const setTactical = useMapStore((s) => s.setTactical);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  useEffect(() => {
    setTactical({
      lat: context?.where?.lat ?? null,
      lon: context?.where?.lon ?? null,
      bearing,
      satellites: context?.where?.satellites ?? 0,
      speed: context?.where?.speed_kmh ?? 0,
      fix: !!context?.where?.fix,
      source: context?.where?.source ?? 'none',
    });
  }, [context, bearing, setTactical]);

  const contextWhere = context?.where;
  const resolvedInitialCenter: [number, number] =
    initialCenter && Array.isArray(initialCenter) && initialCenter.length >= 2 &&
    typeof initialCenter[0] === 'number' && typeof initialCenter[1] === 'number' &&
    !isNaN(initialCenter[0]) && !isNaN(initialCenter[1])
      ? [initialCenter[0], initialCenter[1]]
      : (contextWhere?.fix && contextWhere?.lat != null && contextWhere?.lon != null &&
         typeof contextWhere.lat === 'number' && typeof contextWhere.lon === 'number'
        ? [contextWhere.lon, contextWhere.lat]
        : [30.52, 50.45]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const tokens = getMapTokens();
    applyContainerTheming(container, tokens);

    let map: MapLibreMap;
    try {
      const isSupported = typeof (maplibregl as any).supported === 'function' ? (maplibregl as any).supported() : true;
      if (!isSupported) {
        throw new Error('WebGL not supported');
      }
      map = new maplibregl.Map({
        container,
        // Свій стиль, не чужий URL: звідси об'єм, рельєф, небо й одна мова
        // підписів. `mapStyle` лишається перемикачем теми всередині нього.
        style: buildPhantomMapStyle(tokens, { center: resolvedInitialCenter }),
        center: resolvedInitialCenter,
        zoom: initialZoom,
        // OpenFreeMap styles require OSM attribution to stay visible;
        // `compact` keeps it collapsed to a small "i" chip so it fits the
        // 1024×600 layout without competing with the HUD chrome.
        attributionControl: { compact: true },
        dragRotate: true,
        pitchWithRotate: true,
        // Понад ~72° видно вже не місто, а лінію обрію, всипану точками з
        // сусідніх районів. Об'єм від цього не додається, читабельність
        // зникає.
        maxPitch: 72,
        fadeDuration: 100, // Optimize transitions
      });
      mapRef.current = map;
      setWebglSupported(true);
    } catch (err) {
      console.error('Failed to initialize MapLibre GL map:', err);
      setWebglSupported(false);
      setStyleLoadFailed(true);
      return;
    }

    if (typeof window !== 'undefined') {
      const phantom = ((window as any).__phantom = (window as any).__phantom ?? {});
      phantom.map = map;
    }

    const onLoad = () => {
      setReady(true);
      setStyleLoadFailed(false);
    };
    // Єдиний чесний сигнал «стиль живий». `loaded()` і `isStyleLoaded()`
    // обидва падають у false, щойно полетів бодай один тайл — на нахиленій
    // камері це майже завжди.
    const onStyleLoad = () => { styleReady.current = true; };
    map.on('style.load', onStyleLoad);
    const onRotate = () => setBearing(map.getBearing());
    const onError = (e: any) => {
      const msg = e?.error?.message ?? 'Map source error';
      useMapStore.getState().setToast(`Map: ${msg.slice(0, 80)}`);
    };
    const onMove = () => {
      try {
        const c = map.getCenter();
        if (c && typeof c.lng === 'number' && typeof c.lat === 'number') {
          setCenter([c.lng, c.lat]);
        }
        const z = map.getZoom();
        if (typeof z === 'number' && !isNaN(z)) {
          setZoom(z);
        }
      } catch (err) {
        console.error('Error in onMove handler:', err);
      }
    };
    const onClick = () => select(null);

    // Кнопка атрибуції MapLibre — англійська («Toggle attribution»), своєї
    // локалізації бібліотека не має. Одного присвоєння замало: контрол
    // перемальовує себе при кожній зміні джерел і затирає атрибути, тож
    // тримаємо підпис спостерігачем. Сам текст ліцензії OSM не чіпаємо.
    const ATTRIB_UA = 'Джерела карти';
    const nameAttribution = () => {
      const toggle = map.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-attrib-button');
      if (!toggle || toggle.getAttribute('aria-label') === ATTRIB_UA) return;
      toggle.setAttribute('aria-label', ATTRIB_UA);
      toggle.setAttribute('title', ATTRIB_UA);
    };
    map.on('idle', nameAttribution);
    map.on('styledata', nameAttribution);
    const attribWatch = new MutationObserver(nameAttribution);
    attribWatch.observe(container, { childList: true, subtree: true, attributes: true });
    // Кнопку створює конструктор мапи — тобто вона вже стоїть на місці, і
    // спостерігач її не побачить. Коли стиль не вантажиться, `idle` теж не
    // настає, і англійський підпис лишався на екрані саме в цьому стані.
    nameAttribution();
    // Рельєф прив'язаний до стилю, і КОЖНА його перебудова (зміна теми,
    // стану системи, вигляду) мовчки скидає terrain у null. Тому вмикаємо
    // не один раз, а щоразу, коли стиль осів.
    const keepTerrain = () => {
      try {
        if (map.getSource(DEM_TERRAIN_ID) && !map.getTerrain()) {
          map.setTerrain({ source: DEM_TERRAIN_ID, exaggeration: 1.25 });
        }
      } catch {
        // Немає рельєфу — мапа лишається пласкою, але живою.
      }
    };
    map.on('styledata', keepTerrain);
    map.on('idle', keepTerrain);
    map.on('load', onLoad);
    map.on('moveend', onMove);
    map.on('rotate' as any, onRotate);
    map.on('error' as any, onError);
    map.on('click', onClick);

    return () => {
      map.off('load', onLoad);
      map.off('style.load', onStyleLoad);
      styleReady.current = false;
      map.off('moveend', onMove);
      map.off('rotate' as any, onRotate);
      map.off('error' as any, onError);
      map.off('click', onClick);
      map.off('idle', nameAttribution);
      map.off('styledata', keepTerrain);
      map.off('idle', keepTerrain);
      map.off('styledata', nameAttribution);
      attribWatch.disconnect();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [retryNonce]);

  const storeCenter = useMapStore((s) => s.center);
  const storeZoom = useMapStore((s) => s.zoom);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !storeCenter || !Array.isArray(storeCenter) || storeCenter.length < 2 || map.isMoving()) return;
    const [lng, lat] = storeCenter;
    if (typeof lng !== 'number' || typeof lat !== 'number' || isNaN(lng) || isNaN(lat)) return;
    try {
      const current = map.getCenter();
      if (Math.abs(current.lng - lng) > 0.0001 || Math.abs(current.lat - lat) > 0.0001) {
        map.flyTo({
          center: [lng, lat],
          zoom: storeZoom ?? map.getZoom(),
          duration: 1000,
        });
      }
    } catch (err) {
      console.error('Failed to sync map center:', err);
    }
  }, [storeCenter, storeZoom, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const tokens = getMapTokens();
    if (containerRef.current) applyContainerTheming(containerRef.current, tokens);
    
    // Конструктор уже поставив рівно цей стиль. Перший прогін ставив його
    // вдруге, MapLibre не міг звести діф («Cannot read properties of
    // undefined (reading '_checkLoaded')») і перебудовував усе з нуля —
    // тайли починались наново, а світло, яке ми щойно поставили, гасло.
    const themeKey = `${mapStyle}|${systemState}`;
    if (seenTheme.current === null) {
      seenTheme.current = themeKey;
      return;
    }
    if (seenTheme.current === themeKey) return;
    seenTheme.current = themeKey;

    // Кнопка «Вигляд» писала налаштування і на цьому все: стиль ставився
    // ЛИШЕ в конструкторі, тож до перезавантаження сторінки нічого не
    // мінялось. Тепер перебудовуємо стиль на місці, зберігаючи накладені
    // шари (маркери, маршрути, теплокарту).
    try {
      const c = map.getCenter();
      const next = buildPhantomMapStyle(tokens, { center: [c.lng, c.lat] });
      map.setStyle(next, {
        diff: true,
        transformStyle: (prev, incoming) => preserveOverlayLayers(prev, incoming),
      });
      if (map.getSource(DEM_TERRAIN_ID) && !map.getTerrain()) {
        map.setTerrain({ source: DEM_TERRAIN_ID, exaggeration: 1.25 });
      }
    } catch (err) {
      console.warn('Стиль не перебудувався:', err);
    }
  }, [mapStyle, ready, systemState]);

  // Світло — це справжнє сонце для цього місця й цієї години, а не зашита
  // позиція [1.5, 210, 30], яка стояла тут раніше. Тінь на будинку мусить
  // падати туди, куди вона падає за вікном; інакше об'єм — декорація.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    // `setLight` сам піднімає `styledata`. Слухати `styledata` тут — це
    // нескінченна петля, у якій стиль ніколи не осідає і мапа лишається
    // порожньою. Тому тільки `style.load` і рух камери, і тільки коли
    // світло справді змінилось.
    let last = '';
    const applyLight = (force = false) => {
      try {
        const c = map.getCenter();
        const light = sunLight(sunFor({ center: [c.lng, c.lat] }));
        const key = JSON.stringify(light);
        if (!force && key === last) return;
        last = key;
        map.setLight(light);
      } catch {
        // Стиль саме перебудовується — світло приїде наступним тактом.
      }
    };
    // Новий стиль приходить БЕЗ світла. Порівняння з попереднім значенням
    // тоді працює проти нас: воно однакове, ми виходимо, і мапа лишається
    // без сонця до наступного руху камери.
    const onStyle = () => applyLight(true);
    const onMove = () => applyLight();
    applyLight(true);
    map.on('moveend', onMove);
    map.on('style.load', onStyle);
    // Сонце їде далі, поки людина дивиться на мапу.
    const tick = window.setInterval(onMove, 5 * 60 * 1000);
    return () => {
      map.off('moveend', onMove);
      map.off('style.load', onStyle);
      window.clearInterval(tick);
    };
  }, [ready]);

  // Збій — це збій СТИЛЮ, а не повільні тайли. Раніше тут стояло
  // `!map.loaded()` через 5 секунд, а `loaded()` лишається false, доки
  // летить бодай один тайл: люди бачили «Мапа не завантажилась» над мапою,
  // яка нормально вантажилась, просто по слабкій мережі.
  useEffect(() => {
    if (ready) {
      setStyleLoadFailed(false);
      setSlowLoad(false);
      return;
    }
    const slowTimer = window.setTimeout(() => setSlowLoad(true), 1200);
    const failTimer = window.setTimeout(() => {
      if (mapRef.current && !styleReady.current) setStyleLoadFailed(true);
    }, 20000);
    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(failTimer);
    };
  }, [ready, retryNonce]);

  const handleStyleRetry = useCallback(() => {
    setStyleLoadFailed(false);
    setReady(false);
    setRetryNonce((n) => n + 1);
  }, []);

  // Об'ємний режим — головне, заради чого з'явились рельєф і будівлі.
  // Без кнопки людина про них не дізнається: мишею нахил тягнеться лише
  // правою кнопкою з Ctrl, а на тачскріні — двома пальцями.
  const handleToggleTilt = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const flat = map.getPitch() < 10;
    map.easeTo({
      pitch: flat ? 60 : 0,
      zoom: flat ? Math.max(map.getZoom(), 15.5) : map.getZoom(),
      duration: 900,
    });
  }, []);

  const handleResetBearing = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.rotateTo(0, { duration: 400 });
    map.easeTo({ pitch: 0, duration: 400 });
  }, []);

  const handleCenterToMe = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const contextWhere = context?.where;
    if (contextWhere?.fix && contextWhere?.lat != null && contextWhere?.lon != null &&
        typeof contextWhere.lat === 'number' && typeof contextWhere.lon === 'number') {
      try {
        map.flyTo({ center: [contextWhere.lon, contextWhere.lat], zoom: 17 });
      } catch (err) {
        console.error('Failed to fly to user location:', err);
      }
    }
  }, [context]);

  const [pendingPoi, setPendingPoi] = useState<{ lng: number; lat: number } | null>(null);
  const [pendingName, setPendingName] = useState('');

  const handleAddPoi = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    setPendingPoi({ lng: c.lng, lat: c.lat });
  }, []);

  const confirmPendingPoi = useCallback(async () => {
    if (!pendingPoi) return;
    const name = pendingName.trim() || `POI ${new Date().toLocaleTimeString()}`;
    const saved = await savePOI({
      lat: pendingPoi.lat,
      lon: pendingPoi.lng,
      name,
      category: 'saved',
      notes: '',
      icon: '📍',
      is_secret: false,
    });
    setPendingPoi(null);
    setPendingName('');
    if (saved) setToast(`POI "${saved.name}" dropped`);
    else setToast('POI save failed');
  }, [pendingPoi, pendingName, savePOI, setToast]);

  useEffect(() => {
    onZoomIn?.(() => {
      if (mapRef.current && ready) {
        try {
          mapRef.current.zoomIn();
        } catch (err) {
          console.error('Error zooming in:', err);
        }
      }
    });
    onZoomOut?.(() => {
      if (mapRef.current && ready) {
        try {
          mapRef.current.zoomOut();
        } catch (err) {
          console.error('Error zooming out:', err);
        }
      }
    });
    onCenterToMe?.(handleCenterToMe);
    onAddPoi?.(handleAddPoi);
    onResetBearing?.(handleResetBearing);
    onToggleTilt?.(handleToggleTilt);
  }, [onZoomIn, onZoomOut, onCenterToMe, onAddPoi, onResetBearing, onToggleTilt, handleCenterToMe, handleAddPoi, handleResetBearing, handleToggleTilt, ready]);

  // Нахил віддаємо нагору, щоб кнопка об'єму світилась, коли він увімкнений.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !onTiltChange) return;
    const emit = () => onTiltChange(map.getPitch());
    emit();
    map.on('pitchend', emit);
    return () => { map.off('pitchend', emit); };
  }, [ready, onTiltChange]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;
    const bounds = computeBounds(map);
    if (layers?.wardriving) loadWardriving(bounds).catch((err) => useMapStore.getState().setToast(`Wardriving: ${err.message}`));
    if (layers?.heatmap) loadHeatmap(bounds).catch((err) => useMapStore.getState().setToast(`Heatmap: ${err.message}`));
    if (layers?.intel) loadPOIs().catch((err) => useMapStore.getState().setToast(`Intel: ${err.message}`));
    if (layers?.recon) loadTrack(2).catch((err) => useMapStore.getState().setToast(`Recon: ${err.message}`));
    if (layers?.facts) loadGeoTaggedFacts().catch((err) => useMapStore.getState().setToast(`Facts: ${err.message}`));
  }, [ready, layers?.wardriving, layers?.heatmap, layers?.intel, layers?.recon, layers?.facts, loadWardriving, loadHeatmap, loadPOIs, loadTrack, loadGeoTaggedFacts]);

  return (
    <div aria-label="Тактична мапа" className={`phantom-map-frame relative w-full h-full overflow-hidden ${className}`}>
      <div ref={containerRef} className="absolute inset-0" />
      <MapContext.Provider value={{ map: mapRef.current, ready: ready && !!mapRef.current }}>
        {ready && mapRef.current && (
          <>
            {layers?.base && <BaseLayer />}
            {layers?.presence && <PresenceLayer />}
            {layers?.wardriving && <WardrivingLayer />}
            {layers?.heatmap && <HeatmapLayer />}
            {layers?.intel && <IntelLayer />}
            {layers?.recon && <ReconLayer />}
            {layers?.facts && <FactMarkerLayer />}
            <GeofencesLayer />
            <RouteLayer />
            <MarkerCard />
          </>
        )}
      </MapContext.Provider>

      <div className="absolute top-1/2 left-1/2 pointer-events-none -translate-x-1/2 -translate-y-1/2 w-10 h-10">
        <span className="absolute top-1/2 left-0 right-0 h-px bg-amber-500/50" />
        <span className="absolute left-1/2 top-0 bottom-0 w-px bg-amber-500/50" />
      </div>

      {pendingPoi && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={() => setPendingPoi(null)}>
          <div className="glass-elevated w-[340px] p-5 flex flex-col gap-3 rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Drop POI</div>
            <input autoFocus value={pendingName} onChange={e => setPendingName(e.target.value)} placeholder="Назва..." className="min-h-[44px] px-3 rounded-xl bg-black/20 border border-white/10 text-ink-primary outline-none" />
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setPendingPoi(null)} className="min-h-[40px] px-4 rounded-full border border-white/10 text-xs font-bold uppercase">Скасувати</button>
              <button onClick={confirmPendingPoi} className="min-h-[40px] px-5 rounded-full bg-amber-500 text-ink-inverse text-xs font-bold uppercase shadow-xl">Зберегти</button>
            </div>
          </div>
        </div>
      )}

      {slowLoad && !ready && !styleLoadFailed && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full bg-black/55 px-4 py-2 text-[11px] font-semibold text-white/90 backdrop-blur">
          Вантажимо мапу…
        </div>
      )}

      {styleLoadFailed && (
        <div data-testid="map-style-failed" className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
          <div className="glass-elevated max-w-[360px] p-6 flex flex-col gap-4 rounded-2xl text-center shadow-2xl">
            <div className="text-sm font-semibold text-[color:var(--ink-primary)]">
              {!webglSupported ? 'Мапу нема на чому малювати' : 'Мапа не завантажилась'}
            </div>
            {/* Раніше тут світився самий заголовок «Помилка завантаження» —
                людина бачила збій і не знала ні причини, ні що робити далі. */}
            <div className="text-xs leading-relaxed text-[color:var(--ink-secondary)]">
              {!webglSupported
                ? 'Система не дає апаратного прискорення WebGL, без якого мапа не малюється. Решта PHANTOM працює як завжди.'
                : 'Не вдалося дістати стиль карти. Якщо мережі немає — це очікувано: перемкни вигляд на той, що лежить у пам’яті пристрою.'}
            </div>
            <div className="flex gap-2 justify-center mt-2">
              {webglSupported && (
                <button onClick={handleStyleRetry} aria-label="Спробувати ще раз" className="min-h-[44px] px-6 rounded-full bg-amber-500 text-[color:var(--primary-shadow)] text-xs font-bold">Спробувати ще</button>
              )}
              <button onClick={cycleMapStyle} aria-label="Змінити вигляд мапи" className="min-h-[44px] px-4 rounded-full border border-white/10 text-[color:var(--ink-secondary)] text-xs font-bold">Інший вигляд</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
