/**
 * CommandBar — командна палітра Ctrl+K (Ф1 майстерплану).
 *
 * Виглядом — інструмент, не вітрина: площина surface-raised, тонка
 * межа, моноширинні цифри, нуль декору. Розділи в жорсткому порядку
 * Столи → Перейти → Дії; список будується з живого стану сторів на
 * кожне відкриття; нечіткий пошук по назвах і ключових словах.
 *
 * Клавіатура: Ctrl/Cmd+K — відкрити/закрити, ↑↓ — вибір, Enter —
 * виконати, Esc — закрити. Хоткеї пунктів показуються лише реальні;
 * сьогодні глобальних хоткеїв навігації нема — колонка порожня.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PaneKind } from '../../stores/deskStore';
import { buildCommands, SECTION_ORDER, type CommandItem } from './commands';
import { fuzzyBest, fuzzyMatch } from './fuzzy';

/* ─── Токени (--ph-* з fallback на старі змінні) ─────────────────────── */

const INK = 'var(--ph-color-ink, var(--text-strong, #1C1F23))';
const MUTED = 'var(--ph-color-ink-muted, var(--text-soft, #5A5F66))';
const FAINT = 'var(--ph-color-ink-faint, #9A958B)';
const ACCENT = 'var(--ph-color-accent, var(--primary, #C77B21))';
const RAISED = 'var(--ph-color-surface-raised, var(--surface-raised, #fdf6e9))';
const BORDER = 'var(--ph-color-border, var(--glass-border, rgba(0,0,0,0.14)))';
const SCRIM = 'var(--ph-color-scrim, rgba(20,24,28,0.35))';
const FONT_UI = 'var(--ph-font-ui, system-ui, sans-serif)';
const FONT_MONO = 'var(--ph-font-mono, ui-monospace, monospace)';

export interface CommandBarProps {
  /**
   * Перевизначення навігації «Перейти» для двигуна столів; без нього —
   * дефолт deskStore.openPane(kind).
   */
  onNavigate?: (kind: PaneKind) => void;
  /** Вимкнути глобальний слухач Ctrl+K (для тестів/кастомного тригера). */
  disableHotkey?: boolean;
}

interface ScoredItem {
  item: CommandItem;
  score: number;
  indices: number[];
}

function filterCommands(items: CommandItem[], query: string): ScoredItem[] {
  const q = query.trim();
  const scored: ScoredItem[] = [];
  for (const item of items) {
    const m = q
      ? fuzzyBest(q, item.title, item.keywords ?? [])
      : fuzzyMatch('', item.title);
    if (m) scored.push({ item, score: m.score, indices: m.indices });
  }
  if (q) scored.sort((a, b) => b.score - a.score);
  return scored;
}

/** Групування відфільтрованого у порядку розділів; плаский індекс наскрізний. */
function groupBySection(scored: ScoredItem[]): Array<{ section: string; items: ScoredItem[] }> {
  return SECTION_ORDER.map((section) => ({
    section,
    items: scored.filter((s) => s.item.section === section),
  })).filter((g) => g.items.length > 0);
}

function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const set = new Set(indices);
  return (
    <>
      {text.split('').map((ch, i) =>
        set.has(i) ? (
          <span key={i} style={{ color: ACCENT }}>
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}

export function CommandBar({ onNavigate, disableHotkey }: CommandBarProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setCursor(0);
  }, []);

  /* Глобальний Ctrl/Cmd+K. */
  useEffect(() => {
    if (disableHotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((v) => {
          if (v) {
            setQuery('');
            setCursor(0);
          }
          return !v;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disableHotkey]);

  /* Живий список — з поточного стану сторів на кожен рендер відкритої палітри. */
  const scored = useMemo(
    () => (open ? filterCommands(buildCommands({ onNavigate, close }), query) : []),
    // buildCommands читає стори через getState — залежність від open/query достатня.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, query, onNavigate, close],
  );
  const groups = useMemo(() => groupBySection(scored), [scored]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (cursor >= flat.length) setCursor(Math.max(0, flat.length - 1));
  }, [flat.length, cursor]);

  /* Тримати вибране в полі зору. */
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-cursor="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(0, flat.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      flat[cursor]?.item.run();
    }
  };

  if (!open) return null;

  let flatIndex = -1;

  return (
    <div
      role="dialog"
      aria-label="Командний рядок"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: SCRIM,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '14vh',
      }}
    >
      <div
        style={{
          width: 'min(560px, 92vw)',
          maxHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          background: RAISED,
          border: `var(--ph-stroke-thin, 1px) solid ${BORDER}`,
          borderRadius: 'var(--ph-radius-m, 10px)',
          boxShadow: 'var(--ph-shadow-3, 0 12px 32px rgba(0,0,0,0.38))',
          overflow: 'hidden',
          fontFamily: FONT_UI,
          fontSize: 'var(--ph-type-body-size, 15px)',
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onInputKey}
          placeholder="Команда, стіл або пейн…"
          aria-label="Пошук команди"
          style={{
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: INK,
            padding: 'var(--ph-space-3, 12px) var(--ph-space-4, 16px)',
            fontFamily: FONT_UI,
            fontSize: 'inherit',
            borderBottom: `var(--ph-stroke-thin, 1px) solid ${BORDER}`,
          }}
        />

        <div ref={listRef} style={{ overflowY: 'auto', padding: 'var(--ph-space-1, 4px) 0' }}>
          {flat.length === 0 && (
            <div style={{ padding: 'var(--ph-space-4, 16px)', color: FAINT }}>
              нічого не знайдено
            </div>
          )}
          {groups.map((g) => (
            <div key={g.section}>
              <div
                style={{
                  padding: '6px var(--ph-space-4, 16px) 2px',
                  color: FAINT,
                  fontSize: 'var(--ph-type-micro-size, 10.5px)',
                  fontWeight: 500,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                {g.section}
              </div>
              {g.items.map((s) => {
                flatIndex += 1;
                const idx = flatIndex;
                const active = idx === cursor;
                return (
                  <button
                    key={s.item.id}
                    type="button"
                    data-cursor={active ? 'true' : undefined}
                    onMouseEnter={() => setCursor(idx)}
                    onClick={() => s.item.run()}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 8,
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      cursor: 'pointer',
                      background: active ? SCRIM : 'transparent',
                      color: INK,
                      padding: '7px var(--ph-space-4, 16px)',
                      fontFamily: FONT_UI,
                      fontSize: 'inherit',
                    }}
                  >
                    <span style={{ flex: 'none' }}>
                      <Highlighted text={s.item.title} indices={s.indices} />
                    </span>
                    {s.item.hint && (
                      <span style={{ color: FAINT, fontSize: 'var(--ph-type-caption-size, 12.5px)' }}>
                        {s.item.hint}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    {s.item.hotkey && (
                      <span
                        style={{
                          color: MUTED,
                          fontFamily: FONT_MONO,
                          fontVariantNumeric: 'tabular-nums',
                          fontSize: 'var(--ph-type-caption-size, 12.5px)',
                        }}
                      >
                        {s.item.hotkey}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 'var(--ph-space-4, 16px)',
            padding: '6px var(--ph-space-4, 16px)',
            borderTop: `var(--ph-stroke-thin, 1px) solid ${BORDER}`,
            color: FAINT,
            fontFamily: FONT_MONO,
            fontSize: 'var(--ph-type-micro-size, 10.5px)',
          }}
        >
          <span>↑↓ вибір</span>
          <span>Enter виконати</span>
          <span>Esc закрити</span>
          <span style={{ flex: 1 }} />
          <span>Ctrl+K</span>
        </div>
      </div>
    </div>
  );
}

export default CommandBar;
