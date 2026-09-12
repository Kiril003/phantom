import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, PlugZap, RotateCw, ShieldAlert } from 'lucide-react';
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

  const { setUser, isLocked, lockedUntil, setLockout, incrementAttempts } = useAuthStore();
  const setAuthenticated = useSystemStore((s) => s.setAuthenticated);

  const load = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
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

  /**
   * Невдалий вхід називає причину — і НЕ впускає.
   *
   * Тут стояв фолбек «standalone / web demo mode»: будь-яка помилка
   * `loginPin` — 401 за невірним кодом, 403 за віддаленим разовим кодом,
   * 429 за блокуванням — складала обʼєкт `User` з роллю ROOT для імен
   * `phantom`/`kiril`, клала токен-літерал `'local_demo_token'` і ставила
   * `authenticated = true`. Наслідків два, і обидва погані:
   *
   *   • людина з НЕВІРНИМ кодом потрапляла всередину. Далі кожен виклик
   *     до ядра повертав 401, бо токен не є токеном, — і замість «код не
   *     підійшов» вона отримувала мовчазну оболонку, що ні на що не
   *     відповідає;
   *   • вигадана особа з чужою роллю. Той самий клас, що й чотири
   *     вигадані профілі в `picker`, які тут уже прибрано вище.
   *
   * Замок від цього не міцнішає й не слабшає: сервер однаково не видав
   * токена. Міняється лише те, чи каже екран правду.
   */
  const submitPin = async (pin: string) => {
    if (phase.kind !== 'pin' || locked) return;
    setBusy(true);
    setError('');
    try {
      const res = await authApi.loginPin(phase.who.username, pin);
      setUser(res.user, res.token, res.expires_at);
      setAuthenticated(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          // Тривалість паузи беремо з `Retry-After`, а не вигадуємо.
          if (err.retryAfterS) setLockout(Date.now() + err.retryAfterS * 1000);
          setError(
            err.retryAfterS
              ? `Забагато спроб. Пауза ${err.retryAfterS} с.`
              : 'Забагато спроб. Ядро зробило паузу.',
          );
        } else if (err.status === 401) {
          incrementAttempts();
          setError('Код не підійшов.');
        } else if (err.status === 403) {
          setError('Разовий код приймається лише з екрана самого пристрою.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Вхід не вдався, і причини ядро не назвало.');
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
            <WhereIsTheCode />
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
 * «Звідки взяти код?» — бо форма, яка просить те, чого не пояснює, це не
 * форма, а глуха стіна.
 *
 * Виміряно 12.09.2026 по коду ядра: код народжується один раз, на першому
 * старті вузла (`security/auth.py:252-291`, `secrets.choice` по цифрах,
 * довжина 6 — вшитого типового коду НЕМА), і лягає у файл
 * `identity/bootstrap_pin` з правами 0600. У журнал він теж пишеться, але
 * рівнем WARNING — а `env_logger` оболонки без `RUST_LOG` пропускає лише
 * `error` (`src-tauri/src/main.rs:31`), тож у запакованому застосунку той
 * рядок НЕ видно ніде. Обіцяти журнал тут було б неправдою.
 *
 * Це поки що підказка, а не дорога: показати сам код на екрані застосунок
 * не може — жоден ендпойнт його не віддає, а `main.rs` не має ЖОДНОЇ
 * `#[tauri::command]`, тож і файл із WebView не читається. Дорогу треба
 * прокладати в ядрі або в оболонці; підказка живе тут, доки її нема, бо
 * мовчазна стіна гірша за чесну.
 */
function WhereIsTheCode() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 14, width: '100%' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          minHeight: 44,
          width: '100%',
          background: 'transparent',
          border: 'none',
          color: 'var(--ink-muted)',
          fontSize: 12,
          cursor: 'pointer',
          textDecoration: 'underline',
          textUnderlineOffset: 3,
        }}
      >
        Звідки взяти код?
      </button>
      {open && (
        <div
          className="glass"
          style={{
            marginTop: 4,
            padding: 14,
            borderRadius: 14,
            fontSize: 12,
            lineHeight: 1.6,
            color: 'var(--ink-secondary, var(--ink-muted))',
            textAlign: 'left',
          }}
        >
          <p style={{ margin: 0 }}>
            Це не пароль від хмари. Код живе лише на цьому пристрої: ядро
            створило його випадковим на першому запуску й більше ніде не
            зберігає.
          </p>
          <p style={{ margin: '8px 0 0' }}>
            Шість цифр лежать у файлі <code>identity/bootstrap_pin</code> у
            теці даних вузла — у зібраному застосунку це{' '}
            <code>~/.local/share/PHANTOM/data</code>, у дереві розробки —{' '}
            <code>.phantom-data</code>.
          </p>
          <p style={{ margin: '8px 0 0' }}>
            Він приймається тільки з екрана самого пристрою: по мережі цей
            код не спрацює, доки ти не заміниш його на свій у Налаштуваннях
            → Профіль.
          </p>
          <p style={{ margin: '8px 0 0', color: 'var(--signal-warn)' }}>
            Показати код просто тут застосунок поки не вміє. Це наша
            недоробка, не твоя.
          </p>
        </div>
      )}
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
