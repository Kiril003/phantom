/**
 * WorkbenchScene — the living Atelier card (W1-W2).
 *
 * Renders a chat-embedded creation: a live iframe of the multi-file
 * project the backend built, plus the seeing-loop trace (pass verdicts,
 * scores, critiques). While status is `building` the card listens on the
 * chat WS channel for `workbench.phase` events scoped to this
 * workbench_id and shows the loop breathing in real time; when the
 * `ready` phase lands it reloads the iframe to the final result.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Eye, Hammer, Loader2, Maximize2, Minimize2, RefreshCw, X,
} from 'lucide-react';
import type {
  WorkbenchPass, WorkbenchPhaseEvent, WorkbenchSceneData,
} from '@shared/types';
import { wsClient } from '../../../services/websocket';

const PHASE_LABEL: Record<string, string> = {
  generate: 'будую файли',
  see: 'дивлюсь на результат',
  critique: 'критикую себе',
  verdict: 'вердикт',
  patch: 'правлю',
  ready: 'готово',
  failed: 'збій',
};

function VerdictChip({ p }: { p: WorkbenchPass }) {
  const ship = p.verdict === 'SHIP';
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
      style={{
        background: ship ? 'rgba(22,163,74,0.10)' : 'rgba(244,175,37,0.12)',
        border: `1px solid ${ship ? 'rgba(22,163,74,0.25)' : 'rgba(244,175,37,0.30)'}`,
      }}
    >
      <span
        className="font-mono font-bold"
        style={{
          fontSize: 'var(--fs-xs)',
          color: ship ? '#16a34a' : '#b45309',
        }}
      >
        №{p.n} {p.verdict} {p.score}/10{p.blind ? ' · без ока' : ''}
      </span>
      <span
        className="truncate"
        style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)', maxWidth: 260 }}
        title={p.critique}
      >
        {p.critique}
      </span>
    </div>
  );
}

export function WorkbenchScene({ data }: { data: WorkbenchSceneData }) {
  const [status, setStatus] = useState(data.status);
  const [passes, setPasses] = useState<WorkbenchPass[]>(data.passes ?? []);
  const [livePhase, setLivePhase] = useState<string | null>(
    data.status === 'building' ? 'generate' : null,
  );
  const [fullscreen, setFullscreen] = useState(false);
  const [frameNonce, setFrameNonce] = useState(0);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (status !== 'building') return;
    return wsClient.on('chat', (msg) => {
      if (msg.type !== 'workbench.phase') return;
      const ev = msg.data as unknown as WorkbenchPhaseEvent;
      if (ev.workbench_id !== data.workbench_id) return;
      setLivePhase(ev.phase);
      if (ev.phase === 'verdict' && ev.verdict) {
        setPasses((prev) => [
          ...prev.filter((p) => p.n !== ev.pass),
          {
            n: ev.pass ?? prev.length + 1,
            verdict: ev.verdict as WorkbenchPass['verdict'],
            score: ev.score ?? 0,
            critique: ev.critique ?? '',
            blind: ev.blind,
          },
        ]);
      }
      if (ev.phase === 'ready') {
        setStatus('ready');
        setLivePhase(null);
        setFrameNonce((n) => n + 1);
      }
      if (ev.phase === 'failed') {
        setStatus('failed');
        setLivePhase(ev.error ?? 'збій');
      }
    });
  }, [status, data.workbench_id]);

  const src = useMemo(() => {
    const sep = data.preview_url.includes('?') ? '&' : '?';
    return `${data.preview_url}${sep}v=${frameNonce}`;
  }, [data.preview_url, frameNonce]);

  const reload = useCallback(() => setFrameNonce((n) => n + 1), []);

  const frame = (tall: boolean) => (
    <iframe
      ref={frameRef}
      key={frameNonce}
      src={src}
      title={data.title}
      sandbox="allow-scripts allow-same-origin"
      className="w-full border-0 rounded-xl"
      style={{
        height: tall ? '100%' : 300,
        background: 'white',
        pointerEvents: status === 'ready' ? 'auto' : 'none',
        opacity: status === 'ready' ? 1 : 0.45,
        transition: 'opacity 300ms ease',
      }}
    />
  );

  return (
    <>
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          border: '1px solid rgba(0,0,0,0.08)',
          background: 'var(--surface-raised, rgba(255,255,255,0.65))',
        }}
        data-testid="workbench-scene"
      >
        <div className="flex items-center gap-2 px-3" style={{ minHeight: 44 }}>
          <Hammer size={14} strokeWidth={1.75} style={{ color: 'var(--accent)' }} />
          <span
            className="font-display font-semibold truncate flex-1"
            style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}
          >
            {data.title}
          </span>
          {status === 'building' && (
            <span
              className="flex items-center gap-1.5 font-mono"
              style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}
              data-testid="workbench-live-phase"
            >
              <Loader2 size={12} className="animate-spin" />
              {PHASE_LABEL[livePhase ?? ''] ?? livePhase}
            </span>
          )}
          {status === 'failed' && (
            <span
              className="font-mono font-bold"
              style={{ fontSize: 'var(--fs-xs)', color: '#dc2626' }}
            >
              ЗБІЙ
            </span>
          )}
          {status === 'ready' && (
            <>
              <button
                type="button"
                onClick={reload}
                aria-label="Перезавантажити превʼю"
                className="flex items-center justify-center rounded-lg"
                style={{ minWidth: 44, minHeight: 44, color: 'var(--ink-muted)' }}
              >
                <RefreshCw size={14} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => setFullscreen(true)}
                aria-label="На весь екран"
                className="flex items-center justify-center rounded-lg"
                style={{ minWidth: 44, minHeight: 44, color: 'var(--ink-muted)' }}
              >
                <Maximize2 size={14} strokeWidth={1.75} />
              </button>
            </>
          )}
        </div>

        <div className="px-3 pb-2">{frame(false)}</div>

        {(passes.length > 0 || data.ai_note) && (
          <div className="px-3 pb-3 flex flex-col gap-1.5">
            {passes
              .slice()
              .sort((a, b) => a.n - b.n)
              .map((p) => <VerdictChip key={p.n} p={p} />)}
            {data.ai_note && (
              <span
                className="flex items-center gap-1.5"
                style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}
              >
                <Eye size={11} strokeWidth={1.75} />
                {data.ai_note}
              </span>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {fullscreen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex flex-col"
            style={{ background: 'var(--surface-void, #0a0a0a)' }}
            data-testid="workbench-fullscreen"
          >
            <div className="flex items-center gap-2 px-3" style={{ minHeight: 48 }}>
              <span
                className="font-display font-semibold flex-1 truncate"
                style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}
              >
                {data.title}
              </span>
              <button
                type="button"
                onClick={reload}
                aria-label="Перезавантажити"
                className="flex items-center justify-center rounded-lg"
                style={{ minWidth: 44, minHeight: 44, color: 'var(--ink-muted)' }}
              >
                <RefreshCw size={16} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                aria-label="Згорнути"
                className="flex items-center justify-center rounded-lg"
                style={{ minWidth: 44, minHeight: 44, color: 'var(--ink-muted)' }}
              >
                <Minimize2 size={16} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                aria-label="Закрити"
                className="flex items-center justify-center rounded-lg"
                style={{ minWidth: 44, minHeight: 44, color: 'var(--ink-muted)' }}
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
            <div className="flex-1 px-3 pb-3">{frame(true)}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
