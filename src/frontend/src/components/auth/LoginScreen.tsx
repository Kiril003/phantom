import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck,
  Fingerprint,
  KeyRound,
  Wifi,
  WifiOff,
  Cpu,
  ChevronLeft,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useSystemStore } from '../../stores/systemStore';
import { authApi } from '../../services/api';
import { AmbientGlows } from '../core/AmbientGlows';
import { Orb } from '../core/Orb';
import PinPad from './PinPad';
import RFIDScanner from './RFIDScanner';
import { ProfileSelector } from './ProfileSelector';

type LoginMode = 'pin' | 'rfid';

export default function LoginScreen() {
  const [mode, setMode] = useState<LoginMode>('pin');
  const [username, setUsername] = useState('phantom');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [maxPinAttempts, setMaxPinAttempts] = useState(5);
  const [lockoutDurationM, setLockoutDurationM] = useState(15);
  const [now, setNow] = useState(() => new Date());
  // Day-5 redesign: gate the PIN card behind ProfileSelector when the
  // public picker reports ≥2 operators. State `picker` tri-state:
  //   - 'unknown'   → still fetching, render quiet shell
  //   - 'single'    → 0/1 users, skip selector entirely (legacy behaviour)
  //   - 'choosing'  → ≥2 users + no choice yet, full-surface selector
  //   - 'chosen'    → ≥2 users + operator picked, PIN card revealed
  const [pickerPhase, setPickerPhase] = useState<
    'unknown' | 'single' | 'choosing' | 'chosen'
  >('unknown');
  const [pickerCount, setPickerCount] = useState(0);

  const {
    setUser,
    incrementAttempts,
    setLockout,
    resetAttempts,
    isLocked,
    loginAttempts,
    lockedUntil,
  } = useAuthStore();
  const { setAuthenticated, wsConnected } = useSystemStore();

  useEffect(() => {
    authApi
      .config()
      .then((cfg) => {
        setMaxPinAttempts(cfg.max_pin_attempts);
        setLockoutDurationM(cfg.lockout_duration_m);
      })
      .catch(() => {
        /* defaults */
      });
  }, []);

  // Day-5 — single picker fetch decides whether to show ProfileSelector.
  // The selector itself does its OWN fetch for the cards (it owns the
  // tile state); this fetch is just the gating signal so we don't
  // mount the selector for a single-user install.
  useEffect(() => {
    let cancelled = false;
    authApi
      .picker()
      .then((rows) => {
        if (cancelled) return;
        setPickerCount(rows.length);
        setPickerPhase(rows.length >= 2 ? 'choosing' : 'single');
      })
      .catch(() => {
        if (cancelled) return;
        setPickerPhase('single');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setLockoutSeconds(remaining);
      if (remaining === 0) resetAttempts();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil, resetAttempts]);

  const handlePinSubmit = async (pin: string) => {
    if (isLocked()) {
      setError(`Locked. ${lockoutSeconds}s remaining.`);
      return;
    }
    if (!username.trim()) {
      setError('Enter your operator ID');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await authApi.loginPin(username.trim(), pin);
      setUser(res.user, res.token, res.expires_at);
      setAuthenticated(true);
    } catch {
      incrementAttempts();
      const attempts = loginAttempts + 1;
      if (attempts >= maxPinAttempts) {
        setLockout(Date.now() + lockoutDurationM * 60 * 1000);
        setError(`Too many attempts. Locked for ${lockoutDurationM} min.`);
      } else {
        setError(`Invalid credentials. Attempt ${attempts}/${maxPinAttempts}.`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleModeSwitch = (next: LoginMode) => {
    setMode(next);
    setError('');
  };

  const deviceSerial = useMemo(() => {
    const stored = localStorage.getItem('phantom_device_serial');
    if (stored) return stored;
    const fresh = Array.from({ length: 5 })
      .map(() => 'ABCDEF0123456789'[Math.floor(Math.random() * 16)])
      .join('');
    localStorage.setItem('phantom_device_serial', fresh);
    return fresh;
  }, []);

  const timeStr = now.toLocaleTimeString('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const dateStr = now.toLocaleDateString('uk-UA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  // Day-5 — full-surface ProfileSelector for multi-user installs.
  // While `pickerPhase === 'unknown'` we still render the PIN card
  // (legacy fallback) but with the picker fetch in flight; if it
  // resolves to multi-user the selector swaps in via key change. Once
  // an operator is chosen, we transition to 'chosen' which reveals
  // the PIN card with username pre-filled.
  if (pickerPhase === 'choosing') {
    return (
      <ProfileSelector
        onSelect={(u) => {
          setUsername(u);
          setPickerPhase('chosen');
          setError('');
        }}
        disabled={loading || isLocked()}
      />
    );
  }

  return (
    <div
      className="w-[1024px] h-[600px] relative overflow-hidden flex items-center justify-center"
      style={{ background: 'var(--surface-base)' }}
      data-state="DIALOGUE"
    >
      <AmbientGlows />

      {/* Floating status pills — top-right */}
      <div
        className="absolute top-5 right-5 flex items-center gap-2"
        style={{ zIndex: 10 }}
      >
        <StatusPill
          icon={wsConnected ? <Wifi size={12} strokeWidth={2} /> : <WifiOff size={12} strokeWidth={2} />}
          label={wsConnected ? 'Link secure' : 'Link offline'}
          tone={wsConnected ? 'ok' : 'alert'}
        />
        <StatusPill
          icon={<Cpu size={12} strokeWidth={2} />}
          label={`Node ${deviceSerial}`}
        />
      </div>

      {/* Floating time — top-left. Day-5 polish: bigger, colder,
          serif-italic date. The time is a tabular-nums display so
          digit-flip doesn't reflow the layout each second. */}
      <div
        className="absolute top-5 left-6 flex flex-col"
        style={{ zIndex: 10 }}
      >
        <span
          className="tabular-nums"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-2xl)',
            fontWeight: 200,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--ink-primary)',
            lineHeight: 1,
          }}
        >
          {timeStr}
        </span>
        <span
          className="mt-1 capitalize italic"
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 'var(--fs-xs)',
            color: 'var(--ink-secondary)',
            letterSpacing: 'var(--tracking-wide)',
          }}
        >
          {dateStr}
        </span>
      </div>

      {/* Switch-operator affordance — visible only after the operator
          chose from ProfileSelector (multi-user install). One-tap
          return to the gallery. */}
      {pickerPhase === 'chosen' && (
        <button
          type="button"
          onClick={() => {
            setUsername('phantom');
            setPickerPhase('choosing');
            setError('');
          }}
          className="absolute flex items-center gap-1.5 px-3 rounded-full transition-colors active:scale-95"
          style={{
            top: 22,
            left: '50%',
            transform: 'translateX(-50%)',
            height: 28,
            background: 'var(--glass-subtle)',
            border: '1px solid var(--glass-border)',
            color: 'var(--ink-secondary)',
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-micro)',
            letterSpacing: 'var(--tracking-widest)',
            zIndex: 10,
          }}
          data-testid="switch-operator"
        >
          <ChevronLeft size={12} strokeWidth={2} />
          <span className="uppercase">
            Switch operator{pickerCount > 0 ? ` · ${pickerCount}` : ''}
          </span>
        </button>
      )}

      {/* Main glass card */}
      <motion.main
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="glass-card relative flex flex-col items-center"
        style={{
          width: 460,
          padding: '64px 40px 32px 40px',
          borderRadius: 28,
          zIndex: 10,
        }}
      >
        {/* Avatar ring with orb inside */}
        <div className="absolute" style={{ top: -68, left: '50%', transform: 'translateX(-50%)' }}>
          <div
            className="rounded-full p-[3px] relative"
            style={{
              width: 136,
              height: 136,
              background: 'linear-gradient(180deg, var(--accent), transparent)',
              boxShadow: '0 0 30px var(--accent-glow)',
            }}
          >
            <div
              className="w-full h-full rounded-full overflow-hidden flex items-center justify-center relative"
              style={{
                background: 'var(--surface-void)',
                border: '1px solid var(--glass-border)',
              }}
            >
              <Orb size="sm" className="!w-[120px] !h-[120px]" />
            </div>
            {/* Lock badge */}
            <div
              className="absolute flex items-center justify-center rounded-full"
              style={{
                bottom: -4,
                right: -4,
                width: 30,
                height: 30,
                background: 'var(--surface-base)',
                border: '1px solid var(--accent)',
                boxShadow: '0 0 10px var(--accent-glow)',
              }}
            >
              <ShieldCheck size={14} strokeWidth={2} style={{ color: 'var(--accent)' }} />
            </div>
          </div>
        </div>

        {/* Heading — split-letter stagger reveal. Each glyph fades +
            lifts independently with a slight cyan→ink wash so the
            wordmark feels typed-into-existence rather than flashed. */}
        <h1
          className="flex items-center"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-lg)',
            fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
          }}
          aria-label="PHANTOM OS"
        >
          {Array.from('PHANTOM OS').map((ch, i) => (
            <motion.span
              key={`${ch}-${i}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: 0.4 + i * 0.04,
                duration: 0.55,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="text-gradient"
              style={{
                display: 'inline-block',
                whiteSpace: ch === ' ' ? 'pre' : 'normal',
              }}
              aria-hidden
            >
              {ch === ' ' ? ' ' : ch}
            </motion.span>
          ))}
        </h1>
        <p
          className="mt-1 text-center"
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 'var(--fs-sm)',
            fontStyle: 'italic',
            color: 'var(--ink-secondary)',
            lineHeight: 'var(--lh-normal)',
          }}
        >
          {pickerPhase === 'chosen'
            ? `Вітаю, ${username}. Підтвердьте PIN.`
            : 'Підтвердьте свою особу, оператор.'}
        </p>

        {/* Mode tabs */}
        <div
          className="mt-5 flex items-center gap-1 p-1 rounded-full"
          style={{
            background: 'var(--glass-subtle)',
            border: '1px solid var(--glass-border)',
          }}
        >
          <TabButton
            active={mode === 'pin'}
            onClick={() => handleModeSwitch('pin')}
            icon={<KeyRound size={14} strokeWidth={1.75} />}
            label="PIN"
          />
          <TabButton
            active={mode === 'rfid'}
            onClick={() => handleModeSwitch('rfid')}
            icon={<Fingerprint size={14} strokeWidth={1.75} />}
            label="RFID"
          />
        </div>

        <AnimatePresence mode="wait">
          {mode === 'pin' ? (
            <motion.div
              key="pin"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.2 }}
              className="w-full flex flex-col items-center mt-5 gap-5"
            >
              {/* Day-5 — username input only renders when the picker
                  is single-user (no ProfileSelector ahead of us). For
                  multi-user installs the username arrived from the
                  selector tap and is already locked-in; the user
                  re-chooses via the "Switch operator" pill above. */}
              {pickerPhase !== 'chosen' && (
                <input
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading || isLocked()}
                  placeholder="operator id"
                  className="w-full text-center outline-none transition-colors"
                  style={{
                    height: 44,
                    padding: '0 16px',
                    background: 'var(--glass-subtle)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 12,
                    color: 'var(--ink-primary)',
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--fs-sm)',
                    letterSpacing: 'var(--tracking-wide)',
                  }}
                />
              )}
              {pickerPhase === 'chosen' && (
                <div
                  className="w-full text-center px-4 py-2 rounded-full"
                  style={{
                    background:
                      'color-mix(in srgb, var(--accent) 12%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
                    color: 'var(--accent)',
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--fs-sm)',
                    fontWeight: 500,
                    letterSpacing: 'var(--tracking-wide)',
                  }}
                  data-testid="locked-username"
                >
                  {username}
                </div>
              )}
              <PinPad
                onSubmit={handlePinSubmit}
                disabled={loading || isLocked()}
                error={error || undefined}
              />
            </motion.div>
          ) : (
            <motion.div
              key="rfid"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.2 }}
              className="w-full flex flex-col items-center mt-5"
            >
              <RFIDScanner onError={(m) => setError(m)} />
              {error && (
                <p
                  className="mt-3"
                  style={{
                    color: 'var(--signal-alert)',
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--fs-xs)',
                  }}
                >
                  {error}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer actions */}
        <div className="w-full mt-5 flex items-center justify-between px-2">
          <span
            className="uppercase"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-micro)',
              color: 'var(--ink-muted)',
              letterSpacing: 'var(--tracking-widest)',
            }}
          >
            Attempts {loginAttempts}/{maxPinAttempts}
          </span>
          <span
            className="uppercase"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-micro)',
              color: 'var(--accent)',
              letterSpacing: 'var(--tracking-widest)',
            }}
          >
            HS256 · JWT
          </span>
        </div>

        {isLocked() && lockoutSeconds > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 px-3 py-1.5 rounded-full inline-flex items-center gap-2"
            style={{
              background: 'color-mix(in srgb, var(--signal-alert) 14%, transparent)',
              border: '1px solid var(--signal-alert)',
              color: 'var(--signal-alert)',
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-xs)',
            }}
          >
            Locked · {lockoutSeconds}s
          </motion.div>
        )}
      </motion.main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex items-center gap-2 px-4 transition-all"
      style={{
        height: 36,
        minHeight: 44,
        borderRadius: 9999,
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? 'var(--ink-inverse)' : 'var(--ink-secondary)',
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--fs-xs)',
        fontWeight: 500,
        letterSpacing: 'var(--tracking-widest)',
        boxShadow: active ? '0 0 16px var(--accent-glow)' : 'none',
      }}
      aria-pressed={active}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function StatusPill({
  icon,
  label,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  tone?: 'default' | 'ok' | 'alert';
}) {
  const color =
    tone === 'ok'
      ? 'var(--signal-ok)'
      : tone === 'alert'
        ? 'var(--signal-alert)'
        : 'var(--ink-secondary)';
  return (
    <div
      className="glass-panel flex items-center gap-2 px-3"
      style={{
        height: 28,
        borderRadius: 9999,
        color,
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--fs-micro)',
        letterSpacing: 'var(--tracking-wide)',
      }}
    >
      {icon}
      <span>{label}</span>
    </div>
  );
}
