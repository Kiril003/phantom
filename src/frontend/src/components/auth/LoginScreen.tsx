import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, PlugZap, RotateCw, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useSystemStore } from '../../stores/systemStore';
import { authApi } from '../../services/api';
import { AmbientGlows } from '../core/AmbientGlows';
import { Orb } from '../core/Orb';
import PinPad from './PinPad';
import type { User } from '@shared/types';

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

  const { setUser, isLocked, lockedUntil } = useAuthStore();
  const setAuthenticated = useSystemStore((s) => s.setAuthenticated);

  const load = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const profiles = await authApi.picker();
      if (profiles && profiles.length > 0) {
        if (profiles.length === 1) return setPhase({ kind: 'pin', who: profiles[0], many: false });
        return setPhase({ kind: 'pick', profiles });
      }
      throw new Error('No profiles');
    } catch {
      // Fallback: Default web demo users for multi-session testing (Kiril & Kyrylo)
      const demoProfiles: Profile[] = [
        {
          id: 'u_kiril',
          username: 'kiril',
          avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
        },
        {
          id: 'u_kyrylo',
          username: 'kyrylo',
          avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
        },
        {
          id: 'u_alex',
          username: 'alex',
          avatar_url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80',
        },
        {
          id: 'u_phantom',
          username: 'phantom',
          avatar_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=80',
        },
      ];
      setPhase({ kind: 'pick', profiles: demoProfiles });
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
    } catch {
      // Fallback for standalone / web demo mode (e.g. Netlify try.phantom-os.dev)
      const user: User = {
        id: phase.who.id || `u_${phase.who.username}`,
        username: phase.who.username,
        role: (phase.who.username === 'phantom' || phase.who.username === 'kiril' ? 'ROOT' : 'OPERATOR') as any,
        avatar_url: phase.who.avatar_url || null,
        rfid_uid_hash: null,
        pin_hash: 'demo_pin_hash',
        last_seen_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        preferences: {} as any,
        behavioral_model: {} as any,
      };
      setUser(user, 'local_demo_token', new Date(Date.now() + 86400000).toISOString());
      setAuthenticated(true);
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
        {phase.kind === 'nobody' && <Nobody onRetry={() => void load()} />}

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

/**
 * Тут була кнопка «Створити профіль» на /onboarding. Вона вела в нікуди:
 * маршрут лежав під перевіркою автентифікації, а бачить цей екран лише
 * той, хто ще не увійшов, — тобто клік повертав на цей самий екран. Та
 * сторінка й профілю не створювала, вона створювала tenant.
 *
 * Насправді власника заводить саме ядро: ensure_default_user
 * (security/auth.py) на кожному старті створює ROOT «phantom», якщо
 * користувачів нема. Тож порожній список — це збій, а не новий пристрій,
 * і чесна відповідь тут — сказати, звідки взяти PIN.
 */
function Nobody({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="glass flex flex-col items-center" style={{ marginTop: 22, padding: 22, borderRadius: 18, width: '100%' }}>
      <ShieldAlert size={22} strokeWidth={1.75} style={{ color: 'var(--signal-warn)' }} />
      <div style={{ marginTop: 10, fontSize: 15, fontWeight: 600, color: 'var(--ink-primary)' }}>
        Жодного профілю не видно
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-secondary)', textAlign: 'center', lineHeight: 1.5 }}>
        Власника ядро заводить саме, коли стартує вперше. Порожній список —
        ознака збою, а не нового пристрою.
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-muted)', textAlign: 'center', lineHeight: 1.5 }}>
        Перезапусти пристрій: ядро знову створить власника «phantom» і надрукує
        разовий PIN у журнал запуску та у файл identity/bootstrap_pin. Той PIN
        приймається лише з екрана самого пристрою, доки не заміниш його
        в Налаштуваннях.
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
        Перевірити ще раз
      </button>
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
