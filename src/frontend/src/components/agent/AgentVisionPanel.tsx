/**
 * Phase 18 — AgentVisionPanel.
 *
 * Live screenshot viewer with optional OCR-overlay. Operator toggles it on
 * to "see what the agent sees" — drama / observability per П-2. Polls the
 * /agent/screen/capture endpoint at a soft interval (1.5s) when open and
 * stops when hidden so we don't burn power on the Radxa.
 *
 * Overlays:
 *   • OCR boxes (toggle "AA")
 *   • Last click ripple (animated; consumed via prop)
 *
 * Skeleton state when no backend is installed: shows the install hint
 * (grim / scrot / xdotool) instead of a screenshot.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, Type, Pause, Play } from 'lucide-react';
import { agentApi } from '../../services/agentApi';

interface OcrLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

interface CaptureState {
  width: number;
  height: number;
  strategy: string;
  png_base64: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  pollMs?: number;
}

export function AgentVisionPanel({ open, onClose, pollMs = 1500 }: Props) {
  const [frame, setFrame] = useState<CaptureState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showOcr, setShowOcr] = useState(false);
  const [ocrLines, setOcrLines] = useState<OcrLine[]>([]);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);

  const lastFrameAt = useRef<number>(0);

  useEffect(() => {
    if (!open || paused) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      setBusy(true);
      try {
        const resp = await agentApi.screenCapture();
        if (cancelled) return;
        if (resp.ok && resp.png_base64) {
          setFrame({
            width: resp.width,
            height: resp.height,
            strategy: resp.strategy,
            png_base64: resp.png_base64,
          });
          setError(null);
          setTried(null);
          lastFrameAt.current = Date.now();
        }
      } catch (err: unknown) {
        if (cancelled) return;
        // Try to extract { error, tried } from FastAPI's HTTPException.
        const msg = err instanceof Error ? err.message : String(err);
        // The api wrapper stringifies — look for tried[] in message.
        const triedMatch = msg.match(/"tried":\s*\[([^\]]+)\]/);
        if (triedMatch) {
          setTried(triedMatch[1].split(',').map((s) => s.replace(/["\s]/g, '')));
        }
        setError(msg.slice(0, 240));
      } finally {
        if (!cancelled) {
          setBusy(false);
          timer = setTimeout(tick, pollMs);
        }
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, paused, pollMs]);

  const runOcr = async () => {
    if (ocrBusy) return;
    setOcrBusy(true);
    setOcrError(null);
    try {
      const resp = await agentApi.screenOcr();
      setOcrLines(resp.lines);
      setShowOcr(true);
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'OCR failed');
      setShowOcr(false);
    } finally {
      setOcrBusy(false);
    }
  };

  const dataUrl = useMemo(
    () => (frame ? `data:image/png;base64,${frame.png_base64}` : null),
    [frame],
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0"
          style={{
            zIndex: 69,
            background: 'rgba(28,22,14,0.62)',
            backdropFilter: 'blur(12px)',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            className="glass-strong"
            style={{
              position: 'absolute',
              top: 24,
              left: 24,
              right: 24,
              bottom: 24,
              borderRadius: 22,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              boxShadow:
                '0 30px 70px rgba(120,70,10,0.36), 0 0 0 1px var(--glass-border)',
            }}
            initial={{ scale: 0.97, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 12 }}
            transition={{ duration: 0.22 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Очі агента"
          >
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span className="eyebrow-amber" style={{ fontSize: 11 }}>
                  ОЧІ АГЕНТА
                </span>
                <h2 style={{ margin: '4px 0 0 0', fontSize: 18, color: 'var(--ink-strong)' }}>
                  {frame
                    ? `${frame.width}×${frame.height} · ${frame.strategy}`
                    : 'Очікую кадр…'}
                </h2>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setPaused((p) => !p)}
                  style={{
                    minHeight: 40,
                    padding: '0 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(180,150,90,0.30)',
                    background: 'rgba(255,255,255,0.65)',
                    color: 'var(--ink-strong)',
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                  aria-label={paused ? 'Відновити' : 'Пауза'}
                >
                  {paused ? <Play size={14} /> : <Pause size={14} />}
                  {paused ? 'Відновити' : 'Пауза'}
                </button>
                <button
                  type="button"
                  onClick={() => void runOcr()}
                  disabled={ocrBusy}
                  style={{
                    minHeight: 40,
                    padding: '0 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(180,150,90,0.30)',
                    background: showOcr ? 'rgba(244,175,37,0.20)' : 'rgba(255,255,255,0.65)',
                    color: 'var(--ink-strong)',
                    fontSize: 12,
                    cursor: ocrBusy ? 'wait' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                  aria-label="OCR overlay"
                >
                  <Type size={14} />
                  OCR ({ocrLines.length})
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    border: '1px solid rgba(180,150,90,0.30)',
                    background: 'transparent',
                    color: 'var(--ink-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  aria-label="Закрити"
                >
                  <X size={18} />
                </button>
              </div>
            </header>

            {ocrError && (
              <div style={{ color: '#B9201F', fontSize: 11 }}>OCR: {ocrError}</div>
            )}

            <div
              style={{
                flex: 1,
                minHeight: 0,
                position: 'relative',
                borderRadius: 14,
                overflow: 'hidden',
                background: 'rgba(28,22,14,0.65)',
                border: '1px solid rgba(180,150,90,0.20)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {dataUrl ? (
                <>
                  <img
                    src={dataUrl}
                    alt="screen"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                      display: 'block',
                    }}
                  />
                  {showOcr && frame && (
                    <svg
                      viewBox={`0 0 ${frame.width} ${frame.height}`}
                      preserveAspectRatio="xMidYMid meet"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: 'none',
                      }}
                    >
                      {ocrLines.map((l, i) => (
                        <g key={i}>
                          <rect
                            x={l.x}
                            y={l.y}
                            width={l.w}
                            height={l.h}
                            fill="rgba(244,175,37,0.15)"
                            stroke="rgba(244,175,37,0.7)"
                            strokeWidth={1}
                          />
                          <text
                            x={l.x + 2}
                            y={l.y - 2}
                            fontSize={Math.max(10, l.h * 0.25)}
                            fill="rgba(28,22,14,0.85)"
                          >
                            {l.text}
                          </text>
                        </g>
                      ))}
                    </svg>
                  )}
                </>
              ) : (
                <div
                  style={{
                    color: '#FBE9C5',
                    textAlign: 'center',
                    padding: 24,
                    maxWidth: 480,
                  }}
                >
                  <Camera size={32} style={{ marginBottom: 8, opacity: 0.7 }} />
                  <div style={{ fontSize: 14, marginBottom: 8 }}>
                    {error ? 'Бекенд скріншоту недоступний' : 'Очікую перший кадр…'}
                  </div>
                  {error && (
                    <div
                      style={{
                        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                        fontSize: 11,
                        color: 'rgba(251,233,197,0.65)',
                        background: 'rgba(0,0,0,0.25)',
                        padding: 8,
                        borderRadius: 8,
                        marginBottom: 8,
                      }}
                    >
                      {error}
                    </div>
                  )}
                  {tried && tried.length > 0 && (
                    <div style={{ fontSize: 12, opacity: 0.85 }}>
                      Стратегії перевірені: {tried.join(', ')}.
                      <br />
                      Встанови один з: <code>grim</code>, <code>scrot</code>,{' '}
                      <code>imagemagick</code>, або pip-пакет <code>mss</code>.
                    </div>
                  )}
                </div>
              )}
              {busy && (
                <span
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 12,
                    fontSize: 10,
                    color: 'rgba(251,233,197,0.75)',
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  }}
                >
                  ⟳ оновлюю…
                </span>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
