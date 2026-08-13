import { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Power,
  AlertTriangle,
} from 'lucide-react';
import {
  licenseApi,
  type Entitlement,
  type LicenseStatus,
  type LicenseReason,
} from '../../services/licenseApi';
import { ApiError } from '../../services/api';

const TIER_LABELS: Record<string, string> = {
  free: 'Вільний',
  personal: 'Особистий',
  crew: 'Екіпаж',
  unit: 'Підрозділ',
};

const REASON_MESSAGES: Record<LicenseReason, string> = {
  not_activated: 'Ліцензію не активовано.',
  corrupt_license_file: 'Пошкоджений файл ліцензії на диску.',
  bad_signature: 'Підпис сертифіката недійсний.',
  device_mismatch: 'Сертифікат виданий іншому пристрою.',
  ok: 'Активовано.',
};

/** Права словами. Ключі — ті самі, що у licensing/entitlements.py.
 *
 *  `note` — застереження про те, ЧОГО ключ не дасть саме тут. Ключ активує
 *  пару (ядро на столі + симбіот у кишені), тож право, що живе лише в
 *  телефоні, з переліку не викидаємо — інакше екран применшив би куплене.
 *  Але й мовчати не можна: «Точніша модель слуху» на цьому комп'ютері лежить
 *  над звичайним вибором моделі Whisper у налаштуваннях, який має кожен і без
 *  ключа. Дзеркало на сайті — FEATURE_SURFACE у platform-site/src/lib/plans.ts.
 */
interface FeatureRow {
  label: string;
  note?: string;
}

const PHONE_ONLY = 'лише в телефоні';
const IN_PROGRESS = 'ще в роботі';

const FEATURE_LABELS: Record<string, FeatureRow> = {
  'core.chat': { label: 'Розмова з ядром' },
  'core.map': { label: 'Мапа й офлайн-пакети' },
  'core.nav': { label: 'Навігація' },
  'core.alerts': { label: 'Тривоги' },
  'core.vault': { label: 'Сховище' },
  'core.voice': { label: 'Голос' },
  'bridge.pair': { label: 'Міст із телефоном' },
  'memory.longterm': { label: 'Довга пам’ять' },
  'map.terrain3d': { label: 'Рельєф і об’ємне місто' },
  'voice.premium': { label: 'Точніша модель слуху', note: PHONE_ONLY },
  'gnss.blackbox': { label: 'Чорна скринька GNSS', note: `${PHONE_ONLY} · ${IN_PROGRESS}` },
  'export.reports': { label: 'Вивантаження і звіти' },
  'crew.sync': { label: 'Синхронізація екіпажу', note: IN_PROGRESS },
  'fleet.onprem': { label: 'Власний сервер ліцензій', note: IN_PROGRESS },
};

function tierLabel(tier: string | null): string {
  if (!tier) return '—';
  return TIER_LABELS[tier] ?? tier;
}

/** Один рядок правди про те, ЧОМУ діє цей рівень. Без цього людина бачить
 *  «Вільний» і не розуміє, ключ зіпсувався чи проба скінчилась. */
function entitlementLine(ent: Entitlement): string {
  switch (ent.reason) {
    case 'trial':
      return ent.trial_days_left === 1
        ? 'Ознайомчий період — лишився останній день.'
        : `Ознайомчий період — лишилось ${ent.trial_days_left} дн.`;
    case 'offline_too_long':
      return 'Ключ не вдалося підтвердити надто довго. Під’єднайся до мережі — рівень повернеться сам.';
    case 'updates_expired':
      return `Ця збірка вийшла після ${ent.updates_until}. Куплена версія працює далі, ця — на вільному рівні.`;
    case 'not_activated':
      return 'Ключа немає. Безпека, мапа й розмова працюють без нього — назавжди.';
    case 'device_mismatch':
      return 'Сертифікат виданий іншому пристрою.';
    case 'bad_signature':
      return 'Підпис сертифіката недійсний.';
    case 'corrupt_license_file':
      return 'Файл ліцензії пошкоджено.';
    default:
      return ent.grace_days_left === null
        ? 'Ключ дійсний.'
        : `Ключ дійсний. Без мережі протримається ще ${ent.grace_days_left} дн.`;
  }
}

function fingerprintShort(fp: string | null): string {
  if (!fp) return '—';
  return fp.length > 12 ? `${fp.slice(0, 12)}…` : fp;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Сталася невідома помилка.';
}

export function LicenseGroup() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [licenseKey, setLicenseKey] = useState('');
  const [deviceName, setDeviceName] = useState('phantom-os');
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  const [revalidating, setRevalidating] = useState(false);

  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivateKey, setDeactivateKey] = useState('');
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await licenseApi.status();
      setStatus(res);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleActivate = useCallback(async () => {
    if (licenseKey.trim().length < 10 || activating) return;
    setActivating(true);
    setActivateError(null);
    try {
      const res = await licenseApi.activate(licenseKey.trim(), deviceName.trim() || 'phantom-os');
      setStatus(res);
      setLicenseKey('');
    } catch (err) {
      setActivateError(errorMessage(err));
    } finally {
      setActivating(false);
    }
  }, [licenseKey, deviceName, activating]);

  const handleRevalidate = useCallback(async () => {
    setRevalidating(true);
    try {
      const res = await licenseApi.revalidate();
      setStatus(res);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setRevalidating(false);
    }
  }, []);

  const handleDeactivate = useCallback(async () => {
    if (deactivateKey.trim().length < 10 || deactivating) return;
    setDeactivating(true);
    setDeactivateError(null);
    try {
      const res = await licenseApi.deactivate(deactivateKey.trim());
      setStatus(res);
      setDeactivateOpen(false);
      setDeactivateKey('');
    } catch (err) {
      setDeactivateError(errorMessage(err));
    } finally {
      setDeactivating(false);
    }
  }, [deactivateKey, deactivating]);

  const ent = status?.entitlement ?? null;

  const badge = (() => {
    if (loading) return { label: 'Перевірка…', color: 'var(--ink-muted)', bg: 'rgba(0,0,0,0.05)' };
    if (!status) return { label: 'Невідомо', color: 'var(--ink-muted)', bg: 'rgba(0,0,0,0.05)' };
    if (status.valid) return { label: 'Активовано', color: '#16a34a', bg: 'rgba(22,163,74,0.12)' };
    if (ent?.reason === 'trial') {
      return { label: 'Ознайомчий', color: '#2563eb', bg: 'rgba(37,99,235,0.12)' };
    }
    if (status.reason === 'not_activated') {
      return { label: 'Не активовано', color: '#b07a10', bg: 'rgba(244,175,37,0.14)' };
    }
    return { label: 'Помилка ліцензії', color: '#dc2626', bg: 'rgba(220,38,38,0.10)' };
  })();

  const BadgeIcon = loading
    ? Loader2
    : status?.valid
      ? ShieldCheck
      : status?.reason === 'not_activated'
        ? ShieldQuestion
        : ShieldAlert;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 8, maxWidth: 720 }}>
      <div className="glass" style={{ padding: 12 }} data-testid="license-status-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
            <ShieldCheck size={18} strokeWidth={1.75} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="micro-label" style={{ fontSize: 9 }}>
              РІВЕНЬ
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-primary)', lineHeight: 1.2 }}>
              {tierLabel(ent?.tier ?? null)}
            </div>
          </div>
          <span
            data-testid="license-badge"
            style={{
              minHeight: 32,
              padding: '4px 12px',
              borderRadius: 999,
              background: badge.bg,
              color: badge.color,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.03em',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
            }}
          >
            <BadgeIcon size={13} strokeWidth={1.75} className={loading ? 'animate-spin' : undefined} />
            {badge.label}
          </span>
        </div>

        {status && !status.valid && status.reason !== 'not_activated' && (
          <div
            style={{
              marginTop: 8,
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
            {REASON_MESSAGES[status.reason]}
          </div>
        )}

        {loadError && (
          <div
            style={{
              marginTop: 8,
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
            {loadError}
          </div>
        )}

        {ent && (
          <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--ink-secondary)', lineHeight: 1.45 }}>
            {entitlementLine(ent)}
          </div>
        )}

        {status?.valid && (
          <div
            style={{
              marginTop: 10,
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 8,
            }}
          >
            <InfoTile label="ID ЛІЦЕНЗІЇ" value={status.license_id ?? '—'} mono />
            <InfoTile label="ОНОВЛЕННЯ ДО" value={status.updates_until ?? '—'} mono />
            <InfoTile label="ВІДБИТОК" value={fingerprintShort(status.fingerprint)} mono title={status.fingerprint ?? undefined} />
          </div>
        )}
      </div>

      {ent && <FeatureBoard ent={ent} />}

      {!status?.valid && (
        <div className="glass" style={{ padding: 12 }} data-testid="license-activate-form">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <KeyRound size={12} strokeWidth={1.75} style={{ color: '#b07a10' }} />
            <span className="eyebrow-amber" style={{ fontSize: 9 }}>
              АКТИВАЦІЯ
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              type="text"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
              placeholder="PHTM-XXXXX-XXXXX-XXXXX-XXXXX"
              aria-label="Ліцензійний ключ"
              spellCheck={false}
              style={{
                minHeight: 44,
                width: '100%',
                padding: '0 12px',
                borderRadius: 10,
                color: 'var(--ink-primary)',
                background: 'rgba(255,255,255,0.60)',
                border: '1px solid rgba(0,0,0,0.06)',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <input
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="phantom-os"
              aria-label="Назва пристрою"
              style={{
                minHeight: 44,
                width: '100%',
                padding: '0 12px',
                borderRadius: 10,
                color: 'var(--ink-primary)',
                background: 'rgba(255,255,255,0.60)',
                border: '1px solid rgba(0,0,0,0.06)',
                fontFamily: 'var(--font-display)',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={() => void handleActivate()}
              disabled={licenseKey.trim().length < 10 || activating}
              style={{
                minHeight: 44,
                padding: '0 16px',
                borderRadius: 999,
                background:
                  licenseKey.trim().length < 10 || activating
                    ? 'rgba(0,0,0,0.04)'
                    : 'linear-gradient(135deg,#f4af25,#fb923c)',
                border: 'none',
                color: licenseKey.trim().length < 10 || activating ? 'var(--ink-muted)' : 'white',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                cursor: licenseKey.trim().length < 10 || activating ? 'default' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {activating ? <Loader2 size={14} strokeWidth={1.75} className="animate-spin" /> : <KeyRound size={14} strokeWidth={1.75} />}
              Активувати
            </button>
            {activateError && (
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
                {activateError}
              </div>
            )}
          </div>
        </div>
      )}

      {status?.valid && (
        <div className="glass" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => void handleRevalidate()}
              disabled={revalidating}
              style={{
                minHeight: 44,
                flex: 1,
                padding: '0 14px',
                borderRadius: 999,
                background: 'rgba(0,0,0,0.05)',
                border: '1px solid rgba(0,0,0,0.10)',
                color: 'var(--ink-secondary)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.04em',
                cursor: revalidating ? 'default' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {revalidating ? <Loader2 size={13} strokeWidth={1.75} className="animate-spin" /> : <RefreshCw size={13} strokeWidth={1.75} />}
              Перевірити на сервері
            </button>
            <button
              type="button"
              onClick={() => setDeactivateOpen((v) => !v)}
              style={{
                minHeight: 44,
                flex: 1,
                padding: '0 14px',
                borderRadius: 999,
                background: 'rgba(220,38,38,0.08)',
                border: '1px solid rgba(220,38,38,0.30)',
                color: '#b91c1c',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.04em',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <Power size={13} strokeWidth={1.75} />
              Деактивувати
            </button>
          </div>

          {deactivateOpen && (
            <div
              style={{
                padding: 10,
                borderRadius: 10,
                border: '1px solid rgba(220,38,38,0.30)',
                background: 'rgba(220,38,38,0.06)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
              data-testid="license-deactivate-confirm"
            >
              <div style={{ fontSize: 11, color: '#b91c1c', lineHeight: 1.4 }}>
                Введи ліцензійний ключ ще раз, щоб підтвердити деактивацію цього пристрою.
              </div>
              <input
                type="text"
                value={deactivateKey}
                onChange={(e) => setDeactivateKey(e.target.value.toUpperCase())}
                placeholder="PHTM-XXXXX-XXXXX-XXXXX-XXXXX"
                aria-label="Ключ для деактивації"
                spellCheck={false}
                style={{
                  minHeight: 44,
                  width: '100%',
                  padding: '0 12px',
                  borderRadius: 10,
                  color: 'var(--ink-primary)',
                  background: 'rgba(255,255,255,0.75)',
                  border: '1px solid rgba(220,38,38,0.25)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => void handleDeactivate()}
                disabled={deactivateKey.trim().length < 10 || deactivating}
                style={{
                  minHeight: 44,
                  padding: '0 16px',
                  borderRadius: 999,
                  background:
                    deactivateKey.trim().length < 10 || deactivating ? 'rgba(0,0,0,0.06)' : '#dc2626',
                  border: 'none',
                  color: deactivateKey.trim().length < 10 || deactivating ? 'var(--ink-muted)' : 'white',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  cursor: deactivateKey.trim().length < 10 || deactivating ? 'default' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                {deactivating ? <Loader2 size={14} strokeWidth={1.75} className="animate-spin" /> : <Power size={14} strokeWidth={1.75} />}
                Підтвердити деактивацію
              </button>
              {deactivateError && (
                <div
                  style={{
                    padding: '7px 10px',
                    borderRadius: 10,
                    border: '1px solid rgba(220,38,38,0.30)',
                    background: 'rgba(220,38,38,0.10)',
                    color: '#b91c1c',
                    fontSize: 11,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <AlertTriangle size={12} strokeWidth={1.75} />
                  {deactivateError}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Що відкрито, а що ні — списком, без «оновись і дізнаєшся». */
function FeatureBoard({ ent }: { ent: Entitlement }) {
  const open = new Set(ent.features);
  const rows = Object.entries(FEATURE_LABELS);
  const locked = rows.filter(([key]) => !open.has(key));
  const noted = rows.filter(([, row]) => row.note);

  return (
    <div className="glass" style={{ padding: 12 }} data-testid="license-features">
      <div className="micro-label" style={{ fontSize: 9, marginBottom: 8 }}>
        ЩО ВІДКРИТО
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 6 }}>
        {rows.map(([key, row]) => {
          const on = open.has(key);
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 7,
                fontSize: 11.5,
                color: on ? 'var(--ink-primary)' : 'var(--ink-muted)',
                minWidth: 0,
              }}
            >
              {on ? (
                <ShieldCheck
                  size={12}
                  strokeWidth={2}
                  style={{ color: '#16a34a', flexShrink: 0, alignSelf: 'center' }}
                />
              ) : (
                <Lock
                  size={12}
                  strokeWidth={2}
                  style={{ color: 'var(--ink-faint)', flexShrink: 0, alignSelf: 'center' }}
                />
              )}
              <span style={{ minWidth: 0 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.label}</span>
                {row.note && (
                  <span
                    style={{
                      marginLeft: 5,
                      padding: '1px 6px',
                      borderRadius: 999,
                      border: '1px solid var(--line-default)',
                      background: 'rgba(0,0,0,0.04)',
                      color: 'var(--ink-muted)',
                      fontSize: 9.5,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.note}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {noted.length > 0 && (
        <div style={{ marginTop: 9, fontSize: 11, color: 'var(--ink-muted)', lineHeight: 1.5 }}>
          <div>«{PHONE_ONLY}» — діє на симбіоті, не тут. Ключ активує пару.</div>
          <div>«{IN_PROGRESS}» — не працює ніде, і ми цього не продаємо.</div>
        </div>
      )}
      {locked.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-muted)', lineHeight: 1.45 }}>
          Замкнене — це масштаб і зручність. Навігація, тривоги, мапа й сховище лишаються
          відкритими на будь-якому рівні.
        </div>
      )}
    </div>
  );
}

function InfoTile({
  label,
  value,
  mono,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div
      style={{
        padding: '7px 9px',
        borderRadius: 8,
        border: '1px solid rgba(0,0,0,0.06)',
        background: 'rgba(255,255,255,0.4)',
        minWidth: 0,
      }}
      title={title}
    >
      <div style={{ fontSize: 8.5, color: 'var(--ink-muted)', fontWeight: 700, letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div
        className={mono ? 'tabular' : undefined}
        style={{
          fontSize: 11.5,
          color: 'var(--ink-primary)',
          fontWeight: 600,
          marginTop: 2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: mono ? 'var(--font-mono)' : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}
