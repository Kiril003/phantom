import { useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Mail, KeyRound, Cpu, Wifi, WifiOff } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useSystemStore } from '../../stores/systemStore';
import { authApi } from '../../services/api';
import { AmbientGlows } from '../core/AmbientGlows';
import { Orb } from '../core/Orb';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { setUser, incrementAttempts, setLockout, isLocked, loginAttempts } = useAuthStore();
  const { setAuthenticated, wsConnected } = useSystemStore();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked()) {
      setError('Вхід тимчасово заблоковано.');
      return;
    }
    if (!email.trim() || !password.trim()) {
      setError('Впиши користувача і PIN');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await authApi.loginPin(email.trim(), password);
      setUser(res.user, res.token, res.expires_at);
      setAuthenticated(true);
    } catch {
      incrementAttempts();
      if (loginAttempts >= 4) {
        setLockout(Date.now() + 15 * 60 * 1000);
        setError('Забагато спроб. Заблоковано на 15 хвилин.');
      } else {
        setError('Не той користувач або PIN.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="w-full h-full min-h-screen relative overflow-hidden flex items-center justify-center bg-black"
      style={{ background: 'var(--surface-base)' }}
    >
      <AmbientGlows />

      {/* Top Bar */}
      <div className="absolute top-0 w-full px-8 py-6 flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <Orb size="sm" className="!w-8 !h-8" />
          <span
            className="text-white font-medium tracking-widest text-sm uppercase"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            PHANTOM CLOUD
          </span>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill
            icon={wsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
            label={wsConnected ? 'Link secure' : 'Offline'}
            tone={wsConnected ? 'ok' : 'alert'}
          />
        </div>
      </div>

      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-12 z-10 p-6 items-center">
        {/* Left Side: Branding / Graphic */}
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="hidden md:flex flex-col justify-center"
        >
          <div className="relative w-48 h-48 mb-8">
            <div className="absolute inset-0 bg-[var(--accent)] opacity-20 blur-3xl rounded-full" />
            <Orb size="lg" className="w-full h-full" />
          </div>
          <h1
            className="text-5xl lg:text-6xl text-white font-light tracking-tight mb-4"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Intelligence, <br />
            <span className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-[var(--accent)] to-purple-400">
              Distributed.
            </span>
          </h1>
          <p
            className="text-[var(--ink-secondary)] text-lg leading-relaxed max-w-md"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Secure, autonomous operations at scale. Sign in to your Phantom Cloud workspace to orchestrate agents across your infrastructure.
          </p>
        </motion.div>

        {/* Right Side: Login Form */}
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md mx-auto"
        >
          <div
            className="glass-card flex flex-col p-8 sm:p-10 w-full"
            style={{
              borderRadius: 24,
              boxShadow: '0 20px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
            }}
          >
            <div className="mb-8 text-center md:text-left">
              <h2
                className="text-2xl text-white font-semibold mb-2"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                З поверненням
              </h2>
              <p className="text-[var(--ink-muted)] text-sm">
                Увійди, щоб PHANTOM тебе впізнав.
              </p>
            </div>

            <form onSubmit={handleLogin} className="flex flex-col gap-5">
              <div>
                <label className="block text-xs uppercase tracking-wider text-[var(--ink-secondary)] mb-2 font-medium">
                  Користувач
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-[var(--ink-muted)]">
                    <Mail size={16} />
                  </div>
                  <input
                    // Не email: під цим полем authApi.loginPin(username, pin),
                    // і type="email" не давав браузеру відправити «phantom» —
                    // форма воювала з власним бекендом.
                    type="text"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading || isLocked()}
                    placeholder="phantom"
                    className="w-full bg-[var(--surface-void)] border border-[var(--glass-border)] text-white text-sm rounded-xl py-3 pl-11 pr-4 focus:outline-none focus:border-[var(--accent)] transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-[var(--ink-secondary)] mb-2 font-medium">
                  PIN
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-[var(--ink-muted)]">
                    <KeyRound size={16} />
                  </div>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading || isLocked()}
                    placeholder="••••••"
                    className="w-full bg-[var(--surface-void)] border border-[var(--glass-border)] text-white text-sm rounded-xl py-3 pl-11 pr-4 focus:outline-none focus:border-[var(--accent)] transition-colors"
                  />
                </div>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-red-400 text-sm"
                >
                  <ShieldCheck size={16} />
                  {error}
                </motion.div>
              )}

              <button
                type="submit"
                disabled={loading || isLocked()}
                className="mt-2 w-full py-3.5 rounded-xl font-medium tracking-wide text-sm flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98]"
                style={{
                  background: 'var(--accent)',
                  color: 'var(--ink-inverse)',
                  fontFamily: 'var(--font-display)',
                  boxShadow: '0 0 20px var(--accent-glow)',
                }}
              >
                {loading ? 'Впізнаю…' : 'Увійти'}
              </button>
            </form>

            <div className="mt-8 pt-6 border-t border-[var(--glass-border)] flex items-center justify-between text-xs text-[var(--ink-muted)]">
              <span>Secure Cloud Architecture</span>
              <span className="flex items-center gap-1"><Cpu size={12} /> Edge node active</span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function StatusPill({ icon, label, tone = 'default' }: { icon: React.ReactNode; label: string; tone?: 'default' | 'ok' | 'alert' }) {
  const color =
    tone === 'ok'
      ? 'var(--signal-ok)'
      : tone === 'alert'
        ? 'var(--signal-alert)'
        : 'var(--ink-secondary)';
  return (
    <div
      className="glass-panel flex items-center gap-2 px-4"
      style={{
        height: 32,
        borderRadius: 9999,
        color,
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--fs-micro)',
        letterSpacing: 'var(--tracking-wide)',
        background: 'var(--glass-subtle)',
        border: '1px solid var(--glass-border)',
      }}
    >
      {icon}
      <span className="uppercase">{label}</span>
    </div>
  );
}
