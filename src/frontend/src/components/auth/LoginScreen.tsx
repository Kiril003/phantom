import React, { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useSystemStore } from '../../stores/systemStore';
import { authApi } from '../../services/api';

type LoginMode = 'pin' | 'rfid';

export default function LoginScreen() {
  const [mode, setMode] = useState<LoginMode>('pin');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { setUser, incrementAttempts, setLockout, isLocked, loginAttempts } = useAuthStore();
  const { setAuthenticated } = useSystemStore();

  const handlePinLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked()) {
      setError('Занадто багато спроб. Зачекайте.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await authApi.loginPin(username, pin);
      setUser(res.user, res.token, res.expires_at);
      setAuthenticated(true);
    } catch {
      incrementAttempts();
      if (loginAttempts + 1 >= 5) {
        setLockout(Date.now() + 15 * 60 * 1000);
        setError('Заблоковано на 15 хвилин.');
      } else {
        setError('Невірний логін або PIN.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-[1024px] h-[600px] bg-phantom-bg flex items-center justify-center">
      <div className="phantom-panel p-8 w-[360px]">
        <div className="text-center mb-8">
          <div className="text-phantom-cyan text-xl tracking-[0.3em] font-mono mb-1">PHANTOM</div>
          <div className="text-phantom-text-dim text-xs tracking-[0.2em]">AUTHENTICATION REQUIRED</div>
        </div>

        {/* Mode selector */}
        <div className="flex mb-6 phantom-panel overflow-hidden">
          <button
            className={`flex-1 h-[44px] text-xs tracking-widest transition-colors ${
              mode === 'pin'
                ? 'bg-phantom-cyan text-phantom-bg'
                : 'text-phantom-text-dim hover:text-phantom-text'
            }`}
            onClick={() => setMode('pin')}
          >
            PIN
          </button>
          <button
            className={`flex-1 h-[44px] text-xs tracking-widest transition-colors ${
              mode === 'rfid'
                ? 'bg-phantom-cyan text-phantom-bg'
                : 'text-phantom-text-dim hover:text-phantom-text'
            }`}
            onClick={() => setMode('rfid')}
          >
            RFID
          </button>
        </div>

        {mode === 'pin' && (
          <form onSubmit={handlePinLogin} className="flex flex-col gap-3">
            <input
              className="h-[44px] phantom-panel px-3 text-phantom-text bg-transparent outline-none focus:border-phantom-cyan text-sm w-full"
              placeholder="Логін"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
            <input
              type="password"
              className="h-[44px] phantom-panel px-3 text-phantom-text bg-transparent outline-none focus:border-phantom-cyan text-sm w-full"
              placeholder="PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoComplete="current-password"
            />
            {error && (
              <span className="text-phantom-danger text-xs">{error}</span>
            )}
            <button
              type="submit"
              disabled={loading || !username || !pin}
              className="h-[44px] bg-phantom-cyan text-phantom-bg text-xs tracking-widest hover:bg-phantom-cyan-dim disabled:opacity-40 transition-colors"
            >
              {loading ? 'ВХІД...' : 'УВІЙТИ'}
            </button>
          </form>
        )}

        {mode === 'rfid' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="w-16 h-16 border-2 border-phantom-cyan rounded-full flex items-center justify-center animate-pulse-cyan">
              <span className="text-phantom-cyan text-2xl">⊙</span>
            </div>
            <span className="text-phantom-text-dim text-xs tracking-widest">
              ПРИКЛАДІТЬ RFID КАРТКУ
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
