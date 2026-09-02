import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Save,
  Loader2,
  Plug,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  RotateCcw,
  Sun,
  Moon,
  Cog,
  Languages,
  Search,
  X as XIcon,
} from 'lucide-react';
import { ProfileManagementSection } from './ProfileManagement';
import { MobilePairing } from './MobilePairing';
import { SymbiotePanel } from './SymbiotePanel';
import { VaultPanel } from './VaultPanel';
import { BackupRestoreCard } from './BackupRestoreCard';
import {
  useSettingsStore,
  THEME_SETTING_KEY,
} from '../../stores/settingsStore';
import { LOCALES, LOCALE_LABELS, type Locale } from '../../i18n';
import { useTranslation } from '../../i18n/useTranslation';
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
import type { SettingDefinition, SettingsCategory } from '@shared/types';
import { groupByInferredSubgroup } from './groupSettings';
import {
  SettingsAccordion,
  readAccordionState,
  writeAccordionState,
} from './SettingsAccordion';
import { AgentLimitsGroup } from './AgentLimitsGroup';
import { DesktopShellGroup } from './DesktopShellGroup';
import { KeyVaultPanel } from './KeyVaultPanel';
import { LicenseGroup } from './LicenseGroup';
import { ApiKeysTab } from './ApiKeysTab';
import { MembersTab } from './MembersTab';
import { DangerZonePanel } from './DangerZonePanel';
import {
  SETTINGS_SECTIONS,
  sectionForCategory,
  categoriesForSection,
  DANGER_CATEGORY_ID,
} from './settingsSections';
import { resolveDescription } from './settingDescriptions';
import {
  filterVisibleDefs,
  searchAllSettings,
  resolveUnimplemented,
  DEDICATED_CONTROL_KEYS,
  type SettingsSearchHit,
} from './visibleSettings';
import { useElementSize } from '../desk/useViewportSize';

type ThemeId = 'sunrise-warm' | 'amber-night' | 'cyberdeck-cold';

/* ─── Ф1.5 — анатомія пейна Налаштувань ────────────────────────────────
 *
 * Пейн живе у світі столів: закривається засобами стола, тож кнопки
 * «Назад на головну» не існує. Верстка ЧИТАЄ ВЛАСНИЙ КОНТЕЙНЕР
 * (useElementSize, як DialogueLayout): на широкому пейні — дві колонки
 * (розділи+підрозділи | вміст), на вузькій плитці — одна (чипи згори).
 *
 * ІА: 7 розділів (settingsSections.ts), категорії бекенда стали
 * підрозділами, жодна не зникла — тест settings-ia.test.ts обходить
 * реєстр бекенда і доводить покриття. Пошук — глобальний: по назві,
 * людському поясненню (settingDescriptions.ts) і ключу, з розділом
 * знахідки. Небезпечне (скидання) — окремий підрозділ зі зброюванням.
 *
 * Щільність: pointer-media, не глобальні 44px — компактні контроли на
 * миші, 44px на справжньому тачі (any-pointer: coarse, як DeskStrip).
 * Токени — тільки --ph-* з фолбеками.
 */

/** Вужче за це — «вузька» плитка: навігація стає чипами згори. */
const NARROW_W = 640;

/** Категорії, що існують лише на фронтенді (bespoke-панелі). */
const VIRTUAL_CATEGORIES: SettingsCategory[] = [
  { id: 'mobile', label: 'Телефон', icon: '', settings: [] },
  { id: 'desktop', label: 'Оболонка', icon: '', settings: [] },
  { id: 'polis_keys', label: 'Ключі Поліса', icon: '', settings: [] },
  { id: 'license', label: 'Ліцензія', icon: '', settings: [] },
  { id: 'api_keys', label: 'Ключі доступу', icon: '', settings: [] },
  { id: 'members', label: 'Учасники', icon: '', settings: [] },
  { id: DANGER_CATEGORY_ID, label: 'Небезпечна зона', icon: '', settings: [] },
];

/** Тач-детект: any-pointer, як у DeskStrip — тач-ноутбук теж рахується. */
function usePointerCoarse(): boolean {
  const [coarse, setCoarse] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(any-pointer: coarse)').matches
      : false
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia('(any-pointer: coarse)');
    const onChange = () => setCoarse(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return coarse;
}

export default function SettingsPanel() {
  const categories = useSettingsStore((s) => s.categories);
  const values = useSettingsStore((s) => s.values);
  const dirty = useSettingsStore((s) => s.dirty);
  const loaded = useSettingsStore((s) => s.loaded);
  const setCategories = useSettingsStore((s) => s.setCategories);
  const setValue = useSettingsStore((s) => s.setValue);
  const markClean = useSettingsStore((s) => s.markClean);
  const showAdvanced = useSettingsStore((s) => s.showAdvanced);
  const setShowAdvanced = useSettingsStore((s) => s.setShowAdvanced);
  const query = useSettingsStore((s) => s.query);
  const setQuery = useSettingsStore((s) => s.setQuery);

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

  const { ref, width } = useElementSize<HTMLDivElement>();
  const narrow = width > 0 && width < NARROW_W;
  const coarse = usePointerCoarse();
  /** Висота рядка навігації: тач — 44, миша — компактно. */
  const navRowH = coarse ? 44 : 28;
  /** Мінімум контролів у рядках (input/select/toggle). */
  const controlMin = coarse ? 44 : 32;

  const reload = useCallback(async () => {
    const data = await settingsApi.getAll();
    setCategories(data.categories);
    return data.categories;
  }, [setCategories]);

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: 'loading' });
    reload()
      .then(() => {
        if (cancelled) return;
        setStatus({ kind: 'idle' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus({
          kind: 'error',
          msg:
            err instanceof Error
              ? err.message
              : 'Не вдалося завантажити налаштування',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  /** Бекендові категорії + віртуальні, дедуп за id (бекенд перемагає). */
  const allCategories = useMemo<SettingsCategory[]>(() => {
    const merged = [...categories, ...VIRTUAL_CATEGORIES];
    const seen = new Set<string>();
    return merged.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }, [categories]);

  /** Перший наявний підрозділ у порядку ІА — стартова точка. */
  useEffect(() => {
    if (activeCategoryId || allCategories.length === 0) return;
    for (const section of SETTINGS_SECTIONS) {
      const present = categoriesForSection(section, allCategories);
      if (present.length > 0) {
        setActiveCategoryId(present[0].id);
        return;
      }
    }
    setActiveCategoryId(allCategories[0].id);
  }, [allCategories, activeCategoryId]);

  const activeCategory = useMemo(
    () => allCategories.find((c) => c.id === activeCategoryId),
    [allCategories, activeCategoryId]
  );
  const activeSection = useMemo(
    () => sectionForCategory(activeCategoryId),
    [activeCategoryId]
  );

  const dirtyKeys = useMemo(() => Array.from(dirty), [dirty]);

  /** Зберегти ВСІ незбережені ключі — пошук дозволяє правити крізь
   * категорії, тож збереження теж глобальне. */
  const handleSave = useCallback(async () => {
    if (dirtyKeys.length === 0) return;
    setStatus({ kind: 'saving' });
    try {
      const appliedPatch: Record<string, unknown> = {};
      for (const key of dirtyKeys) {
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
        msg: err instanceof Error ? err.message : 'Зберегти не вдалося',
      });
    }
  }, [dirtyKeys, values, markClean]);

  const searchHits = useMemo(
    () => searchAllSettings(allCategories, query),
    [allCategories, query]
  );
  const searching = query.trim().length > 0;

  const jumpToCategory = useCallback(
    (categoryId: string) => {
      setActiveCategoryId(categoryId);
      setQuery('');
    },
    [setQuery]
  );

  return (
    <div
      ref={ref}
      data-testid="settings-surface"
      data-narrow={narrow ? 'true' : undefined}
      style={
        {
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          minWidth: 0,
          background: 'var(--ph-color-surface, #fff)',
          color: 'var(--ph-color-ink, #1C1F23)',
          fontFamily: 'var(--ph-font-ui, system-ui)',
          '--set-control-min': `${controlMin}px`,
        } as React.CSSProperties
      }
    >
      {/* ── Легка шапка: пошук + експертний тумблер + збереження ────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--ph-space-2, 8px)',
          padding: 'var(--ph-space-2, 8px) var(--ph-space-3, 12px)',
          borderBottom:
            'var(--ph-stroke-thin, 1px) solid var(--ph-color-border, #D8D2C6)',
          flexShrink: 0,
        }}
      >
        <Search
          size={14}
          strokeWidth={1.75}
          aria-hidden
          style={{ color: 'var(--ph-color-ink-faint, #9A958B)', flexShrink: 0 }}
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Пошук: назва або пояснення…"
          aria-label="Пошук по всіх налаштуваннях"
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: controlMin,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--ph-color-ink, #1C1F23)',
            fontSize: 'var(--ph-type-caption-size, 12.5px)',
          }}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Очистити пошук"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: Math.max(20, navRowH - 8),
              height: Math.max(20, navRowH - 8),
              borderRadius: 'var(--ph-radius-pill, 999px)',
              border: 'none',
              background: 'var(--ph-color-glass, rgba(0,0,0,0.05))',
              color: 'var(--ph-color-ink-muted, #5A5F66)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <XIcon size={11} strokeWidth={1.75} />
          </button>
        )}

        {/* Тумблер експертних значень — з ПІДПИСАНИМ призначенням,
            а не безіменний перемикач у пошуковому рядку. */}
        <button
          type="button"
          role="switch"
          aria-checked={showAdvanced}
          onClick={() => setShowAdvanced(!showAdvanced)}
          title="Показати експертні налаштування: тонкі пороги й бюджети, які щодня не чіпають"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            minHeight: controlMin,
            padding: '0 var(--ph-space-2, 8px)',
            borderRadius: 'var(--ph-radius-s, 6px)',
            border: `var(--ph-stroke-thin, 1px) solid ${
              showAdvanced
                ? 'var(--ph-color-accent, #C77B21)'
                : 'var(--ph-color-border, #D8D2C6)'
            }`,
            background: showAdvanced
              ? 'color-mix(in srgb, var(--ph-color-accent, #C77B21) 12%, transparent)'
              : 'transparent',
            color: showAdvanced
              ? 'var(--ph-color-accent, #C77B21)'
              : 'var(--ph-color-ink-muted, #5A5F66)',
            cursor: 'pointer',
            fontSize: 'var(--ph-type-micro-size, 10.5px)',
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            flexShrink: 0,
          }}
        >
          Експертні
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 'var(--ph-radius-pill, 999px)',
              background: showAdvanced
                ? 'var(--ph-color-accent, #C77B21)'
                : 'var(--ph-color-border, #D8D2C6)',
            }}
          />
        </button>

        <StatusPill status={status} />

        <button
          type="button"
          onClick={handleSave}
          disabled={dirtyKeys.length === 0 || status.kind === 'saving'}
          style={{
            minHeight: controlMin,
            padding: '0 var(--ph-space-3, 12px)',
            borderRadius: 'var(--ph-radius-s, 6px)',
            border: 'none',
            background:
              dirtyKeys.length > 0
                ? 'var(--ph-color-accent, #C77B21)'
                : 'var(--ph-color-glass, rgba(0,0,0,0.05))',
            color:
              dirtyKeys.length > 0
                ? 'var(--ph-color-surface, #fff)'
                : 'var(--ph-color-ink-faint, #9A958B)',
            cursor: dirtyKeys.length > 0 ? 'pointer' : 'default',
            fontSize: 'var(--ph-type-caption-size, 12.5px)',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
          }}
        >
          {status.kind === 'saving' ? (
            <Loader2 size={13} strokeWidth={1.75} className="animate-spin" />
          ) : (
            <Save size={13} strokeWidth={1.75} />
          )}
          Зберегти
          {dirtyKeys.length > 0 && (
            <span
              className="tabular-nums"
              style={{
                fontSize: 'var(--ph-type-micro-size, 10.5px)',
                padding: '0 5px',
                borderRadius: 'var(--ph-radius-pill, 999px)',
                background: 'color-mix(in srgb, var(--ph-color-surface, #fff) 30%, transparent)',
              }}
            >
              {dirtyKeys.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Тіло: навігація + вміст, від контейнера ─────────────────── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: 'flex',
          flexDirection: narrow ? 'column' : 'row',
        }}
      >
        {!searching && (
          <SectionNav
            narrow={narrow}
            rowH={navRowH}
            allCategories={allCategories}
            activeCategoryId={activeCategoryId}
            activeSectionId={activeSection.id}
            onPick={setActiveCategoryId}
          />
        )}

        {/* Вміст (скрол лише тут) */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            overflowY: 'auto',
            padding: 'var(--ph-space-3, 12px)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--ph-space-2, 8px)',
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
                color: 'var(--ph-color-ink-muted, #5A5F66)',
              }}
            >
              <Loader2
                size={20}
                strokeWidth={1.5}
                className="animate-spin"
                style={{ color: 'var(--ph-color-accent, #C77B21)' }}
              />
              <span style={{ fontSize: 'var(--ph-type-caption-size, 12.5px)' }}>
                Завантаження…
              </span>
            </div>
          )}

          {status.kind === 'error' && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--ph-radius-m, 10px)',
                background:
                  'color-mix(in srgb, var(--ph-color-alert, #D93B26) 10%, transparent)',
                border:
                  'var(--ph-stroke-thin, 1px) solid color-mix(in srgb, var(--ph-color-alert, #D93B26) 40%, transparent)',
                color: 'var(--ph-color-alert, #D93B26)',
                fontSize: 'var(--ph-type-caption-size, 12.5px)',
              }}
            >
              {status.msg}
            </div>
          )}

          {loaded && searching && (
            <SearchResults
              hits={searchHits}
              query={query}
              values={values}
              dirty={dirty}
              onChange={setValue}
              onJump={jumpToCategory}
            />
          )}

          {loaded && !searching && activeCategory && (
            <>
              {/* Крихта місця: розділ › підрозділ — словами. */}
              <div
                style={{
                  fontSize: 'var(--ph-type-micro-size, 10.5px)',
                  fontWeight: 500,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: 'var(--ph-color-ink-faint, #9A958B)',
                }}
              >
                {activeSection.label} › {activeCategory.label}
              </div>

              <CategoryContent
                category={activeCategory}
                allCategories={allCategories}
                values={values}
                dirty={dirty}
                query={query}
                showAdvanced={showAdvanced}
                accordionState={accordionState}
                setAccordionState={setAccordionState}
                onChange={setValue}
                onAfterReset={reload}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Навігація розділів ────────────────────────────────────────────────
 *
 * Широкий пейн: ліва колонка, розділи словами, підрозділи активного
 * розділу — під ним (акордеон навігації). Вузька плитка: два ряди
 * горизонтальних чипів (розділи / підрозділи активного розділу).
 */
function SectionNav({
  narrow,
  rowH,
  allCategories,
  activeCategoryId,
  activeSectionId,
  onPick,
}: {
  narrow: boolean;
  rowH: number;
  allCategories: SettingsCategory[];
  activeCategoryId: string;
  activeSectionId: string;
  onPick: (categoryId: string) => void;
}) {
  const sectionsWithCats = useMemo(
    () =>
      SETTINGS_SECTIONS.map((section) => ({
        section,
        cats: categoriesForSection(section, allCategories),
      })).filter(({ cats }) => cats.length > 0),
    [allCategories]
  );

  if (narrow) {
    const active = sectionsWithCats.find(
      ({ section }) => section.id === activeSectionId
    );
    return (
      <nav
        aria-label="Розділи налаштувань"
        style={{
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: 'var(--ph-space-2, 8px) var(--ph-space-3, 12px) 4px',
          borderBottom:
            'var(--ph-stroke-thin, 1px) solid var(--ph-color-border, #D8D2C6)',
        }}
      >
        <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
          {sectionsWithCats.map(({ section, cats }) => (
            <NavChip
              key={section.id}
              label={section.label}
              active={section.id === activeSectionId}
              rowH={rowH}
              onClick={() => onPick(cats[0].id)}
            />
          ))}
        </div>
        {active && active.cats.length > 1 && (
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
            {active.cats.map((cat) => (
              <NavChip
                key={cat.id}
                label={cat.label}
                active={cat.id === activeCategoryId}
                subtle
                rowH={rowH}
                onClick={() => onPick(cat.id)}
              />
            ))}
          </div>
        )}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Розділи налаштувань"
      style={{
        width: 208,
        flexShrink: 0,
        overflowY: 'auto',
        padding: 'var(--ph-space-2, 8px)',
        borderRight:
          'var(--ph-stroke-thin, 1px) solid var(--ph-color-border, #D8D2C6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      {sectionsWithCats.map(({ section, cats }) => {
        const open = section.id === activeSectionId;
        return (
          <div key={section.id} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <button
              type="button"
              onClick={() => onPick(cats[0].id)}
              aria-expanded={open}
              title={section.blurb}
              style={{
                minHeight: rowH,
                display: 'flex',
                alignItems: 'center',
                padding: '0 var(--ph-space-2, 8px)',
                borderRadius: 'var(--ph-radius-s, 6px)',
                border: 'none',
                background: 'transparent',
                color: open
                  ? 'var(--ph-color-ink, #1C1F23)'
                  : 'var(--ph-color-ink-muted, #5A5F66)',
                cursor: 'pointer',
                fontSize: 'var(--ph-type-micro-size, 10.5px)',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                textAlign: 'left',
              }}
            >
              {section.label}
            </button>
            {open &&
              cats.map((cat) => {
                const active = cat.id === activeCategoryId;
                const danger = cat.id === DANGER_CATEGORY_ID;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => onPick(cat.id)}
                    aria-current={active ? 'true' : undefined}
                    style={{
                      minHeight: rowH,
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 var(--ph-space-2, 8px) 0 var(--ph-space-4, 16px)',
                      borderRadius: 'var(--ph-radius-s, 6px)',
                      border: 'none',
                      background: active
                        ? 'color-mix(in srgb, var(--ph-color-accent, #C77B21) 14%, transparent)'
                        : 'transparent',
                      color: danger
                        ? 'var(--ph-color-danger, #C7373D)'
                        : active
                          ? 'var(--ph-color-ink, #1C1F23)'
                          : 'var(--ph-color-ink-muted, #5A5F66)',
                      cursor: 'pointer',
                      fontSize: 'var(--ph-type-caption-size, 12.5px)',
                      fontWeight: active ? 600 : 400,
                      textAlign: 'left',
                    }}
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {cat.label}
                    </span>
                  </button>
                );
              })}
          </div>
        );
      })}
    </nav>
  );
}

function NavChip({
  label,
  active,
  subtle = false,
  rowH,
  onClick,
}: {
  label: string;
  active: boolean;
  subtle?: boolean;
  rowH: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      style={{
        minHeight: Math.max(rowH, subtle ? 24 : 28),
        padding: '0 var(--ph-space-3, 12px)',
        borderRadius: 'var(--ph-radius-pill, 999px)',
        border: `var(--ph-stroke-thin, 1px) solid ${
          active ? 'var(--ph-color-accent, #C77B21)' : 'var(--ph-color-border, #D8D2C6)'
        }`,
        background: active
          ? 'color-mix(in srgb, var(--ph-color-accent, #C77B21) 12%, transparent)'
          : 'transparent',
        color: active
          ? 'var(--ph-color-ink, #1C1F23)'
          : 'var(--ph-color-ink-muted, #5A5F66)',
        cursor: 'pointer',
        fontSize: subtle
          ? 'var(--ph-type-micro-size, 10.5px)'
          : 'var(--ph-type-caption-size, 12.5px)',
        fontWeight: active ? 600 : 400,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}

/* ─── Результати глобального пошуку ────────────────────────────────────── */

function SearchResults({
  hits,
  query,
  values,
  dirty,
  onChange,
  onJump,
}: {
  hits: SettingsSearchHit[];
  query: string;
  values: Record<string, unknown>;
  dirty: Set<string>;
  onChange: (key: string, v: unknown) => void;
  onJump: (categoryId: string) => void;
}) {
  if (hits.length === 0) {
    return (
      <div
        style={{
          padding: 'var(--ph-space-4, 16px)',
          color: 'var(--ph-color-ink-muted, #5A5F66)',
          fontSize: 'var(--ph-type-caption-size, 12.5px)',
        }}
      >
        Нічого не знайдено за «{query.trim()}». Пошук дивиться в назви,
        пояснення і ключі всіх розділів.
      </div>
    );
  }
  return (
    <>
      <div
        style={{
          fontSize: 'var(--ph-type-micro-size, 10.5px)',
          fontWeight: 500,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--ph-color-ink-faint, #9A958B)',
        }}
      >
        Знайдено: {hits.length}
      </div>
      {hits.map(({ def, category, section }) => (
        <div key={def.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button
            type="button"
            onClick={() => onJump(category.id)}
            title={`Відкрити ${section.label} › ${category.label}`}
            style={{
              alignSelf: 'flex-start',
              border: 'none',
              background: 'transparent',
              padding: 0,
              cursor: 'pointer',
              fontSize: 'var(--ph-type-micro-size, 10.5px)',
              color: 'var(--ph-color-accent, #C77B21)',
            }}
          >
            {section.label} › {category.label}
          </button>
          {def.key in DEDICATED_CONTROL_KEYS ? (
            /* Ключ із власним контролом: не редактор, а двері до нього. */
            <button
              type="button"
              onClick={() => onJump(category.id)}
              style={{
                textAlign: 'left',
                padding: 'var(--ph-space-2, 8px) var(--ph-space-3, 12px)',
                borderRadius: 'var(--ph-radius-m, 10px)',
                border:
                  'var(--ph-stroke-thin, 1px) solid var(--ph-color-border, #D8D2C6)',
                background: 'transparent',
                color: 'var(--ph-color-ink, #1C1F23)',
                cursor: 'pointer',
                fontSize: 'var(--ph-type-caption-size, 12.5px)',
              }}
            >
              {def.label} — налаштовується у «{category.label}»
            </button>
          ) : (
            <SettingRow
              def={def}
              value={values[def.key]}
              dirty={dirty.has(def.key)}
              onChange={(v) => onChange(def.key, v)}
            />
          )}
        </div>
      ))}
    </>
  );
}

/* ─── Вміст підрозділу (категорії) ─────────────────────────────────────── */

function CategoryContent({
  category,
  allCategories,
  values,
  dirty,
  query,
  showAdvanced,
  accordionState,
  setAccordionState,
  onChange,
  onAfterReset,
}: {
  category: SettingsCategory;
  allCategories: SettingsCategory[];
  values: Record<string, unknown>;
  dirty: Set<string>;
  query: string;
  showAdvanced: boolean;
  accordionState: Record<string, Record<string, boolean>>;
  setAccordionState: React.Dispatch<
    React.SetStateAction<Record<string, Record<string, boolean>>>
  >;
  onChange: (key: string, v: unknown) => void;
  onAfterReset: () => Promise<unknown>;
}) {
  /* Bespoke-панелі підрозділів. */
  if (category.id === DANGER_CATEGORY_ID) {
    return (
      <DangerZonePanel
        categories={allCategories.filter((c) => c.settings.length > 0)}
        onAfterReset={onAfterReset}
      />
    );
  }
  if (category.id === 'mobile') {
    // Симбіот стоїть НАД паруванням: спершу організм — що ПК може
    // попросити в телефона й що телефон каже про себе, — і лише потім
    // механіка приєднання.
    //
    // Панель загубилась при зшиванні гілок: труба симбіозу на бекенді
    // ціла на всю довжину, а голови в цьому дереві не було взагалі, тож
    // команду не мав хто надіслати. Повернуто з `phantom-os-agentsys`,
    // де вона й лишалась змонтованою.
    return (
      <>
        <SymbiotePanel />
        <div style={{ height: 12 }} />
        <MobilePairing />
      </>
    );
  }
  if (category.id === 'vault') return <VaultPanel />;
  if (category.id === 'desktop') return <DesktopShellGroup />;
  if (category.id === 'polis_keys') return <KeyVaultPanel />;
  if (category.id === 'license') return <LicenseGroup />;
  if (category.id === 'api_keys') return <ApiKeysTab />;
  if (category.id === 'members') return <MembersTab />;
  if (category.id === 'about') {
    return (
      <>
        <AboutSection />
        <div style={{ marginTop: 'var(--ph-space-4, 16px)' }}>
          <BackupRestoreCard />
        </div>
      </>
    );
  }

  const visible = filterVisibleDefs(category.settings, { query, showAdvanced });
  const groups = groupByInferredSubgroup(category.id, visible);
  const stateForCategory =
    accordionState[category.id] ??
    (() => {
      const stored = readAccordionState(category.id);
      if (stored) return stored;
      const seed: Record<string, boolean> = {};
      groups.forEach((g, idx) => {
        seed[g.bucket.id] = idx === 0;
      });
      return seed;
    })();

  const rows =
    groups.length <= 1
      ? groups[0]?.items.map((def) => (
          <SettingRow
            key={def.key}
            def={def}
            value={values[def.key]}
            dirty={dirty.has(def.key)}
            onChange={(v) => onChange(def.key, v)}
          />
        ))
      : groups.map((g) => {
          const open = stateForCategory[g.bucket.id] ?? false;
          const dirtyCount = g.items.filter((d) => dirty.has(d.key)).length;
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
                  [category.id]: nextForCategory,
                }));
                writeAccordionState(category.id, nextForCategory);
              }}
            >
              {g.items.map((def) => (
                <SettingRow
                  key={def.key}
                  def={def}
                  value={values[def.key]}
                  dirty={dirty.has(def.key)}
                  onChange={(v) => onChange(def.key, v)}
                />
              ))}
            </SettingsAccordion>
          );
        });

  return (
    <>
      {category.id === 'theme' && (
        <>
          <ThemePicker values={values} />
          <LanguagePicker />
        </>
      )}
      {category.id === 'ai' && <AIProviderDiagnostics />}
      {category.id === 'voice' && <NPUDiagnostics />}
      {category.id === 'agent' && <AgentLimitsGroup values={values} onChange={onChange} />}
      {(category.id === 'profile' || category.id === 'personality') && (
        <>
          <FamiliarControlSection />
          <ProfileManagementSection />
        </>
      )}
      {rows}
      {visible.length === 0 && category.settings.length > 0 && (
        <div
          style={{
            fontSize: 'var(--ph-type-caption-size, 12.5px)',
            color: 'var(--ph-color-ink-muted, #5A5F66)',
          }}
        >
          Усі значення цього підрозділу — експертні. Увімкни «Експертні»
          в шапці, щоб їх побачити.
        </div>
      )}
      {category.settings.length === 0 &&
        category.id !== 'theme' &&
        category.id !== 'profile' &&
        category.id !== 'personality' && (
          <div
            style={{
              fontSize: 'var(--ph-type-caption-size, 12.5px)',
              color: 'var(--ph-color-ink-muted, #5A5F66)',
              fontStyle: 'italic',
            }}
          >
            У цьому підрозділі поки нема налаштувань.
          </div>
        )}
    </>
  );
}

/* ─── Рядок налаштування ────────────────────────────────────────────────
 *
 * Чесність рядка: назва + людське пояснення видимі завжди (не тільки
 * в title). «Ще не діє» і «потребує перезапуску» — словом, не кольором.
 */
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
  const description = resolveDescription(def);
  // Прапорця бекенда самого по собі не досить: реєстр ховає власні
  // UNIMPLEMENTED_KEYS ще на сервері, тож `def.unimplemented` не приходив
  // ніколи — значок не мав ЖОДНОГО шляху зʼявитись. Причину дає той
  // самий розбір, що й сторож: фронтова мапа, далі прапорець.
  const deadReason = resolveUnimplemented(def);
  return (
    <div
      data-testid={`setting-row-${def.key}`}
      title={def.key}
      style={{
        padding: 'var(--ph-space-2, 8px) var(--ph-space-3, 12px)',
        borderRadius: 'var(--ph-radius-m, 10px)',
        background: 'var(--ph-color-surface-raised, #fff)',
        border: `var(--ph-stroke-thin, 1px) solid ${
          dirty
            ? 'color-mix(in srgb, var(--ph-color-accent, #C77B21) 45%, transparent)'
            : 'var(--ph-color-border, #D8D2C6)'
        }`,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--ph-space-3, 12px)',
        minHeight: 'var(--set-control-min, 36px)',
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontSize: 'var(--ph-type-caption-size, 12.5px)',
              fontWeight: 600,
              color: 'var(--ph-color-ink, #1C1F23)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {def.label}
          </span>
          {deadReason && (
            <span
              title={deadReason}
              style={{
                fontSize: 'var(--ph-type-micro-size, 10.5px)',
                padding: '0 5px',
                borderRadius: 'var(--ph-radius-s, 6px)',
                background:
                  'color-mix(in srgb, var(--ph-color-info, #2270C4) 14%, transparent)',
                color: 'var(--ph-color-info, #2270C4)',
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              ще не діє
            </span>
          )}
          {dirty && (
            <span
              style={{
                fontSize: 'var(--ph-type-micro-size, 10.5px)',
                padding: '0 5px',
                borderRadius: 'var(--ph-radius-s, 6px)',
                background:
                  'color-mix(in srgb, var(--ph-color-accent, #C77B21) 16%, transparent)',
                color: 'var(--ph-color-accent-warm, #A8541C)',
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              змінено
            </span>
          )}
        </div>
        {(description || def.requires_restart) && (
          <span
            style={{
              fontSize: 'var(--ph-type-micro-size, 10.5px)',
              lineHeight: 1.35,
              color: 'var(--ph-color-ink-muted, #5A5F66)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
            title={description}
          >
            {description}
            {def.requires_restart && (
              <span style={{ color: 'var(--ph-color-accent-warm, #A8541C)' }}>
                {description ? ' ' : ''}Потребує перезапуску.
              </span>
            )}
          </span>
        )}
      </div>
      <div style={{ flexShrink: 0, minWidth: 170, maxWidth: '45%' }}>
        <ValueEditor def={def} value={value} onChange={onChange} />
      </div>
    </div>
  );
}

/* ─── Редактор значення ─────────────────────────────────────────────────── */

/**
 * Реєстр кастомних редакторів: бекенд ставить `editor: "Name"` на
 * ключі, що заслуговують окремого віджета; невідоме імʼя чесно падає
 * в генеричний редактор за типом.
 */
const KEY_EDITORS: Record<
  string,
  React.ComponentType<{
    value: unknown;
    onChange: (v: unknown) => void;
    def: SettingDefinition;
  }>
> = {
  OllamaModelEditor: ({ value, onChange }) => (
    <OllamaModelEditor value={value} onChange={onChange} />
  ),
  HostPortEditor: ({ value, onChange }) => (
    <HostPortEditor value={value} onChange={onChange} />
  ),
  ChipInputEditor: ({ value, onChange }) => (
    <ChipInputEditor value={value} onChange={onChange} />
  ),
};

const FIELD_STYLE: React.CSSProperties = {
  minHeight: 'var(--set-control-min, 36px)',
  width: '100%',
  padding: '0 var(--ph-space-3, 12px)',
  borderRadius: 'var(--ph-radius-s, 6px)',
  color: 'var(--ph-color-ink, #1C1F23)',
  background: 'var(--ph-color-surface, #fff)',
  border: 'var(--ph-stroke-thin, 1px) solid var(--ph-color-border, #D8D2C6)',
  fontFamily: 'var(--ph-font-mono, monospace)',
  fontSize: 'var(--ph-type-caption-size, 12.5px)',
  outline: 'none',
};

function ValueEditor({
  def,
  value,
  onChange,
}: {
  def: SettingDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (def.editor && KEY_EDITORS[def.editor]) {
    const Editor = KEY_EDITORS[def.editor];
    return <Editor def={def} value={value} onChange={onChange} />;
  }

  if (def.type === 'boolean') {
    const on = !!value;
    // Хіт-зона — прозора кнопка (44 на тачі через --set-control-min);
    // видимий перемикач компактний, щоб читатись перемикачем.
    return (
      <button
        type="button"
        onClick={() => onChange(!on)}
        aria-pressed={on}
        style={{
          minHeight: 'var(--set-control-min, 36px)',
          minWidth: 'var(--set-control-min, 36px)',
          padding: 0,
          border: 'none',
          background: 'transparent',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          width: '100%',
          cursor: 'pointer',
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'relative',
            display: 'inline-block',
            width: 36,
            height: 20,
            borderRadius: 'var(--ph-radius-pill, 999px)',
            background: on
              ? 'var(--ph-color-accent, #C77B21)'
              : 'var(--ph-color-border, #D8D2C6)',
            transition:
              'background var(--ph-motion-base, 200ms) var(--ph-ease-standard, ease)',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              left: on ? 18 : 2,
              width: 16,
              height: 16,
              borderRadius: 'var(--ph-radius-pill, 999px)',
              background: 'var(--ph-color-surface, #fff)',
              boxShadow: 'var(--ph-shadow-1, 0 1px 2px rgba(0,0,0,0.25))',
              transition:
                'left var(--ph-motion-base, 200ms) var(--ph-ease-standard, ease)',
            }}
          />
        </span>
      </button>
    );
  }

  if (def.type === 'select' && def.options) {
    return (
      <select
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...FIELD_STYLE, fontFamily: 'var(--ph-font-ui, system-ui)' }}
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
        className="tabular-nums"
        style={FIELD_STYLE}
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
        style={FIELD_STYLE}
      />
    );
  }

  return (
    <input
      type="text"
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      style={FIELD_STYLE}
    />
  );
}

/* ─── Плитки вибору теми ────────────────────────────────────────────────── */

interface ThemePickerProps {
  values: Record<string, unknown>;
}

function ThemePicker({ values }: ThemePickerProps) {
  // Канонічний ключ активної теми — `ui_theme` (THEME_SETTING_KEY):
  // його реєструє config.py, читає bootstrap, персистить setTheme.
  const active: ThemeId =
    (values[THEME_SETTING_KEY] as ThemeId) ??
    ((document.documentElement.getAttribute('data-theme') as ThemeId) ||
      'sunrise-warm');

  const tiles: Array<{
    id: ThemeId;
    label: string;
    swatch: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'sunrise-warm',
      label: 'Sunrise',
      // Свотчі — це дані про палітру теми, не хром: лишаються літералами.
      swatch: 'linear-gradient(135deg,#fdf6e9 0%, #f4af25 50%, #fb923c 100%)',
      icon: <Sun size={14} strokeWidth={2} />,
    },
    {
      id: 'amber-night',
      label: 'Amber',
      swatch: 'linear-gradient(135deg,#221c10 0%, #b07a10 60%, #f4af25 100%)',
      icon: <Moon size={14} strokeWidth={2} />,
    },
    {
      id: 'cyberdeck-cold',
      label: 'Cyberdeck',
      swatch: 'linear-gradient(135deg,#020617 0%, #0891b2 60%, #22d3ee 100%)',
      icon: <Cog size={14} strokeWidth={2} />,
    },
  ];

  const handleSelect = (id: ThemeId) => {
    // setTheme — єдине джерело правди: DOM одразу, localStorage для
    // першого кадру, бекенд під `ui_theme`. Без окремого «Зберегти».
    void useSettingsStore.getState().setTheme(id);
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 'var(--ph-space-2, 8px)',
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
              minHeight: 'var(--set-control-min, 36px)',
              padding: '4px var(--ph-space-2, 8px)',
              borderRadius: 'var(--ph-radius-m, 10px)',
              background: 'var(--ph-color-surface-raised, #fff)',
              border: `var(--ph-stroke-bold, 2px) solid ${
                selected ? 'var(--ph-color-accent, #C77B21)' : 'var(--ph-color-border, #D8D2C6)'
              }`,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              textAlign: 'left',
            }}
          >
            <div
              aria-hidden
              style={{
                width: 26,
                height: 26,
                borderRadius: 'var(--ph-radius-s, 6px)',
                background: t.swatch,
                flexShrink: 0,
              }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: 'var(--ph-color-accent, #C77B21)',
                flex: 1,
                minWidth: 0,
              }}
            >
              {t.icon}
              <span
                style={{
                  fontSize: 'var(--ph-type-caption-size, 12.5px)',
                  fontWeight: 600,
                  color: 'var(--ph-color-ink, #1C1F23)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.label}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ─── Вибір мови ────────────────────────────────────────────────────────── */

function LanguagePicker() {
  const { t, locale } = useTranslation();
  const handleSelect = (next: Locale) => {
    void useSettingsStore.getState().setLanguage(next);
  };

  return (
    <div style={{ marginTop: 'var(--ph-space-3, 12px)' }}>
      <div
        style={{
          marginBottom: 6,
          fontSize: 'var(--ph-type-micro-size, 10.5px)',
          fontWeight: 500,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--ph-color-ink-muted, #5A5F66)',
        }}
      >
        {t('settings.language.label')}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit, minmax(120px, 1fr))`,
          gap: 'var(--ph-space-2, 8px)',
        }}
      >
        {LOCALES.map((id) => {
          const selected = locale === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleSelect(id)}
              aria-pressed={selected}
              lang={id}
              style={{
                minHeight: 'var(--set-control-min, 36px)',
                padding: '4px var(--ph-space-2, 8px)',
                borderRadius: 'var(--ph-radius-m, 10px)',
                background: 'var(--ph-color-surface-raised, #fff)',
                border: `var(--ph-stroke-bold, 2px) solid ${
                  selected
                    ? 'var(--ph-color-accent, #C77B21)'
                    : 'var(--ph-color-border, #D8D2C6)'
                }`,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                textAlign: 'left',
              }}
            >
              <Languages
                size={14}
                strokeWidth={2}
                aria-hidden
                style={{ color: 'var(--ph-color-accent, #C77B21)', flexShrink: 0 }}
              />
              <span
                style={{
                  fontSize: 'var(--ph-type-caption-size, 12.5px)',
                  fontWeight: 600,
                  color: 'var(--ph-color-ink, #1C1F23)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {LOCALE_LABELS[id]}
              </span>
            </button>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 'var(--ph-type-micro-size, 10.5px)',
          color: 'var(--ph-color-ink-faint, #9A958B)',
        }}
      >
        {t('settings.language.hint')}
      </div>
    </div>
  );
}

/* ─── Пігулка статусу ───────────────────────────────────────────────────── */

function StatusPill({
  status,
}: {
  status: { kind: string; msg?: string };
}) {
  if (status.kind === 'idle' || status.kind === 'loading') return null;
  const color =
    status.kind === 'saved'
      ? 'var(--ph-color-success, #1F9D62)'
      : status.kind === 'error'
        ? 'var(--ph-color-alert, #D93B26)'
        : 'var(--ph-color-accent, #C77B21)';
  const label =
    status.kind === 'saving'
      ? 'Зберігаю…'
      : status.kind === 'saved'
        ? 'Збережено'
        : status.kind === 'error'
          ? 'Помилка'
          : '';
  return (
    <span
      title={status.msg}
      style={{
        padding: '2px 8px',
        borderRadius: 'var(--ph-radius-pill, 999px)',
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
        border: `var(--ph-stroke-thin, 1px) solid ${color}`,
        fontSize: 'var(--ph-type-micro-size, 10.5px)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}

/* ─── Діагностика ШІ ────────────────────────────────────────────────────── */

function AIProviderDiagnostics() {
  const [state, setState] = useState<{
    running: null | 'ollama' | 'gemini' | 'reset';
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
            error: err instanceof Error ? err.message : 'Запит не вдався',
          },
        },
      }));
    }
  }, []);

  const runReset = useCallback(async () => {
    setState((s) => ({ ...s, running: 'reset' }));
    try {
      await aiApi.reset();
      setState({ running: null, result: { ollama: null, gemini: null } });
    } catch {
      setState((s) => ({ ...s, running: null }));
    }
  }, []);

  return (
    <div
      style={{
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        borderRadius: 'var(--ph-radius-m, 10px)',
        border: 'var(--ph-stroke-thin, 1px) solid var(--ph-color-border, #D8D2C6)',
        background: 'var(--ph-color-surface-raised, #fff)',
      }}
    >
      <span
        style={{
          fontSize: 'var(--ph-type-micro-size, 10.5px)',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--ph-color-ink-muted, #5A5F66)',
          marginRight: 4,
        }}
      >
        Звʼязок
      </span>
      <ProviderTestButton
        label="Тест Ollama"
        onClick={() => run('ollama')}
        busy={state.running === 'ollama'}
        result={state.result.ollama}
      />
      <ProviderTestButton
        label="Тест Gemini"
        onClick={() => run('gemini')}
        busy={state.running === 'gemini'}
        result={state.result.gemini}
      />
      <button
        type="button"
        onClick={runReset}
        disabled={state.running === 'reset'}
        style={{
          minHeight: 'var(--set-control-min, 36px)',
          padding: '0 12px',
          background: 'transparent',
          color: 'var(--ph-color-ink-muted, #5A5F66)',
          border: 'var(--ph-stroke-thin, 1px) solid var(--ph-color-border, #D8D2C6)',
          borderRadius: 'var(--ph-radius-pill, 999px)',
          fontSize: 'var(--ph-type-micro-size, 10.5px)',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          opacity: state.running === 'reset' ? 0.6 : 1,
          cursor: state.running === 'reset' ? 'default' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          marginLeft: 'auto',
        }}
      >
        {state.running === 'reset' ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <RotateCcw size={12} />
        )}
        Перезапустити ШІ
      </button>
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
      ? 'var(--ph-color-success, #1F9D62)'
      : tone === 'err'
        ? 'var(--ph-color-alert, #D93B26)'
        : 'var(--ph-color-accent, #C77B21)';
  const summary = result
    ? result.ok
      ? `Зʼєднано · ${result.latency_ms} мс`
      : `Провал: ${result.error ?? 'невідомо'}`
    : 'Не перевірено';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        style={{
          minHeight: 'var(--set-control-min, 36px)',
          padding: '0 12px',
          background: `color-mix(in srgb, ${color} 12%, transparent)`,
          color,
          border: `var(--ph-stroke-thin, 1px) solid color-mix(in srgb, ${color} 50%, transparent)`,
          borderRadius: 'var(--ph-radius-pill, 999px)',
          fontSize: 'var(--ph-type-caption-size, 12.5px)',
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
        style={{
          fontFamily: 'var(--ph-font-mono, monospace)',
          fontSize: 'var(--ph-type-micro-size, 10.5px)',
          color: 'var(--ph-color-ink-muted, #5A5F66)',
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
          setOfflineMessage('Ollama офлайн — впиши вручну');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setModels([]);
        setOfflineMessage('Ollama недосяжна — впиши вручну');
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
          ...FIELD_STYLE,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--ph-color-ink-muted, #5A5F66)',
        }}
      >
        <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
        Читаю моделі…
      </div>
    );
  }

  if (!showDropdown) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <input
          type="text"
          value={current}
          onChange={(e) => onChange(e.target.value)}
          placeholder="напр. llama3.2:3b"
          style={FIELD_STYLE}
        />
        <span
          style={{
            fontSize: 'var(--ph-type-micro-size, 10.5px)',
            color: 'var(--ph-color-accent-warm, #A8541C)',
          }}
        >
          {offlineMessage ?? 'Моделей нема — виконай `ollama pull <name>`'}
        </span>
      </div>
    );
  }

  const hasCurrent = models!.some((m) => m.name === current);
  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      style={FIELD_STYLE}
    >
      {!hasCurrent && current && (
        <option value={current}>{current} (не встановлена)</option>
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

/**
 * host:port редактор (`ai_ollama_host` тощо): валідація форми ДО
 * збереження, значення персиститься сирим рядком.
 */
function HostPortEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const current = String(value ?? '');
  const ok = useMemo(() => {
    const trimmed = current.trim();
    if (trimmed.length === 0) return true; // порожньо = типове
    if (/^https?:\/\/[^\s/]+(?:\/.*)?$/i.test(trimmed)) return true;
    if (/^[A-Za-z0-9_.-]+(?::\d{1,5})?$/.test(trimmed)) return true;
    return false;
  }, [current]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <input
        type="text"
        value={current}
        onChange={(e) => onChange(e.target.value)}
        placeholder="http://localhost:11434"
        spellCheck={false}
        style={{
          ...FIELD_STYLE,
          border: ok
            ? FIELD_STYLE.border
            : 'var(--ph-stroke-thin, 1px) solid var(--ph-color-alert, #D93B26)',
        }}
      />
      {!ok && (
        <span
          style={{
            fontSize: 'var(--ph-type-micro-size, 10.5px)',
            color: 'var(--ph-color-accent-warm, #A8541C)',
          }}
        >
          Очікується host[:port] або http(s)://host[:port]
        </span>
      )}
    </div>
  );
}

/**
 * Chip-input для list[str] (наприклад `security_trusted_proxies`):
 * кома/Enter творить чип, Backspace на порожньому знімає останній.
 */
function ChipInputEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const items = useMemo<string[]>(() => {
    if (Array.isArray(value)) {
      return value.map((v) => String(v).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  }, [value]);

  const [draft, setDraft] = useState('');

  const commit = (next: string[]) => onChange(next);

  const addToken = (raw: string) => {
    const token = raw.trim();
    if (!token) return;
    if (items.includes(token)) {
      setDraft('');
      return;
    }
    commit([...items, token]);
    setDraft('');
  };

  const removeAt = (idx: number) => {
    const next = items.slice();
    next.splice(idx, 1);
    commit(next);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        alignItems: 'center',
        minHeight: 'var(--set-control-min, 36px)',
        width: '100%',
        padding: '4px 8px',
        borderRadius: 'var(--ph-radius-s, 6px)',
        background: 'var(--ph-color-surface, #fff)',
        border: 'var(--ph-stroke-thin, 1px) solid var(--ph-color-border, #D8D2C6)',
      }}
    >
      {items.map((token, idx) => (
        <span
          key={`${token}-${idx}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 4px 2px 8px',
            borderRadius: 'var(--ph-radius-pill, 999px)',
            background:
              'color-mix(in srgb, var(--ph-color-accent, #C77B21) 16%, transparent)',
            color: 'var(--ph-color-accent-warm, #A8541C)',
            fontFamily: 'var(--ph-font-mono, monospace)',
            fontSize: 'var(--ph-type-micro-size, 10.5px)',
          }}
        >
          {token}
          <button
            type="button"
            onClick={() => removeAt(idx)}
            aria-label={`Видалити ${token}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              borderRadius: 'var(--ph-radius-pill, 999px)',
              border: 'none',
              background: 'var(--ph-color-glass, rgba(0,0,0,0.08))',
              color: 'var(--ph-color-accent-warm, #A8541C)',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <XIcon size={10} strokeWidth={2} />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => {
          const v = e.currentTarget.value;
          if (/[,\s]/.test(v)) {
            const parts = v.split(/[,\s]+/).filter(Boolean);
            for (const p of parts) addToken(p);
            return;
          }
          setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addToken(draft);
          } else if (e.key === 'Backspace' && draft === '' && items.length > 0) {
            removeAt(items.length - 1);
          }
        }}
        onBlur={() => addToken(draft)}
        placeholder={items.length === 0 ? 'додати запис…' : ''}
        spellCheck={false}
        style={{
          flex: '1 1 80px',
          minWidth: 80,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--ph-color-ink, #1C1F23)',
          fontFamily: 'var(--ph-font-mono, monospace)',
          fontSize: 'var(--ph-type-caption-size, 12.5px)',
          padding: '4px 2px',
        }}
      />
    </div>
  );
}

/* ─── Діагностика NPU ───────────────────────────────────────────────────── */

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
        error: err instanceof Error ? err.message : 'voice/status не відповів',
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
      summary = 'Провайдер активний, encoder на CPU (QNN session не піднявся)';
    } else if (status.npu_available) {
      tone = 'ok';
      summary = `Готовий · поточний engine: ${status.stt_engine}`;
    } else {
      tone = 'warn';
      summary = 'Bundle або EP плагін недоступні — впаде на faster-whisper';
    }
  } else if (state.loading) {
    summary = 'Перевіряю стан…';
  }

  const color =
    tone === 'ok'
      ? 'var(--ph-color-success, #1F9D62)'
      : tone === 'warn'
        ? 'var(--ph-color-accent-warm, #A8541C)'
        : tone === 'err'
          ? 'var(--ph-color-alert, #D93B26)'
          : tone === 'off'
            ? 'var(--ph-color-ink-faint, #9A958B)'
            : 'var(--ph-color-accent, #C77B21)';

  return (
    <details
      style={{
        padding: '6px 10px',
        borderRadius: 'var(--ph-radius-m, 10px)',
        border: 'var(--ph-stroke-thin, 1px) solid var(--ph-color-border, #D8D2C6)',
        background: 'var(--ph-color-surface-raised, #fff)',
      }}
    >
      <summary
        style={{
          listStyle: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 28,
          userSelect: 'none',
        }}
      >
        <Cpu
          size={13}
          strokeWidth={1.75}
          style={{ color: 'var(--ph-color-ink-faint, #9A958B)', flexShrink: 0 }}
        />
        <span
          style={{
            fontSize: 'var(--ph-type-micro-size, 10.5px)',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--ph-color-ink-muted, #5A5F66)',
            flexShrink: 0,
          }}
        >
          NPU · HTP
        </span>
        <span
          style={{
            padding: '1px 7px',
            borderRadius: 'var(--ph-radius-pill, 999px)',
            background: `color-mix(in srgb, ${color} 18%, transparent)`,
            color,
            border: `var(--ph-stroke-thin, 1px) solid color-mix(in srgb, ${color} 50%, transparent)`,
            fontSize: 'var(--ph-type-micro-size, 10.5px)',
            flexShrink: 0,
          }}
        >
          {tone === 'ok'
            ? 'OK'
            : tone === 'warn'
              ? 'Увага'
              : tone === 'err'
                ? 'Помилка'
                : tone === 'off'
                  ? 'Вимк.'
                  : '…'}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 'var(--ph-type-micro-size, 10.5px)',
            color: 'var(--ph-color-ink-muted, #5A5F66)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={summary}
        >
          {summary}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void refresh();
          }}
          disabled={state.loading}
          style={{
            minHeight: 24,
            padding: '0 8px',
            borderRadius: 'var(--ph-radius-pill, 999px)',
            background: 'transparent',
            color: 'var(--ph-color-ink-muted, #5A5F66)',
            border: 'var(--ph-stroke-thin, 1px) solid var(--ph-color-border, #D8D2C6)',
            fontSize: 'var(--ph-type-micro-size, 10.5px)',
            cursor: state.loading ? 'default' : 'pointer',
            opacity: state.loading ? 0.5 : 1,
            flexShrink: 0,
          }}
          title="Перечитати /voice/status"
        >
          {state.loading ? (
            <Loader2 size={10} strokeWidth={1.75} className="animate-spin" />
          ) : (
            'Оновити'
          )}
        </button>
      </summary>

      {status && (
        <div
          style={{
            marginTop: 8,
            display: 'grid',
            gridTemplateColumns: '110px 1fr',
            rowGap: 3,
            columnGap: 10,
            fontFamily: 'var(--ph-font-mono, monospace)',
            fontSize: 'var(--ph-type-micro-size, 10.5px)',
            color: 'var(--ph-color-ink-muted, #5A5F66)',
          }}
        >
          <span>Bundle</span>
          <span style={{ color: 'var(--ph-color-ink, #1C1F23)' }}>
            {status.npu_model_path || '—'}
          </span>
          <span>Compute</span>
          <span style={{ color: 'var(--ph-color-ink, #1C1F23)' }}>
            {status.npu_compute || '—'}
          </span>
          <span>Encoder · QNN</span>
          <span
            style={{
              color: status.npu_encoder_loaded
                ? 'var(--ph-color-success, #1F9D62)'
                : 'var(--ph-color-ink, #1C1F23)',
            }}
          >
            {status.npu_encoder_loaded ? 'завантажений' : 'не завантажений'}
          </span>
          <span>Providers</span>
          <span
            style={{
              color: 'var(--ph-color-ink, #1C1F23)',
              overflowWrap: 'anywhere',
            }}
          >
            {status.npu_providers || 'невідомо'}
          </span>
          <span>Активний engine</span>
          <span style={{ color: 'var(--ph-color-ink, #1C1F23)' }}>
            {status.stt_engine}
          </span>
        </div>
      )}
    </details>
  );
}

/* ─── Про систему ───────────────────────────────────────────────────────── */

function AboutSection() {
  return (
    <div
      style={{
        borderRadius: 'var(--ph-radius-m, 10px)',
        border: 'var(--ph-stroke-thin, 1px) solid var(--ph-color-border, #D8D2C6)',
        background: 'var(--ph-color-surface-raised, #fff)',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span
          style={{
            fontSize: 'var(--ph-type-body-size, 15px)',
            fontWeight: 700,
            color: 'var(--ph-color-ink, #1C1F23)',
            letterSpacing: '-0.01em',
          }}
        >
          PHANTOM OS
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 'var(--ph-type-micro-size, 10.5px)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--ph-color-ink-faint, #9A958B)',
          }}
        >
          Десктоп · ESP32 опційно
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '70px 1fr',
          rowGap: 3,
          columnGap: 10,
          fontFamily: 'var(--ph-font-mono, monospace)',
          fontSize: 'var(--ph-type-micro-size, 10.5px)',
          color: 'var(--ph-color-ink-muted, #5A5F66)',
        }}
      >
        <span>Frontend</span>
        <span style={{ color: 'var(--ph-color-ink, #1C1F23)' }}>
          React 18 · Vite 5 · Tailwind 3
        </span>
        <span>Backend</span>
        <span style={{ color: 'var(--ph-color-ink, #1C1F23)' }}>
          FastAPI · SQLite · ChromaDB
        </span>
        <span>AI</span>
        <span style={{ color: 'var(--ph-color-ink, #1C1F23)' }}>
          Gemini router → Ollama fallback
        </span>
        <span>Voice</span>
        <span style={{ color: 'var(--ph-color-ink, #1C1F23)' }}>
          Whisper / Vosk / NPU STT · Piper TTS
        </span>
      </div>
    </div>
  );
}

/* ─── Familiar (Phase-5 R1-FAMILIAR-1) ──────────────────────────────────
 *
 * Вбудований у Профіль/Характер. Рідкість переживає перезавантаження
 * через localStorage — чисто фронтендна фіча, бекендового ключа нема.
 */

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

  useEffect(() => {
    const stored = loadFamiliarRarity();
    if (stored !== rarity) setRarity(stored);
    // Run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options: Array<{ id: FamiliarRarity; label: string; blurb: string }> = [
    { id: 'off', label: 'Вимк.', blurb: 'Familiar спить.' },
    { id: 'rare', label: 'Рідко', blurb: '~1 із 8 спроб.' },
    { id: 'normal', label: 'Звичайно', blurb: '~1 із 3 спроб.' },
    { id: 'often', label: 'Часто', blurb: '~2 із 3 спроб.' },
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
      style={{
        padding: '8px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderRadius: 'var(--ph-radius-m, 10px)',
        border: 'var(--ph-stroke-thin, 1px) solid var(--ph-color-border, #D8D2C6)',
        background: 'var(--ph-color-surface-raised, #fff)',
        flexWrap: 'wrap',
      }}
      data-testid="familiar-control"
    >
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: 'var(--ph-radius-pill, 999px)',
          background:
            'radial-gradient(circle at 30% 30%, var(--ph-color-surface, #fff), var(--ph-color-accent, #C77B21) 70%)',
          flexShrink: 0,
        }}
      />
      <span
        title="Маленький вогник, що зрідка зʼявляється, показує на речі й махає."
        style={{
          fontSize: 'var(--ph-type-micro-size, 10.5px)',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--ph-color-ink-muted, #5A5F66)',
          flexShrink: 0,
        }}
      >
        Familiar
      </span>

      <div
        role="group"
        aria-label="Частота появи Familiar"
        style={{
          display: 'inline-flex',
          alignItems: 'stretch',
          padding: 2,
          borderRadius: 'var(--ph-radius-pill, 999px)',
          background: 'var(--ph-color-glass, rgba(0,0,0,0.05))',
          border: 'var(--ph-stroke-thin, 1px) solid var(--ph-color-border, #D8D2C6)',
          gap: 2,
        }}
      >
        {options.map((opt) => {
          const selected = opt.id === rarity;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleSelect(opt.id)}
              aria-pressed={selected}
              title={opt.blurb}
              style={{
                minHeight: 'var(--ph-control-min, 28px)',
                padding: '0 10px',
                borderRadius: 'var(--ph-radius-pill, 999px)',
                border: 'none',
                background: selected
                  ? 'var(--ph-color-accent, #C77B21)'
                  : 'transparent',
                color: selected
                  ? 'var(--ph-color-surface, #fff)'
                  : 'var(--ph-color-ink-muted, #5A5F66)',
                cursor: 'pointer',
                fontSize: 'var(--ph-type-micro-size, 10.5px)',
                fontWeight: selected ? 700 : 500,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <span style={{ flex: 1, minWidth: 8 }} />

      <button
        type="button"
        onClick={handleTestSummon}
        style={{
          minHeight: 'var(--ph-control-min, 28px)',
          padding: '0 12px',
          borderRadius: 'var(--ph-radius-pill, 999px)',
          background: 'transparent',
          color: 'var(--ph-color-accent-warm, #A8541C)',
          border:
            'var(--ph-stroke-thin, 1px) solid color-mix(in srgb, var(--ph-color-accent, #C77B21) 55%, transparent)',
          cursor: 'pointer',
          fontSize: 'var(--ph-type-micro-size, 10.5px)',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
        title="Прикликати Familiar примусово (повз рідкість)"
      >
        Прикликати
      </button>
    </div>
  );
}
