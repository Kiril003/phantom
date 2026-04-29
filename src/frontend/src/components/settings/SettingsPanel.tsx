import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  RotateCcw,
  Loader2,
  Plug,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  ChevronRight,
  GitCompareArrows,
  KeyRound,
  Sun,
  Moon,
  Cog,
  SlidersHorizontal as Tune,
} from 'lucide-react';
import { StatusBar } from '../core/StatusBar';
import { FloatingToolbar } from '../core/FloatingToolbar';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFamiliarStore } from '../../stores/familiarStore';
import type { FamiliarRarity } from '@shared/types';
import {
  settingsApi,
  aiApi,
  type OllamaModelInfo,
  type AITestResponse,
} from '../../services/api';
import { voiceApi, type VoiceStatusResponse } from '../../services/voiceApi';
import { applyUISettings } from '../../services/settingsBootstrap';
import type { SettingDefinition } from '@shared/types';
import { groupByInferredSubgroup } from './groupSettings';
import {
  SettingsAccordion,
  readAccordionState,
  writeAccordionState,
} from './SettingsAccordion';

type ThemeId = 'sunrise-warm' | 'amber-night' | 'cyberdeck-cold';

/* ─── SettingsPanel — sunrise repaint (phase-5-R1-FE-SET) ─────────────
 * Preserves ALL existing Zustand selectors, store actions, and API
 * calls (settingsApi.getAll/set/reset, applyUISettings, etc.). Only
 * the visual chrome and theme-picker tile UI are new. THEME-NIGHT
 * agent owns the active-theme writeback through the same setValue/
 * settingsApi.set pipeline; this file just renders the picker so the
 * operator can choose. */
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
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'saving' }
    | { kind: 'error'; msg: string }
    | { kind: 'saved' }
  >({ kind: 'idle' });
  const [accordionState, setAccordionState] = useState<
    Record<string, Record<string, boolean>>
  >({});

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
    return activeCategory.settings
      .map((d) => d.key)
      .filter((k) => dirty.has(k));
  }, [activeCategory, dirty]);

  /* ── Aggregate progress (configured / total) across all categories.
     A setting counts as "configured" if its current value differs from
     its registered default — otherwise it's pristine. Mirrors the
     "83 / 88" pill in the design comp. ────────────────────────────── */
  const overallProgress = useMemo(() => {
    let total = 0;
    let configured = 0;
    for (const cat of categories) {
      for (const def of cat.settings) {
        total += 1;
        const cur = values[def.key];
        if (cur !== undefined && JSON.stringify(cur) !== JSON.stringify(def.default)) {
          configured += 1;
        }
      }
    }
    return { total, configured, ratio: total === 0 ? 0 : configured / total };
  }, [categories, values]);

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

  /* ── Pending-changes diff summary (3 PENDING CHANGES · …). Shows
     up to 2 keys verbatim then "+N more" so the strip stays inside
     the main pane width. ─────────────────────────────────────────── */
  const diffSummary = useMemo(() => {
    if (!activeCategory) return null;
    const dirtyKeys = activeCategory.settings.filter((d) => dirty.has(d.key));
    if (dirtyKeys.length === 0) return null;
    const head = dirtyKeys.slice(0, 2);
    const rest = dirtyKeys.length - head.length;
    const parts = head.map((d) => {
      const next = values[d.key];
      const prev = d.value;
      const fmt = (v: unknown) =>
        typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
          ? String(v)
          : '…';
      return `${d.key} · ${fmt(prev)}→${fmt(next)}`;
    });
    return {
      count: dirtyKeys.length,
      caption:
        parts.join(' · ') + (rest > 0 ? ` · +${rest} more` : ''),
    };
  }, [activeCategory, dirty, values]);

  const sectionIndex = useMemo(() => {
    if (!activeCategory) return { now: 0, total: categories.length };
    const idx = categories.findIndex((c) => c.id === activeCategory.id);
    return { now: idx + 1, total: categories.length };
  }, [activeCategory, categories]);

  return (
    <div
      className="sunrise-frame relative"
      style={{
        width: 1024,
        height: 600,
        background: 'var(--surface-base)',
        overflow: 'hidden',
      }}
    >
      <StatusBar />

      {/* === SIDEBAR === */}
      <aside
        className="glass"
        style={{
          position: 'absolute',
          left: 12,
          top: 68,
          bottom: 76,
          width: 260,
          padding: 14,
          zIndex: 3,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 14,
        }}
      >
        <div className="eyebrow">НАЛАШТУВАННЯ</div>
        <div
          className="playfair"
          style={{
            fontSize: 17,
            color: 'var(--ink-secondary)',
            lineHeight: 1.15,
            marginTop: 2,
            marginBottom: 8,
          }}
        >
          Usage shaped
          <br />
          to taste.
        </div>

        {/* Overall progress pill */}
        <div
          style={{
            marginBottom: 10,
            padding: '8px 10px',
            borderRadius: 10,
            background: 'rgba(244,175,37,0.10)',
            border: '1px solid rgba(244,175,37,0.20)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span className="micro-label" style={{ color: '#b07a10' }}>
              CONFIGURED
            </span>
            <span
              className="tabular"
              style={{ fontSize: 11, fontWeight: 700, color: '#b07a10' }}
            >
              {overallProgress.configured} / {overallProgress.total}
            </span>
          </div>
          <div
            style={{
              marginTop: 5,
              height: 3,
              background: 'rgba(244,175,37,0.18)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.round(overallProgress.ratio * 100)}%`,
                height: '100%',
                background: 'linear-gradient(90deg,#f4af25,#fb923c)',
                transition: 'width 240ms ease',
              }}
            />
          </div>
        </div>

        {/* Category list */}
        <div
          className="no-scrollbar"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            flex: 1,
            overflowY: 'auto',
            minHeight: 0,
          }}
        >
          {categories.map((cat) => {
            const active = cat.id === activeCategoryId;
            const dirtyCount = cat.settings.filter((d) =>
              dirty.has(d.key)
            ).length;
            const total = cat.settings.length;
            const done = total - dirtyCount;
            const pillBg = dirtyCount > 0
              ? 'rgba(244,175,37,0.20)'
              : 'rgba(34,197,94,0.18)';
            const pillFg = dirtyCount > 0 ? '#b07a10' : '#16a34a';
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategoryId(cat.id)}
                className="active:scale-[0.99]"
                style={{
                  minHeight: 44,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 10,
                  background: active ? 'rgba(244,175,37,0.18)' : 'transparent',
                  borderLeft: active
                    ? '3px solid #f4af25'
                    : '3px solid transparent',
                  color: active ? '#8a5e0a' : 'var(--ink-secondary)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  textAlign: 'left',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 16,
                    textAlign: 'center',
                    color: active ? '#b07a10' : 'var(--ink-muted)',
                  }}
                >
                  {cat.icon}
                </span>
                <span style={{ flex: 1 }}>{cat.label}</span>
                <span
                  className="tabular"
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: pillBg,
                    color: pillFg,
                  }}
                >
                  {done}/{total}
                </span>
              </button>
            );
          })}
        </div>

        {/* Bottom — back button */}
        <button
          type="button"
          onClick={() => navigate(-1)}
          style={{
            marginTop: 8,
            minHeight: 44,
            padding: '8px 12px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.6)',
            border: '1px solid rgba(255,255,255,0.6)',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            justifyContent: 'center',
            color: 'var(--ink-secondary)',
          }}
        >
          <ArrowLeft size={12} strokeWidth={1.75} />
          Назад до Shadow
        </button>
      </aside>

      {/* === MAIN PANE === */}
      <div
        style={{
          position: 'absolute',
          left: 284,
          right: 12,
          top: 68,
          bottom: 76,
          display: 'flex',
          flexDirection: 'column',
          zIndex: 2,
          gap: 10,
        }}
      >
        {/* Breadcrumb header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '4px 4px 0',
          }}
        >
          <span style={{ fontSize: 10, color: 'var(--ink-muted)' }}>
            Налаштування
          </span>
          <ChevronRight
            size={12}
            strokeWidth={1.75}
            style={{ color: 'var(--ink-muted)' }}
          />
          <span
            style={{
              fontSize: 10,
              color: '#b07a10',
              fontWeight: 600,
            }}
          >
            {activeCategory?.label ?? '—'}
          </span>
          <span style={{ flex: 1 }} />
          <StatusPill status={status} />
          <button
            type="button"
            onClick={handleReset}
            style={{
              minHeight: 44,
              padding: '6px 12px',
              borderRadius: 999,
              background: 'transparent',
              border: '1.5px solid rgba(0,0,0,0.12)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              color: 'var(--ink-secondary)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
            title="Reset category to defaults"
          >
            <RotateCcw size={12} strokeWidth={1.75} />
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={
              dirtyInCategory.length === 0 || status.kind === 'saving'
            }
            style={{
              minHeight: 44,
              padding: '6px 14px',
              borderRadius: 999,
              background:
                dirtyInCategory.length > 0
                  ? 'linear-gradient(135deg,#f4af25,#fb923c)'
                  : 'rgba(0,0,0,0.04)',
              border: 'none',
              cursor: dirtyInCategory.length > 0 ? 'pointer' : 'default',
              color:
                dirtyInCategory.length > 0
                  ? 'white'
                  : 'var(--ink-muted)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              opacity: dirtyInCategory.length > 0 ? 1 : 0.6,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              boxShadow:
                dirtyInCategory.length > 0
                  ? '0 4px 14px rgba(244,175,37,0.40)'
                  : 'none',
            }}
          >
            {status.kind === 'saving' ? (
              <Loader2
                size={14}
                strokeWidth={1.75}
                className="animate-spin"
              />
            ) : (
              <Save size={14} strokeWidth={1.75} />
            )}
            SAVE
            {dirtyInCategory.length > 0 && (
              <span
                style={{
                  background: 'rgba(255,255,255,0.30)',
                  padding: '1px 6px',
                  borderRadius: 999,
                  fontSize: 9,
                }}
              >
                {dirtyInCategory.length}
              </span>
            )}
          </button>
        </div>

        {/* Hero glass row */}
        <div
          className="glass"
          style={{
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'linear-gradient(135deg,#f4af25,#fb923c)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              boxShadow: '0 4px 14px rgba(244,175,37,0.35)',
            }}
            aria-hidden
          >
            <CategoryGlyph icon={activeCategory?.icon ?? '⚙'} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="micro-label">
              СЕКЦІЯ ·{' '}
              <span className="tabular">
                {String(sectionIndex.now).padStart(2, '0')}/
                {String(sectionIndex.total).padStart(2, '0')}
              </span>
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: '-0.01em',
                color: 'var(--ink-primary)',
              }}
            >
              {activeCategory?.label ?? '—'}
            </div>
          </div>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 12 }}
          >
            <div style={{ textAlign: 'right' }}>
              <div className="micro-label">CONFIG SCORE</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span
                  className="tabular"
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: '#16a34a',
                  }}
                >
                  {Math.round(overallProgress.ratio * 100)}
                </span>
                <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                  / 100
                </span>
              </div>
            </div>
            <CircularScore ratio={overallProgress.ratio} />
          </div>
        </div>

        {/* Settings list (scrollable inside main only) */}
        <div
          className="glass"
          style={{
            padding: 14,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <KeyRound
              size={14}
              strokeWidth={1.75}
              style={{ color: '#b07a10' }}
            />
            <span className="eyebrow-amber">
              {(activeCategory?.label ?? 'SETTINGS').toUpperCase()}
            </span>
            {dirtyInCategory.length > 0 && (
              <span
                className="tabular"
                style={{
                  fontSize: 9,
                  padding: '1px 7px',
                  borderRadius: 999,
                  background: 'rgba(244,175,37,0.18)',
                  color: '#8a5e0a',
                  fontWeight: 700,
                }}
              >
                {dirtyInCategory.length} edited
              </span>
            )}
          </div>

          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              paddingRight: 4,
            }}
          >
            {!loaded && status.kind === 'loading' && (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                }}
              >
                <Loader2
                  size={20}
                  strokeWidth={1.5}
                  className="animate-spin"
                  style={{ color: 'var(--accent)' }}
                />
                <span className="micro-label">Завантаження…</span>
              </div>
            )}

            {status.kind === 'error' && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  background:
                    'color-mix(in srgb, var(--signal-alert) 10%, transparent)',
                  border:
                    '1px solid color-mix(in srgb, var(--signal-alert) 40%, transparent)',
                  color: 'var(--signal-alert)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 12,
                }}
              >
                {status.msg}
              </div>
            )}

            {/* Theme picker tiles in the Theme group ────────────────── */}
            {loaded && activeCategory && activeCategory.id === 'theme' && (
              <ThemePicker values={values} onChange={setValue} />
            )}

            {loaded && activeCategory && activeCategory.id === 'about' && (
              <AboutSection />
            )}

            {loaded && activeCategory && activeCategory.id !== 'about' && (
              <>
                {activeCategory.id === 'ai' && <AIProviderDiagnostics />}
                {activeCategory.id === 'voice' && <NPUDiagnostics />}
                {(activeCategory.id === 'profile' ||
                  activeCategory.id === 'personality') && (
                  <FamiliarControlSection />
                )}
                {activeCategory.settings.length === 0 && (
                  <div
                    className="playfair"
                    style={{
                      fontSize: 13,
                      color: 'var(--ink-muted)',
                      fontStyle: 'italic',
                    }}
                  >
                    No settings yet for this category.
                  </div>
                )}
                {(() => {
                  const visible = activeCategory.settings.filter(
                    (def) => def.key !== 'voice_always_on_enabled'
                  );
                  const groups = groupByInferredSubgroup(
                    activeCategory.id,
                    visible
                  );
                  const stateForCategory =
                    accordionState[activeCategory.id] ??
                    (() => {
                      const stored = readAccordionState(activeCategory.id);
                      if (stored) return stored;
                      const seed: Record<string, boolean> = {};
                      groups.forEach((g, idx) => {
                        seed[g.bucket.id] = idx === 0;
                      });
                      return seed;
                    })();
                  if (groups.length <= 1) {
                    return groups[0]?.items.map((def) => (
                      <SettingRow
                        key={def.key}
                        def={def}
                        value={values[def.key]}
                        dirty={dirty.has(def.key)}
                        onChange={(v) => setValue(def.key, v)}
                      />
                    ));
                  }
                  return groups.map((g) => {
                    const open = stateForCategory[g.bucket.id] ?? false;
                    const dirtyCount = g.items.filter((d) =>
                      dirty.has(d.key)
                    ).length;
                    return (
                      <SettingsAccordion
                        key={g.bucket.id}
                        id={g.bucket.id}
                        label={g.bucket.label}
                        count={g.items.length}
                        dirtyCount={dirtyCount}
                        open={open}
                        onToggle={() => {
                          const nextForCategory = {
                            ...stateForCategory,
                            [g.bucket.id]: !open,
                          };
                          setAccordionState((curr) => ({
                            ...curr,
                            [activeCategory.id]: nextForCategory,
                          }));
                          writeAccordionState(
                            activeCategory.id,
                            nextForCategory
                          );
                        }}
                      >
                        {g.items.map((def) => (
                          <SettingRow
                            key={def.key}
                            def={def}
                            value={values[def.key]}
                            dirty={dirty.has(def.key)}
                            onChange={(v) => setValue(def.key, v)}
                          />
                        ))}
                      </SettingsAccordion>
                    );
                  });
                })()}
              </>
            )}
          </div>

          {/* Diff strip — sticky to the bottom of the glass */}
          {diffSummary && (
            <div
              style={{
                marginTop: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 10,
                background: 'rgba(244,175,37,0.08)',
                border: '1px dashed rgba(244,175,37,0.32)',
              }}
            >
              <GitCompareArrows
                size={14}
                strokeWidth={1.75}
                style={{ color: '#b07a10' }}
              />
              <span className="micro-label" style={{ color: '#b07a10' }}>
                {diffSummary.count} PENDING CHANGES
              </span>
              <span style={{ flex: 1 }} />
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  color: 'var(--ink-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 420,
                }}
                title={diffSummary.caption}
              >
                {diffSummary.caption}
              </span>
            </div>
          )}
        </div>
      </div>

      <FloatingToolbar />
    </div>
  );
}

/* ─── Setting row ────────────────────────────────────────────────────── */

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
      style={{
        position: 'relative',
        padding: '10px 12px',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.50)',
        border: dirty
          ? '1px solid rgba(244,175,37,0.40)'
          : '1px solid rgba(255,255,255,0.50)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        minHeight: 52,
      }}
    >
      {dirty && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: -3,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 6,
            height: 6,
            borderRadius: 999,
            background: '#f4af25',
            boxShadow: '0 0 6px rgba(244,175,37,0.60)',
          }}
        />
      )}
      <Tune
        size={16}
        strokeWidth={1.75}
        style={{ color: '#b07a10', flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--ink-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {def.label}
          </span>
          {dirty && (
            <span
              style={{
                fontSize: 8,
                padding: '1px 5px',
                borderRadius: 4,
                background: 'rgba(244,175,37,0.22)',
                color: '#8a5e0a',
                fontWeight: 700,
                letterSpacing: '0.10em',
              }}
            >
              EDITED
            </span>
          )}
        </div>
        <div
          className="mono"
          style={{
            fontSize: 9,
            color: 'var(--ink-muted)',
            marginTop: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {def.key}
        </div>
        {def.description && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--ink-muted)',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={def.description}
          >
            {def.description}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0, minWidth: 180 }}>
        <ValueEditor def={def} value={value} onChange={onChange} />
      </div>
    </div>
  );
}

/* ─── Value editor ───────────────────────────────────────────────────── */

function ValueEditor({
  def,
  value,
  onChange,
}: {
  def: SettingDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
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
        style={{
          minHeight: 44,
          minWidth: 64,
          width: 64,
          height: 28,
          padding: '0 4px',
          borderRadius: 9999,
          background: on
            ? 'linear-gradient(135deg,#f4af25,#fb923c)'
            : 'rgba(0,0,0,0.12)',
          border: 'none',
          position: 'relative',
          cursor: 'pointer',
          boxShadow: on
            ? '0 0 0 1px rgba(244,175,37,0.50), inset 0 0 8px rgba(255,255,255,0.30)'
            : 'inset 0 0 0 1px rgba(0,0,0,0.06)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: on ? 38 : 2,
            width: 22,
            height: 22,
            borderRadius: 9999,
            background: 'white',
            boxShadow: '0 1px 4px rgba(0,0,0,0.20)',
            transition: 'left 200ms ease',
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
        style={{
          minHeight: 44,
          width: '100%',
          padding: '0 12px',
          borderRadius: 10,
          color: 'var(--ink-primary)',
          background: 'rgba(255,255,255,0.60)',
          border: '1px solid rgba(0,0,0,0.06)',
          fontFamily: 'var(--font-display)',
          fontSize: 13,
          outline: 'none',
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
        className="tabular"
        style={{
          minHeight: 44,
          width: '100%',
          padding: '0 12px',
          borderRadius: 10,
          color: 'var(--ink-primary)',
          background: 'rgba(255,255,255,0.60)',
          border: '1px solid rgba(0,0,0,0.06)',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          outline: 'none',
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
        style={{
          minHeight: 44,
          width: '100%',
          padding: '0 12px',
          borderRadius: 10,
          color: 'var(--ink-primary)',
          background: 'rgba(255,255,255,0.60)',
          border: '1px solid rgba(0,0,0,0.06)',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          outline: 'none',
        }}
      />
    );
  }

  return (
    <input
      type="text"
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      style={{
        minHeight: 44,
        width: '100%',
        padding: '0 12px',
        borderRadius: 10,
        color: 'var(--ink-primary)',
        background: 'rgba(255,255,255,0.60)',
        border: '1px solid rgba(0,0,0,0.06)',
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        outline: 'none',
      }}
    />
  );
}

/* ─── Theme picker tiles ─────────────────────────────────────────────── */

interface ThemePickerProps {
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

const THEME_KEY = 'theme_active';

function ThemePicker({ values, onChange }: ThemePickerProps) {
  // The active-theme key landed by THEME-NIGHT is `theme_active`. We
  // tolerate it being absent (e.g. on a fresh install) by falling
  // back to the root <html> attribute, then "sunrise-warm".
  const active: ThemeId =
    (values[THEME_KEY] as ThemeId) ??
    ((document.documentElement.getAttribute('data-theme') as ThemeId) ||
      'sunrise-warm');

  const tiles: Array<{
    id: ThemeId;
    label: string;
    blurb: string;
    swatch: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'sunrise-warm',
      label: 'Sunrise · Warm',
      blurb: 'Cream + amber. Bright as life.',
      swatch:
        'linear-gradient(135deg,#fdf6e9 0%, #f4af25 50%, #fb923c 100%)',
      icon: <Sun size={16} strokeWidth={2} />,
    },
    {
      id: 'amber-night',
      label: 'Amber · Night',
      blurb: 'Warm-dark. Amber accents.',
      swatch:
        'linear-gradient(135deg,#221c10 0%, #b07a10 60%, #f4af25 100%)',
      icon: <Moon size={16} strokeWidth={2} />,
    },
    {
      id: 'cyberdeck-cold',
      label: 'Cyberdeck · Cold',
      blurb: 'Slate + cyan. Legacy.',
      swatch:
        'linear-gradient(135deg,#020617 0%, #0891b2 60%, #22d3ee 100%)',
      icon: <Cog size={16} strokeWidth={2} />,
    },
  ];

  const handleSelect = (id: ThemeId) => {
    // Apply optimistically so the operator sees the change instantly;
    // THEME-NIGHT's settings setter persists it, applyUISettings (run
    // on save) would re-apply identically.
    document.documentElement.setAttribute('data-theme', id);
    onChange(THEME_KEY, id);
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 10,
      }}
    >
      {tiles.map((t) => {
        const selected = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => handleSelect(t.id)}
            aria-pressed={selected}
            style={{
              minHeight: 110,
              padding: 12,
              borderRadius: 14,
              background: 'rgba(255,255,255,0.55)',
              border: selected
                ? '2px solid #f4af25'
                : '1px solid rgba(255,255,255,0.55)',
              boxShadow: selected
                ? '0 8px 24px rgba(244,175,37,0.30)'
                : 'var(--shadow-md)',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              textAlign: 'left',
              position: 'relative',
            }}
          >
            <div
              aria-hidden
              style={{
                width: '100%',
                height: 36,
                borderRadius: 10,
                background: t.swatch,
                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)',
              }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: '#b07a10',
              }}
            >
              {t.icon}
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--ink-primary)',
                  letterSpacing: '0.02em',
                }}
              >
                {t.label}
              </span>
            </div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--ink-muted)',
                lineHeight: 1.4,
              }}
            >
              {t.blurb}
            </div>
            {selected && (
              <span
                className="micro-label"
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  color: '#b07a10',
                  background: 'rgba(244,175,37,0.18)',
                  padding: '2px 6px',
                  borderRadius: 999,
                }}
              >
                ACTIVE
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Status pill ────────────────────────────────────────────────────── */

function StatusPill({
  status,
}: {
  status: { kind: string; msg?: string };
}) {
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
      className="tabular"
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
        border: `1px solid ${color}`,
        fontFamily: 'var(--font-display)',
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  );
}

/* ─── Circular score ─────────────────────────────────────────────────── */

function CircularScore({ ratio }: { ratio: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const dash = c * Math.max(0, Math.min(1, ratio));
  return (
    <div style={{ position: 'relative', width: 44, height: 44 }}>
      <svg
        viewBox="0 0 44 44"
        style={{ position: 'absolute', inset: 0 }}
        aria-hidden
      >
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="rgba(0,0,0,0.06)"
          strokeWidth="3"
        />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="#16a34a"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 22 22)"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 700,
          color: '#16a34a',
        }}
      >
        {Math.round(ratio * 100)}
      </div>
    </div>
  );
}

/* ─── Category glyph ─────────────────────────────────────────────────── */

function CategoryGlyph({ icon }: { icon: string }) {
  // Categories carry a single-glyph icon string in the schema (e.g.
  // "tune", "palette"). Rendering them as text inside the gradient
  // tile keeps zero new asset loads. A real icon font lookup would
  // belong in a shared <Icon> component — out of scope here.
  return (
    <span
      style={{
        fontFamily: 'Material Symbols Outlined, system-ui',
        fontSize: 22,
        lineHeight: 1,
      }}
    >
      {icon}
    </span>
  );
}

/* ─── AI diagnostics ─────────────────────────────────────────────────── */

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
      className="sub-glass"
      style={{
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        borderRadius: 12,
      }}
    >
      <div className="eyebrow-amber">Connectivity</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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
    tone === 'ok'
      ? 'var(--signal-ok)'
      : tone === 'err'
        ? 'var(--signal-alert)'
        : 'var(--accent)';
  const summary = result
    ? result.ok
      ? `Connected · ${result.latency_ms}ms`
      : `Failed: ${result.error ?? 'unknown'}`
    : 'Not tested';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        style={{
          minHeight: 44,
          padding: '0 14px',
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          color,
          border: `1px solid color-mix(in srgb, ${color} 50%, transparent)`,
          borderRadius: 9999,
          fontFamily: 'var(--font-display)',
          fontSize: 12,
          letterSpacing: '0.05em',
          opacity: busy ? 0.6 : 1,
          cursor: busy ? 'default' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
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
        className="mono"
        style={{
          fontSize: 11,
          color: 'var(--ink-muted)',
          maxWidth: 340,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
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
        style={{
          minHeight: 44,
          padding: '0 12px',
          borderRadius: 10,
          background: 'rgba(255,255,255,0.60)',
          border: '1px solid rgba(0,0,0,0.06)',
          color: 'var(--ink-muted)',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
        Loading models…
      </div>
    );
  }

  if (!showDropdown) {
    return (
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <input
          type="text"
          value={current}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. llama3.2:3b"
          style={{
            minHeight: 44,
            width: '100%',
            padding: '0 12px',
            borderRadius: 10,
            color: 'var(--ink-primary)',
            background: 'rgba(255,255,255,0.60)',
            border: '1px solid rgba(0,0,0,0.06)',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            outline: 'none',
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 10,
            color: 'var(--signal-warn)',
            letterSpacing: '0.05em',
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
      style={{
        minHeight: 44,
        width: '100%',
        padding: '0 12px',
        borderRadius: 10,
        color: 'var(--ink-primary)',
        background: 'rgba(255,255,255,0.60)',
        border: '1px solid rgba(0,0,0,0.06)',
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        outline: 'none',
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

/* ─── NPU diagnostics (Phase 15) ─────────────────────────────────────── */

function NPUDiagnostics() {
  const [state, setState] = useState<{
    loading: boolean;
    error: string | null;
    status: VoiceStatusResponse | null;
  }>({ loading: true, error: null, status: null });

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const status = await voiceApi.status();
      setState({ loading: false, error: null, status });
    } catch (err) {
      setState({
        loading: false,
        error: err instanceof Error ? err.message : 'voice/status failed',
        status: null,
      });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const status = state.status;
  let tone: 'idle' | 'ok' | 'warn' | 'err' | 'off' = 'idle';
  let summary = 'Не перевірено';
  if (state.error) {
    tone = 'err';
    summary = state.error;
  } else if (status) {
    if (!status.npu_enabled) {
      tone = 'off';
      summary = 'NPU вимкнено в налаштуваннях';
    } else if (status.npu_active && status.npu_encoder_loaded) {
      tone = 'ok';
      summary = `Активний · encoder на QNN HTP · ${status.stt_engine}`;
    } else if (status.npu_active) {
      tone = 'warn';
      summary =
        'Провайдер активний, encoder на CPU (QNN session не піднявся)';
    } else if (status.npu_available) {
      tone = 'ok';
      summary = `Готовий · поточний engine: ${status.stt_engine}`;
    } else {
      tone = 'warn';
      summary =
        'Bundle або EP плагін не доступні — система впаде на faster-whisper';
    }
  } else if (state.loading) {
    summary = 'Перевіряємо стан…';
  }

  const color =
    tone === 'ok'
      ? 'var(--signal-ok)'
      : tone === 'warn'
        ? 'var(--signal-warn)'
        : tone === 'err'
          ? 'var(--signal-alert)'
          : tone === 'off'
            ? 'var(--ink-muted)'
            : 'var(--accent)';

  return (
    <div
      className="sub-glass"
      style={{
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        borderRadius: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Cpu
          size={14}
          strokeWidth={1.75}
          style={{ color: 'var(--ink-muted)' }}
        />
        <span className="eyebrow-amber">NPU · Hexagon HTP</span>
        <span
          className="micro-label"
          style={{
            padding: '1px 7px',
            borderRadius: 999,
            background: `color-mix(in srgb, ${color} 18%, transparent)`,
            color,
            border: `1px solid color-mix(in srgb, ${color} 50%, transparent)`,
          }}
        >
          {tone === 'ok'
            ? 'OK'
            : tone === 'warn'
              ? 'Warn'
              : tone === 'err'
                ? 'Error'
                : tone === 'off'
                  ? 'Off'
                  : '…'}
        </span>
        <button
          type="button"
          onClick={refresh}
          disabled={state.loading}
          style={{
            marginLeft: 'auto',
            minHeight: 32,
            minWidth: 0,
            padding: '0 10px',
            borderRadius: 9999,
            background: 'rgba(255,255,255,0.60)',
            color: 'var(--ink-secondary)',
            border: '1px solid rgba(0,0,0,0.06)',
            fontFamily: 'var(--font-display)',
            fontSize: 10,
            letterSpacing: '0.05em',
            cursor: state.loading ? 'default' : 'pointer',
            opacity: state.loading ? 0.5 : 1,
          }}
          title="Re-check /voice/status"
        >
          {state.loading ? (
            <Loader2
              size={12}
              strokeWidth={1.75}
              className="animate-spin"
            />
          ) : (
            'Refresh'
          )}
        </button>
      </div>

      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 12,
          color: 'var(--ink-secondary)',
        }}
      >
        {summary}
      </div>

      {status && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '120px 1fr',
            rowGap: 4,
            columnGap: 12,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--ink-muted)',
          }}
        >
          <span>Bundle</span>
          <span style={{ color: 'var(--ink-primary)' }}>
            {status.npu_model_path || '—'}
          </span>
          <span>Compute</span>
          <span style={{ color: 'var(--ink-primary)' }}>
            {status.npu_compute || '—'}
          </span>
          <span>Encoder · QNN</span>
          <span
            style={{
              color: status.npu_encoder_loaded
                ? 'var(--signal-ok)'
                : 'var(--ink-primary)',
            }}
          >
            {status.npu_encoder_loaded ? 'loaded' : 'not loaded'}
          </span>
          <span>Providers</span>
          <span
            style={{
              color: 'var(--ink-primary)',
              overflowWrap: 'anywhere',
            }}
          >
            {status.npu_providers || 'unknown'}
          </span>
          <span>Active engine</span>
          <span style={{ color: 'var(--ink-primary)' }}>
            {status.stt_engine}
          </span>
        </div>
      )}
    </div>
  );
}

/* ─── About ──────────────────────────────────────────────────────────── */

function AboutSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        className="sub-glass"
        style={{ borderRadius: 14, padding: '16px 18px' }}
      >
        <div className="eyebrow-amber">Version</div>
        <div
          style={{
            fontSize: 28,
            fontWeight: 300,
            color: 'var(--ink-primary)',
            letterSpacing: '-0.02em',
            marginTop: 4,
          }}
        >
          PHANTOM OS{' '}
          <span style={{ color: '#b07a10' }}>0.6 · Phase 06</span>
        </div>
        <div
          className="playfair"
          style={{
            fontSize: 14,
            color: 'var(--ink-secondary)',
            lineHeight: 1.5,
            maxWidth: 520,
            marginTop: 8,
            fontStyle: 'italic',
          }}
        >
          A dual-node assistant, part brain (Radxa Dragon Q6A) and part
          nerves (ESP32-S3). Quiet by default. Louder when it matters.
        </div>
      </div>

      <div
        className="sub-glass"
        style={{ borderRadius: 14, padding: '14px 18px' }}
      >
        <div className="eyebrow-amber" style={{ marginBottom: 6 }}>
          Runtime
        </div>
        <AboutRow label="Frontend" value="React 18 · Vite 5 · Tailwind 3" />
        <AboutRow label="Backend" value="FastAPI · SQLite · ChromaDB" />
        <AboutRow label="AI" value="Gemini 2.0 Flash → Ollama Gemma 4" />
        <AboutRow
          label="Voice"
          value="faster-whisper → Vosk · StyleTTS2 UA"
        />
      </div>
    </div>
  );
}

function AboutRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '6px 0',
        borderBottom: '1px solid var(--line-subtle)',
      }}
    >
      <span
        className="micro-label"
        style={{
          width: 120,
        }}
      >
        {label}
      </span>
      <span
        className="mono"
        style={{
          fontSize: 12,
          color: 'var(--ink-primary)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ─── Familiar control (Phase-5 R1-FAMILIAR-1) ───────────────────────────
 *
 * Embedded inside the Profile / Personality category. Lets the operator:
 *   - pick how often the Familiar appears (off / rare / normal / often)
 *   - test-summon the creature on demand (bypasses the rarity gate)
 *
 * The rarity is mirrored into localStorage so the choice survives a hard
 * refresh; the familiarStore reads it back on next bootstrap. We keep the
 * persistence inside this component because the wisp is a pure-FE feature
 * — there's no backend setting row to mirror. */

const FAMILIAR_RARITY_LS_KEY = 'phantom-familiar-rarity';

function loadFamiliarRarity(): FamiliarRarity {
  if (typeof window === 'undefined') return 'normal';
  try {
    const raw = window.localStorage.getItem(FAMILIAR_RARITY_LS_KEY);
    if (raw === 'off' || raw === 'rare' || raw === 'normal' || raw === 'often') {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return 'normal';
}

function saveFamiliarRarity(r: FamiliarRarity): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FAMILIAR_RARITY_LS_KEY, r);
  } catch {
    /* quota — ignore */
  }
}

function FamiliarControlSection() {
  const rarity = useFamiliarStore((s) => s.rarity);
  const setRarity = useFamiliarStore((s) => s.setRarity);
  const manifest = useFamiliarStore((s) => s.manifest);

  // Hydrate from localStorage on first mount.
  useEffect(() => {
    const stored = loadFamiliarRarity();
    if (stored !== rarity) setRarity(stored);
    // Run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options: Array<{ id: FamiliarRarity; label: string; blurb: string }> = [
    { id: 'off', label: 'Off', blurb: 'Familiar dormant.' },
    { id: 'rare', label: 'Rare', blurb: '~1 in 8 attempts.' },
    { id: 'normal', label: 'Normal', blurb: '~1 in 3 attempts.' },
    { id: 'often', label: 'Often', blurb: '~2 in 3 attempts.' },
  ];

  const handleSelect = (r: FamiliarRarity) => {
    setRarity(r);
    saveFamiliarRarity(r);
  };

  const handleTestSummon = () => {
    manifest('easter-egg', { force: true });
  };

  return (
    <div
      className="sub-glass"
      style={{
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        borderRadius: 12,
      }}
      data-testid="familiar-control"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          aria-hidden
          style={{
            width: 12,
            height: 12,
            borderRadius: 999,
            background:
              'radial-gradient(circle at 30% 30%, #ffffff, #f4af25 70%)',
            boxShadow: '0 0 12px rgba(244,175,37,0.55)',
          }}
        />
        <span className="eyebrow-amber">PHANTOM Familiar</span>
        <span
          className="micro-label"
          style={{
            padding: '1px 7px',
            borderRadius: 999,
            background: 'rgba(244,175,37,0.18)',
            color: '#8a5e0a',
            fontWeight: 700,
          }}
        >
          {rarity.toUpperCase()}
        </span>
      </div>

      <div
        className="playfair"
        style={{
          fontSize: 11,
          color: 'var(--ink-secondary)',
          fontStyle: 'italic',
          lineHeight: 1.4,
        }}
      >
        A small wisp that occasionally appears, points at things, and waves.
        Set how often it manifests — or summon one now.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {options.map((opt) => {
          const selected = opt.id === rarity;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleSelect(opt.id)}
              aria-pressed={selected}
              style={{
                minHeight: 44,
                padding: '6px 8px',
                borderRadius: 10,
                border: selected
                  ? '2px solid #f4af25'
                  : '1px solid rgba(0,0,0,0.08)',
                background: selected
                  ? 'rgba(244,175,37,0.18)'
                  : 'rgba(255,255,255,0.50)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 2,
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: selected ? '#8a5e0a' : 'var(--ink-primary)',
                }}
              >
                {opt.label}
              </span>
              <span
                style={{
                  fontSize: 9,
                  color: 'var(--ink-muted)',
                  letterSpacing: '0.02em',
                }}
              >
                {opt.blurb}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={handleTestSummon}
          style={{
            minHeight: 44,
            padding: '0 14px',
            borderRadius: 9999,
            background: 'linear-gradient(135deg,#f4af25,#fb923c)',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'var(--font-display)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            boxShadow: '0 4px 14px rgba(244,175,37,0.40)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
          title="Force-summon the Familiar (bypasses rarity gate)"
        >
          Test summon
        </button>
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: 'var(--ink-muted)',
          }}
        >
          Honours `prefers-reduced-motion: reduce` — the wisp fades in/out
          instead of drifting when motion is reduced.
        </span>
      </div>
    </div>
  );
}
