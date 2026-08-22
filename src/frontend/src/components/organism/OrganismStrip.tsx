/**
 * OrganismStrip — тонка (30px) верхня смуга РЕАЛЬНИХ пульсів організму
 * (Ф1 майстерплану, §3 «Що рухається на склі»).
 *
 * Зліва направо: ідентичність вузла (порт — доказ адресата, завжди
 * видимий), СЛОВО СТАНУ машини (головний елемент; клік — тихе меню з
 * єдиним пунктом «Привид»), канал WS, ядро (/health), ресурси
 * (/linux/resources, лише з правами), праворуч — годинник.
 *
 * Доктрина: жодного вигаданого числа. Джерело, що не відповідало
 * ніколи, — «мовчить» сірим; джерело, що замовкло після виміру, —
 * останній вимір З маркером віку (свіжість — окремий маркер, не
 * перефарбовування). Нічого «припущеного» у стрічці не існує.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SystemState } from '@shared/types';
import { useSystemStore } from '../../stores/systemStore';
import {
  formatAge,
  formatClock,
  formatGiB,
  formatUptime,
  useClock,
  useHealthPulse,
  useNodeIdentity,
  useResourcesPulse,
  useWsPulse,
} from './pulses';

/* ─── Токени (--ph-* з fallback на старі змінні) ─────────────────────── */

const INK = 'var(--ph-color-ink, var(--text-strong, #1C1F23))';
const MUTED = 'var(--ph-color-ink-muted, var(--text-soft, #5A5F66))';
const FAINT = 'var(--ph-color-ink-faint, #9A958B)';
const ALERT = 'var(--ph-color-alert, var(--coral, #D93B26))';
const SUCCESS = 'var(--ph-color-success, #1F9D62)';
const ACCENT = 'var(--ph-color-accent, var(--primary, #C77B21))';
const SURFACE = 'var(--ph-color-surface, var(--surface-base, #f8f7f5))';
const RAISED = 'var(--ph-color-surface-raised, var(--surface-raised, #fdf6e9))';
const BORDER = 'var(--ph-color-border, var(--glass-border, rgba(0,0,0,0.14)))';
const FONT_UI = 'var(--ph-font-ui, system-ui, sans-serif)';
const FONT_MONO = 'var(--ph-font-mono, ui-monospace, monospace)';

export const ORGANISM_STRIP_HEIGHT = 30;

/* ─── Слово стану (канон міток — як у core/StatusBar) ────────────────── */

const STATE_WORDS: Record<SystemState, string> = {
  [SystemState.SHADOW]: 'Тінь',
  [SystemState.FOCUS]: 'Фокус',
  [SystemState.DIALOGUE]: 'Діалог',
  [SystemState.SENTINEL]: 'Вартовий',
  [SystemState.GHOST]: 'Привид',
  [SystemState.DREAM]: 'Сон',
  [SystemState.OPERATOR]: 'Оператор',
};

function stateColor(state: SystemState): string {
  if (state === SystemState.SENTINEL || state === SystemState.GHOST) return ALERT;
  if (state === SystemState.OPERATOR) return SUCCESS;
  return ACCENT;
}

/* ─── Атоми подання ───────────────────────────────────────────────────── */

function Word({ children }: { children: string }) {
  return (
    <span style={{ color: MUTED, fontFamily: FONT_UI, marginRight: 5 }}>
      {children}
    </span>
  );
}

function Value({ children, tone = INK }: { children: string; tone?: string }) {
  return (
    <span
      style={{
        color: tone,
        fontFamily: FONT_MONO,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {children}
    </span>
  );
}

function Silent() {
  return <span style={{ color: FAINT, fontFamily: FONT_UI }}>мовчить</span>;
}

/** Маркер віку — показується лише коли джерело зараз мовчить. */
function Age({ ageS }: { ageS: number }) {
  return (
    <span
      style={{ color: FAINT, fontFamily: FONT_MONO, marginLeft: 4 }}
      title="вік останнього виміру"
    >
      ·{formatAge(ageS)}
    </span>
  );
}

function Pulse({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

/* ─── Слово стану + тихе меню «Привид» ───────────────────────────────── */

function StateWord() {
  const state = useSystemStore((s) => s.state);
  const setState = useSystemStore((s) => s.setState);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const goGhost = useCallback(() => {
    setOpen(false);
    if (state === SystemState.GHOST) return;
    // Наявний перехід стану: setState з auto:false шле contextApi.setState
    // на бекенд — той самий шлях, що й у решти ручних переходів UI.
    setState(SystemState.GHOST, {
      trigger: 'organism-strip',
      timestamp: Date.now(),
      auto: false,
    });
  }, [state, setState]);

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Стан машини: ${STATE_WORDS[state]}`}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: stateColor(state),
          fontFamily: 'var(--ph-font-display, var(--ph-font-ui, system-ui, sans-serif))',
          fontSize: 'inherit',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        {STATE_WORDS[state]}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            zIndex: 60,
            background: RAISED,
            border: `1px solid ${BORDER}`,
            borderRadius: 'var(--ph-radius-s, 6px)',
            boxShadow: 'var(--ph-shadow-2, 0 4px 12px rgba(0,0,0,0.3))',
            padding: 2,
            minWidth: 96,
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={goGhost}
            disabled={state === SystemState.GHOST}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              borderRadius: 'var(--ph-radius-s, 6px)',
              padding: '5px 10px',
              cursor: state === SystemState.GHOST ? 'default' : 'pointer',
              color: state === SystemState.GHOST ? FAINT : INK,
              fontFamily: FONT_UI,
              fontSize: 'inherit',
            }}
          >
            Привид
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Стрічка ─────────────────────────────────────────────────────────── */

export function OrganismStrip() {
  const identity = useNodeIdentity();
  const health = useHealthPulse();
  const resources = useResourcesPulse();
  const wsConnected = useWsPulse();
  const now = useClock();

  const h = health.data;
  const r = resources.data;

  return (
    <div
      style={{
        height: ORGANISM_STRIP_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--ph-space-4, 16px)',
        padding: '0 var(--ph-space-3, 12px)',
        background: SURFACE,
        borderBottom: `var(--ph-stroke-thin, 1px) solid ${BORDER}`,
        fontSize: 'var(--ph-type-caption-size, 12.5px)',
        lineHeight: 1,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      {/* Ідентичність вузла — доказ адресата видимий завжди. */}
      <Pulse>
        <Word>вузол</Word>
        {identity.port !== null || identity.manifest ? (
          <Value>
            {[
              identity.port !== null ? `:${identity.port}` : null,
              identity.manifest ? identity.manifest.name : null,
            ]
              .filter(Boolean)
              .join(' ')}
          </Value>
        ) : (
          <Silent />
        )}
      </Pulse>

      {/* Слово стану машини — головний елемент після ідентичності. */}
      <StateWord />

      {/* Власний WS-канал фронтенда. */}
      <Pulse>
        <Word>канал</Word>
        <Value tone={wsConnected ? INK : ALERT}>{wsConnected ? 'живий' : 'обрив'}</Value>
      </Pulse>

      {/* Ядро: /health кожні 5 с. */}
      <Pulse>
        <Word>ядро</Word>
        {h ? (
          <>
            <Value tone={h.status === 'ok' ? INK : ALERT}>
              {`v${h.version} · кл ${h.ws_clients} · ШІ ${h.ai_active}→${h.ai_fallback}`}
            </Value>
            {health.silent && health.ageS !== null && <Age ageS={health.ageS} />}
          </>
        ) : (
          <Silent />
        )}
      </Pulse>

      {/* Ресурси: реальні лише з operator-правами; інакше — мовчить. */}
      <Pulse>
        <Word>ресурси</Word>
        {r ? (
          <>
            <Value>
              {`CPU ${Math.round(r.cpu_percent)}% · RAM ${formatGiB(r.ram_used)}/${formatGiB(
                r.ram_total,
              )}Г · диск ${formatGiB(r.disk_used)}/${formatGiB(r.disk_total)}Г · ап ${formatUptime(
                r.uptime_s,
              )}`}
            </Value>
            {resources.silent && resources.ageS !== null && <Age ageS={resources.ageS} />}
          </>
        ) : (
          <Silent />
        )}
      </Pulse>

      <div style={{ flex: 1 }} />

      {/* Годинник. */}
      <Value>{formatClock(now)}</Value>
    </div>
  );
}

export default OrganismStrip;
