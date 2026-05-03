/**
 * Phase 19 Mobile Companion — desktop-side pairing panel.
 *
 * Renders inside SettingsPanel under category id `mobile`. Owns:
 *   1. "Generate QR" CTA → POST /api/v1/pair/init → displays inline SVG.
 *   2. 60-second countdown ring; auto-clears the QR on expiry.
 *   3. Live "claimed" / "revoked" toasts via the `pair` WS channel.
 *   4. Paired devices list with REVOKE button per row.
 *
 * Crypto, JWT minting, and ECDH live on the backend (`security/pair_crypto`
 * + `api/routes_pair.py`); this component is a thin presentational shell.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Smartphone,
  QrCode,
  RefreshCw,
  ShieldOff,
  CheckCircle2,
  Loader2,
  AlertTriangle,
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
        // QR is single-shot; once claimed the session is gone.
        setQr(null);
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

  /* ── Render ──────────────────────────────────────────────────────── */
  const ringPct = qr ? secondsLeft / PAIR_TTL_S : 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        paddingBottom: 12,
      }}
    >
      {/* Hero block */}
      <div
        className="glass"
        style={{
          padding: 16,
          display: 'flex',
          gap: 16,
          alignItems: 'flex-start',
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg,#f4af25,#fb923c)',
            color: 'white',
            boxShadow: '0 4px 14px rgba(244,175,37,0.35)',
            flexShrink: 0,
          }}
          aria-hidden
        >
          <Smartphone size={22} strokeWidth={1.75} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="micro-label">MOBILE COMPANION</div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--ink-primary)',
              lineHeight: 1.25,
              marginTop: 2,
            }}
          >
            Парування телефону через QR
          </div>
          <p
            style={{
              fontSize: 11,
              color: 'var(--ink-muted)',
              marginTop: 6,
              lineHeight: 1.5,
              maxWidth: 520,
            }}
          >
            Згенеруй одноразовий QR (60 секунд) і відскануй у застосунку
            PHANTOM Companion. Сервер видасть телефону device-JWT,
            прив&apos;яже його до твого ROOT-акаунту і додасть у список нижче.
            Код можна відкликати в один клік.
          </p>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          style={{
            minHeight: 44,
            padding: '0 16px',
            borderRadius: 999,
            background: generating
              ? 'rgba(0,0,0,0.04)'
              : 'linear-gradient(135deg,#f4af25,#fb923c)',
            border: 'none',
            color: generating ? 'var(--ink-muted)' : 'white',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            cursor: generating ? 'default' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: generating
              ? 'none'
              : '0 4px 14px rgba(244,175,37,0.40)',
            flexShrink: 0,
          }}
        >
          {generating ? (
            <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />
          ) : qr ? (
            <RefreshCw size={14} strokeWidth={1.75} />
          ) : (
            <QrCode size={14} strokeWidth={1.75} />
          )}
          {qr ? 'Новий QR' : 'Згенерувати QR'}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 12,
            border: '1px solid rgba(220,38,38,0.30)',
            background: 'rgba(220,38,38,0.08)',
            color: '#b91c1c',
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <AlertTriangle size={14} strokeWidth={1.75} />
          {error}
        </div>
      )}

      {/* Toast (claimed / revoked) */}
      {toast && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 12,
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
            gap: 8,
          }}
        >
          <CheckCircle2 size={14} strokeWidth={1.75} />
          {toast.message}
        </div>
      )}

      {/* QR canvas */}
      {qr && (
        <div
          className="glass"
          style={{
            padding: 18,
            display: 'flex',
            gap: 18,
            alignItems: 'center',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: 220,
              height: 220,
              borderRadius: 16,
              padding: 8,
              background: 'white',
              boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
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
            {/* Countdown ring overlay (top-right corner) */}
            <div
              style={{
                position: 'absolute',
                top: -10,
                right: -10,
                width: 36,
                height: 36,
                borderRadius: 999,
                background: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
              }}
              aria-label={`expires in ${secondsLeft}s`}
            >
              <svg width="36" height="36" viewBox="0 0 36 36">
                <circle
                  cx="18"
                  cy="18"
                  r="15"
                  fill="none"
                  stroke="rgba(0,0,0,0.08)"
                  strokeWidth="3"
                />
                <circle
                  cx="18"
                  cy="18"
                  r="15"
                  fill="none"
                  stroke={secondsLeft > 10 ? '#f4af25' : '#dc2626'}
                  strokeWidth="3"
                  strokeDasharray={`${ringPct * 94.25} 94.25`}
                  strokeLinecap="round"
                  transform="rotate(-90 18 18)"
                  style={{ transition: 'stroke-dasharray 1s linear' }}
                />
              </svg>
              <span
                className="tabular"
                style={{
                  position: 'absolute',
                  fontSize: 10,
                  fontWeight: 700,
                  color: secondsLeft > 10 ? '#8a5e0a' : '#b91c1c',
                }}
              >
                {secondsLeft}
              </span>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow-amber">SCAN ME</div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--ink-primary)',
                marginTop: 4,
              }}
            >
              {qr.qr.host}
              <span
                className="tabular"
                style={{
                  fontSize: 11,
                  color: 'var(--ink-muted)',
                  marginLeft: 8,
                  fontWeight: 500,
                }}
              >
                {qr.qr.ip}:{qr.qr.port}
              </span>
            </div>
            <p
              style={{
                fontSize: 11,
                color: 'var(--ink-muted)',
                marginTop: 8,
                lineHeight: 1.55,
                maxWidth: 380,
              }}
            >
              Відкрий PHANTOM Companion на Android, натисни{' '}
              <strong style={{ color: 'var(--ink-secondary)' }}>Pair</strong>{' '}
              і наведи камеру на QR. Telegram, scanner-app — НЕ підійдуть:
              payload зашифрований ECDH-handshake&apos;ом, читається лише
              нашим клієнтом.
            </p>
            <div
              style={{
                marginTop: 10,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
              }}
            >
              <span
                className="tabular"
                style={{
                  fontSize: 9,
                  padding: '2px 8px',
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
                  padding: '2px 8px',
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
          </div>
        </div>
      )}

      {/* Paired devices list */}
      <div className="glass" style={{ padding: 14 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 10,
          }}
        >
          <Smartphone size={14} strokeWidth={1.75} style={{ color: '#b07a10' }} />
          <span className="eyebrow-amber">PAIRED DEVICES</span>
          <span
            className="tabular"
            style={{
              fontSize: 9,
              padding: '1px 7px',
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
              minHeight: 28,
              padding: '4px 10px',
              borderRadius: 999,
              background: 'transparent',
              border: '1px solid rgba(0,0,0,0.10)',
              fontSize: 10,
              color: 'var(--ink-muted)',
              cursor: devicesLoading ? 'default' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
            title="Refresh"
          >
            {devicesLoading ? (
              <Loader2 size={11} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <RefreshCw size={11} strokeWidth={1.75} />
            )}
            Refresh
          </button>
        </div>

        {devices.length === 0 && !devicesLoading && (
          <div
            style={{
              padding: '20px 0',
              textAlign: 'center',
              fontSize: 11,
              color: 'var(--ink-muted)',
            }}
          >
            Жодного телефону не приєднано. Згенеруй QR вище, щоб
            прив&apos;язати перший пристрій.
          </div>
        )}

        {devices.map((d) => (
          <div
            key={d.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(0,0,0,0.06)',
              marginBottom: 6,
              background: 'rgba(255,255,255,0.4)',
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'rgba(244,175,37,0.18)',
                color: '#b07a10',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
              aria-hidden
            >
              <Smartphone size={16} strokeWidth={1.75} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
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
                  fontSize: 10,
                  color: 'var(--ink-muted)',
                  marginTop: 1,
                }}
              >
                {d.platform}
                {d.platform_version ? ` · ${d.platform_version}` : ''} ·
                paired {formatRelative(d.paired_at)} · seen{' '}
                {formatRelative(d.last_seen_at)}
              </div>
              {d.capabilities.length > 0 && (
                <div
                  style={{
                    marginTop: 4,
                    display: 'flex',
                    gap: 4,
                    flexWrap: 'wrap',
                  }}
                >
                  {d.capabilities.map((c) => (
                    <span
                      key={c}
                      style={{
                        fontSize: 9,
                        padding: '1px 6px',
                        borderRadius: 999,
                        background: 'rgba(0,0,0,0.05)',
                        color: 'var(--ink-muted)',
                        fontWeight: 500,
                      }}
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => void handleRevoke(d.id)}
              disabled={revokingId === d.id}
              style={{
                minHeight: 32,
                padding: '4px 10px',
                borderRadius: 999,
                border: '1px solid rgba(220,38,38,0.30)',
                background:
                  revokingId === d.id
                    ? 'rgba(220,38,38,0.06)'
                    : 'transparent',
                color: '#b91c1c',
                fontSize: 10,
                fontWeight: 600,
                cursor: revokingId === d.id ? 'default' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                flexShrink: 0,
              }}
            >
              {revokingId === d.id ? (
                <Loader2 size={11} strokeWidth={1.75} className="animate-spin" />
              ) : (
                <ShieldOff size={11} strokeWidth={1.75} />
              )}
              Revoke
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
