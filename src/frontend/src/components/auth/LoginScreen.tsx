import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '../../stores/authStore';
import { useSystemStore } from '../../stores/systemStore';
import { authApi } from '../../services/api';
import PinPad from './PinPad';
import RFIDScanner from './RFIDScanner';

type LoginMode = 'pin' | 'rfid';

export default function LoginScreen() {
  const [mode, setMode] = useState<LoginMode>('pin');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [maxPinAttempts, setMaxPinAttempts] = useState(5);
  const [lockoutDurationM, setLockoutDurationM] = useState(15);

  const {
    setUser,
    incrementAttempts,
    setLockout,
    resetAttempts,
    isLocked,
    loginAttempts,
    lockedUntil,
  } = useAuthStore();
  const { setAuthenticated } = useSystemStore();

  // Fetch auth config (pin limits) on mount — no auth required
  useEffect(() => {
    authApi.config().then((cfg) => {
      setMaxPinAttempts(cfg.max_pin_attempts);
      setLockoutDurationM(cfg.lockout_duration_m);
    }).catch(() => {
      // Use defaults if config fetch fails
    });
  }, []);

  // Countdown timer for lockout display
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
      setError(`Заблоковано. Залишилось ${lockoutSeconds}с`);
      return;
    }
    if (!username.trim()) {
      setError('Введіть логін');
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
        setError(`Занадто багато спроб. Заблоковано на ${lockoutDurationM} хвилин.`);
      } else {
        setError(`Невірний логін або PIN. Спроба ${attempts}/${maxPinAttempts}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleModeSwitch = (next: LoginMode) => {
    setMode(next);
    setError('');
  };

  return (
    <div className="w-[1024px] h-[600px] bg-phantom-bg flex items-center justify-center overflow-hidden">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="phantom-panel p-8 w-[380px]"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <motion.div
            className="text-phantom-cyan text-2xl tracking-[0.4em] font-mono mb-1"
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            PHANTOM
          </motion.div>
          <div className="text-phantom-text-dim text-xs tracking-[0.2em] font-mono">
            AUTHENTICATION REQUIRED
          </div>
        </div>

        {/* Mode selector */}
        <div className="flex mb-6 phantom-panel overflow-hidden">
          {(['pin', 'rfid'] as LoginMode[]).map((m) => (
            <button
              key={m}
              onClick={() => handleModeSwitch(m)}
              className={[
                'flex-1 h-[44px] text-xs tracking-widest font-mono transition-colors',
                mode === m
                  ? 'bg-phantom-cyan text-phantom-bg'
                  : 'text-phantom-text-dim hover:text-phantom-text',
              ].join(' ')}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Mode content */}
        <AnimatePresence mode="wait">
          {mode === 'pin' ? (
            <motion.div
              key="pin"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col gap-3"
            >
              <input
                className={[
                  'h-[44px] phantom-panel px-3 bg-transparent outline-none text-sm w-full',
                  'text-phantom-text font-mono placeholder-phantom-text-dim',
                  'focus:border-phantom-cyan transition-colors',
                ].join(' ')}
                placeholder="Логін"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                disabled={loading || isLocked()}
              />
              <PinPad
                onSubmit={handlePinSubmit}
                disabled={loading || isLocked()}
                error={error || undefined}
              />
            </motion.div>
          ) : (
            <motion.div
              key="rfid"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2 }}
            >
              <RFIDScanner
                onError={(msg) => setError(msg)}
              />
              {error && (
                <p className="text-phantom-danger text-xs text-center mt-2 font-mono">
                  {error}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        {isLocked() && lockoutSeconds > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 text-center text-phantom-warning text-xs font-mono"
          >
            ЗАБЛОКОВАНО: {lockoutSeconds}с
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
