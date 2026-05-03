/**
 * Phase-5 R1 Task C — ToolsOverlay.
 *
 * Top-level full-frame overlay reachable from the FloatingToolbar's
 * "Tools" action. Hosts the conversational tool managers that don't
 * fit the chat-scene inline cards (e.g. multi-row CRUD: timers list,
 * alarms list, calendar). Each tool gets its own tab; the active tab
 * lives in local UI state for now (operator never deep-links into a
 * specific tab — they always come in via the toolbar).
 *
 * Closing the overlay reverts to whatever layout was active before.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TimerManager } from './TimerManager';
import { AlarmManager } from './AlarmManager';
import { CalendarManager } from '../calendar/CalendarManager';
import { FileBrowser } from '../files/FileBrowser';

type ToolsTab = 'timer' | 'alarm' | 'calendar' | 'files';

const TABS: Array<{ id: ToolsTab; label: string; icon: string; ready: boolean }> = [
  { id: 'timer', label: 'Таймери', icon: 'timer', ready: true },
  { id: 'alarm', label: 'Будильники', icon: 'alarm', ready: true },
  { id: 'calendar', label: 'Календар', icon: 'event', ready: true },
  { id: 'files', label: 'Файли', icon: 'folder', ready: true },
];

export interface ToolsOverlayProps {
  open: boolean;
  initialTab?: ToolsTab;
  onClose: () => void;
}

export function ToolsOverlay({ open, initialTab = 'timer', onClose }: ToolsOverlayProps) {
  const [tab, setTab] = useState<ToolsTab>(initialTab);

  // Phase 22 — when the overlay re-opens with a new initialTab (e.g. the
  // operator tapped the Calendar tile in the Apps grid), jump straight to
  // that tab instead of showing whichever one was last visited.
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0"
          style={{
            zIndex: 60,
            background: 'rgba(26,22,18,0.55)',
            backdropFilter: 'blur(10px)',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            className="glass-strong"
            style={{
              position: 'absolute',
              top: 24,
              left: 24,
              right: 24,
              bottom: 24,
              borderRadius: 20,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              boxShadow: '0 24px 60px rgba(120,70,10,0.32), 0 0 0 1px var(--glass-border)',
            }}
            initial={{ scale: 0.97, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 8 }}
            transition={{ duration: 0.22 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Tools"
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="eyebrow-amber">ІНСТРУМЕНТИ</span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрити"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'rgba(0,0,0,0.04)',
                  border: '1px solid rgba(0,0,0,0.06)',
                  color: 'var(--ink-muted)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span className="msym" aria-hidden style={{ fontSize: 18 }}>close</span>
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => t.ready && setTab(t.id)}
                  disabled={!t.ready}
                  aria-pressed={tab === t.id}
                  style={{
                    padding: '8px 14px',
                    minHeight: 44,
                    borderRadius: 12,
                    border: tab === t.id
                      ? '1px solid rgba(244,175,37,0.55)'
                      : '1px solid rgba(0,0,0,0.06)',
                    background: tab === t.id
                      ? 'linear-gradient(135deg, rgba(244,175,37,0.18), rgba(251,146,60,0.14))'
                      : t.ready
                        ? 'rgba(255,255,255,0.55)'
                        : 'rgba(0,0,0,0.03)',
                    color: !t.ready
                      ? 'var(--ink-muted)'
                      : tab === t.id
                        ? '#8a5e0a'
                        : 'var(--ink-secondary)',
                    fontFamily: 'var(--font-display)',
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    cursor: t.ready ? 'pointer' : 'not-allowed',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    opacity: t.ready ? 1 : 0.45,
                  }}
                  title={t.ready ? t.label : `${t.label} — coming next phase`}
                >
                  <span className="msym" aria-hidden style={{ fontSize: 18 }}>{t.icon}</span>
                  {t.label}
                  {!t.ready && (
                    <span
                      className="micro-label"
                      style={{ fontSize: 8, marginLeft: 4, color: 'var(--ink-muted)' }}
                    >
                      SOON
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {tab === 'timer' && <TimerManager />}
              {tab === 'alarm' && <AlarmManager />}
              {tab === 'calendar' && <CalendarManager />}
              {tab === 'files' && <FileBrowser />}
              {false && (
                <div
                  className="playfair"
                  style={{
                    padding: 32,
                    textAlign: 'center',
                    color: 'var(--ink-muted)',
                    fontStyle: 'italic',
                    fontSize: 14,
                  }}
                >
                  Цей інструмент чекає на свою чергу в плані —{' '}
                  <code style={{ fontStyle: 'normal' }}>docs/PHASE_5_FEATURE_COMPLETION.md</code>.
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
