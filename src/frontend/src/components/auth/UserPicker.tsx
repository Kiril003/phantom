/**
 * Day-4 Wave-2 IDB-3 — `<UserPicker>` (ADR-IDB-004).
 *
 * Pre-PinPad component shown on the LoginScreen when the picker
 * endpoint reports >= 2 users. Each tile is a 44x44 minimum touch
 * target (CLAUDE.md rule #2) carrying the avatar (or first-letter
 * fallback) + the username. Tap a tile → invokes `onPick(username)`
 * which the parent uses to pre-fill the username input + reveal the
 * PinPad.
 *
 * The component is uncontrolled with respect to the active user —
 * the parent owns the state. We just emit the user's username on
 * tap.
 *
 * Failure modes (defensive):
 *   - Network failure → empty state ("no users known yet"),
 *     `onPick` never fires.
 *   - Single user → render nothing (the parent should auto-fill the
 *     username and skip the picker UI entirely).
 *   - The fetched array is REORDERED last_seen_at DESC by the server
 *     so we just splat it as-is.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { authApi } from '../../services/api';

export interface UserPickerProps {
  /** Called with the tapped tile's username. */
  onPick: (username: string) => void;
  /** Currently-active username; used to highlight the selected tile. */
  activeUsername?: string;
  /** Disable taps during async work. */
  disabled?: boolean;
}

interface PickerTile {
  id: string;
  username: string;
  avatar_url: string | null;
}

export function UserPicker({
  onPick,
  activeUsername,
  disabled = false,
}: UserPickerProps) {
  const [tiles, setTiles] = useState<PickerTile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authApi
      .picker()
      .then((rows) => {
        if (cancelled) return;
        setTiles(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setError('picker unavailable');
        setTiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Don't render until the fetch settles; LoginScreen has its own
  // loading shell, the picker just stays empty until we have data.
  if (tiles === null) {
    return null;
  }

  // Single-user (or zero-user) installs — the picker would be visual
  // noise. The parent's auto-fill default handles the username field.
  if (tiles.length < 2) {
    return null;
  }

  return (
    <div
      className="w-full"
      data-testid="user-picker"
      data-tile-count={tiles.length}
      data-error={error ?? ''}
    >
      <div
        className="flex flex-wrap justify-center gap-3"
        role="listbox"
        aria-label="Select operator"
      >
        {tiles.map((tile) => {
          const active = tile.username === activeUsername;
          return (
            <motion.button
              key={tile.id}
              type="button"
              role="option"
              aria-selected={active}
              disabled={disabled}
              onClick={() => onPick(tile.username)}
              whileTap={{ scale: 0.96 }}
              className="flex flex-col items-center gap-1 transition-colors"
              style={{
                minWidth: 64,
                minHeight: 80,
                padding: '6px 10px',
                borderRadius: 14,
                background: active
                  ? 'color-mix(in srgb, var(--accent) 20%, transparent)'
                  : 'var(--glass-subtle)',
                border: active
                  ? '1px solid var(--accent)'
                  : '1px solid var(--glass-border)',
                color: active ? 'var(--accent)' : 'var(--ink-secondary)',
                opacity: disabled ? 0.55 : 1,
              }}
              data-username={tile.username}
              data-active={active ? '1' : '0'}
            >
              <div
                className="flex items-center justify-center"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 9999,
                  background: active
                    ? 'color-mix(in srgb, var(--accent) 14%, transparent)'
                    : 'var(--glass-subtle)',
                  border: '1px solid var(--glass-border)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-base)',
                  color: 'var(--ink-primary)',
                  overflow: 'hidden',
                }}
                aria-hidden
              >
                {tile.avatar_url ? (
                  <img
                    src={tile.avatar_url}
                    alt=""
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                ) : (
                  <span>{tile.username.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-micro)',
                  letterSpacing: 'var(--tracking-wide)',
                  maxWidth: 96,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {tile.username}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
