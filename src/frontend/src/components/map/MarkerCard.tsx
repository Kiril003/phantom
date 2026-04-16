import { useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, Navigation, Signal, Shield, Wifi } from 'lucide-react';
import { useMapStore } from '../../stores/mapStore';
import { EASE_PHANTOM } from '../../styles/motion';
import { poiColor, getMapTokens } from './mapTokens';
import type { MapPOI, WardrivingRecord } from '@shared/types';

const CATEGORY_LABELS: Record<MapPOI['category'], string> = {
  intel: 'INTEL',
  threat: 'THREAT',
  saved: 'SAVED',
  home: 'HOME',
  work: 'WORK',
  custom: 'CUSTOM',
};

export function MarkerCard() {
  const selection = useMapStore((s) => s.selection);
  const select = useMapStore((s) => s.select);
  const deletePOI = useMapStore((s) => s.deletePOI);

  const handleClose = useCallback(() => select(null), [select]);

  return (
    <AnimatePresence>
      {selection && (
        <motion.aside
          key={`${selection.kind}-${selection.kind === 'poi' ? selection.poi.id : selection.record.id}`}
          initial={{ x: 320, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 320, opacity: 0 }}
          transition={{ duration: 0.28, ease: EASE_PHANTOM as unknown as number[] }}
          className="absolute top-0 right-0 h-full w-[320px] flex flex-col z-20"
          style={{
            background: 'var(--surface-raised)',
            borderLeft: '1px solid var(--line-default)',
          }}
          role="dialog"
          aria-label="Marker details"
        >
          <header
            className="flex items-center gap-2 px-3 py-2 shrink-0"
            style={{ borderBottom: '1px solid var(--line-subtle)' }}
          >
            <span
              className="font-mono tracking-wider uppercase flex-1"
              style={{ color: 'var(--accent)', fontSize: 'var(--fs-micro)' }}
            >
              {selection.kind === 'poi' ? 'POI' : 'WIFI AP'}
            </span>
            <button
              type="button"
              onClick={handleClose}
              className="flex items-center justify-center rounded transition-colors"
              style={{
                minWidth: 44,
                minHeight: 44,
                color: 'var(--ink-muted)',
              }}
              aria-label="Close"
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
            {selection.kind === 'poi' ? (
              <PoiDetails poi={selection.poi} onDelete={() => deletePOI(selection.poi.id)} />
            ) : (
              <WardrivingDetails record={selection.record} />
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function PoiDetails({ poi, onDelete }: { poi: MapPOI; onDelete: () => void }) {
  const tokens = getMapTokens();
  return (
    <>
      <div className="flex items-center gap-2">
        <div
          className="flex items-center justify-center rounded"
          style={{
            width: 36,
            height: 36,
            background: poiColor(tokens, poi.category),
            color: tokens.surfaceDeep,
          }}
        >
          {poi.icon && poi.icon.length <= 2 ? (
            <span style={{ fontSize: 18 }}>{poi.icon}</span>
          ) : (
            <Navigation size={18} strokeWidth={2} />
          )}
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <span
            className="truncate"
            style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-md)' }}
          >
            {poi.name}
          </span>
          <span
            className="font-mono tracking-wider uppercase"
            style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}
          >
            {CATEGORY_LABELS[poi.category] ?? poi.category.toUpperCase()}
          </span>
        </div>
      </div>

      <CoordinatesRow lat={poi.lat} lon={poi.lon} />

      {poi.notes && (
        <div
          className="p-3 rounded"
          style={{
            background: 'var(--surface-glass)',
            border: '1px solid var(--line-subtle)',
            color: 'var(--ink-secondary)',
            fontSize: 'var(--fs-xs)',
            lineHeight: 'var(--lh-normal)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {poi.notes}
        </div>
      )}

      <MetaRow label="Created" value={new Date(poi.created_at).toLocaleString('uk-UA')} />

      <button
        type="button"
        onClick={onDelete}
        className="mt-auto flex items-center justify-center gap-2 rounded transition-colors font-mono tracking-wider"
        style={{
          minHeight: 44,
          padding: '0 12px',
          background: 'color-mix(in srgb, var(--signal-alert) 8%, transparent)',
          color: 'var(--signal-alert)',
          border: '1px solid var(--signal-alert)',
          fontSize: 'var(--fs-xs)',
        }}
        aria-label="Delete POI"
      >
        <Trash2 size={14} strokeWidth={1.75} />
        DELETE POI
      </button>
    </>
  );
}

function WardrivingDetails({ record }: { record: WardrivingRecord }) {
  const rssiLabel =
    record.rssi > -60 ? 'strong' :
    record.rssi > -80 ? 'usable' : 'weak';

  return (
    <>
      <div className="flex items-center gap-2">
        <div
          className="flex items-center justify-center rounded"
          style={{
            width: 36,
            height: 36,
            background: 'var(--surface-glass)',
            color: 'var(--accent)',
            border: '1px solid var(--line-default)',
          }}
        >
          <Wifi size={18} strokeWidth={1.75} />
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <span
            className="truncate font-mono"
            style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-md)' }}
          >
            {record.ssid || '<hidden>'}
          </span>
          <span
            className="font-mono"
            style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}
          >
            {record.mac}
          </span>
        </div>
      </div>

      <CoordinatesRow lat={record.lat} lon={record.lon} />

      <div className="grid grid-cols-2 gap-2">
        <StatTile
          icon={<Signal size={14} strokeWidth={1.5} />}
          label="RSSI"
          value={`${record.rssi} dBm`}
          sub={rssiLabel}
        />
        <StatTile
          icon={<Shield size={14} strokeWidth={1.5} />}
          label="Encryption"
          value={record.encryption}
          sub={`ch ${record.channel}`}
        />
      </div>

      <MetaRow label="Seen" value={`${record.seen_count} times`} />
      <MetaRow label="First seen" value={new Date(record.first_seen).toLocaleString('uk-UA')} />
      <MetaRow label="Last seen" value={new Date(record.last_seen).toLocaleString('uk-UA')} />
    </>
  );
}

function CoordinatesRow({ lat, lon }: { lat: number; lon: number }) {
  return (
    <div
      className="flex items-center gap-2 p-2 rounded font-mono"
      style={{
        background: 'var(--surface-void)',
        border: '1px solid var(--line-subtle)',
        color: 'var(--ink-secondary)',
        fontSize: 'var(--fs-xs)',
      }}
    >
      <span style={{ color: 'var(--ink-muted)' }}>LAT</span>
      <span>{lat.toFixed(5)}</span>
      <span style={{ color: 'var(--ink-muted)' }}>· LON</span>
      <span>{lon.toFixed(5)}</span>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span
        className="font-mono tracking-wider uppercase"
        style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}
      >
        {label}
      </span>
      <span
        className="font-mono"
        style={{ color: 'var(--ink-secondary)', fontSize: 'var(--fs-xs)' }}
      >
        {value}
      </span>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      className="flex flex-col gap-1 p-2 rounded"
      style={{
        background: 'var(--surface-glass)',
        border: '1px solid var(--line-subtle)',
      }}
    >
      <div
        className="flex items-center gap-1 font-mono tracking-wider uppercase"
        style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}
      >
        {icon}
        {label}
      </div>
      <span
        className="font-mono"
        style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-sm)' }}
      >
        {value}
      </span>
      {sub && (
        <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--fs-micro)' }}>{sub}</span>
      )}
    </div>
  );
}
