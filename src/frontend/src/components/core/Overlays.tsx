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
  Map,
  Cpu,
  Radar,
  Settings,
  Search,
  Clock,
  Bell,
  CalendarDays,
  Folder,
  BarChart3,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { FloatingWindow } from './FloatingWindow';
import { useUIStore, type OverlayName } from '../../stores/uiStore';
import { useMapStore } from '../../stores/mapStore';
import { useSystemStore } from '../../stores/systemStore';
import { useAppsStore } from '../../stores/appsStore';
import { useFaceStore } from '../../stores/faceStore';
import { useFaceDetection } from '../../hooks/useFaceDetection';
import { faceApi } from '../../services/faceApi';
import { SystemState } from '@shared/types';
import { StandingOrdersOverlay } from './StandingOrdersOverlay';
import { Zap } from 'lucide-react';
import { readToken } from '../../services/tokenStore';
// Адреса бекенда — тільки з єдиного джерела. У пакунку фронт віддається
// asset-протоколом Tauri, тож відносний fetch на /api іде на tauri.localhost,
// а не на sidecar, і виклик не доходить — виміряно на зібраному AppImage.
import { apiUrl } from '../../services/backendOrigin';

const TITLES: Record<OverlayName, string> = {
  terminal: 'Terminal',
  wardriving: 'Nearby networks',
  camera: 'Camera · face track',
  apps: 'Apps',
  standing_orders: 'Protocols · standing orders',
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
    case 'standing_orders':
      return <Zap size={14} strokeWidth={1.75} />;
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
    case 'standing_orders':
      return <StandingOrdersOverlay />;
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

  const onSubmit = useCallback(async (cmd: string) => {
    const id = Math.random().toString(36).slice(2);
    const trimmed = cmd.trim();
    if (!trimmed) return;

    setLines((l) => [...l, { id: id + '_p', kind: 'prompt', text: `› ${trimmed}` }]);
    setInput('');

    if (trimmed === 'clear') {
      setLines([]);
      return;
    }

    if (trimmed === 'help') {
      setLines((l) => [
        ...l,
        { id: id + '_h', kind: 'info', text: 'PHANTOM sandboxed shell. Run any linux command.' },
      ]);
      return;
    }

    try {
      const token = readToken();
      const res = await fetch(apiUrl('/api/v1/linux/execute'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ command: trimmed }),
      });

      const data = await res.json();
      if (!res.ok) {
        setLines((l) => [...l, { id: id + '_e', kind: 'stderr', text: data.detail || 'Error' }]);
        return;
      }

      if (data.needs_confirmation) {
        setLines((l) => [...l, { id: id + '_o', kind: 'info', text: data.message }]);
        return;
      }

      const { stdout, stderr, return_code } = data.output || {};
      if (stdout) {
        setLines((l) => [...l, { id: id + '_o', kind: 'stdout', text: stdout }]);
      }
      if (stderr) {
        setLines((l) => [...l, { id: id + '_e', kind: 'stderr', text: stderr }]);
      }
      if (return_code !== 0 && !stderr) {
        setLines((l) => [
          ...l,
          { id: id + '_e', kind: 'stderr', text: `Process exited with code ${return_code}` },
        ]);
      }
    } catch (err) {
      setLines((l) => [
        ...l,
        { id: id + '_e', kind: 'stderr', text: 'System offline or connection refused' },
      ]);
    }
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

interface AppTile {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}

interface AppSection {
  id: string;
  title: string;
  tiles: AppTile[];
}

function AppsOverlay() {
  const navigate = useNavigate();
  const toggleOverlay = useUIStore((s) => s.toggleOverlay);
  const openToolsTab = useUIStore((s) => s.openToolsTab);
  const goSentinel = useSystemStore((s) => s.goSentinel);
  const lastUsed = useAppsStore((s) => s.lastUsed);
  const markUsed = useAppsStore((s) => s.markUsed);

  const [query, setQuery] = useState('');
  const now = Date.now();

  const closeApps = () => toggleOverlay('apps');
  const launch = (id: string, action: () => void) => {
    markUsed(id);
    action();
    closeApps();
  };

  // Phase 22 — single home for every app. Camera/Terminal/Networks/Map only
  // live here, not in the More menu. Tools (Timer/Alarm/Calendar/Files) are
  // promoted out of the legacy ToolsOverlay tab strip into top-level tiles.
  const sections: AppSection[] = [
    {
      id: 'system',
      title: 'Системні',
      tiles: [
        {
          id: 'map',
          label: 'Карта',
          description: 'Тактична карта · сенсори · мітки',
          icon: <Map size={22} strokeWidth={1.6} />,
          onClick: () => launch('map', () => navigate('/map')),
        },
        {
          id: 'camera',
          label: 'Камера',
          description: 'Face track · OpenCV pipeline',
          icon: <Camera size={22} strokeWidth={1.6} />,
          onClick: () => launch('camera', () => toggleOverlay('camera')),
        },
        {
          id: 'terminal',
          label: 'Термінал',
          description: 'Sandboxed shell · пiсочниця',
          icon: <TerminalIcon size={22} strokeWidth={1.6} />,
          onClick: () => launch('terminal', () => toggleOverlay('terminal')),
        },
        {
          id: 'wifi',
          label: 'Мережі',
          description: 'Wardriving · BSSID скан',
          icon: <Wifi size={22} strokeWidth={1.6} />,
          onClick: () => launch('wifi', () => toggleOverlay('wardriving')),
        },
      ],
    },
    {
      id: 'tools',
      title: 'Інструменти',
      tiles: [
        {
          id: 'timer',
          label: 'Таймери',
          description: 'Зворотний відлік · alerts',
          icon: <Clock size={22} strokeWidth={1.6} />,
          onClick: () => launch('timer', () => openToolsTab('timer')),
        },
        {
          id: 'alarm',
          label: 'Будильники',
          description: 'Розклад · повторення',
          icon: <Bell size={22} strokeWidth={1.6} />,
          onClick: () => launch('alarm', () => openToolsTab('alarm')),
        },
        {
          id: 'calendar',
          label: 'Календар',
          description: 'Події · нагадування',
          icon: <CalendarDays size={22} strokeWidth={1.6} />,
          onClick: () => launch('calendar', () => openToolsTab('calendar')),
        },
        {
          id: 'files',
          label: 'Файли',
          description: 'Browser · upload · sandbox',
          icon: <Folder size={22} strokeWidth={1.6} />,
          onClick: () => launch('files', () => openToolsTab('files')),
        },
      ],
    },
    {
      id: 'agent',
      title: 'Дані / Агент',
      tiles: [
        {
          id: 'agent',
          label: 'Агент',
          description: 'Майстерня агента · задачі',
          icon: <Cpu size={22} strokeWidth={1.6} />,
          onClick: () => launch('agent', () => navigate('/foundry')),
        },
        {
          id: 'analytics',
          label: 'Аналітика',
          description: 'Сесії · листування · оператори',
          icon: <BarChart3 size={22} strokeWidth={1.6} />,
          onClick: () => launch('analytics', () => navigate('/analytics')),
        },
        {
          id: 'sentinel',
          label: 'Sentinel',
          description: 'Threat watch · radar',
          icon: <Radar size={22} strokeWidth={1.6} />,
          // Стан малює StateSurface, а він живе на «/». Без переходу тап із
          // /map чи /settings міняв лише плашку.
          onClick: () =>
            launch('sentinel', () => {
              navigate('/');
              goSentinel();
            }),
        },
        {
          id: 'settings',
          label: 'Налаштування',
          description: 'Усі параметри системи',
          icon: <Settings size={22} strokeWidth={1.6} />,
          onClick: () => launch('settings', () => navigate('/settings')),
        },
        {
          id: 'protocols',
          label: 'Протоколи',
          description: 'Standing orders · автозадачі',
          icon: <Zap size={22} strokeWidth={1.6} />,
          onClick: () =>
            launch('protocols', () => toggleOverlay('standing_orders')),
        },
      ],
    },
  ];

  const q = query.trim().toLowerCase();
  const filteredSections = q
    ? sections
        .map((section) => ({
          ...section,
          tiles: section.tiles.filter(
            (t) =>
              t.label.toLowerCase().includes(q) ||
              t.description.toLowerCase().includes(q),
          ),
        }))
        .filter((section) => section.tiles.length > 0)
    : sections;

  return (
    <div
      className="h-full flex flex-col"
      style={{ padding: '14px 16px 16px', gap: 12 }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 10px',
          background: 'rgba(255,250,244,0.55)',
          border: '1px solid rgba(40,30,15,0.10)',
          borderRadius: 12,
          minHeight: 40,
        }}
      >
        <Search
          size={16}
          strokeWidth={1.75}
          style={{ color: 'var(--ink-muted)', flexShrink: 0 }}
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Пошук додатків…"
          aria-label="Пошук додатків"
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--ink-primary)',
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-small)',
          }}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Очистити пошук"
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--ink-muted)',
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: 'var(--font-display)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            очистити
          </button>
        )}
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          paddingRight: 4,
        }}
      >
        {filteredSections.length === 0 && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink-muted)',
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-small)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            нічого не знайдено
          </div>
        )}
        {filteredSections.map((section) => (
          <div
            key={section.id}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <div
              className="eyebrow-amber"
              style={{ paddingLeft: 4, fontSize: 10, letterSpacing: '0.16em' }}
            >
              {section.title}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: 10,
              }}
            >
              {section.tiles.map((tile) => {
                const ts = lastUsed[tile.id];
                const ago =
                  typeof ts === 'number' ? formatAgoLabel(now - ts) : null;
                return (
                  <AppTileButton key={tile.id} tile={tile} ago={ago} />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
function formatAgoLabel(deltaMs: number): string | null {
  if (deltaMs < 0 || !Number.isFinite(deltaMs)) return null;
  if (deltaMs < MIN) return 'щойно';
  if (deltaMs < HOUR) return `${Math.floor(deltaMs / MIN)} хв`;
  if (deltaMs < DAY) return `${Math.floor(deltaMs / HOUR)} год`;
  const d = Math.floor(deltaMs / DAY);
  if (d <= 7) return `${d} дн`;
  return null;
}

function AppTileButton({
  tile,
  ago,
}: {
  tile: AppTile;
  ago: string | null;
}) {
  return (
    <button
      type="button"
      onClick={tile.onClick}
      aria-label={tile.label}
      title={`${tile.label} — ${tile.description}`}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 6,
        padding: '12px 12px 10px',
        minHeight: 96,
        borderRadius: 14,
        background: 'rgba(255,250,244,0.55)',
        border: '1px solid rgba(40,30,15,0.08)',
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.55), 0 4px 10px rgba(40,30,15,0.04)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'transform 120ms ease, background 200ms ease, box-shadow 200ms ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background =
          'rgba(255,250,244,0.85)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background =
          'rgba(255,250,244,0.55)';
      }}
    >
      <div
        style={{
          display: 'flex',
          width: 36,
          height: 36,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 10,
          background:
            'linear-gradient(135deg, rgba(244,175,37,0.18), rgba(251,146,60,0.14))',
          color: 'var(--accent)',
          border: '1px solid rgba(244,175,37,0.35)',
        }}
      >
        {tile.icon}
      </div>
      <span
        className="font-display"
        style={{
          fontSize: 'var(--fs-small)',
          fontWeight: 600,
          color: 'var(--ink-primary)',
          letterSpacing: '0.01em',
        }}
      >
        {tile.label}
      </span>
      <span
        style={{
          fontSize: 11,
          lineHeight: 1.3,
          color: 'var(--ink-muted)',
          fontFamily: 'var(--font-display)',
        }}
      >
        {tile.description}
      </span>
      {ago && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 8,
            right: 10,
            fontSize: 9,
            color: 'var(--ink-muted)',
            fontFamily: 'var(--font-display)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            opacity: 0.7,
          }}
        >
          {ago}
        </span>
      )}
    </button>
  );
}
