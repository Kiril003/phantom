import { useEffect, useRef, useState } from 'react';
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
  }, [alive, data.capabilities]);

  if (!alive) return null;

  // During a build: use liveHtml preview when available, otherwise shimmer.
  const isBuilding = buildPhase !== null && buildPhase !== 'done';
  const displayHtml = liveHtml ?? data.html;
  const srcdoc =
    `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    displayHtml;

  return (
    <div
      data-testid="artifact-panel"
      data-expanded={expanded ? '1' : '0'}
      data-build-phase={buildPhase ?? undefined}
      className="rounded-xl border border-white/10 overflow-hidden"
      style={
        expanded
          ? {
              position: 'fixed',
              inset: 0,
              zIndex: 1000,
              maxWidth: 'none',
              background: '#0b0f14',
              display: 'flex',
              flexDirection: 'column',
            }
          : { width: '100%', maxWidth: 1024 }
      }
    >
      <div className="flex shrink-0 items-center justify-between px-3 py-1.5 text-xs bg-white/5 border-b border-white/5">
        <span className="opacity-70">
          {buildPhase !== null
            ? PHASE_LABELS[buildPhase]
            : (data.title || 'Артефакт')}
        </span>
        <div className="flex gap-2">
          {!isBuilding && (
            <button
              aria-label={expanded ? 'згорнути артефакт' : 'розгорнути артефакт'}
              onClick={() => setExpanded((v) => !v)}
              className="artifact-control-btn"
            >
              {expanded ? <Minimize2 size={13} strokeWidth={2} /> : <Maximize2 size={13} strokeWidth={2} />}
            </button>
          )}
          {!isBuilding && (
            <button
              aria-label="зберегти артефакт"
              onClick={handleSave}
              className={`artifact-control-btn ${saved ? 'success' : ''}`}
            >
              {saved ? <Check size={13} strokeWidth={2.5} /> : <Download size={13} strokeWidth={2} />}
            </button>
          )}
          <button
            aria-label="зупинити артефакт"
            onClick={() => setAlive(false)}
            className="artifact-control-btn alert"
          >
            <X size={13} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Phase shimmer bar — only visible while a build is in progress */}
      {isBuilding && (
        <div
          data-testid="artifact-phase-shimmer"
          aria-live="polite"
          aria-label={buildPhase ? PHASE_LABELS[buildPhase] : undefined}
          className="h-0.5 w-full overflow-hidden"
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
      )}

      {failed ? (
        <pre className="p-3 text-xs overflow-auto max-h-[420px]">{displayHtml}</pre>
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
            height: expanded ? 'auto' : 520,
            border: 0,
            background: '#0b0f14',
            display: 'block',
            opacity: isBuilding && !liveHtml ? 0 : 1,
            transition: 'opacity 0.2s',
          }}
        />
      )}
    </div>
  );
}
