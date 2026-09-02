import React, { useCallback, useEffect, useState } from 'react';
import { Key, Plus, Trash2, Copy, Check, Loader2 } from 'lucide-react';
import { request, ApiError } from '../../services/api';

/** Те, що справді віддає GET /api-keys/ — рядок таблиці ключів цього простору.
 *  Сирого значення тут немає й бути не може: ядро зберігає лише SHA-256-відбиток
 *  (routes_api_keys.py), тож показувати «pk_live_••••» замість забутого ключа
 *  означало б домальовувати те, чого ніхто вже не знає. */
interface ApiKeyRow {
  id: string;
  name: string;
  created_at: string | null;
}

/** Повний ключ існує рівно один раз — у відповіді на створення. Далі його
 *  немає ніде, тож картка «ось він» показується один раз і не повертається. */
interface FreshKey {
  id: string;
  name: string;
  key: string;
}

const PANEL: React.CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--glass-border)',
  boxShadow: 'var(--shadow-sm)',
};

const PANEL_MUTED: React.CSSProperties = { ...PANEL, color: 'var(--ink-muted)' };

const FIELD: React.CSSProperties = {
  background: 'var(--surface-deep)',
  border: '1px solid var(--line-default)',
  color: 'var(--ink-primary)',
};

type Load = { s: 'reading' } | { s: 'ok' } | { s: 'failed'; why: string };

function failureLine(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'цей профіль ще не належить жодному простору';
    if (err.status === 401) return 'сесія скінчилась — увійди ще раз';
    return err.message || 'ядро не віддало перелік ключів';
  }
  return 'ядро не відповідає';
}

function created(iso: string | null): string {
  if (!iso) return 'дата невідома';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? 'дата невідома'
    : `створено ${d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

export function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [load, setLoad] = useState<Load>({ s: 'reading' });
  const [name, setName] = useState('');
  const [making, setMaking] = useState(false);
  const [makeError, setMakeError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<FreshKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [dropping, setDropping] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      const data = await request<{ api_keys?: ApiKeyRow[] }>('GET', '/api-keys/');
      setKeys(Array.isArray(data?.api_keys) ? data.api_keys : []);
      setLoad({ s: 'ok' });
    } catch (err) {
      setKeys([]);
      setLoad({ s: 'failed', why: failureLine(err) });
    }
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  const make = useCallback(async () => {
    const wanted = name.trim();
    if (!wanted || making) return;
    setMaking(true);
    setMakeError(null);
    try {
      // `name` у маршруті — звичайний рядковий параметр, тобто питання адреси.
      const born = await request<FreshKey>(
        'POST',
        `/api-keys/generate?name=${encodeURIComponent(wanted)}`,
      );
      setFresh(born);
      setCopied(false);
      setName('');
      // Перелік перечитуємо з ядра, а не дописуємо рядок у пам'ять вкладки:
      // саме так тут колись і зʼявлялись ключі, що зникали після перезавантаження.
      await read();
    } catch (err) {
      setMakeError(failureLine(err));
    } finally {
      setMaking(false);
    }
  }, [name, making, read]);

  const drop = useCallback(
    async (id: string) => {
      setDropping(id);
      try {
        await request('DELETE', `/api-keys/${id}`);
        if (fresh?.id === id) setFresh(null);
        await read();
      } catch (err) {
        setLoad({ s: 'failed', why: failureLine(err) });
      } finally {
        setDropping(null);
      }
    },
    [fresh, read],
  );

  const copy = useCallback((value: string) => {
    void navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl">
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#f4af25,#fb923c)', color: 'white' }}
        >
          <Key size={18} strokeWidth={1.75} />
        </div>
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--ink-primary)' }}>
            Ключі доступу
          </h2>
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            Ними інші програми входять у цей вузол замість тебе. Ключ видно рівно
            один раз — далі вузол знає лише його відбиток.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          data-testid="api-key-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void make();
          }}
          placeholder="для чого цей ключ — наприклад «сервер збірок»"
          className="flex-1 min-w-[220px] px-4 rounded-xl text-sm"
          style={{ ...FIELD, minHeight: 44 }}
        />
        <button
          data-testid="api-key-generate"
          onClick={() => void make()}
          disabled={making || name.trim().length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-xl transition-all shadow-sm text-sm font-medium"
          style={{
            background: 'linear-gradient(135deg,#f4af25,#fb923c)',
            border: 'none',
            color: 'white',
            minHeight: 44,
            opacity: making || name.trim().length === 0 ? 0.5 : 1,
          }}
        >
          {making ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          Створити ключ
        </button>
      </div>

      {makeError && (
        <div className="p-4 rounded-2xl text-sm" style={PANEL_MUTED}>
          ключ не створено: {makeError}
        </div>
      )}

      {fresh && (
        <div
          className="flex flex-col gap-2 p-4 rounded-2xl"
          style={{ ...PANEL, borderColor: '#f4af25' }}
        >
          <span className="text-sm font-medium" style={{ color: 'var(--ink-primary)' }}>
            Ключ «{fresh.name}» створено. Збережи його зараз — більше ми його не покажемо.
          </span>
          <div className="flex items-center gap-3">
            <code
              className="flex-1 px-3 py-2 rounded-xl text-xs break-all"
              style={{ ...FIELD, fontFamily: 'var(--font-mono)' }}
            >
              {fresh.key}
            </code>
            <button
              onClick={() => copy(fresh.key)}
              className="flex items-center gap-2 px-3 rounded-xl text-sm"
              style={{ ...FIELD, minHeight: 40 }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'скопійовано' : 'копіювати'}
            </button>
          </div>
        </div>
      )}

      {load.s === 'reading' ? (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--ink-muted)' }} />
        </div>
      ) : load.s === 'failed' ? (
        <div className="p-4 rounded-2xl text-sm" style={PANEL_MUTED}>
          {load.why}
        </div>
      ) : keys.length === 0 ? (
        <div className="p-4 rounded-2xl text-sm" style={PANEL_MUTED}>
          Жодного ключа доступу. Поки їх немає, увійти в цей вузол можна лише
          з профілю.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between p-4 rounded-2xl"
              style={PANEL}
            >
              <div className="flex flex-col min-w-0">
                <span
                  className="text-sm font-medium truncate"
                  style={{ color: 'var(--ink-primary)' }}
                >
                  {k.name}
                </span>
                <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  {created(k.created_at)}
                </span>
              </div>
              <button
                data-testid={`api-key-delete-${k.id}`}
                onClick={() => void drop(k.id)}
                disabled={dropping === k.id}
                aria-label={`відкликати ключ ${k.name}`}
                className="flex items-center justify-center rounded-xl"
                style={{ ...FIELD, width: 40, height: 40, color: 'var(--ink-muted)' }}
              >
                {dropping === k.id ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Trash2 size={16} />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
