import React, { useEffect, useRef } from 'react';
import Map, { NavigationControl, Source } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { useMapStore } from '../../stores/mapStore';
import { DeckOverlay } from './DeckOverlay';
import 'maplibre-gl/dist/maplibre-gl.css';

export const PhantomMap: React.FC = () => {
  const { longitude, latitude, zoom, pitch, bearing, setViewState, updateEntities } = useMapStore();
  const mapRef = useRef(null);

  // Connect to telemetry WebSocket
  useEffect(() => {
    // Add placeholders if backend is not ready, but design it to connect to ws://localhost:8000/ws/telemetry.
    const ws = new WebSocket('ws://localhost:8000/ws/telemetry');

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.entities) {
          updateEntities(data.entities);
        } else {
          updateEntities(data);
        }
      } catch (e) {
        // Fallback for binary data or malformed JSON
        updateEntities(event.data);
      }
    };

    ws.onerror = (error) => {
      console.warn('Telemetry WS Error (waiting for backend):', error);
    };

    return () => {
      ws.close();
    };
  }, [updateEntities]);

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden rounded-xl border border-cyan-500/30 shadow-[0_0_15px_rgba(0,255,255,0.1)]">
      <Map
        ref={mapRef}
        mapLib={maplibregl as any}
        longitude={longitude}
        latitude={latitude}
        zoom={zoom}
        pitch={pitch}
        bearing={bearing}
        onMove={(evt: any) => setViewState(evt.viewState)}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        terrain={{ source: 'terrainSource', exaggeration: 1.5 }}
      >
        <Source
          id="terrainSource"
          type="raster-dem"
          tiles={['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png']}
          encoding="terrarium"
          tileSize={256}
          maxzoom={14}
        />
        
        <NavigationControl position="top-right" showCompass showZoom visualizePitch />
        
        <DeckOverlay />
      </Map>

      {/* Cyberpunk/Neon UI Overlays */}
      <div className="absolute top-4 left-4 z-10 pointer-events-none">
        <h1 className="text-cyan-400 font-mono text-xl uppercase tracking-widest drop-shadow-[0_0_8px_rgba(0,255,255,0.8)]">
          Phantom::OS // Map
        </h1>
        <div className="text-xs text-cyan-600 font-mono mt-1">
          [{longitude.toFixed(4)}, {latitude.toFixed(4)}] Z:{zoom.toFixed(1)} P:{pitch.toFixed(0)}
        </div>
      </div>
      
      <div className="absolute bottom-4 left-4 z-10 pointer-events-none">
        <div className="flex items-center gap-2 text-xs font-mono text-emerald-400">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
          TELEMETRY STANDBY
        </div>
      </div>
      
      {/* Decorative corners */}
      <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-cyan-500/50 pointer-events-none rounded-tl-xl" />
      <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-cyan-500/50 pointer-events-none rounded-tr-xl" />
      <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-cyan-500/50 pointer-events-none rounded-bl-xl" />
      <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-cyan-500/50 pointer-events-none rounded-br-xl" />
    </div>
  );
};
