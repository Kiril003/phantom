/**
 * ChromeHandle — спільний 44×24 toggle для chrome-elements.
 *
 * Top-mounted (StatusBar, Roster):
 *   collapsed=true  → ChevronDown (tap → expand to full)
 *   collapsed=false → ChevronUp   (tap → collapse to compact)
 *
 * Bottom-mounted (HUD, Toolbar):
 *   collapsed=true  → ChevronUp   (tap → expand)
 *   collapsed=false → ChevronDown (tap → hide)
 *
 * 44×24 розмір гарантує touch-safe зону на 1024×600 / 7" дисплеї.
 */
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { CSSProperties } from 'react';

interface Props {
  position: 'top' | 'bottom';
  collapsed: boolean;
  onToggle: () => void;
  /** Назва елемента для aria-label, наприклад "StatusBar". */
  label: string;
  /** Optional inline style override (positioning by parent). */
  style?: CSSProperties;
  className?: string;
}

export function ChromeHandle({
  position,
  collapsed,
  onToggle,
  label,
  style,
  className,
}: Props) {
  const expand = collapsed; // tapping while collapsed expands the panel
  const showDown =
    (position === 'top' && collapsed) ||
    (position === 'bottom' && !collapsed);

  const ariaLabel = expand
    ? `Розгорнути ${label}`
    : `Згорнути ${label}`;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={ariaLabel}
      aria-expanded={!collapsed}
      title={ariaLabel}
      className={
        className ??
        'flex items-center justify-center transition-colors hover:bg-black/5 active:bg-black/10'
      }
      style={{
        minWidth: 44,
        minHeight: 24,
        height: 24,
        borderRadius: 12,
        color: 'var(--ink-muted, rgba(0,0,0,0.55))',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        ...style,
      }}
    >
      {showDown ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
    </button>
  );
}
