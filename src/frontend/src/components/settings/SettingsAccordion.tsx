/**
 * Day-4 Wave-2 W-3b — collapsible Settings subgroup accordion.
 *
 * Renders the subgroup header with a chevron + count + dirty badge
 * and toggles the children visibility. The `open` state is OWNED by
 * the parent (SettingsPanel) so it can be persisted to localStorage
 * across reloads. The component itself is uncontrolled-ish — it
 * forwards a click to `onToggle` and reads `open` for ARIA.
 */
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

export interface SettingsAccordionProps {
  /** Stable id — used as the localStorage key suffix. */
  id: string;
  /** Display label, e.g. "Speech to text". */
  label: string;
  /** Setting count for the count badge. */
  count: number;
  /** Number of dirty (unsaved) items — surfaces an orange dot. */
  dirtyCount: number;
  /** Open/closed state owned by parent. */
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function SettingsAccordion({
  id,
  label,
  count,
  dirtyCount,
  open,
  onToggle,
  children,
}: SettingsAccordionProps) {
  const headerId = `settings-accordion-${id}-header`;
  const panelId = `settings-accordion-${id}-panel`;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div
      className="flex flex-col"
      data-testid="settings-accordion"
      data-accordion-id={id}
      data-accordion-open={open ? '1' : '0'}
    >
      <button
        type="button"
        id={headerId}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex items-center gap-2 w-full text-left transition-colors"
        style={{
          minHeight: 44,
          padding: '8px 10px',
          borderRadius: 10,
          background: open
            ? 'color-mix(in srgb, var(--accent) 8%, var(--glass-subtle))'
            : 'var(--glass-subtle)',
          border: `1px solid ${open ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'var(--glass-border)'}`,
        }}
      >
        <Chevron
          size={14}
          strokeWidth={1.75}
          color="var(--ink-secondary)"
          aria-hidden
        />
        <span
          className="flex-1"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-xs)',
            color: 'var(--ink-primary)',
            letterSpacing: 'var(--tracking-wide)',
          }}
        >
          {label}
        </span>
        {dirtyCount > 0 && (
          <span
            aria-label={`${dirtyCount} unsaved changes in ${label}`}
            className="inline-flex items-center gap-1"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-micro)',
              color: 'var(--signal-warn)',
            }}
          >
            <span
              aria-hidden
              className="block rounded-full"
              style={{
                width: 6,
                height: 6,
                background: 'var(--signal-warn)',
              }}
            />
            {dirtyCount}
          </span>
        )}
        <span
          aria-hidden
          className="tabular-nums"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-micro)',
            color: 'var(--ink-muted)',
          }}
        >
          {count}
        </span>
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className="flex flex-col gap-2 mt-2 mb-3"
          data-testid="settings-accordion-body"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Read accordion-open state from localStorage.
 * Returns `null` when storage is unavailable or the entry is missing,
 * so the caller can apply a sensible default (first accordion open).
 */
export function readAccordionState(
  categoryId: string
): Record<string, boolean> | null {
  try {
    const raw = window.localStorage.getItem(
      `phantom.settings.accordion.${categoryId}`
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      const out: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'boolean') out[k] = v;
      }
      return out;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeAccordionState(
  categoryId: string,
  state: Record<string, boolean>
): void {
  try {
    window.localStorage.setItem(
      `phantom.settings.accordion.${categoryId}`,
      JSON.stringify(state)
    );
  } catch {
    // Storage full / disabled — silently degrade.
  }
}
