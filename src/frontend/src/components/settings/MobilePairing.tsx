/**
 * Phase 19 Mobile Companion — desktop-side pairing panel.
 *
 * Renders inside SettingsPanel under category id `mobile`. Owns:
 *   1. "Generate QR" CTA → POST /api/v1/pair/init → displays inline SVG.
 *   2. 60-second countdown ring; auto-clears the QR on expiry.
 *   3. Live "claimed" / "revoked" toasts via the `pair` WS channel.
 *   4. Copyable raw QR JSON drawer for the Companion app's manual-paste
 *      fallback (when the camera scan fails).
 *   5. Paired devices list with REVOKE button per row.
 *
 * Layout note: this panel must fit on the 1024×600 device alongside the
 * categories sidebar and the StatusBar header. Earlier revision used
 * 44 px icons and 220 px QR + 16 px paddings — visually rich on a 27"
 * monitor, but cramped against the actual hardware viewport. Density
 * is now tuned for the device first; spacious-screen rendering still
 * feels intentional because the column max-width caps the spread.
 *
 * Crypto, JWT minting, and ECDH live on the backend (`security/pair_crypto`
 * + `api/routes_pair.py`); this component is a thin presentational shell.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Smartphone,
  QrCode,
  RefreshCw,
  ShieldOff,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  pairApi,
  ApiError,
  type PairInitResponse,
  type PairedDeviceRow,
} from '../../services/api';
import { wsClient } from '../../services/websocket';

interface ClaimToast {
  kind: 'claimed' | 'revoked';
  message: string;
  ts: number;
}

const PAIR_TTL_S = 60;

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const dt = (Date.now() - t) / 1000;
  if (dt < 60) return `${Math.floor(dt)}s ago`;
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`;
  if (dt < 86_400) return `${Math.floor(dt / 3600)}h ago`;
  return `${Math.floor(dt / 86_400)}d ago`;
}

export function MobilePairing(): JSX.Element {
  const [qr, setQr] = useState<PairInitResponse | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<PairedDeviceRow[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [toast, setToast] = useState<ClaimToast | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [copied, setCopied] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Initial device list + WS subscription ───────────────────────── */
  const refreshDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const rows = await pairApi.listDevices(false);
      setDevices(rows);
    } catch (err) {
      // Non-fatal: keep prior list, surface the error in a banner.
      setError(err instanceof Error ? err.message : 'Failed to load devices');
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    const offClaimed = wsClient.on('pair', (msg) => {
      if (msg.type === 'claimed') {
        const name =
          (msg.data?.device_name as string) ||
          (msg.data?.device_model as string) ||
          'phone';
        setToast({
          kind: 'claimed',
          message: `${name} paired successfully`,
          ts: Date.now(),
        });
        setQr(null);
        setShowJson(false);
        setSecondsLeft(0);
        void refreshDevices();
      } else if (msg.type === 'revoked') {
        setToast({
          kind: 'revoked',
          message: 'Device revoked',
          ts: Date.now(),
        });
        void refreshDevices();
      }
    });
    return () => offClaimed();
  }, [refreshDevices]);

  /* ── Toast auto-dismiss ──────────────────────────────────────────── */
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  /* ── 60s countdown ───────────────────────────────────────────────── */
  useEffect(() => {
    if (!qr) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    setSecondsLeft(qr.expires_in_seconds);
    tickRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (tickRef.current) {
            clearInterval(tickRef.current);
            tickRef.current = null;
          }
          setQr(null);
          setShowJson(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [qr]);

  /* ── Actions ─────────────────────────────────────────────────────── */
  const handleGenerate = useCallback(async () => {
    setError(null);
    setGenerating(true);
    setShowJson(false);
    setCopied(false);
    try {
      const resp = await pairApi.init();
      setQr(resp);
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 403
          ? 'ROOT trust required to pair a device.'
          : err instanceof Error
            ? err.message
            : 'Failed to start pairing';
      setError(msg);
    } finally {
      setGenerating(false);
    }
  }, []);

  const handleRevoke = useCallback(
    async (id: string) => {
      setRevokingId(id);
      try {
        await pairApi.revoke(id, 'revoked from desktop');
        await refreshDevices();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Revoke failed');
      } finally {
        setRevokingId(null);
      }
    },
    [refreshDevices]
  );

  const qrJsonText = useMemo(() => {
    if (!qr) return '';
    // Companion app accepts the raw `qr` payload object; we serialise
    // pretty so the operator can eyeball the cert pin / nonce while
    // copying. The phone's manual-paste field tolerates both compact
    // and pretty-printed JSON.
    return JSON.stringify(qr.qr, null, 2);
  }, [qr]);

  const handleCopyJson = useCallback(async () => {
    if (!qrJsonText) return;
    try {
      // Modern path. Falls back to a hidden textarea selection in
      // browsers without the async clipboard API (very rare on Chromium
      // running our kiosk shell, but cheap insurance).
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(qrJsonText);
      } else {
        const ta = document.createElement('textarea');
        ta.value = qrJsonText;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Clipboard write failed');
    }
  }, [qrJsonText]);

  /* ── Render ──────────────────────────────────────────────────────── */
  const ringPct = qr ? secondsLeft / PAIR_TTL_S : 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        paddingBottom: 8,
        // Cap width so on a wide monitor the panel doesn't sprawl edge-to-edge.
        maxWidth: 720,
      }}
    >
      {/* Hero — compact one-row layout */}
      <div
        className="glass"
        style={{
          padding: 10,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg,#f4af25,#fb923c)',
            color: 'white',
            boxShadow: '0 3px 10px rgba(244,175,37,0.30)',
            flexShrink: 0,
          }}
          aria-hidden
        >
          <Smartphone size={18} strokeWidth={1.75} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="micro-label" style={{ fontSize: 9 }}>
            MOBILE COMPANION
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--ink-primary)',
              lineHeight: 1.2,
            }}
          >
            Парування телефону
          </div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--ink-muted)',
              marginTop: 2,
              lineHeight: 1.4,
            }}
          >
            Згенеруй одноразовий QR (60 с) — Companion видобуде device-JWT.
          </div>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          style={{
            minHeight: 32,
            padding: '0 12px',
            borderRadius: 999,
            background: generating
              ? 'rgba(0,0,0,0.04)'
              : 'linear-gradient(135deg,#f4af25,#fb923c)',
            border: 'none',
            color: generating ? 'var(--ink-muted)' : 'white',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            cursor: generating ? 'default' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            boxShadow: generating
              ? 'none'
              : '0 3px 10px rgba(244,175,37,0.35)',
            flexShrink: 0,
          }}
        >
          {generating ? (
            <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
          ) : qr ? (
            <RefreshCw size={12} strokeWidth={1.75} />
          ) : (
            <QrCode size={12} strokeWidth={1.75} />
          )}
          {qr ? 'Новий QR' : 'Згенерувати QR'}
        </button>
      </div>

      {/* Banners stack — error and toast share the same compact row style. */}
      {error && (
        <div
          style={{
            padding: '7px 10px',
            borderRadius: 10,
            border: '1px solid rgba(220,38,38,0.30)',
            background: 'rgba(220,38,38,0.08)',
            color: '#b91c1c',
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <AlertTriangle size={12} strokeWidth={1.75} />
          {error}
        </div>
      )}
      {toast && (
        <div
          style={{
            padding: '7px 10px',
            borderRadius: 10,
            border:
              toast.kind === 'claimed'
                ? '1px solid rgba(22,163,74,0.30)'
                : '1px solid rgba(244,175,37,0.30)',
            background:
              toast.kind === 'claimed'
                ? 'rgba(22,163,74,0.08)'
                : 'rgba(244,175,37,0.08)',
            color: toast.kind === 'claimed' ? '#16a34a' : '#b07a10',
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <CheckCircle2 size={12} strokeWidth={1.75} />
          {toast.message}
        </div>
      )}

      {/* QR canvas — 180 px QR (was 220), endpoint badges row, JSON drawer */}
      {qr && (
        <div className="glass" style={{ padding: 12 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div
              style={{
                position: 'relative',
                width: 180,
                height: 180,
                borderRadius: 12,
                padding: 6,
                background: 'white',
                boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
                flexShrink: 0,
              }}
            >
              <img
                src={qr.qr_svg_data_url}
                alt="Pairing QR code"
                style={{
                  width: '100%',
                  height: '100%',
                  imageRendering: 'pixelated',
                  display: 'block',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: -8,
                  right: -8,
                  width: 32,
                  height: 32,
                  borderRadius: 999,
                  background: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                }}
                aria-label={`expires in ${secondsLeft}s`}
              >
                <svg width="32" height="32" viewBox="0 0 32 32">
                  <circle
                    cx="16"
                    cy="16"
                    r="13"
                    fill="none"
                    stroke="rgba(0,0,0,0.08)"
                    strokeWidth="3"
                  />
                  <circle
                    cx="16"
                    cy="16"
                    r="13"
                    fill="none"
                    stroke={secondsLeft > 10 ? '#f4af25' : '#dc2626'}
                    strokeWidth="3"
                    strokeDasharray={`${ringPct * 81.68} 81.68`}
                    strokeLinecap="round"
                    transform="rotate(-90 16 16)"
                    style={{ transition: 'stroke-dasharray 1s linear' }}
                  />
                </svg>
                <span
                  className="tabular"
                  style={{
                    position: 'absolute',
                    fontSize: 9,
                    fontWeight: 700,
                    color: secondsLeft > 10 ? '#8a5e0a' : '#b91c1c',
                  }}
                >
                  {secondsLeft}
                </span>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="eyebrow-amber" style={{ fontSize: 9 }}>
                SCAN ME
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--ink-primary)',
                  marginTop: 2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {qr.qr.host}
                <span
                  className="tabular"
                  style={{
                    fontSize: 10,
                    color: 'var(--ink-muted)',
                    marginLeft: 6,
                    fontWeight: 500,
                  }}
                >
                  {qr.qr.ip}:{qr.qr.port}
                </span>
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--ink-muted)',
                  marginTop: 4,
                  lineHeight: 1.4,
                }}
              >
                Companion → камера → QR. Або кнопка{' '}
                <strong style={{ color: 'var(--ink-secondary)' }}>JSON</strong>{' '}
                нижче, якщо камера недоступна.
              </div>
              <div
                style={{
                  marginTop: 6,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 5,
                }}
              >
                <span
                  className="tabular"
                  style={{
                    fontSize: 9,
                    padding: '2px 7px',
                    borderRadius: 999,
                    background: 'rgba(244,175,37,0.12)',
                    color: '#b07a10',
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                  }}
                >
                  pair_id · {qr.pair_id.slice(0, 8)}…
                </span>
                <span
                  className="tabular"
                  style={{
                    fontSize: 9,
                    padding: '2px 7px',
                    borderRadius: 999,
                    background:
                      qr.qr.server_cert_sha256 === 'dev-no-pin'
                        ? 'rgba(244,175,37,0.12)'
                        : 'rgba(22,163,74,0.12)',
                    color:
                      qr.qr.server_cert_sha256 === 'dev-no-pin'
                        ? '#b07a10'
                        : '#16a34a',
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                  }}
                  title={qr.qr.server_cert_sha256}
                >
                  {qr.qr.server_cert_sha256 === 'dev-no-pin'
                    ? 'dev · no cert pin'
                    : 'cert pinned'}
                </span>
              </div>

              {/* JSON drawer — toggle + copy. The Companion app's manual
                  paste field on PairScreen accepts exactly this object. */}
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => setShowJson((v) => !v)}
                    style={{
                      minHeight: 26,
                      padding: '3px 9px',
                      borderRadius: 999,
                      border: '1px solid rgba(0,0,0,0.10)',
                      background: showJson
                        ? 'rgba(244,175,37,0.10)'
                        : 'transparent',
                      color: showJson ? '#b07a10' : 'var(--ink-secondary)',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {showJson ? (
                      <ChevronDown size={11} strokeWidth={1.75} />
                    ) : (
                      <ChevronRight size={11} strokeWidth={1.75} />
                    )}
                    {showJson ? 'Сховати JSON' : 'Показати JSON'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyJson()}
                    style={{
                      minHeight: 26,
                      padding: '3px 9px',
                      borderRadius: 999,
                      border: '1px solid rgba(0,0,0,0.10)',
                      background: copied
                        ? 'rgba(22,163,74,0.10)'
                        : 'transparent',
                      color: copied ? '#16a34a' : 'var(--ink-secondary)',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                    title="Скопіювати raw JSON для manual-paste у Companion"
                  >
                    {copied ? (
                      <Check size={11} strokeWidth={1.75} />
                    ) : (
                      <Copy size={11} strokeWidth={1.75} />
                    )}
                    {copied ? 'Скопійовано' : 'Скопіювати'}
                  </button>
                </div>
                {showJson && (
                  <pre
                    onClick={(e) => {
                      // Click-to-select makes manual copy with Ctrl-C work
                      // for the rare Chromium build without async-clipboard.
                      const range = document.createRange();
                      range.selectNodeContents(e.currentTarget);
                      const sel = window.getSelection();
                      sel?.removeAllRanges();
                      sel?.addRange(range);
                    }}
                    style={{
                      marginTop: 6,
                      padding: 10,
                      borderRadius: 8,
                      background: 'rgba(0,0,0,0.04)',
                      border: '1px solid rgba(0,0,0,0.08)',
                      fontSize: 10.5,
                      lineHeight: 1.45,
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, monospace',
                      color: 'var(--ink-primary)',
                      maxHeight: 180,
                      overflowY: 'auto',
                      whiteSpace: 'pre',
                      cursor: 'text',
                      userSelect: 'text',
                    }}
                  >
                    {qrJsonText}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Paired devices list */}
      <div className="glass" style={{ padding: 10 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 8,
          }}
        >
          <Smartphone
            size={12}
            strokeWidth={1.75}
            style={{ color: '#b07a10' }}
          />
          <span className="eyebrow-amber" style={{ fontSize: 9 }}>
            PAIRED DEVICES
          </span>
          <span
            className="tabular"
            style={{
              fontSize: 9,
              padding: '1px 6px',
              borderRadius: 999,
              background:
                devices.length > 0
                  ? 'rgba(22,163,74,0.18)'
                  : 'rgba(0,0,0,0.06)',
              color: devices.length > 0 ? '#16a34a' : 'var(--ink-muted)',
              fontWeight: 700,
            }}
          >
            {devices.length}
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => void refreshDevices()}
            disabled={devicesLoading}
            style={{
              minHeight: 24,
              padding: '3px 8px',
              borderRadius: 999,
              background: 'transparent',
              border: '1px solid rgba(0,0,0,0.10)',
              fontSize: 9,
              color: 'var(--ink-muted)',
              cursor: devicesLoading ? 'default' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
            title="Refresh"
          >
            {devicesLoading ? (
              <Loader2 size={10} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <RefreshCw size={10} strokeWidth={1.75} />
            )}
            Refresh
          </button>
        </div>

        {devices.length === 0 && !devicesLoading && (
          <div
            style={{
              padding: '14px 0',
              textAlign: 'center',
              fontSize: 10.5,
              color: 'var(--ink-muted)',
            }}
          >
            Жодного телефону не приєднано. Згенеруй QR вище.
          </div>
        )}

        {devices.map((d) => (
          <div
            key={d.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 9px',
              borderRadius: 8,
              border: '1px solid rgba(0,0,0,0.06)',
              marginBottom: 4,
              background: 'rgba(255,255,255,0.4)',
            }}
          >
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                background: 'rgba(244,175,37,0.18)',
                color: '#b07a10',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
              aria-hidden
            >
              <Smartphone size={13} strokeWidth={1.75} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: 'var(--ink-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {d.device_name || d.device_model || '—'}
              </div>
              <div
                className="tabular"
                style={{
                  fontSize: 9.5,
                  color: 'var(--ink-muted)',
                  marginTop: 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {d.platform}
                {d.platform_version ? ` · ${d.platform_version}` : ''} ·{' '}
                {formatRelative(d.paired_at)} · seen{' '}
                {formatRelative(d.last_seen_at)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleRevoke(d.id)}
              disabled={revokingId === d.id}
              style={{
                minHeight: 26,
                padding: '3px 9px',
                borderRadius: 999,
                border: '1px solid rgba(220,38,38,0.30)',
                background:
                  revokingId === d.id
                    ? 'rgba(220,38,38,0.06)'
                    : 'transparent',
                color: '#b91c1c',
                fontSize: 9.5,
                fontWeight: 600,
                cursor: revokingId === d.id ? 'default' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                flexShrink: 0,
              }}
            >
              {revokingId === d.id ? (
                <Loader2 size={10} strokeWidth={1.75} className="animate-spin" />
              ) : (
                <ShieldOff size={10} strokeWidth={1.75} />
              )}
              Revoke
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
