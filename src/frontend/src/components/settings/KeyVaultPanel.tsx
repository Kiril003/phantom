/** Ключі Поліса — the vault, operated entirely from the UI (rule 8):
 * add many keys per provider, watch live meters, disable/revive/delete.
 * Secrets go straight to the encrypted vault; the UI only ever sees hints. */
import { useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2, Power, Loader2 } from 'lucide-react';
import { polisApi } from '../../services/polisApi';
import type { ManagedKeyPublic } from '@shared/types';

const PROVIDERS = ['gemini', 'anthropic', 'openrouter', 'openai'];

const STATE_UA: Record<string, { label: string; tint: string }> = {
  active: { label: 'активний', tint: 'var(--accent)' },
  cooling: { label: 'охолодження', tint: 'var(--primary)' },
  exhausted: { label: 'квота вичерпана', tint: 'var(--primary)' },
  invalid: { label: 'невалідний', tint: 'var(--signal-alert)' },
  disabled: { label: 'вимкнено', tint: 'var(--ink-faint)' },
};

export function KeyVaultPanel() {
  const [keys, setKeys] = useState<ManagedKeyPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [provider, setProvider] = useState('gemini');
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      const res = await polisApi.keys();
      setKeys(res.keys);
    } catch {
      setError('Не вдалося отримати ключі — бекенд недоступний.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(t);
  }, []);

  const add = async () => {
    if (secret.trim().length < 8 || busy) return;
    setBusy(true);
    setError('');
    try {
      await polisApi.addKey(provider, label.trim(), secret.trim(), 100 + keys.length);
      setSecret('');
      setLabel('');
      setFormOpen(false);
      await refresh();
    } catch {
      setError('Ключ не додано — перевір формат.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (k: ManagedKeyPublic) => {
    await polisApi.setKeyState(k.id, k.state === 'disabled' ? 'active' : 'disabled');
    await refresh();
  };

  const remove = async (k: ManagedKeyPublic) => {
    await polisApi.deleteKey(k.id);
    await refresh();
  };

  return (
    <div className="flex flex-col gap-3" data-testid="keyvault-panel">
      <div className="flex items-center gap-2">
        <KeyRound size={18} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
        <div className="flex-1">
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}>
            Реактори живлення — API-ключі
          </p>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}>
            Багато ключів на провайдера. При ліміті Поліс сам перемикається на
            наступний; без жодного — тримається на локальному Ollama.
          </p>
        </div>
        <button
          onClick={() => setFormOpen((v) => !v)}
          className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center active:scale-[0.95]"
          style={{ background: 'var(--accent)', color: 'var(--ink-inverse)' }}
          aria-label="додати ключ"
          data-testid="key-add-toggle"
        >
          <Plus size={20} strokeWidth={2} />
        </button>
      </div>

      {formOpen && (
        <div
          className="rounded-xl p-3 flex flex-col gap-2"
          style={{ background: 'var(--glass-card)', border: '1px solid var(--glass-border)' }}
          data-testid="key-add-form"
        >
          <div className="flex gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p}
                onClick={() => setProvider(p)}
                className="px-3 min-h-[44px] rounded-lg font-mono active:scale-[0.97]"
                style={{
                  fontSize: 'var(--fs-xs)',
                  background: provider === p ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'var(--glass-subtle)',
                  color: provider === p ? 'var(--accent)' : 'var(--ink-secondary)',
                  border: `1px solid ${provider === p ? 'color-mix(in srgb, var(--accent) 34%, transparent)' : 'var(--glass-border)'}`,
                }}
              >
                {p}
              </button>
            ))}
          </div>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Назва (напр. «основний», «резерв-1»)"
            className="min-h-[44px] rounded-lg px-3 outline-none"
            style={{
              background: 'var(--glass-subtle)',
              border: '1px solid var(--glass-border)',
              color: 'var(--ink-primary)',
              fontSize: 'var(--fs-sm)',
            }}
          />
          <input
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Секретний ключ — буде зашифровано"
            type="password"
            autoComplete="off"
            className="min-h-[44px] rounded-lg px-3 outline-none font-mono"
            style={{
              background: 'var(--glass-subtle)',
              border: '1px solid var(--glass-border)',
              color: 'var(--ink-primary)',
              fontSize: 'var(--fs-sm)',
            }}
            data-testid="key-secret-input"
          />
          <button
            onClick={() => void add()}
            disabled={secret.trim().length < 8 || busy}
            className="min-h-[48px] rounded-lg font-medium active:scale-[0.98] disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--ink-inverse)' }}
            data-testid="key-submit"
          >
            {busy ? 'Шифрую…' : 'Покласти у сховище'}
          </button>
        </div>
      )}

      {error && (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--signal-alert)' }}>{error}</p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-4">
          <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}>
            Відкриваю сховище…
          </span>
        </div>
      ) : keys.length === 0 ? (
        <p
          className="rounded-xl p-3"
          style={{
            fontSize: 'var(--fs-sm)',
            color: 'var(--ink-muted)',
            background: 'var(--glass-subtle)',
          }}
        >
          Сховище порожнє. Поліс живиться від ключа з оточення або Ollama.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {keys.map((k) => {
            const st = STATE_UA[k.state] ?? STATE_UA.disabled;
            return (
              <div
                key={k.id}
                className="rounded-xl p-3 flex items-center gap-3"
                style={{
                  background: 'var(--glass-card)',
                  border: '1px solid var(--glass-border)',
                  opacity: k.state === 'disabled' ? 0.6 : 1,
                }}
                data-testid={`key-row-${k.id}`}
              >
                <span
                  className="w-2 h-8 rounded-sm shrink-0"
                  style={{
                    background: st.tint,
                    boxShadow: k.state === 'active' ? `0 0 8px ${st.tint}` : 'none',
                  }}
                />
                <div className="flex-1 min-w-0">
                  <p className="truncate" style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}>
                    {k.provider} · {k.label}{' '}
                    <span className="font-mono" style={{ color: 'var(--ink-faint)' }}>
                      {k.key_hint}
                    </span>
                  </p>
                  <p className="font-mono" style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-muted)' }}>
                    {st.label} · {k.metrics.requests_1h}/год ·{' '}
                    {Math.round(k.metrics.tokens_24h / 1000)}k ток/24г ·{' '}
                    {k.metrics.failures_24h} відмов
                  </p>
                </div>
                <button
                  onClick={() => void toggle(k)}
                  className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center active:scale-[0.95]"
                  style={{
                    background: 'var(--glass-subtle)',
                    color: k.state === 'disabled' ? 'var(--ink-faint)' : 'var(--accent)',
                  }}
                  aria-label={k.state === 'disabled' ? 'увімкнути' : 'вимкнути'}
                >
                  <Power size={18} strokeWidth={1.5} />
                </button>
                <button
                  onClick={() => void remove(k)}
                  className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center active:scale-[0.95]"
                  style={{ background: 'color-mix(in srgb, var(--signal-alert) 12%, transparent)', color: 'var(--signal-alert)' }}
                  aria-label="видалити ключ"
                >
                  <Trash2 size={18} strokeWidth={1.5} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
