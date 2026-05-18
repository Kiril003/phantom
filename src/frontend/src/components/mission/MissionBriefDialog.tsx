/**
 * MissionBriefDialog — operator fills in a mission brief before PHANTOM
 * dispatches the long-horizon planner.
 *
 * Opened when the HUD is in [Mission] mode and the operator presses RUN.
 * Closed on success (opens MissionDetailScreen) or on Cancel.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { useAgentStore } from '../../stores/agentStore';
import { useUIStore } from '../../stores/uiStore';
import { useMissionStore } from '../../stores/missionStore';
import type { MissionBrief, BudgetConstraints } from '@shared/types/mission';

interface Props {
  initialBrief?: string;
  onSuccess: (missionId: string) => void;
  onClose: () => void;
}

export function MissionBriefDialog({ initialBrief, onSuccess, onClose }: Props) {
  const unsafeModeIntent = useAgentStore((s) => s.unsafeModeIntent);
  const startMission = useMissionStore((s) => s.startMission);
  const uiBrief = useUIStore((s) => s.missionBriefObjective);

  const [brief, setBrief] = useState(initialBrief ?? uiBrief);
  const [qualityBar, setQualityBar] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [maxUsd, setMaxUsd] = useState('');
  const [maxWallHours, setMaxWallHours] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [unsafeMode, setUnsafeMode] = useState(unsafeModeIntent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRun = brief.trim().length > 0 && !busy;

  const handleRun = async () => {
    if (!canRun) return;
    setBusy(true);
    setError(null);

    const budget: BudgetConstraints = {};
    if (maxUsd) budget.max_usd = Number(maxUsd);
    if (maxWallHours) budget.max_wall_hours = Number(maxWallHours);
    if (maxTokens) budget.max_tokens = Number(maxTokens);
    const hasBudget = Object.keys(budget).length > 0;

    const payload: MissionBrief = {
      brief: brief.trim(),
      quality_bar: qualityBar.trim() || undefined,
      budget_constraints: hasBudget ? budget : null,
      unsafe_mode: unsafeMode,
    };

    try {
      const resp = await startMission(payload);
      onSuccess(resp.mission_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start mission');
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="absolute inset-0 flex items-center justify-center p-6"
        style={{ zIndex: 100, background: 'rgba(28,22,14,0.7)', backdropFilter: 'blur(20px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        role="presentation"
      >
        <motion.div
          className="glass-strong flex flex-col"
          style={{
            width: 520,
            maxHeight: 520,
            overflowY: 'auto',
            borderRadius: 24,
            padding: 24,
            gap: 16,
            boxShadow: '0 32px 80px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.4)',
            background: 'rgba(255,255,255,0.95)',
          }}
          initial={{ scale: 0.95, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 20 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          role="dialog"
          aria-modal="true"
          aria-label="New mission brief"
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <span
                className="eyebrow-amber"
                style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}
              >
                MISSION
              </span>
              <h2
                style={{
                  fontFamily: 'Space Grotesk, sans-serif',
                  fontSize: 18,
                  fontWeight: 700,
                  color: 'var(--ink-strong, #1F1A11)',
                  margin: '4px 0 0 0',
                }}
              >
                Define mission objective
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={{
                minWidth: 44,
                minHeight: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 12,
                background: 'rgba(180,150,90,0.10)',
                border: '1px solid rgba(180,150,90,0.20)',
                color: 'var(--ink-muted)',
                cursor: 'pointer',
              }}
              aria-label="Cancel"
            >
              <X size={18} />
            </button>
          </div>

          {/* Brief textarea */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label
              style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              Objective
            </label>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value.slice(0, 2000))}
              placeholder="Describe what PHANTOM should accomplish..."
              rows={5}
              autoFocus
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid var(--glass-border, rgba(180,150,90,0.25))',
                background: 'rgba(255,255,255,0.55)',
                fontFamily: 'Space Grotesk, sans-serif',
                fontSize: 13,
                color: 'var(--ink-strong, #1F1A11)',
                resize: 'vertical',
                outline: 'none',
                lineHeight: 1.5,
              }}
              aria-label="Mission brief"
              data-testid="mission-brief-input"
            />
            <div
              style={{ fontSize: 10, color: 'var(--ink-muted)', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}
            >
              {brief.length}/2000
            </div>
          </div>

          {/* Quality bar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label
              style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              Quality bar <span style={{ fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              type="text"
              value={qualityBar}
              onChange={(e) => setQualityBar(e.target.value.slice(0, 240))}
              placeholder="What does 'good enough' look like?"
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 10,
                border: '1px solid var(--glass-border, rgba(180,150,90,0.25))',
                background: 'rgba(255,255,255,0.55)',
                fontFamily: 'Space Grotesk, sans-serif',
                fontSize: 13,
                color: 'var(--ink-strong, #1F1A11)',
                outline: 'none',
              }}
              data-testid="mission-quality-bar-input"
            />
          </div>

          {/* Advanced (collapsible) */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--ink-muted)',
                fontSize: 12,
                fontWeight: 600,
                padding: 0,
                letterSpacing: '0.04em',
              }}
            >
              {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Budget &amp; safety constraints
            </button>

            <AnimatePresence>
              {showAdvanced && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div
                    style={{
                      paddingTop: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 10, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          Max USD
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={maxUsd}
                          onChange={(e) => setMaxUsd(e.target.value)}
                          placeholder="—"
                          style={inputStyle}
                          data-testid="mission-max-usd"
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 10, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          Max hours
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={maxWallHours}
                          onChange={(e) => setMaxWallHours(e.target.value)}
                          placeholder="—"
                          style={inputStyle}
                          data-testid="mission-max-hours"
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 10, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          Max tokens
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="1000"
                          value={maxTokens}
                          onChange={(e) => setMaxTokens(e.target.value)}
                          placeholder="—"
                          style={inputStyle}
                          data-testid="mission-max-tokens"
                        />
                      </div>
                    </div>

                    {/* Unsafe mode toggle */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 10px',
                        borderRadius: 8,
                        background: unsafeMode
                          ? 'rgba(185,32,31,0.08)'
                          : 'rgba(180,150,90,0.06)',
                        border: `1px solid ${unsafeMode ? 'rgba(185,32,31,0.22)' : 'rgba(180,150,90,0.18)'}`,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: unsafeMode ? '#B9201F' : 'var(--ink-muted)' }}>
                          Unsafe mode
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 2 }}>
                          Waives sandbox and risk gate for this mission
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setUnsafeMode((v) => !v)}
                        role="switch"
                        aria-checked={unsafeMode}
                        data-testid="mission-unsafe-toggle"
                        style={{
                          minWidth: 44,
                          minHeight: 44,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        <div
                          style={{
                            width: 36,
                            height: 20,
                            borderRadius: 10,
                            background: unsafeMode ? '#B9201F' : 'rgba(180,150,90,0.25)',
                            position: 'relative',
                            transition: 'background 0.18s',
                          }}
                        >
                          <motion.div
                            style={{
                              position: 'absolute',
                              top: 2,
                              width: 16,
                              height: 16,
                              borderRadius: 8,
                              background: '#fff',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                            }}
                            animate={{ left: unsafeMode ? 18 : 2 }}
                            transition={{ duration: 0.16 }}
                          />
                        </div>
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                background: 'rgba(185,32,31,0.08)',
                border: '1px solid rgba(185,32,31,0.22)',
                fontSize: 12,
                color: '#B9201F',
              }}
              role="alert"
            >
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={{
                minHeight: 44,
                padding: '0 18px',
                borderRadius: 12,
                background: 'rgba(180,150,90,0.10)',
                border: '1px solid rgba(180,150,90,0.25)',
                color: 'var(--ink-strong)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRun}
              disabled={!canRun}
              data-testid="mission-run-btn"
              style={{
                minHeight: 44,
                padding: '0 24px',
                borderRadius: 12,
                background: canRun
                  ? 'linear-gradient(180deg, var(--primary, #F4AF25) 0%, #E89A1C 100%)'
                  : 'rgba(180,150,90,0.15)',
                border: canRun
                  ? '1px solid rgba(168,118,18,0.45)'
                  : '1px solid rgba(180,150,90,0.20)',
                color: canRun ? '#1F1308' : 'rgba(0,0,0,0.3)',
                cursor: canRun ? 'pointer' : 'not-allowed',
                fontSize: 13,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: canRun ? '0 8px 22px rgba(244,175,37,0.28)' : 'none',
              }}
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {busy ? 'Starting...' : 'Run mission'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid var(--glass-border, rgba(180,150,90,0.25))',
  background: 'rgba(255,255,255,0.55)',
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 12,
  color: 'var(--ink-strong, #1F1A11)',
  outline: 'none',
};
