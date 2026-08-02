import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, PlugZap, RotateCw, UserPlus } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useSystemStore } from '../../stores/systemStore';
import { ApiError, authApi } from '../../services/api';
import { AmbientGlows } from '../core/AmbientGlows';
import { Orb } from '../core/Orb';
import PinPad from './PinPad';

interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'unreachable' }
  | { kind: 'nobody' }
  | { kind: 'pick'; profiles: Profile[] }
  | { kind: 'pin'; who: Profile; many: boolean };

/** Логін у базі — «phantom». Вітатися з людиною малою літерою негарно. */
function displayName(username: string): string {
  return username.charAt(0).toUpperCase() + username.slice(1);
}

function greeting(hour: number): string {
  if (hour < 5) return 'Ще ніч';
  if (hour < 11) return 'Доброго ранку';
  if (hour < 17) return 'Доброго дня';
  if (hour < 23) return 'Доброго вечора';
  return 'Пізній вечір';
}

/**
 * Вхід на пристрій — не в хмару. Тут стояла верстка SaaS-лендінгу: англійський
 * заголовок «Intelligence, Distributed», обіцянка «Phantom Cloud workspace»
 * і рядок «Edge node active», який світився навіть тоді, коли ядро мовчало.
 * Білий текст на кремовому тлі не читався взагалі.
 *
 * Пристрій знає своїх. Якщо власник один — питаємо лише PIN і одразу
 * клавіатурою під палець, а не полем «користувач», куди на тачскріні
 * доводилось вписувати власне ім'я.
 */
export default function LoginScreen() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const { setUser, incrementAttempts, setLockout, isLocked, lockedUntil } = useAuthStore();
  const setAuthenticated = useSystemStore((s) => s.setAuthenticated);

  const load = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const profiles = await authApi.picker();
      if (!profiles.length) return setPhase({ kind: 'nobody' });
      if (profiles.length === 1) return setPhase({ kind: 'pin', who: profiles[0], many: false });
      setPhase({ kind: 'pick', profiles });
    } catch (err) {
      // 404 на старому ядрі — не обрив: список просто не віддається.
      setPhase(err instanceof ApiError ? { kind: 'nobody' } : { kind: 'unreachable' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Цокає лише поки блокування триває: інакше екран входу перемальовувався
  // раз на секунду просто так.
  useEffect(() => {
    if (!lockedUntil || Date.now() >= lockedUntil) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);

  const locked = isLocked();
  const lockLeft = locked && lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;

  const submitPin = async (pin: string) => {
    if (phase.kind !== 'pin' || locked) return;
    setBusy(true);
    setError('');
    try {
      const res = await authApi.loginPin(phase.who.username, pin);
      setUser(res.user, res.token, res.expires_at);
      setAuthenticated(true);
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setError('Ядро не відповідає. PIN нема кому перевірити.');
        return;
      }
      const attempts = useAuthStore.getState().loginAttempts + 1;
      incrementAttempts();
      if (attempts >= 5) {
        setLockout(Date.now() + 15 * 60 * 1000);
        setNow(Date.now());
        setError('Забагато спроб. Пауза на 15 хвилин.');
      } else {
        setError(`Не той PIN. Лишилось спроб: ${5 - attempts}.`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="w-full h-full min-h-screen relative overflow-hidden flex items-center justify-center"
      style={{ background: 'var(--surface-base)' }}
    >
      <AmbientGlows />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 flex flex-col items-center"
        style={{ width: 420, maxWidth: '92vw' }}
      >
        <Orb size="sm" className="!w-14 !h-14" />
        <div
          className="micro-label"
          style={{ marginTop: 22, color: 'var(--primary-deep)', letterSpacing: '0.28em' }}
        >
          PHANTOM
        </div>

        {phase.kind === 'loading' && <Waiting />}
        {phase.kind === 'unreachable' && <Unreachable onRetry={() => void load()} />}
        {phase.kind === 'nobody' && <Nobody />}

        {phase.kind === 'pick' && (
          <>
            <Title text={`${greeting(new Date().getHours())}. Хто це?`} />
            <div className="grid grid-cols-2" style={{ gap: 10, marginTop: 20, width: '100%' }}>
              {phase.profiles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setError('');
                    setPhase({ kind: 'pin', who: p, many: true });
                  }}
                  className="glass flex items-center"
                  style={{
                    gap: 10,
                    minHeight: 56,
                    padding: '10px 14px',
                    borderRadius: 14,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <Initial name={p.username} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-primary)' }}>
                    {displayName(p.username)}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {phase.kind === 'pin' && (
          <>
            <Title text={`${greeting(new Date().getHours())}, ${displayName(phase.who.username)}.`} />
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>
              {locked ? `Пауза ще ${lockLeft} с` : 'Набери PIN, щоб зняти замок'}
            </div>
            <div style={{ marginTop: 22 }}>
              <PinPad onSubmit={(pin) => void submitPin(pin)} disabled={busy || locked} error={error} />
            </div>
            {phase.many && (
              <BackToPicker
                onBack={() => {
                  setError('');
                  void load();
                }}
              />
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}

/**
 * Ключ на місці, підтвердити нікому. Показуємо стіну, але не мовчазну:
 * сама стукає в ядро кожні 4 с і зникає, щойно те озветься. Викидати
 * власника на PIN тут не можна — перевірити той PIN однаково нічим.
 */
export function CoreDownWall() {
  const autoLogin = useAuthStore((s) => s.autoLogin);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setTries((n) => n + 1);
      void autoLogin();
    }, 4000);
    return () => clearInterval(t);
  }, [autoLogin]);

  return (
    <div
      className="w-full h-full min-h-screen relative overflow-hidden flex items-center justify-center"
      style={{ background: 'var(--surface-base)' }}
    >
      <AmbientGlows />
      <div className="relative z-10 flex flex-col items-center" style={{ width: 420, maxWidth: '92vw' }}>
        <Orb size="sm" className="!w-14 !h-14" />
        <div className="micro-label" style={{ marginTop: 12, color: 'var(--primary-deep)', letterSpacing: '0.28em' }}>
          PHANTOM
        </div>
        <Unreachable onRetry={() => void autoLogin()} />
        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--ink-muted)' }}>
          {tries === 0 ? 'Стукаю сам кожні 4 секунди' : `Спроб: ${tries}`}
        </div>
        <button
          type="button"
          onClick={clearAuth}
          style={{
            marginTop: 10,
            minHeight: 44,
            padding: '0 14px',
            background: 'transparent',
            border: 'none',
            color: 'var(--ink-muted)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Вийти й забути ключ
        </button>
      </div>
    </div>
  );
}

/* ─── Стани ────────────────────────────────────────────────────────────── */

function Title({ text }: { text: string }) {
  return (
    <h1
      className="playfair"
      style={{
        marginTop: 18,
        fontSize: 28,
        fontWeight: 500,
        color: 'var(--ink-primary)',
        textAlign: 'center',
        letterSpacing: '-0.01em',
      }}
    >
      {text}
    </h1>
  );
}

function Waiting() {
  return (
    <div className="flex flex-col items-center" style={{ marginTop: 28, gap: 10 }}>
      <div
        className="w-6 h-6 border-2 rounded-full animate-spin"
        style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }}
      />
      <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Питаю ядро, хто тут живе…</span>
    </div>
  );
}

function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="glass flex flex-col items-center" style={{ marginTop: 22, padding: 22, borderRadius: 18, width: '100%' }}>
      <PlugZap size={22} strokeWidth={1.75} style={{ color: 'var(--signal-warn)' }} />
      <div style={{ marginTop: 10, fontSize: 15, fontWeight: 600, color: 'var(--ink-primary)' }}>
        Ядро не відповідає
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-secondary)', textAlign: 'center', lineHeight: 1.5 }}>
        PIN зараз нема кому перевірити. Це не твоя провина — служба на пристрої
        або ще піднімається, або впала.
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center justify-center"
        style={{
          marginTop: 16,
          gap: 8,
          minHeight: 44,
          padding: '0 20px',
          borderRadius: 12,
          background: 'linear-gradient(135deg,#f4af25,#fb923c)',
          border: 'none',
          color: 'var(--primary-shadow, #5c3d05)',
          fontSize: 13,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        <RotateCw size={14} strokeWidth={2.25} />
        Спробувати ще
      </button>
    </div>
  );
}

function Nobody() {
  return (
    <div className="glass flex flex-col items-center" style={{ marginTop: 22, padding: 22, borderRadius: 18, width: '100%' }}>
      <UserPlus size={22} strokeWidth={1.75} style={{ color: 'var(--primary-deep)' }} />
      <div style={{ marginTop: 10, fontSize: 15, fontWeight: 600, color: 'var(--ink-primary)' }}>
        Пристрій ще нічий
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-secondary)', textAlign: 'center', lineHeight: 1.5 }}>
        Тут немає жодного профілю. Створи перший — PHANTOM запам'ятає тебе
        і більше не питатиме, хто ти.
      </div>
      <a
        href="/onboarding"
        className="flex items-center justify-center"
        style={{
          marginTop: 16,
          minHeight: 44,
          padding: '0 20px',
          borderRadius: 12,
          background: 'linear-gradient(135deg,#f4af25,#fb923c)',
          color: 'var(--primary-shadow, #5c3d05)',
          fontSize: 13,
          fontWeight: 700,
          textDecoration: 'none',
        }}
      >
        Створити профіль
      </a>
    </div>
  );
}

function BackToPicker({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="flex items-center justify-center"
      style={{
        marginTop: 18,
        gap: 6,
        minHeight: 44,
        padding: '0 14px',
        borderRadius: 10,
        background: 'transparent',
        border: 'none',
        color: 'var(--ink-muted)',
        fontSize: 12,
        cursor: 'pointer',
      }}
    >
      <ArrowLeft size={13} strokeWidth={2} />
      Це не я
    </button>
  );
}

function Initial({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex items-center justify-center shrink-0"
      style={{
        width: 34,
        height: 34,
        borderRadius: 10,
        background: 'rgba(244,175,37,0.18)',
        border: '1px solid rgba(244,175,37,0.32)',
        color: 'var(--primary-deep)',
        fontSize: 14,
        fontWeight: 700,
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
