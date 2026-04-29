import { useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, Navigation, Signal, Shield, Wifi, Sparkles } from 'lucide-react';
import { useMapStore } from '../../stores/mapStore';
import { EASE_PHANTOM } from '../../styles/motion';
import { poiColor, getMapTokens } from './mapTokens';
import type { MapPOI, WardrivingRecord } from '@shared/types';
import type { GeoTaggedFact } from '../../services/api';

/**
 * MarkerCard — sunrise-warm glass slide-over for selected map markers.
 *
 * Design DNA (CONTRACTS_R1.md + screen-5-map.jsx): the card slides in from
 * the right edge, sits on a `--glass-elevated` surface with cream rim,
 * uses Manrope display + Playfair italic for the marker label, and amber
 * `--primary` chips/icons. The deletion CTA stays coral so a destructive
 * action reads instantly even on warm cream.
 */

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
          key={`${selection.kind}-${
            selection.kind === 'poi'
              ? selection.poi.id
              : selection.kind === 'wardriving'
                ? selection.record.id
                : selection.fact.id
          }`}
          initial={{ x: 320, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 320, opacity: 0 }}
          transition={{ duration: 0.28, ease: EASE_PHANTOM as unknown as number[] }}
          className="glass-elevated absolute top-3 right-3 bottom-3 w-[300px] flex flex-col z-20"
          style={{ borderRadius: 18 }}
          role="dialog"
          aria-label="Marker details"
        >
          <header
            className="flex items-center gap-2 px-3 shrink-0"
            style={{
              height: 48,
              borderBottom: '1px solid var(--line-subtle)',
            }}
          >
            <span
              className="status-pill"
              style={{
                background:
                  selection.kind === 'wardriving'
                    ? 'rgba(37,99,235,0.10)'
                    : 'rgba(244,175,37,0.18)',
                borderColor:
                  selection.kind === 'wardriving'
                    ? 'rgba(37,99,235,0.32)'
                    : 'rgba(244,175,37,0.36)',
                color:
                  selection.kind === 'wardriving'
                    ? '#1d4ed8'
                    : 'var(--primary-shadow)',
              }}
            >
              <span className="dot" />
              {selection.kind === 'poi'
                ? 'POI'
                : selection.kind === 'wardriving'
                  ? 'WIFI AP'
                  : 'MEMORY'}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={handleClose}
              className="flex items-center justify-center transition-colors active:scale-95"
              style={{
                minWidth: 44,
                minHeight: 44,
                width: 44,
                height: 44,
                borderRadius: 12,
                color: 'var(--ink-muted)',
                background: 'transparent',
                border: '1px solid transparent',
              }}
              aria-label="Close"
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
            {selection.kind === 'poi' ? (
              <PoiDetails poi={selection.poi} onDelete={() => deletePOI(selection.poi.id)} />
            ) : selection.kind === 'wardriving' ? (
              <WardrivingDetails record={selection.record} />
            ) : (
              <FactDetails fact={selection.fact} />
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
      <div className="flex items-center gap-3">
        <div
          className="flex items-center justify-center"
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            background: poiColor(tokens, poi.category),
            color: tokens.theme === 'cyberdeck-cold' ? tokens.surfaceDeep : '#fdf6e9',
            boxShadow: '0 4px 14px rgba(120,70,10,0.18)',
          }}
        >
          {poi.icon && poi.icon.length <= 2 ? (
            <span style={{ fontSize: 20 }}>{poi.icon}</span>
          ) : (
            <Navigation size={20} strokeWidth={2} />
          )}
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <span
            className="playfair truncate"
            style={{
              color: 'var(--ink-primary)',
              fontSize: 'var(--fs-md)',
              lineHeight: 1.2,
            }}
          >
            {poi.name}
          </span>
          <span
            className="micro-label"
            style={{ color: 'var(--primary-shadow)' }}
          >
            {CATEGORY_LABELS[poi.category] ?? poi.category.toUpperCase()}
          </span>
        </div>
      </div>

      <CoordinatesRow lat={poi.lat} lon={poi.lon} />

      {poi.notes && (
        <div
          className="sub-glass p-3"
          style={{
            color: 'var(--ink-secondary)',
            fontSize: 'var(--fs-xs)',
            lineHeight: 'var(--lh-normal)',
            whiteSpace: 'pre-wrap',
            fontFamily: 'var(--font-display)',
          }}
        >
          {poi.notes}
        </div>
      )}

      <MetaRow label="Created" value={new Date(poi.created_at).toLocaleString('uk-UA')} />

      <button
        type="button"
        onClick={onDelete}
        className="mt-auto flex items-center justify-center gap-2 transition-colors active:scale-95"
        style={{
          minHeight: 44,
          padding: '0 14px',
          borderRadius: 9999,
          background: 'rgba(239, 68, 68, 0.10)',
          color: 'var(--coral-deep)',
          border: '1px solid rgba(239, 68, 68, 0.36)',
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--fs-xs)',
          letterSpacing: 'var(--tracking-wider)',
          textTransform: 'uppercase',
          fontWeight: 700,
        }}
        aria-label="Delete POI"
      >
        <Trash2 size={14} strokeWidth={1.75} />
        Delete POI
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
      <div className="flex items-center gap-3">
        <div
          className="flex items-center justify-center"
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            background: 'rgba(37,99,235,0.10)',
            color: '#1d4ed8',
            border: '1px solid rgba(37,99,235,0.30)',
          }}
        >
          <Wifi size={20} strokeWidth={1.75} />
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <span
            className="truncate playfair"
            style={{
              color: 'var(--ink-primary)',
              fontSize: 'var(--fs-md)',
              lineHeight: 1.2,
            }}
          >
            {record.ssid || '<hidden>'}
          </span>
          <span
            className="mono"
            style={{
              color: 'var(--ink-muted)',
              fontSize: 'var(--fs-micro)',
              letterSpacing: '0.04em',
            }}
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

function FactDetails({ fact }: { fact: GeoTaggedFact }) {
  return (
    <>
      <div className="flex items-center gap-3">
        <div
          className="flex items-center justify-center"
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            background: 'rgba(244,175,37,0.18)',
            color: 'var(--primary-shadow)',
            border: '1px solid rgba(244,175,37,0.36)',
          }}
        >
          <Sparkles size={20} strokeWidth={1.75} />
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <span
            className="truncate playfair"
            style={{
              color: 'var(--ink-primary)',
              fontSize: 'var(--fs-md)',
              lineHeight: 1.2,
            }}
          >
            {fact.place_name || 'Remembered place'}
          </span>
          <span
            className="micro-label"
            style={{ color: 'var(--primary-shadow)' }}
          >
            {fact.category}
          </span>
        </div>
      </div>

      <CoordinatesRow lat={fact.place_lat} lon={fact.place_lon} />

      <div
        className="sub-glass p-3"
        style={{
          color: 'var(--ink-secondary)',
          fontSize: 'var(--fs-xs)',
          lineHeight: 'var(--lh-normal)',
          whiteSpace: 'pre-wrap',
          fontFamily: 'var(--font-display)',
        }}
      >
        {fact.content}
      </div>

      {fact.place_source && (
        <MetaRow label="Source" value={fact.place_source} />
      )}
      {fact.place_confidence != null && (
        <MetaRow
          label="Confidence"
          value={`${Math.round(fact.place_confidence * 100)}%`}
        />
      )}
      <MetaRow
        label="Created"
        value={new Date(fact.created_at).toLocaleString('uk-UA')}
      />
    </>
  );
}

function CoordinatesRow({ lat, lon }: { lat: number; lon: number }) {
  return (
    <div
      className="sub-glass flex items-center gap-2 px-3 mono tabular"
      style={{
        height: 36,
        color: 'var(--ink-secondary)',
        fontSize: 'var(--fs-xs)',
      }}
    >
      <span className="micro-label" style={{ color: 'var(--ink-muted)' }}>
        LAT
      </span>
      <span>{lat.toFixed(5)}</span>
      <span style={{ color: 'var(--ink-muted)' }}>·</span>
      <span className="micro-label" style={{ color: 'var(--ink-muted)' }}>
        LON
      </span>
      <span>{lon.toFixed(5)}</span>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="micro-label">{label}</span>
      <span
        className="mono tabular"
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
      className="sub-glass flex flex-col gap-1 p-2"
      style={{ borderRadius: 12 }}
    >
      <div
        className="micro-label flex items-center gap-1"
        style={{ color: 'var(--primary-shadow)' }}
      >
        {icon}
        {label}
      </div>
      <span
        className="mono tabular"
        style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-sm)' }}
      >
        {value}
      </span>
      {sub && (
        <span
          style={{
            color: 'var(--ink-muted)',
            fontSize: 'var(--fs-micro)',
            fontFamily: 'var(--font-display)',
          }}
        >
          {sub}
        </span>
      )}
    </div>
  );
}
