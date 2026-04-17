import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Terminal as TerminalIcon,
  Wifi,
  Camera,
  Grid3x3,
  Square as SquareIcon,
  Trash2,
  UserCheck,
  UserX,
  Shield,
} from 'lucide-react';
import { FloatingWindow } from './FloatingWindow';
import { useUIStore, type OverlayName } from '../../stores/uiStore';
import { useMapStore } from '../../stores/mapStore';
import { useSystemStore } from '../../stores/systemStore';
import { useFaceStore } from '../../stores/faceStore';
import { useFaceDetection } from '../../hooks/useFaceDetection';
import { faceApi } from '../../services/faceApi';
import { SystemState } from '@shared/types';

const TITLES: Record<OverlayName, string> = {
  terminal: 'Terminal',
  wardriving: 'Nearby networks',
  camera: 'Camera · face track',
  apps: 'Apps',
};

function iconFor(name: OverlayName): React.ReactNode {
  switch (name) {
    case 'terminal':
      return <TerminalIcon size={14} strokeWidth={1.75} />;
    case 'wardriving':
      return <Wifi size={14} strokeWidth={1.75} />;
    case 'camera':
      return <Camera size={14} strokeWidth={1.75} />;
    case 'apps':
      return <Grid3x3 size={14} strokeWidth={1.75} />;
  }
}

export function Overlays() {
  const windows = useUIStore((s) => s.windows);
  const closeOverlay = useUIStore((s) => s.closeOverlay);
  const focusedId = useUIStore((s) => s.focusedId);

  /* Escape closes the topmost open window. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const id = focusedId();
      if (id) closeOverlay(id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [focusedId, closeOverlay]);

  const openIds = (Object.keys(windows) as OverlayName[]).filter((id) => windows[id].open);
  const minimizedIds = openIds.filter((id) => windows[id].minimized);

  return (
    <div className="absolute inset-0 pointer-events-none">
      <AnimatePresence>
        {openIds
          .filter((id) => !windows[id].minimized)
          .map((id) => (
            <FloatingWindow key={id} id={id} title={TITLES[id]} icon={iconFor(id)}>
              <OverlayBody name={id} />
            </FloatingWindow>
          ))}
      </AnimatePresence>

      {minimizedIds.length > 0 && <MinimizedDock ids={minimizedIds} />}
    </div>
  );
}

/* ─── Minimized dock ──────────────────────────────────────────────── */

function MinimizedDock({ ids }: { ids: OverlayName[] }) {
  const restoreOpen = useUIStore((s) => s.openOverlay);
  return (
    <div
      className="absolute pointer-events-auto flex items-center gap-2"
      style={{ bottom: 74, right: 20, zIndex: 200 }}
    >
      <AnimatePresence>
        {ids.map((id) => (
          <motion.button
            key={id}
            type="button"
            layout
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.9 }}
            transition={{ duration: 0.22 }}
            onClick={() => restoreOpen(id)}
            className="glass-elevated flex items-center gap-2 px-3"
            style={{
              height: 36,
              minWidth: 44,
              minHeight: 44,
              borderRadius: 9999,
              color: 'var(--ink-primary)',
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-micro)',
              letterSpacing: 'var(--tracking-widest)',
              textTransform: 'uppercase',
            }}
            aria-label={`Restore ${TITLES[id]}`}
            title={TITLES[id]}
          >
            <span style={{ color: 'var(--accent)', display: 'inline-flex' }}>
              {iconFor(id)}
            </span>
            <span className="truncate" style={{ maxWidth: 140 }}>
              {TITLES[id]}
            </span>
            <SquareIcon size={9} strokeWidth={1.5} style={{ color: 'var(--ink-muted)' }} />
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

function OverlayBody({ name }: { name: OverlayName }) {
  switch (name) {
    case 'terminal':
      return <TerminalOverlay />;
    case 'wardriving':
      return <WardrivingOverlay />;
    case 'camera':
      return <CameraOverlay />;
    case 'apps':
      return <AppsOverlay />;
  }
}

/* ─── Terminal ─────────────────────────────────────────────────────────── */

interface TerminalLine {
  id: string;
  kind: 'prompt' | 'stdout' | 'stderr' | 'info';
  text: string;
}

function TerminalOverlay() {
  const [lines, setLines] = useState<TerminalLine[]>([
    { id: 'boot', kind: 'info', text: 'PHANTOM shell · type `help` for commands' },
  ]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lines]);

  const onSubmit = useCallback((cmd: string) => {
    const id = Math.random().toString(36).slice(2);
    const trimmed = cmd.trim();
    if (!trimmed) return;
    setLines((l) => [...l, { id: id + '_p', kind: 'prompt', text: `› ${trimmed}` }]);
    setInput('');
    const out =
      trimmed === 'help'
        ? 'Available: help, state, ws, clear'
        : trimmed === 'state'
          ? `state=${useSystemStore.getState().state}`
          : trimmed === 'ws'
            ? `ws=${useSystemStore.getState().wsConnected ? 'connected' : 'offline'}`
            : trimmed === 'clear'
              ? null
              : `unknown: ${trimmed}`;
    if (trimmed === 'clear') setLines([]);
    else if (out != null)
      setLines((l) => [...l, { id: id + '_o', kind: 'stdout', text: out }]);
  }, []);

  return (
    <div className="h-full flex flex-col">
      <div
        className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-1"
        style={{
          background: 'var(--surface-deep)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-xs)',
          color: 'var(--ink-primary)',
        }}
      >
        {lines.map((line) => (
          <div
            key={line.id}
            style={{
              color:
                line.kind === 'prompt'
                  ? 'var(--accent)'
                  : line.kind === 'stderr'
                    ? 'var(--signal-alert)'
                    : line.kind === 'info'
                      ? 'var(--ink-muted)'
                      : 'var(--ink-primary)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {line.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form
        className="flex items-center gap-2 px-4 py-3 shrink-0"
        style={{ borderTop: '1px solid var(--glass-border)' }}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(input);
        }}
      >
        <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>›</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type command…"
          aria-label="Shell input"
          className="flex-1 bg-transparent outline-none"
          style={{
            color: 'var(--ink-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-xs)',
            border: 'none',
            minHeight: 32,
          }}
        />
      </form>
    </div>
  );
}

/* ─── Wardriving ───────────────────────────────────────────────────────── */

function WardrivingOverlay() {
  const records = useMapStore((s) => s.wardrivingRecords);
  const loadWardriving = useMapStore((s) => s.loadWardriving);
  const loading = useMapStore((s) => s.loading);
  const error = useMapStore((s) => s.error);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    loadWardriving().catch(() => void 0);
  }, [loadWardriving]);

  const sorted = useMemo(() => {
    const list = [...records].sort((a, b) => (b.rssi ?? -200) - (a.rssi ?? -200));
    if (!filter.trim()) return list.slice(0, 80);
    const q = filter.trim().toLowerCase();
    return list
      .filter(
        (r) =>
          (r.ssid ?? '').toLowerCase().includes(q) ||
          r.mac.toLowerCase().includes(q) ||
          (r.encryption ?? '').toLowerCase().includes(q)
      )
      .slice(0, 80);
  }, [records, filter]);

  return (
    <div className="h-full flex flex-col">
      <div
        className="flex items-center gap-2 px-4 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--glass-border)' }}
      >
        <button
          type="button"
          className="active:scale-95 transition-all"
          style={{
            minHeight: 44,
            padding: '0 14px',
            borderRadius: 9999,
            background: scanning
              ? 'var(--accent)'
              : 'color-mix(in srgb, var(--accent) 14%, transparent)',
            color: scanning ? 'var(--ink-inverse)' : 'var(--accent)',
            border: '1px solid var(--accent)',
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-micro)',
            letterSpacing: 'var(--tracking-wider)',
            textTransform: 'uppercase',
            transitionDuration: '200ms',
          }}
          onClick={() => {
            setScanning((v) => !v);
            loadWardriving().catch(() => void 0);
          }}
        >
          {scanning ? 'Stop scan' : 'Scan now'}
        </button>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter…"
          aria-label="Filter networks"
          className="flex-1 bg-transparent outline-none"
          style={{
            minHeight: 36,
            padding: '0 10px',
            borderRadius: 9999,
            background: 'var(--glass-subtle)',
            border: '1px solid var(--glass-border)',
            color: 'var(--ink-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-xs)',
          }}
        />
        <span
          className="tabular-nums"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-micro)',
            color: 'var(--ink-muted)',
            minWidth: 46,
            textAlign: 'right',
          }}
        >
          {loading ? '···' : `${sorted.length} net`}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {error && (
          <div
            className="px-3 py-2 mb-2 rounded"
            style={{
              background: 'color-mix(in srgb, var(--signal-alert) 10%, transparent)',
              color: 'var(--signal-alert)',
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-xs)',
            }}
          >
            {error}
          </div>
        )}
        {sorted.length === 0 && !loading && (
          <div
            className="h-full flex flex-col items-center justify-center text-center px-4 gap-2"
            style={{ minHeight: 200 }}
          >
            <Wifi size={20} strokeWidth={1.5} style={{ color: 'var(--ink-muted)' }} />
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-xs)',
                color: 'var(--ink-muted)',
              }}
            >
              No networks match.
            </span>
          </div>
        )}
        {sorted.map((rec) => (
          <div
            key={`${rec.mac}-${rec.first_seen}`}
            className="flex items-center gap-3 px-3 py-2 mb-1 rounded"
            style={{ background: 'var(--glass-subtle)' }}
          >
            <RSSIBars rssi={rec.rssi ?? -100} />
            <div className="flex-1 min-w-0">
              <div
                className="truncate"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--ink-primary)',
                }}
              >
                {rec.ssid?.trim() || <em style={{ color: 'var(--ink-muted)' }}>(hidden)</em>}
              </div>
              <div
                className="truncate"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--fs-micro)',
                  color: 'var(--ink-muted)',
                }}
              >
                {rec.mac} · {rec.encryption ?? 'open'}
              </div>
            </div>
            <span
              className="tabular-nums"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-micro)',
                color: 'var(--ink-muted)',
              }}
            >
              {rec.rssi ?? '—'} dBm
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RSSIBars({ rssi }: { rssi: number }) {
  const strength = rssi > -50 ? 4 : rssi > -65 ? 3 : rssi > -78 ? 2 : rssi > -90 ? 1 : 0;
  return (
    <div className="flex items-end gap-[2px]" style={{ width: 14, height: 14 }}>
      {[1, 2, 3, 4].map((b) => (
        <span
          key={b}
          style={{
            width: 2,
            height: 3 + b * 2,
            borderRadius: 1,
            background: b <= strength ? 'var(--accent)' : 'var(--line-subtle)',
          }}
        />
      ))}
    </div>
  );
}

/* ─── Camera ───────────────────────────────────────────────────────────── */

const ENROLL_TARGET_SAMPLES = 8;

function CameraOverlay() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [tracking, setTracking] = useState(false);
  const systemState = useSystemStore((s) => s.state);
  const detection = useFaceStore((s) => s.lastDetection);
  const recognized = useFaceStore((s) => s.recognized);
  const unknownSince = useFaceStore((s) => s.unknownSince);
  const cameraError = useFaceStore((s) => s.cameraError);
  const enrollStatus = useFaceStore((s) => s.enrollStatus);
  const enrollSamples = useFaceStore((s) => s.enrollSamples);
  const enrollError = useFaceStore((s) => s.enrollError);
  const startEnrollment = useFaceStore((s) => s.startEnrollment);
  const resetEnrollment = useFaceStore((s) => s.resetEnrollment);
  const setEnrollStatus = useFaceStore((s) => s.setEnrollStatus);
  const enabled = useFaceStore((s) => s.enabled);
  const privacyMode = useFaceStore((s) => s.privacyMode);

  // GHOST forces camera off; also respect the master enable flag.
  const privacyOff =
    systemState === SystemState.GHOST || privacyMode === 'off' || !enabled;

  useFaceDetection({
    videoRef,
    enabled: tracking && !privacyOff,
  });

  useEffect(() => {
    if (privacyOff) setTracking(false);
  }, [privacyOff]);

  // Auto-finalize enrollment once we have enough samples.
  useEffect(() => {
    if (enrollStatus !== 'collecting') return;
    if (enrollSamples.length < ENROLL_TARGET_SAMPLES) return;
    setEnrollStatus('sending');
    faceApi
      .enroll(enrollSamples.slice(0, ENROLL_TARGET_SAMPLES))
      .then(() => setEnrollStatus('done'))
      .catch((err: Error) => setEnrollStatus('error', err.message));
  }, [enrollStatus, enrollSamples, setEnrollStatus]);

  const onDelete = useCallback(async () => {
    try {
      await faceApi.deleteEmbedding();
      resetEnrollment();
    } catch {
      /* surfaced elsewhere */
    }
  }, [resetEnrollment]);

  const box = detection?.box;
  const progress = Math.min(1, enrollSamples.length / ENROLL_TARGET_SAMPLES);

  return (
    <div className="h-full flex flex-col">
      <div
        className="flex-1 relative overflow-hidden"
        style={{
          background:
            'radial-gradient(circle at center, color-mix(in srgb, var(--accent) 10%, transparent), var(--surface-deep))',
        }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: 'scaleX(-1)', // mirror for user-facing webcam
            display: tracking && !privacyOff ? 'block' : 'none',
          }}
        />

        {/* Face bbox overlay (mirrored to match the video). */}
        {tracking && !privacyOff && box && box.w > 0 && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: `${(1 - box.x - box.w) * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
              border: '1px solid var(--accent)',
              borderRadius: 6,
              boxShadow: '0 0 12px var(--accent-glow)',
              pointerEvents: 'none',
              transition: 'all 80ms linear',
            }}
          />
        )}

        {(!tracking || privacyOff) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-center px-4">
              {privacyOff ? (
                <Shield size={32} strokeWidth={1.5} style={{ color: 'var(--signal-warn)' }} />
              ) : (
                <Camera size={32} strokeWidth={1.5} style={{ color: 'var(--ink-muted)' }} />
              )}
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--ink-muted)',
                }}
              >
                {privacyOff
                  ? systemState === SystemState.GHOST
                    ? 'Camera off · GHOST'
                    : privacyMode === 'off'
                      ? 'Camera off · privacy mode'
                      : 'Face tracking disabled'
                  : 'Camera idle'}
              </span>
              {!privacyOff && (
                <span
                  className="italic"
                  style={{
                    fontFamily: 'var(--font-serif)',
                    fontSize: 'var(--fs-micro)',
                    color: 'var(--ink-faint)',
                  }}
                >
                  Tap “Start tracking” to begin
                </span>
              )}
            </div>
          </div>
        )}

        {/* Status label */}
        {tracking && !privacyOff && (
          <div
            className="absolute"
            style={{
              top: 10,
              left: 10,
              padding: '4px 10px',
              borderRadius: 9999,
              background: 'color-mix(in srgb, var(--surface-deep) 70%, transparent)',
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-micro)',
              color: recognized
                ? 'var(--signal-ok)'
                : unknownSince
                  ? 'var(--signal-warn)'
                  : 'var(--ink-muted)',
              letterSpacing: 'var(--tracking-widest)',
              textTransform: 'uppercase',
            }}
          >
            {recognized
              ? `${recognized.username} · ${(recognized.confidence * 100).toFixed(0)}%`
              : unknownSince
                ? 'Unknown face'
                : detection
                  ? 'Detecting…'
                  : 'No face'}
          </div>
        )}

        {cameraError && (
          <div
            className="absolute"
            style={{
              bottom: 10,
              left: 10,
              right: 10,
              padding: '6px 10px',
              borderRadius: 6,
              background: 'color-mix(in srgb, var(--signal-alert) 16%, transparent)',
              color: 'var(--signal-alert)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-micro)',
            }}
          >
            {cameraError}
          </div>
        )}
      </div>
      <div
        className="flex items-center gap-2 px-4 py-3 shrink-0 flex-wrap"
        style={{ borderTop: '1px solid var(--glass-border)' }}
      >
        <button
          type="button"
          className="active:scale-95 transition-all"
          onClick={() => setTracking((v) => !v)}
          disabled={privacyOff}
          style={{
            minHeight: 44,
            padding: '0 14px',
            borderRadius: 9999,
            background: tracking
              ? 'var(--accent)'
              : 'color-mix(in srgb, var(--accent) 14%, transparent)',
            color: tracking ? 'var(--ink-inverse)' : 'var(--accent)',
            border: '1px solid var(--accent)',
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-micro)',
            letterSpacing: 'var(--tracking-wider)',
            textTransform: 'uppercase',
            transitionDuration: '200ms',
            opacity: privacyOff ? 0.4 : 1,
          }}
        >
          {tracking ? 'Stop' : 'Start tracking'}
        </button>

        <button
          type="button"
          onClick={() => {
            if (enrollStatus === 'collecting' || enrollStatus === 'sending') return;
            startEnrollment();
          }}
          disabled={!tracking || privacyOff || enrollStatus === 'sending'}
          className="active:scale-95 transition-all flex items-center gap-2"
          style={{
            minHeight: 44,
            padding: '0 14px',
            borderRadius: 9999,
            background: 'color-mix(in srgb, var(--signal-ok) 14%, transparent)',
            color: 'var(--signal-ok)',
            border: '1px solid var(--signal-ok)',
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-micro)',
            letterSpacing: 'var(--tracking-wider)',
            textTransform: 'uppercase',
            opacity: !tracking || privacyOff ? 0.4 : 1,
          }}
        >
          <UserCheck size={14} strokeWidth={1.75} />
          {enrollStatus === 'collecting'
            ? `${Math.round(progress * 100)}%`
            : enrollStatus === 'sending'
              ? 'Saving…'
              : enrollStatus === 'done'
                ? 'Enrolled'
                : 'Enroll face'}
        </button>

        <button
          type="button"
          onClick={onDelete}
          className="active:scale-95 transition-all flex items-center gap-2"
          style={{
            minHeight: 44,
            padding: '0 14px',
            borderRadius: 9999,
            background: 'color-mix(in srgb, var(--signal-alert) 12%, transparent)',
            color: 'var(--signal-alert)',
            border: '1px solid color-mix(in srgb, var(--signal-alert) 40%, transparent)',
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-micro)',
            letterSpacing: 'var(--tracking-wider)',
            textTransform: 'uppercase',
          }}
          title="Delete my face embedding"
        >
          <Trash2 size={14} strokeWidth={1.75} />
          Forget me
        </button>

        <div className="flex-1" />

        {(enrollStatus === 'done' || enrollStatus === 'error') && (
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-micro)',
              color:
                enrollStatus === 'error' ? 'var(--signal-alert)' : 'var(--signal-ok)',
            }}
          >
            {enrollStatus === 'error' ? enrollError ?? 'Enroll failed' : 'Saved ✓'}
          </span>
        )}

        {unknownSince && !recognized && (
          <span className="flex items-center gap-1"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-micro)',
              color: 'var(--signal-warn)',
            }}
          >
            <UserX size={12} strokeWidth={1.75} />
            Unknown
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Apps ────────────────────────────────────────────────────────────── */

function AppsOverlay() {
  return (
    <div className="h-full flex items-center justify-center p-6 text-center">
      <span
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 'var(--fs-sm)',
          color: 'var(--ink-muted)',
          fontStyle: 'italic',
        }}
      >
        Apps grid arrives in a later phase.
      </span>
    </div>
  );
}
