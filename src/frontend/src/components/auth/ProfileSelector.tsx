/**
 * Day-5 redesign D5-DSGN-1 — full-surface profile selector that
 * takes over the LoginScreen when the public picker reports ≥2
 * operators. Replaces the cramped IDB-3 inline mini-tiles.
 *
 * Visual contract (per docs/VISUAL_SYSTEM.md + design-refs/profiles.html):
 *   - 1024×600 stage, AmbientGlows behind, Orb + serif copy header.
 *   - Centered row of premium glass cards (180×260) with avatar
 *     image (or gradient-initial fallback), bottom gradient mask,
 *     accent ring + glow on hover/active.
 *   - Stagger reveal: 80ms per tile, ease-phantom curve.
 *   - Tap → fade out + onSelect(username); LoginScreen then mounts
 *     the PIN card with the chosen username pre-filled.
 *
 * Privacy: payload still whitelists ONLY {id, username, avatar_url}
 * — no role / last_seen / created_at exposed pre-auth (per IDB-2
 * audit M-1/M-2). The "Standard Access" / "Last seen" flavour text
 * from the design ref is INTENTIONALLY omitted; restoring it would
 * regress the pre-auth boundary.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, ShieldCheck, UserPlus } from 'lucide-react';
import { authApi } from '../../services/api';
import { AmbientGlows } from '../core/AmbientGlows';
import { EASE_PHANTOM } from '../../styles/motion';

interface PickerTile {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface ProfileSelectorProps {
  /** Fired when an operator card is tapped. Parent then reveals the PIN card. */
  onSelect: (username: string) => void;
  /** Disable taps while parent is mid-flight (e.g. lockout countdown). */
  disabled?: boolean;
}

export function ProfileSelector({ onSelect, disabled = false }: ProfileSelectorProps) {
  const [tiles, setTiles] = useState<PickerTile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

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

  // Loading shell — keep the surface alive but unobtrusive while the
  // pre-auth fetch settles. The parent (LoginScreen) renders us
  // unconditionally for ≥2-user installs, so we own the empty surface.
  if (tiles === null) {
    return (
      <div
        className="w-[1024px] h-[600px] relative overflow-hidden flex items-center justify-center"
        style={{ background: 'var(--surface-base)' }}
        data-state="DIALOGUE"
      >
        <AmbientGlows />
      </div>
    );
  }

  return (
    <div
      className="w-[1024px] h-[600px] relative overflow-hidden flex flex-col"
      style={{ background: 'var(--surface-base)' }}
      data-state="DIALOGUE"
      data-testid="profile-selector"
      data-tile-count={tiles.length}
      data-error={error ?? ''}
    >
      <AmbientGlows />

      {/* Header */}
      <motion.div
        className="relative pt-9 px-10 flex items-end justify-between z-10"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_PHANTOM as unknown as number[] }}
      >
        <div className="flex flex-col gap-1">
          <span
            className="uppercase"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-micro)',
              color: 'var(--ink-muted)',
              letterSpacing: 'var(--tracking-widest)',
            }}
          >
            PHANTOM OS · Operators
          </span>
          <h1
            className="text-gradient"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-2xl)',
              fontWeight: 300,
              letterSpacing: 'var(--tracking-tight)',
              lineHeight: 1,
            }}
          >
            Оберіть оператора
          </h1>
          <p
            className="italic mt-1"
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 'var(--fs-sm)',
              color: 'var(--ink-secondary)',
            }}
          >
            Кожен профіль — окрема пам'ять, окремі звички, окремий тон.
          </p>
        </div>

        <div
          className="glass-panel inline-flex items-center gap-2 px-3 rounded-full"
          style={{ height: 32 }}
        >
          <ShieldCheck size={14} strokeWidth={2} style={{ color: 'var(--accent)' }} />
          <span
            className="uppercase"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-micro)',
              color: 'var(--ink-secondary)',
              letterSpacing: 'var(--tracking-widest)',
            }}
          >
            Pre-auth · whitelisted payload
          </span>
        </div>
      </motion.div>

      {/* Cards rail */}
      <div className="flex-1 flex items-center justify-center min-h-0 relative z-10">
        <div
          className="flex gap-5 px-10 overflow-x-auto"
          style={{ scrollbarWidth: 'none' }}
          role="listbox"
          aria-label="Select operator"
        >
          <AnimatePresence>
            {tiles.map((tile, idx) => (
              <ProfileCard
                key={tile.id}
                tile={tile}
                index={idx}
                disabled={disabled}
                hovered={hovered === tile.username}
                onHover={(h) => setHovered(h ? tile.username : null)}
                onPick={() => !disabled && onSelect(tile.username)}
              />
            ))}
            <AddOperatorHint
              key="__add_hint"
              index={tiles.length}
            />
          </AnimatePresence>
        </div>
      </div>

      {/* Footer rail — JWT badge + count */}
      <motion.div
        className="relative px-10 pb-6 flex items-center justify-between z-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
      >
        <span
          className="uppercase"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-micro)',
            color: 'var(--ink-muted)',
            letterSpacing: 'var(--tracking-widest)',
          }}
        >
          {tiles.length} operator{tiles.length === 1 ? '' : 's'} known
        </span>
        <span
          className="uppercase"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-micro)',
            color: 'var(--accent)',
            letterSpacing: 'var(--tracking-widest)',
          }}
        >
          HS256 · JWT
        </span>
      </motion.div>
    </div>
  );
}

/* ────────────────────────────────────────────── ProfileCard ── */

interface ProfileCardProps {
  tile: PickerTile;
  index: number;
  disabled: boolean;
  hovered: boolean;
  onHover: (h: boolean) => void;
  onPick: () => void;
}

function ProfileCard({ tile, index, disabled, hovered, onHover, onPick }: ProfileCardProps) {
  // Deterministic gradient seed from the username so the avatar
  // fallback is stable across renders + restarts. Pure visual; never
  // exposes any non-whitelisted field.
  const seedColors = useMemo(() => seedFromUsername(tile.username), [tile.username]);

  return (
    <motion.button
      type="button"
      role="option"
      aria-selected={hovered}
      disabled={disabled}
      onClick={onPick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -4 }}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: 0.15 + index * 0.08,
        duration: 0.45,
        ease: EASE_PHANTOM as unknown as number[],
      }}
      className="relative shrink-0 overflow-hidden text-left transition-all"
      style={{
        width: 184,
        height: 268,
        borderRadius: 22,
        background: hovered
          ? 'linear-gradient(145deg, color-mix(in srgb, var(--accent) 14%, transparent), color-mix(in srgb, var(--accent) 2%, transparent))'
          : 'linear-gradient(145deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: hovered
          ? '1px solid var(--accent)'
          : '1px solid var(--glass-border)',
        boxShadow: hovered
          ? '0 18px 50px -16px var(--accent-glow), inset 0 1px 0 var(--glass-highlight)'
          : '0 12px 30px -16px rgba(0,0,0,0.45), inset 0 1px 0 var(--glass-highlight)',
        opacity: disabled ? 0.55 : 1,
      }}
      data-username={tile.username}
      data-active={hovered ? '1' : '0'}
    >
      {/* Active dot */}
      <span
        aria-hidden
        className="absolute rounded-full"
        style={{
          top: 12,
          right: 12,
          width: 8,
          height: 8,
          background: hovered ? 'var(--accent)' : 'var(--ink-muted)',
          boxShadow: hovered ? '0 0 12px var(--accent-glow)' : 'none',
          transition: 'background-color 200ms, box-shadow 200ms',
          zIndex: 2,
        }}
      />

      {/* Avatar zone (top 62%) */}
      <div
        className="absolute inset-x-0 top-0 overflow-hidden"
        style={{ height: '62%' }}
      >
        {tile.avatar_url ? (
          <img
            src={tile.avatar_url}
            alt=""
            className="w-full h-full object-cover transition-transform duration-700"
            style={{
              transform: hovered ? 'scale(1.08)' : 'scale(1)',
              filter: hovered ? 'none' : 'grayscale(0.35) saturate(0.85)',
            }}
            aria-hidden
          />
        ) : (
          <div
            aria-hidden
            className="w-full h-full flex items-center justify-center transition-transform duration-700"
            style={{
              background: `radial-gradient(circle at 30% 25%, ${seedColors.from}, ${seedColors.to})`,
              transform: hovered ? 'scale(1.06)' : 'scale(1)',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-2xl)',
                fontWeight: 300,
                color: 'rgba(255,255,255,0.92)',
                letterSpacing: 'var(--tracking-tight)',
                textShadow: '0 4px 24px rgba(0,0,0,0.45)',
              }}
            >
              {tile.username.slice(0, 1).toUpperCase()}
            </span>
          </div>
        )}
        {/* Bottom gradient mask for label legibility */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 pointer-events-none"
          style={{
            height: '70%',
            background: 'linear-gradient(to top, rgba(2,6,23,0.92), transparent)',
          }}
        />
        {/* Subtle scanline shimmer when hovered */}
        {hovered && (
          <motion.div
            aria-hidden
            initial={{ x: '-100%' }}
            animate={{ x: '110%' }}
            transition={{ duration: 1.6, ease: 'easeInOut', repeat: Infinity }}
            className="absolute inset-y-0 pointer-events-none"
            style={{
              width: '40%',
              background:
                'linear-gradient(110deg, transparent, color-mix(in srgb, var(--accent) 22%, transparent), transparent)',
              mixBlendMode: 'screen',
            }}
          />
        )}
      </div>

      {/* Label zone (bottom 38%) */}
      <div
        className="absolute inset-x-0 bottom-0 px-4 pb-4 pt-3 flex flex-col justify-end"
        style={{ height: '40%' }}
      >
        <span
          className="uppercase"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-micro)',
            color: hovered ? 'var(--accent)' : 'var(--ink-muted)',
            letterSpacing: 'var(--tracking-widest)',
            transition: 'color 200ms',
          }}
        >
          Operator
        </span>
        <h3
          className="truncate mt-0.5"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-md)',
            fontWeight: 600,
            color: hovered ? 'var(--ink-primary)' : 'var(--ink-secondary)',
            letterSpacing: 'var(--tracking-tight)',
            transition: 'color 200ms',
          }}
        >
          {tile.username}
        </h3>
        <div
          className="mt-2 flex items-center justify-between"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-micro)',
            color: hovered ? 'var(--accent)' : 'var(--ink-muted)',
            letterSpacing: 'var(--tracking-wide)',
            transition: 'color 200ms',
          }}
        >
          <span className="flex items-center gap-1">
            <span
              aria-hidden
              className="rounded-full"
              style={{
                width: 6,
                height: 6,
                background: 'currentColor',
                boxShadow: hovered ? '0 0 6px currentColor' : 'none',
                display: 'inline-block',
              }}
            />
            <span>Tap to enter</span>
          </span>
          <ArrowRight
            size={14}
            strokeWidth={2}
            style={{
              opacity: hovered ? 1 : 0.4,
              transform: hovered ? 'translateX(2px)' : 'translateX(0)',
              transition: 'opacity 200ms, transform 200ms',
            }}
          />
        </div>
      </div>
    </motion.button>
  );
}

/* ────────────────────────────────────────────── AddOperatorHint ── */

function AddOperatorHint({ index }: { index: number }) {
  // Visual hint: there's no pre-auth flow to actually add a user
  // (creation requires ROOT auth via settings). Tile is non-interactive
  // and just communicates the multi-user product narrative.
  return (
    <motion.div
      role="presentation"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 0.7, y: 0 }}
      transition={{
        delay: 0.15 + index * 0.08,
        duration: 0.45,
        ease: EASE_PHANTOM as unknown as number[],
      }}
      className="relative shrink-0 flex flex-col items-center justify-center text-center px-4"
      style={{
        width: 184,
        height: 268,
        borderRadius: 22,
        border: '2px dashed var(--glass-border-hover)',
        background:
          'linear-gradient(145deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005))',
      }}
    >
      <div
        className="rounded-full flex items-center justify-center mb-3"
        style={{
          width: 56,
          height: 56,
          background: 'var(--glass-subtle)',
          border: '1px solid var(--glass-border)',
        }}
      >
        <UserPlus size={22} strokeWidth={1.5} style={{ color: 'var(--ink-secondary)' }} />
      </div>
      <span
        className="uppercase"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--fs-micro)',
          color: 'var(--ink-muted)',
          letterSpacing: 'var(--tracking-widest)',
        }}
      >
        Add operator
      </span>
      <span
        className="italic mt-1"
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 'var(--fs-xs)',
          color: 'var(--ink-faint)',
          maxWidth: 140,
          lineHeight: 'var(--lh-normal)',
        }}
      >
        Settings → Operators after sign-in
      </span>
    </motion.div>
  );
}

/* ────────────────────────────────────────────── helpers ── */

const SEED_PALETTE = [
  { from: '#22d3ee', to: '#0e7490' },
  { from: '#8b5cf6', to: '#4c1d95' },
  { from: '#f43f5e', to: '#9f1239' },
  { from: '#10b981', to: '#065f46' },
  { from: '#f59e0b', to: '#7c2d12' },
  { from: '#6366f1', to: '#312e81' },
];

function seedFromUsername(username: string): { from: string; to: string } {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
  }
  return SEED_PALETTE[hash % SEED_PALETTE.length];
}
