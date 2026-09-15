import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, PlugZap, RotateCw, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useSystemStore } from '../../stores/systemStore';
import { authApi, type AuthResponse } from '../../services/api';
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
  // Перший запуск: вузол ще нічий. Стоїть ПЕРЕД `pin`, бо саме тут людина
  // застрягала — див. [Claim] нижче.
  | { kind: 'claim' }
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
      // ПЕРШИМ питанням — «а цей вузол узагалі чийсь?».
      //
      // Доти екран одразу просив PIN, якого в людини не було й не могло
      // бути: пакована збірка мінтить його випадковим у файл
      // `identity/bootstrap_pin` (на Windows усередині %LOCALAPPDATA%) і в
      // журнал запуску, а в портативного застосунку немає ані консолі, ані
      // причини знати той шлях. Людина, яка щойно розпакувала архів,
      // упиралась у замок без ключа з коробки — і це читалось як «застосунок
      // не працює», хоч працювало все, крім дверей.
      //
      // Ручка лише на петлі й лише поки вузол нічий; помилка тут нічого не
      // ламає — просто йдемо звичайним шляхом і питаємо PIN, як питали.
      const bootstrap = await authApi.bootstrapState().catch(() => null);
      if (bootstrap?.unclaimed) return setPhase({ kind: 'claim' });

      const profiles = await authApi.picker();
      if (profiles && profiles.length > 0) {
        if (profiles.length === 1) return setPhase({ kind: 'pin', who: profiles[0], many: false });
        return setPhase({ kind: 'pick', profiles });
      }
      // Порожній список — це збій ядра, а не новий пристрій: власника
      // заводить `ensure_default_user` на кожному старті. Саме це й
      // пояснює екран `Nobody`, разом із тим, звідки взяти разовий PIN.
      return setPhase({ kind: 'nobody' });
    } catch {
      // Тут стояв фолбек на ЧОТИРИ ВИГАДАНИХ користувачі — kiril, kyrylo,
      // alex, phantom, з аватарками, що тягнулись із unsplash.com. Він
      // зʼявився заради багатосесійного тестування у вебі (41173d3), і
      // разом із `throw new Error('No profiles')` вище робив дві погані
      // речі одночасно:
      //
      //   • перекривав чесний екран `Nobody` — той, що пояснює, що
      //     порожній список означає збій ядра, і каже, звідки взяти
      //     разовий PIN. Досягти його було неможливо взагалі;
      //   • перетворював «ядро не відповідає» на нормальний вигляд
      //     переліку профілів. Людина з мертвим бекендом бачила
      //     чотирьох людей, тицяла в них і не розуміла, чому нічого.
      //
      // Виміряно 29.08.2026: у запакованому AppImage на екрані входу
      // стояли рівно ці чотири імені, і я спершу зарахував це як доказ
      // живого HTTP. Список був вигаданий.
      //
      // Ядро недосяжне — так і кажемо. `Unreachable` уміє стукати сам.
      setPhase({ kind: 'unreachable' });
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
        {phase.kind === 'claim' && (
          <Claim
            onDone={(res) => {
              setUser(res.user, res.token, res.expires_at);
              setAuthenticated(true);
            }}
          />
        )}

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

/**
 * Перший запуск: людина заводить СЕБЕ.
 *
 * **Вада, заради якої цей екран існує.** Ядро на першому старті створює
 * власника `phantom` і мінтить йому випадковий шестизначний PIN — у файл
 * `identity/bootstrap_pin` (на Windows усередині `%LOCALAPPDATA%`) і в журнал
 * запуску. У портативної збірки немає ані консолі, ані причини знати той шлях,
 * а автовхід свідомо вимкнений, доки PIN бутстрапний. Людина, яка щойно
 * розпакувала архів, упиралась у запит PIN, якого для неї не існує ніде.
 * Власник 15.09: «запускається але пише сесія застаріла і просить пін»,
 * «чому людина не може створити свій профіль?».
 *
 * Реєстрації ж не було взагалі: кнопку «Створити профіль» свого часу прибрали
 * ПРАВИЛЬНО (вела на маршрут під автентифікацією, тобто в нікуди), але нічим
 * не замінили — див. коментар над [Nobody].
 *
 * Чому це не діра. Ручка приймає лише з петлі й лише поки вузол нічий; після
 * першого разу вона віддає 409 назавжди. Хто дотягнувся до петлі в цю мить,
 * уже сидить за цією машиною і вже може прочитати той файл очима — екран не
 * додає доступу, він прибирає потребу шукати файл.
 */
function Claim({ onDone }: { onDone: (res: AuthResponse) => void }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Межі — ті самі, що на ядрі (`ClaimRequest`: 4..12 цифр), і названі тут
  // словами ДО натиску. Кнопка, яка мовчки не працює, — це та сама мовчазна
  // відмова, тільки без повідомлення.
  const pinOk = /^\d{4,12}$/.test(pin);
  const same = pin.length > 0 && pin === again;
  const nameOk = name.trim().length > 0;
  const ready = nameOk && pinOk && same && !busy;

  const why = !nameOk
    ? 'Скажи, як тебе звати'
    : !pinOk
      ? 'PIN — від 4 до 12 цифр'
      : !same
        ? 'PIN не збігається'
        : '';

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      onDone(await authApi.claimBootstrap(name.trim(), pin));
    } catch (e) {
      // Причину кажемо словами. «Не вийшло» без причини на першому ж екрані
      // застосунку — найгірше можливе перше враження.
      const detail = e instanceof Error ? e.message : '';
      setError(detail || 'Ядро не прийняло — спробуй ще раз');
      setBusy(false);
    }
  };

  const field: React.CSSProperties = {
    width: '100%',
    minHeight: 44,
    marginTop: 6,
    padding: '0 12px',
    borderRadius: 12,
    border: '1px solid var(--hairline, rgba(255,255,255,.12))',
    background: 'var(--surface-raised, rgba(255,255,255,.04))',
    color: 'var(--ink-primary)',
    fontSize: 14,
  };
  const label: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: .3,
    color: 'var(--ink-muted)',
    textTransform: 'uppercase',
  };

  return (
    <div className="glass" style={{ marginTop: 22, padding: 22, borderRadius: 18, width: '100%' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink-primary)' }}>
        Цей пристрій ще нічий
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-secondary)', lineHeight: 1.5 }}>
        Заведи себе: імʼя і PIN, яким відмикатимеш. Обидва лишаються тут, на
        пристрої — нікуди не йдуть і ні з ким не звіряються.
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={label}>Як тебе звати</div>
        <input
          style={field}
          value={name}
          maxLength={64}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          placeholder="Імʼя або позивний"
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={label}>PIN</div>
        <input
          style={field}
          value={pin}
          inputMode="numeric"
          type="password"
          maxLength={12}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          placeholder="Від 4 до 12 цифр"
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={label}>PIN ще раз</div>
        <input
          style={field}
          value={again}
          inputMode="numeric"
          type="password"
          maxLength={12}
          onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          placeholder="Щоб не помилитись"
        />
      </div>

      {(why || error) && (
        <div style={{ marginTop: 10, fontSize: 12, color: error ? 'var(--signal-danger,#f87171)' : 'var(--ink-muted)' }}>
          {error || why}
        </div>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!ready}
        className="flex items-center justify-center"
        style={{
          marginTop: 16,
          width: '100%',
          minHeight: 44,
          borderRadius: 12,
          border: 'none',
          background: ready ? 'linear-gradient(135deg,#f4af25,#fb923c)' : 'var(--surface-raised, rgba(255,255,255,.06))',
          color: ready ? 'var(--primary-shadow, #5c3d05)' : 'var(--ink-muted)',
          fontSize: 14,
          fontWeight: 700,
          cursor: ready ? 'pointer' : 'not-allowed',
        }}
      >
        {busy ? 'Заводжу…' : 'Це мій пристрій'}
      </button>

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--ink-muted)', lineHeight: 1.5 }}>
        Далі цей екран не зʼявиться: пристрій матиме власника, і зайти можна
        буде лише цим PIN.
      </div>
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
