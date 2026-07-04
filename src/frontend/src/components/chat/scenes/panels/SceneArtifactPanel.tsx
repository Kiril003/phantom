import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, Download, X, Check } from 'lucide-react';
import type { ArtifactCapability, ArtifactPhase } from '@shared/types/chat';
import { ArtifactBroker } from '../artifactBroker';
import { wsClient } from '../../../../services/websocket';
import type { WSMessage } from '../../../../services/websocket';

interface Props {
  data: { html: string; title: string; capabilities: ArtifactCapability[] };
}

const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
  "img-src data:; font-src data:; connect-src 'none'";

// Inline measurer: reports the document's real height to the parent so the
// inline card hugs its content instead of a blind fixed 520px. Full-height
// (100%) artifacts settle at the clamp minimum and rely on fullscreen.
const MEASURE_SCRIPT =
  '<script>(function(){var last=0;function r(){var b=document.body,e=document.documentElement;' +
  'var h=Math.max(b?b.scrollHeight:0,e?e.scrollHeight:0);' +
  "if(Math.abs(h-last)>4){last=h;parent.postMessage({type:'phantom:artifact:height',height:h},'*');}}" +
  'var ro=window.ResizeObserver?new ResizeObserver(r):null;' +
  "window.addEventListener('load',function(){r();if(ro&&document.body)ro.observe(document.body);setInterval(r,800);});" +
  '})()</script>';

const INLINE_MIN = 260;
const INLINE_MAX = 420;

const PHASE_LABELS: Record<ArtifactPhase, string> = {
  draft: 'Чернетка…',
  critiquing: 'Критика…',
  polishing: 'Полірування…',
  done: 'Готово',
};

async function readSlice(key: string): Promise<unknown> {
  const r = await fetch('/api/v1/context/snapshot', { credentials: 'include' });
  const snap = await r.json();
  switch (key) {
    case 'context.snapshot': return snap;
    case 'sensors.latest': return snap.sensors ?? null;
    case 'memory.facts': return snap.memory ?? null;
    case 'system.state': return snap.system?.state ?? null;
    default: return null;
  }
}

interface ProgressMsg extends WSMessage {
  channel: 'chat';
  type: 'scene.artifact.progress';
  data: { phase: ArtifactPhase; htmlPreview?: string };
}

export function SceneArtifactPanel({ data }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [alive, setAlive] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [inlineHeight, setInlineHeight] = useState(320);

  const handleSave = async () => {
    try {
      await fetch('/api/v1/studio/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: data.title || 'Артефакт',
          cards: [{
            kind: 'artifact',
            category: 'output',
            title: data.title,
            config: { html: data.html, capabilities: data.capabilities }
          }],
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
  };

  // Progressive render state. null = no progress events received yet →
  // render committed data.html exactly as before (back-compat invariant).
  const [buildPhase, setBuildPhase] = useState<ArtifactPhase | null>(null);
  const [liveHtml, setLiveHtml] = useState<string | null>(null);

  // Subscribe to scene.artifact.progress on the chat channel.
  useEffect(() => {
    const off = wsClient.on<WSMessage>('chat', (msg) => {
      if (msg.type !== 'scene.artifact.progress') return;
      const m = msg as ProgressMsg;
      const { phase, htmlPreview } = m.data;
      setBuildPhase(phase);
      if (htmlPreview !== undefined) setLiveHtml(htmlPreview);
      if (phase === 'done') {
        // Settle: clear progress state so the panel uses committed data.
        // Use a microtask to let React apply the final html first.
        setTimeout(() => {
          setBuildPhase(null);
          setLiveHtml(null);
        }, 300);
      }
    });
    return off;
  }, []);

  useEffect(() => {
    const w = ref.current?.contentWindow;
    if (!w || !alive) return;
    const broker = new ArtifactBroker(w, data.capabilities, readSlice);
    broker.attach();
    return () => broker.detach();
  }, [alive, data.capabilities, expanded]);

  // Content-height reports from OUR iframe only (a transcript can hold
  // several artifact panels at once).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return;
      const d = e.data as { type?: string; height?: number } | null;
      if (!d || d.type !== 'phantom:artifact:height' || typeof d.height !== 'number') return;
      setInlineHeight(Math.round(Math.min(INLINE_MAX, Math.max(INLINE_MIN, d.height))));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Fullscreen ergonomics: Escape closes, body scroll locks.
  const collapse = useCallback(() => setExpanded(false), []);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') collapse();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded, collapse]);

  if (!alive) return null;

  // During a build: use liveHtml preview when available, otherwise shimmer.
  const isBuilding = buildPhase !== null && buildPhase !== 'done';
  const displayHtml = liveHtml ?? data.html;
  const srcdoc =
    `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    displayHtml +
    MEASURE_SCRIPT;

  const header = (
    <div
      className="flex shrink-0 items-center justify-between pl-3 pr-2 text-xs bg-white/5 border-b border-white/5"
      style={{ minHeight: 44 }}
    >
      <button
        type="button"
        data-testid="artifact-header-toggle"
        onClick={() => !isBuilding && setExpanded((v) => !v)}
        className="flex-1 min-w-0 text-left truncate opacity-80"
        style={{ minHeight: 44, background: 'none', border: 0, color: 'inherit', font: 'inherit' }}
      >
        {buildPhase !== null ? PHASE_LABELS[buildPhase] : (data.title || 'Артефакт')}
      </button>
      <div className="flex items-center gap-1">
        {!isBuilding && (
          <button
            aria-label={expanded ? 'згорнути артефакт' : 'розгорнути артефакт'}
            onClick={() => setExpanded((v) => !v)}
            className="artifact-control-btn"
            style={{ minWidth: 44, minHeight: 44 }}
          >
            {expanded ? <Minimize2 size={16} strokeWidth={2} /> : <Maximize2 size={16} strokeWidth={2} />}
          </button>
        )}
        {!isBuilding && (
          <button
            aria-label="зберегти артефакт"
            onClick={handleSave}
            className={`artifact-control-btn ${saved ? 'success' : ''}`}
            style={{ minWidth: 44, minHeight: 44 }}
          >
            {saved ? <Check size={16} strokeWidth={2.5} /> : <Download size={16} strokeWidth={2} />}
          </button>
        )}
        <button
          aria-label={expanded ? 'закрити повний екран' : 'зупинити артефакт'}
          onClick={() => (expanded ? collapse() : setAlive(false))}
          className="artifact-control-btn alert"
          style={{ minWidth: 44, minHeight: 44 }}
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );

  const shimmer = isBuilding && (
    <div
      data-testid="artifact-phase-shimmer"
      aria-live="polite"
      aria-label={buildPhase ? PHASE_LABELS[buildPhase] : undefined}
      className="h-0.5 w-full shrink-0 overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.06)' }}
    >
      <div
        className="h-full"
        style={{
          width: '40%',
          background: 'linear-gradient(90deg, transparent, rgba(120,180,255,0.6), transparent)',
          animation: 'artifact-shimmer 1.4s linear infinite',
        }}
      />
    </div>
  );

  const body = failed ? (
    <pre className="p-3 text-xs overflow-auto" style={{ maxHeight: expanded ? 'none' : 420 }}>
      {displayHtml}
    </pre>
  ) : (
    <iframe
      ref={ref}
      title={data.title || 'artifact'}
      sandbox="allow-scripts"
      srcDoc={srcdoc}
      onError={() => setFailed(true)}
      className={expanded ? 'flex-1' : ''}
      style={{
        width: '100%',
        height: expanded ? '100%' : inlineHeight,
        border: 0,
        background: '#0b0f14',
        display: 'block',
        opacity: isBuilding && !liveHtml ? 0 : 1,
        transition: 'opacity 0.2s, height 0.25s ease',
      }}
    />
  );

  // Fullscreen rides a portal: ancestors in the chat transcript carry
  // framer-motion transforms, and position:fixed inside a transformed
  // element anchors to that element — the old in-place overlay never
  // actually reached the viewport. document.body has no transform.
  if (expanded) {
    return createPortal(
      <div
        data-testid="artifact-panel"
        data-expanded="1"
        data-build-phase={buildPhase ?? undefined}
        className="flex flex-col"
        style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#0b0f14' }}
      >
        {header}
        {shimmer}
        {body}
      </div>,
      document.body,
    );
  }

  return (
    <div
      data-testid="artifact-panel"
      data-expanded="0"
      data-build-phase={buildPhase ?? undefined}
      className="rounded-xl border border-white/10 overflow-hidden"
      style={{ width: '100%', maxWidth: 1024 }}
    >
      {header}
      {shimmer}
      {body}
    </div>
  );
}
