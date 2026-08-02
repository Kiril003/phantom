/**
 * SafetyShieldToggle — per-task "no-leash" switch.
 *
 * A small floating chip the operator anchors top-right of the OPERATOR
 * screen. Two states:
 *
 *   GUARDED  (default, shield filled, amber-green)
 *     Default safety stack engaged: bwrap sandbox, risk-tolerance gate,
 *     Council deliberation, phone approve-on-high-risk. This is what
 *     ships on first run.
 *
 *   NO LEASH (shield broken, red, with a dashed/pulsing border)
 *     Operator-issued waiver. The active task (if any) AND the next
 *     task picks up unsafe_mode=True: actions skip the sandbox, risk
 *     gate auto-approves, Council is bypassed. The agent gets full
 *     host access for as long as this is on.
 *
 * The widget reaches into agentStore for both:
 *   - `unsafeMode`        : live state of the running task (synced via
 *                            WS `task.safety_changed` from the backend)
 *   - `unsafeModeIntent`  : operator's persisted choice for the next
 *                            task (survives reloads via localStorage)
 *
 * Showing the live state when a task is active means another paired
 * surface (e.g. the companion phone) flipping the switch is reflected
 * here too. When no task is active, we show the *intent* so the
 * operator can pre-stage their choice.
 */
import { useState } from 'react';
import { Shield, ShieldOff, Loader2 } from 'lucide-react';
import { useAgentStore } from '../../../stores/agentStore';
import { useUIStore } from '../../../stores/uiStore';

export function SafetyShieldToggle() {
  const currentTask = useAgentStore((s) => s.currentTask);
  const status = useAgentStore((s) => s.status);
  const unsafeMode = useAgentStore((s) => s.unsafeMode);
  const unsafeModeIntent = useAgentStore((s) => s.unsafeModeIntent);
  const setUnsafeMode = useAgentStore((s) => s.setUnsafeMode);
  const toast = useUIStore((s) => s.toast);

  const [busy, setBusy] = useState(false);

  const taskActive =
    currentTask !== null &&
    !['idle', 'done', 'failed', 'stopped'].includes(status);
  // When a task is live, the live flag is authoritative. Otherwise we
  // show the operator's intent for the next task.
  const isUnsafe = taskActive ? unsafeMode : unsafeModeIntent;

  const flip = async () => {
    if (busy) return;
    const target = !isUnsafe;
    setBusy(true);
    try {
      await setUnsafeMode(target);
      toast({
        kind: target ? 'warn' : 'info',
        message: target
          ? 'NO LEASH — agent has unrestricted execution for this task.'
          : 'Auto-safety re-engaged.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to flip safety';
      toast({ kind: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  };

  // Visual tokens.
  // Бурштин — колір заливки, не чорнила: на майже білому тлі підпис зникав.
  const tint = isUnsafe ? '#ef4444' : 'var(--primary-shadow, #8a5e0a)';
  const surface = isUnsafe
    ? 'rgba(239, 68, 68, 0.12)'
    : 'rgba(255, 255, 255, 0.92)';
  const border = isUnsafe ? '#ef4444' : 'var(--primary, #f4af25)';

  return (
    <button
      type="button"
      onClick={flip}
      disabled={busy}
      aria-pressed={isUnsafe}
      aria-label={isUnsafe ? 'Повернути автозахист' : 'Зняти автозахист'}
      title={
        isUnsafe
          ? 'Автозахист знято — тап, щоб повернути'
          : taskActive
            ? 'Тап зніме автозахист для цієї задачі'
            : 'Тап зніме автозахист для наступної задачі'
      }
      data-testid="safety-shield-toggle"
      className="flex items-center gap-2 transition-all"
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 60,
        padding: '2px 10px',
        minHeight: 44,
        borderRadius: 10,
        background: surface,
        border: `1px solid ${border}`,
        boxShadow: isUnsafe
          ? '0 6px 18px rgba(239, 68, 68, 0.35), inset 0 0 0 1px rgba(239,68,68,0.25)'
          : '0 4px 12px rgba(120,70,10,0.16)',
        color: tint,
        cursor: busy ? 'wait' : 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        // Subtle pulse when unsafe so operator never forgets the leash is off.
        animation: isUnsafe ? 'phantom-shield-pulse 2.2s ease-in-out infinite' : undefined,
      }}
    >
      {busy ? (
        <Loader2 size={12} className="animate-spin" />
      ) : isUnsafe ? (
        <ShieldOff size={12} strokeWidth={2.5} />
      ) : (
        <Shield size={12} strokeWidth={2.5} />
      )}
      <span>{isUnsafe ? 'БЕЗ ПОВІДКА' : 'ПІД ЗАХИСТОМ'}</span>
      <style>{`
        @keyframes phantom-shield-pulse {
          0%, 100% { box-shadow: 0 6px 18px rgba(239,68,68,0.35), inset 0 0 0 1px rgba(239,68,68,0.25); }
          50%      { box-shadow: 0 6px 24px rgba(239,68,68,0.55), inset 0 0 0 1.5px rgba(239,68,68,0.45); }
        }
      `}</style>
    </button>
  );
}
