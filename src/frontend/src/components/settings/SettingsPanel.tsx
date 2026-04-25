import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, RotateCcw, Loader2, Plug, CheckCircle2, AlertTriangle } from 'lucide-react';
import { StatusBar } from '../core/StatusBar';
import { useSettingsStore } from '../../stores/settingsStore';
import { settingsApi, aiApi, type OllamaModelInfo, type AITestResponse } from '../../services/api';
import { applyUISettings } from '../../services/settingsBootstrap';
import type { SettingDefinition } from '@shared/types';

export default function SettingsPanel() {
  const navigate = useNavigate();
  const categories = useSettingsStore((s) => s.categories);
  const values = useSettingsStore((s) => s.values);
  const dirty = useSettingsStore((s) => s.dirty);
  const loaded = useSettingsStore((s) => s.loaded);
  const setCategories = useSettingsStore((s) => s.setCategories);
  const setValue = useSettingsStore((s) => s.setValue);
  const markClean = useSettingsStore((s) => s.markClean);

  const [activeCategoryId, setActiveCategoryId] = useState<string>('');
  const [status, setStatus] = useState<
    { kind: 'idle' } | { kind: 'loading' } | { kind: 'saving' } | { kind: 'error'; msg: string } | { kind: 'saved' }
  >({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: 'loading' });
    settingsApi
      .getAll()
      .then((data) => {
        if (cancelled) return;
        setCategories(data.categories);
        setActiveCategoryId((prev) => prev || data.categories[0]?.id || '');
        setStatus({ kind: 'idle' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus({
          kind: 'error',
          msg: err instanceof Error ? err.message : 'Failed to load settings',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [setCategories]);

  useEffect(() => {
    if (!activeCategoryId && categories.length > 0) {
      setActiveCategoryId(categories[0].id);
    }
  }, [categories, activeCategoryId]);

  const activeCategory = useMemo(
    () => categories.find((c) => c.id === activeCategoryId),
    [categories, activeCategoryId]
  );

  const dirtyInCategory = useMemo(() => {
    if (!activeCategory) return [] as string[];
    return activeCategory.settings.map((d) => d.key).filter((k) => dirty.has(k));
  }, [activeCategory, dirty]);

  const handleSave = useCallback(async () => {
    if (!activeCategory || dirtyInCategory.length === 0) return;
    setStatus({ kind: 'saving' });
    try {
      const appliedPatch: Record<string, unknown> = {};
      for (const key of dirtyInCategory) {
        await settingsApi.set(key, values[key]);
        appliedPatch[key] = values[key];
        markClean(key);
      }
      // Re-apply UI-affecting values to the DOM immediately so the user sees
      // the change without a reload. Non-UI keys are no-ops here.
      applyUISettings(appliedPatch);
      setStatus({ kind: 'saved' });
      setTimeout(() => setStatus({ kind: 'idle' }), 1200);
    } catch (err) {
      setStatus({
        kind: 'error',
        msg: err instanceof Error ? err.message : 'Save failed',
      });
    }
  }, [activeCategory, dirtyInCategory, values, markClean]);

  const handleReset = useCallback(async () => {
    if (!activeCategory) return;
    try {
      await settingsApi.reset(activeCategory.id);
      const fresh = await settingsApi.getAll();
      setCategories(fresh.categories);
      // Same reason as handleSave: flush UI-affecting defaults back to DOM so
      // a theme reset is visible without a page reload.
      const all: Record<string, unknown> = {};
      for (const cat of fresh.categories) {
        for (const def of cat.settings) {
          all[def.key] = def.value;
        }
      }
      applyUISettings(all);
      setStatus({ kind: 'saved' });
      setTimeout(() => setStatus({ kind: 'idle' }), 1200);
    } catch (err) {
      setStatus({
        kind: 'error',
        msg: err instanceof Error ? err.message : 'Reset failed',
      });
    }
  }, [activeCategory, setCategories]);

  return (
    <div
      className="w-[1024px] h-[600px] flex flex-col"
      style={{ background: 'var(--surface-base)' }}
    >
      <StatusBar />

      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <aside
          className="w-[220px] h-full flex flex-col glass-panel"
          style={{ borderLeft: 'none', borderTop: 'none', borderBottom: 'none' }}
        >
          <div
            className="px-4 py-3 shrink-0"
            style={{ borderBottom: '1px solid var(--glass-border)' }}
          >
            <div
              className="flex items-center gap-2 uppercase"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-micro)',
                letterSpacing: 'var(--tracking-widest)',
                color: 'var(--ink-secondary)',
              }}
            >
              Налаштування
            </div>
            <div
              className="italic mt-1"
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 'var(--fs-xs)',
                color: 'var(--ink-muted)',
              }}
            >
              Usage shaped to taste.
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {categories.map((cat) => {
              const active = cat.id === activeCategoryId;
              const dirtyCount = cat.settings.filter((d) => dirty.has(d.key)).length;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategoryId(cat.id)}
                  className="w-full flex items-center gap-2 px-4 active:scale-[0.99] transition-all"
                  style={{
                    minHeight: 44,
                    background: active
                      ? 'color-mix(in srgb, var(--accent) 14%, transparent)'
                      : 'transparent',
                    borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                    color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--fs-xs)',
                    letterSpacing: 'var(--tracking-wide)',
                  }}
                >
                  <span
                    style={{
                      color: active ? 'var(--accent)' : 'var(--ink-muted)',
                      width: 16,
                      textAlign: 'center',
                    }}
                  >
                    {cat.icon}
                  </span>
                  <span className="flex-1 text-left">{cat.label}</span>
                  {dirtyCount > 0 && (
                    <span
                      className="rounded-full tabular-nums"
                      style={{
                        minWidth: 16,
                        height: 16,
                        padding: '0 6px',
                        fontSize: 10,
                        background: 'var(--signal-warn)',
                        color: 'var(--ink-inverse)',
                        fontFamily: 'var(--font-mono)',
                        textAlign: 'center',
                        lineHeight: '16px',
                      }}
                    >
                      {dirtyCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div
            className="shrink-0 px-3 py-2"
            style={{ borderTop: '1px solid var(--glass-border)' }}
          >
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="w-full flex items-center gap-2 active:scale-95"
              style={{
                minHeight: 44,
                padding: '0 10px',
                borderRadius: 10,
                background: 'var(--glass-subtle)',
                color: 'var(--ink-secondary)',
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-xs)',
                letterSpacing: 'var(--tracking-wide)',
                border: '1px solid var(--glass-border)',
              }}
            >
              <ArrowLeft size={14} strokeWidth={1.75} />
              Назад
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 min-h-0 flex flex-col">
          <header
            className="flex items-center gap-3 px-6 shrink-0"
            style={{
              height: 56,
              borderBottom: '1px solid var(--glass-border)',
              background: 'var(--glass-subtle)',
            }}
          >
            <div className="flex-1 min-w-0">
              <div
                className="uppercase"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-micro)',
                  color: 'var(--ink-muted)',
                  letterSpacing: 'var(--tracking-widest)',
                }}
              >
                Секція
              </div>
              <div
                className="truncate"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-md)',
                  color: 'var(--ink-primary)',
                  fontWeight: 500,
                  letterSpacing: 'var(--tracking-tight)',
                }}
              >
                {activeCategory?.label ?? '—'}
              </div>
            </div>

            <StatusPill status={status} />

            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-2 active:scale-95"
              style={{
                minHeight: 44,
                padding: '0 12px',
                borderRadius: 9999,
                background: 'var(--glass-subtle)',
                color: 'var(--ink-secondary)',
                border: '1px solid var(--glass-border)',
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-xs)',
                letterSpacing: 'var(--tracking-wide)',
              }}
              title="Reset category to defaults"
            >
              <RotateCcw size={14} strokeWidth={1.75} />
              Reset
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={dirtyInCategory.length === 0 || status.kind === 'saving'}
              className="flex items-center gap-2 active:scale-95"
              style={{
                minHeight: 44,
                padding: '0 14px',
                borderRadius: 9999,
                background:
                  dirtyInCategory.length > 0
                    ? 'var(--accent)'
                    : 'var(--glass-subtle)',
                color:
                  dirtyInCategory.length > 0
                    ? 'var(--ink-inverse)'
                    : 'var(--ink-muted)',
                border: '1px solid var(--accent)',
                opacity: dirtyInCategory.length > 0 ? 1 : 0.4,
                cursor: dirtyInCategory.length > 0 ? 'pointer' : 'default',
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-xs)',
                letterSpacing: 'var(--tracking-wider)',
                textTransform: 'uppercase',
              }}
            >
              {status.kind === 'saving' ? (
                <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />
              ) : (
                <Save size={14} strokeWidth={1.75} />
              )}
              Save ({dirtyInCategory.length})
            </button>
          </header>

          <section className="flex-1 overflow-y-auto px-6 py-5">
            {!loaded && status.kind === 'loading' && (
              <div className="h-full flex flex-col items-center justify-center gap-3">
                <Loader2
                  size={20}
                  strokeWidth={1.5}
                  className="animate-spin"
                  style={{ color: 'var(--accent)' }}
                />
                <span
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--fs-xs)',
                    color: 'var(--ink-muted)',
                    letterSpacing: 'var(--tracking-widest)',
                  }}
                >
                  Завантаження…
                </span>
              </div>
            )}
            {status.kind === 'error' && (
              <div
                className="px-3 py-2 rounded mb-3"
                style={{
                  background: 'color-mix(in srgb, var(--signal-alert) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--signal-alert) 40%, transparent)',
                  color: 'var(--signal-alert)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-xs)',
                }}
              >
                {status.msg}
              </div>
            )}
            {loaded && activeCategory && activeCategory.id === 'about' && <AboutSection />}
            {loaded && activeCategory && activeCategory.id !== 'about' && (
              <div className="flex flex-col gap-2">
                {activeCategory.id === 'ai' && <AIProviderDiagnostics />}
                {activeCategory.settings.length === 0 && (
                  <div
                    className="italic"
                    style={{
                      fontFamily: 'var(--font-serif)',
                      fontSize: 'var(--fs-sm)',
                      color: 'var(--ink-muted)',
                    }}
                  >
                    No settings yet for this category.
                  </div>
                )}
                {activeCategory.settings.map((def) => (
                  <SettingRow
                    key={def.key}
                    def={def}
                    value={values[def.key]}
                    dirty={dirty.has(def.key)}
                    onChange={(v) => setValue(def.key, v)}
                  />
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

/* ─── Row ──────────────────────────────────────────────────────────── */

function SettingRow({
  def,
  value,
  dirty,
  onChange,
}: {
  def: SettingDefinition;
  value: unknown;
  dirty: boolean;
  onChange: (v: unknown) => void;
}) {
  return (
    <div
      className="flex items-center gap-3 px-4"
      style={{
        minHeight: 52,
        padding: '10px 14px',
        borderRadius: 12,
        background: dirty
          ? 'color-mix(in srgb, var(--signal-warn) 8%, var(--glass-subtle))'
          : 'var(--glass-subtle)',
        border: `1px solid ${dirty ? 'color-mix(in srgb, var(--signal-warn) 40%, transparent)' : 'var(--glass-border)'}`,
      }}
    >
      <div className="flex-1 min-w-0">
        <div
          className="truncate"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-xs)',
            color: 'var(--ink-primary)',
          }}
        >
          {def.label}
        </div>
        <div
          className="truncate"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-micro)',
            color: 'var(--ink-muted)',
          }}
        >
          {def.key}
        </div>
      </div>
      <div className="shrink-0" style={{ minWidth: 180 }}>
        <ValueEditor def={def} value={value} onChange={onChange} />
      </div>
    </div>
  );
}

function ValueEditor({
  def,
  value,
  onChange,
}: {
  def: SettingDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  // Ollama model: dynamic dropdown backed by `/api/v1/ai/models`. Falls back
  // to a plain text input when the daemon isn't reachable.
  if (def.key === 'ai_ollama_model') {
    return <OllamaModelEditor value={value} onChange={onChange} />;
  }

  if (def.type === 'boolean') {
    const on = !!value;
    return (
      <button
        type="button"
        onClick={() => onChange(!on)}
        aria-pressed={on}
        className="flex items-center active:scale-95"
        style={{
          minHeight: 44,
          minWidth: 64,
          padding: '0 4px',
          width: 64,
          height: 28,
          borderRadius: 9999,
          background: on ? 'var(--accent)' : 'var(--glass-subtle)',
          border: `1px solid ${on ? 'var(--accent)' : 'var(--glass-border)'}`,
          position: 'relative',
          transition: 'all 0.2s ease',
        }}
      >
        <span
          className="rounded-full"
          style={{
            width: 20,
            height: 20,
            background: on ? 'var(--ink-inverse)' : 'var(--ink-secondary)',
            transform: on ? 'translateX(36px)' : 'translateX(0)',
            transition: 'transform 0.2s ease',
          }}
        />
      </button>
    );
  }

  if (def.type === 'select' && def.options) {
    return (
      <select
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent outline-none"
        style={{
          minHeight: 44,
          width: '100%',
          padding: '0 12px',
          borderRadius: 10,
          color: 'var(--ink-primary)',
          background: 'var(--surface-deep)',
          border: '1px solid var(--glass-border)',
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--fs-xs)',
        }}
      >
        {def.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  if (def.type === 'number') {
    return (
      <input
        type="number"
        value={Number.isFinite(value as number) ? (value as number) : 0}
        onChange={(e) => {
          const n = e.target.value === '' ? 0 : Number(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className="bg-transparent outline-none tabular-nums"
        style={{
          minHeight: 44,
          width: '100%',
          padding: '0 12px',
          borderRadius: 10,
          color: 'var(--ink-primary)',
          background: 'var(--surface-deep)',
          border: '1px solid var(--glass-border)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-xs)',
        }}
      />
    );
  }

  if (def.type === 'password') {
    return (
      <input
        type="password"
        placeholder="••••••••"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent outline-none"
        style={{
          minHeight: 44,
          width: '100%',
          padding: '0 12px',
          borderRadius: 10,
          color: 'var(--ink-primary)',
          background: 'var(--surface-deep)',
          border: '1px solid var(--glass-border)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-xs)',
        }}
      />
    );
  }

  return (
    <input
      type="text"
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      className="bg-transparent outline-none"
      style={{
        minHeight: 44,
        width: '100%',
        padding: '0 12px',
        borderRadius: 10,
        color: 'var(--ink-primary)',
        background: 'var(--surface-deep)',
        border: '1px solid var(--glass-border)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-xs)',
      }}
    />
  );
}

/* ─── AI diagnostics ───────────────────────────────────────────────── */

function AIProviderDiagnostics() {
  const [state, setState] = useState<{
    running: null | 'ollama' | 'gemini';
    result: Record<'ollama' | 'gemini', AITestResponse | null>;
  }>({ running: null, result: { ollama: null, gemini: null } });

  const run = useCallback(async (provider: 'ollama' | 'gemini') => {
    setState((s) => ({ ...s, running: provider }));
    try {
      const res = await aiApi.test(provider);
      setState((s) => ({
        running: null,
        result: { ...s.result, [provider]: res },
      }));
    } catch (err) {
      setState((s) => ({
        running: null,
        result: {
          ...s.result,
          [provider]: {
            ok: false,
            provider,
            latency_ms: 0,
            error: err instanceof Error ? err.message : 'Request failed',
          },
        },
      }));
    }
  }, []);

  return (
    <div
      className="glass-card flex flex-col gap-3 mb-2 px-4 py-3"
      style={{ borderRadius: 14, border: '1px solid var(--glass-border)' }}
    >
      <div
        className="uppercase"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--fs-micro)',
          color: 'var(--ink-muted)',
          letterSpacing: 'var(--tracking-widest)',
        }}
      >
        Connectivity
      </div>
      <div className="flex flex-wrap gap-2">
        <ProviderTestButton
          label="Test Ollama"
          onClick={() => run('ollama')}
          busy={state.running === 'ollama'}
          result={state.result.ollama}
        />
        <ProviderTestButton
          label="Test Gemini"
          onClick={() => run('gemini')}
          busy={state.running === 'gemini'}
          result={state.result.gemini}
        />
      </div>
    </div>
  );
}

function ProviderTestButton({
  label,
  onClick,
  busy,
  result,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  result: AITestResponse | null;
}) {
  const tone = result == null ? 'idle' : result.ok ? 'ok' : 'err';
  const color =
    tone === 'ok' ? 'var(--signal-ok)' : tone === 'err' ? 'var(--signal-alert)' : 'var(--accent)';
  const summary = result
    ? result.ok
      ? `Connected · ${result.latency_ms}ms`
      : `Failed: ${result.error ?? 'unknown'}`
    : 'Not tested';

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="flex items-center gap-2 px-3 rounded-full active:scale-95"
        style={{
          minHeight: 44,
          padding: '0 14px',
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          color,
          border: `1px solid color-mix(in srgb, ${color} 50%, transparent)`,
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--fs-xs)',
          letterSpacing: 'var(--tracking-wide)',
          opacity: busy ? 0.6 : 1,
          transition: 'all 200ms ease',
        }}
        aria-label={label}
      >
        {busy ? (
          <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />
        ) : tone === 'ok' ? (
          <CheckCircle2 size={14} strokeWidth={1.75} />
        ) : tone === 'err' ? (
          <AlertTriangle size={14} strokeWidth={1.75} />
        ) : (
          <Plug size={14} strokeWidth={1.75} />
        )}
        {label}
      </button>
      <span
        className="truncate"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-micro)',
          color: 'var(--ink-muted)',
          maxWidth: 340,
        }}
        title={result?.error ?? summary}
      >
        {summary}
      </span>
    </div>
  );
}

function OllamaModelEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [models, setModels] = useState<OllamaModelInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [offlineMessage, setOfflineMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    aiApi
      .listModels()
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setModels(res.models);
          setOfflineMessage(null);
        } else {
          setModels([]);
          setOfflineMessage('Ollama offline, enter manually');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setModels([]);
        setOfflineMessage('Ollama unreachable, enter manually');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const current = String(value ?? '');
  const showDropdown = models != null && models.length > 0;

  if (loading) {
    return (
      <div
        className="flex items-center gap-2"
        style={{
          minHeight: 44,
          padding: '0 12px',
          borderRadius: 10,
          background: 'var(--surface-deep)',
          border: '1px solid var(--glass-border)',
          color: 'var(--ink-muted)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-xs)',
        }}
      >
        <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
        Loading models…
      </div>
    );
  }

  if (!showDropdown) {
    // Fallback: manual input + an inline hint about Ollama being offline.
    return (
      <div className="flex flex-col gap-1">
        <input
          type="text"
          value={current}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. llama3.2:3b"
          className="bg-transparent outline-none"
          style={{
            minHeight: 44,
            width: '100%',
            padding: '0 12px',
            borderRadius: 10,
            color: 'var(--ink-primary)',
            background: 'var(--surface-deep)',
            border: '1px solid var(--glass-border)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-xs)',
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-micro)',
            color: 'var(--signal-warn)',
            letterSpacing: 'var(--tracking-wide)',
          }}
        >
          {offlineMessage ?? 'No models installed — run `ollama pull <name>`'}
        </span>
      </div>
    );
  }

  const hasCurrent = models!.some((m) => m.name === current);
  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className="bg-transparent outline-none"
      style={{
        minHeight: 44,
        width: '100%',
        padding: '0 12px',
        borderRadius: 10,
        color: 'var(--ink-primary)',
        background: 'var(--surface-deep)',
        border: '1px solid var(--glass-border)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-xs)',
      }}
    >
      {!hasCurrent && current && (
        <option value={current}>{current} (not installed)</option>
      )}
      {models!.map((m) => (
        <option key={m.name} value={m.name}>
          {m.name}
          {m.parameter_size ? ` · ${m.parameter_size}` : ''}
          {m.quantization ? ` · ${m.quantization}` : ''}
        </option>
      ))}
    </select>
  );
}

function StatusPill({ status }: { status: { kind: string; msg?: string } }) {
  if (status.kind === 'idle' || status.kind === 'loading') return null;
  const color =
    status.kind === 'saved'
      ? 'var(--signal-ok)'
      : status.kind === 'error'
        ? 'var(--signal-alert)'
        : 'var(--accent)';
  const label =
    status.kind === 'saving'
      ? 'Saving…'
      : status.kind === 'saved'
        ? 'Saved'
        : status.kind === 'error'
          ? 'Error'
          : '';
  return (
    <span
      className="px-2 py-1 rounded tabular-nums"
      style={{
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
        border: `1px solid ${color}`,
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--fs-micro)',
        letterSpacing: 'var(--tracking-widest)',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  );
}

/* ─── About ────────────────────────────────────────────────────────── */

function AboutSection() {
  return (
    <div className="flex flex-col gap-4">
      <div
        className="glass-card"
        style={{ borderRadius: 16, padding: '20px 22px' }}
      >
        <div
          className="uppercase"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-micro)',
            color: 'var(--ink-muted)',
            letterSpacing: 'var(--tracking-widest)',
          }}
        >
          Version
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-xl)',
            fontWeight: 300,
            color: 'var(--ink-primary)',
            letterSpacing: 'var(--tracking-tight)',
          }}
        >
          PHANTOM OS <span style={{ color: 'var(--accent)' }}>0.6 · Phase 06</span>
        </div>
        <div
          className="italic mt-2"
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 'var(--fs-sm)',
            color: 'var(--ink-secondary)',
            lineHeight: 'var(--lh-relaxed)',
            maxWidth: 520,
          }}
        >
          A dual-node assistant, part brain (Radxa Dragon Q6A) and part nerves
          (ESP32-S3). Quiet by default. Louder when it matters.
        </div>
      </div>

      <div
        className="glass-card"
        style={{ borderRadius: 16, padding: '16px 20px' }}
      >
        <div
          className="uppercase mb-2"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-micro)',
            color: 'var(--ink-muted)',
            letterSpacing: 'var(--tracking-widest)',
          }}
        >
          Runtime
        </div>
        <AboutRow label="Frontend" value="React 18 · Vite 5 · Tailwind 3" />
        <AboutRow label="Backend" value="FastAPI · SQLite · ChromaDB" />
        <AboutRow label="AI" value="Gemini 2.0 Flash → Ollama Gemma 4" />
        <AboutRow label="Voice" value="faster-whisper → Vosk · StyleTTS2 UA" />
      </div>
    </div>
  );
}

function AboutRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-center gap-3"
      style={{ padding: '6px 0', borderBottom: '1px solid var(--line-subtle)' }}
    >
      <span
        className="uppercase"
        style={{
          width: 120,
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--fs-micro)',
          color: 'var(--ink-muted)',
          letterSpacing: 'var(--tracking-widest)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-xs)',
          color: 'var(--ink-primary)',
        }}
      >
        {value}
      </span>
    </div>
  );
}
