/**
 * R1 sunrise repaint — full-surface ProfileSelector. Replaces the
 * cyberdeck dark-glass deck with the warm horizon design from
 * `docs/design-handoff/project/screen-1-profile.jsx`:
 *
 *   - Animated sunrise SVG (sky gradient, breathing sun, light rays,
 *     horizon line, soft cloud silhouettes) behind everything.
 *   - Each operator avatar is a generative gradient mandala (deterministic
 *     from the username so reloads keep the same face).
 *   - Up to 6 cards laid out horizontally with a soft amber glow under
 *     the active selection.
 *   - Voice command pill ("Тапніть, або скажіть «Я Алекс»") at the
 *     bottom-right, mic key with the warm gradient.
 *
 * Privacy contract is unchanged — the picker payload still whitelists
 * only {id, username, avatar_url} (per IDB-2 audit M-1/M-2). Role and
 * last-seen flavour from the design ref are intentionally NOT shown
 * pre-auth; the design ref's "ROOT/02 14h ago" labels would regress
 * the pre-auth boundary so the repaint keeps the role/timestamp ink
 * on the post-auth profile screen, not the picker.
 *
 * Wiring contract:
 *   - Props (`onSelect`, `disabled`) unchanged.
 *   - `authApi.picker()` called once on mount; tile order = server's
 *     last_seen_at DESC.
 *   - Tap → onSelect(username); LoginScreen reveals the PIN card.
 *   - data-testid="profile-selector", data-tile-count, data-error
 *     preserved for the existing test suite.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { authApi } from '../../services/api';
import { EASE_PHANTOM } from '../../styles/motion';
import { AddProfileWizard } from './AddProfileWizard';

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

/* ── Generative mandala palette (sunrise/amber bias) ──────────────────
 * Each entry is the [highlight, mid, deep] triple consumed by the
 * radial+linear SVG gradients so the avatar feels like a small piece
 * of the same horizon. Operators get a deterministic palette from the
 * username hash — same operator = same face across boots. */
interface MandalaPalette {
  hi: string;
  mid: string;
  deep: string;
  glyph: string;
}

const MANDALA_PALETTES: readonly MandalaPalette[] = [
  { hi: '#f4af25', mid: '#fb923c', deep: '#d97706', glyph: '◉' },
  { hi: '#fbcfb1', mid: '#f59e7c', deep: '#e2723f', glyph: '◐' },
  { hi: '#f4d35e', mid: '#e2a13b', deep: '#a86b1c', glyph: '✦' },
  { hi: '#ecd9b6', mid: '#c79760', deep: '#8a5d2f', glyph: '❋' },
  { hi: '#fef3d6', mid: '#dba94e', deep: '#b07a10', glyph: '◇' },
  { hi: '#fda985', mid: '#f4af25', deep: '#c2410c', glyph: '⌖' },
] as const;

function mandalaFor(username: string): MandalaPalette {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
  }
  return MANDALA_PALETTES[hash % MANDALA_PALETTES.length];
}

function sigilFor(username: string): string {
  // Two-letter sigil — first + last alpha char (uppercase). For 1-char
  // names we duplicate. Never exposes anything outside the whitelisted
  // username field.
  const letters = username.replace(/[^a-zа-яіїєґ]/gi, '').toUpperCase();
  if (!letters.length) return 'OP';
  if (letters.length === 1) return letters + letters;
  return letters[0] + letters[letters.length - 1];
}

export function ProfileSelector({ onSelect, disabled = false }: ProfileSelectorProps) {
  const [tiles, setTiles] = useState<PickerTile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [wizardOpen, setWizardOpen] = useState(false);

  const reloadPicker = useCallback(async () => {
    try {
      const rows = await authApi.picker();
      setTiles(rows);
      if (rows.length && !activeId) {
        const phantom = rows.find((r) => r.username === 'phantom');
        setActiveId(phantom ? phantom.id : rows[0].id);
      }
      setError(null);
    } catch {
      setError('picker unavailable');
      setTiles([]);
    }
  }, [activeId]);

  useEffect(() => {
    let cancelled = false;
    authApi
      .picker()
      .then((rows) => {
        if (cancelled) return;
        setTiles(rows);
        // Default selection: phantom (ROOT) first, otherwise the
        // most-recently-seen operator returned by the server.
        if (rows.length) {
          const phantom = rows.find((r) => r.username === 'phantom');
          setActiveId(phantom ? phantom.id : rows[0].id);
        }
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

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Loading shell — keep the surface bright but quiet while the
  // pre-auth fetch settles.
  if (tiles === null) {
    return (
      <div
        className="w-[1024px] h-[600px] relative overflow-hidden"
        style={{ background: 'var(--surface-base)' }}
        data-state="DIALOGUE"
        data-testid="profile-selector"
      >
        <SunriseHorizon />
      </div>
    );
  }

  // Cap at 6 cards horizontally — design budget. If the install grows
  // past 6, the most-recent 6 win (server returns DESC by last_seen_at).
  const visible = tiles.slice(0, 6);

  const dateStr = now.toLocaleDateString('uk-UA', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });
  const timeStr = now.toLocaleTimeString('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className="w-[1024px] h-[600px] relative overflow-hidden"
      style={{ background: 'var(--surface-base)' }}
      data-state="DIALOGUE"
      data-testid="profile-selector"
      data-tile-count={tiles.length}
      data-error={error ?? ''}
    >
      <SunriseHorizon />

      {/* ── Header row ─────────────────────────────────────────── */}
      <motion.div
        className="absolute flex items-start justify-between"
        style={{ top: 22, left: 28, right: 28, zIndex: 3 }}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_PHANTOM as unknown as number[] }}
      >
        <div>
          <div className="eyebrow">
            PHANTOM OS · {String(tiles.length).padStart(2, '0')} OPERATORS KNOWN
          </div>
          <h1
            style={{
              margin: '6px 0 0',
              fontSize: 38,
              fontWeight: 200,
              letterSpacing: '-0.025em',
              color: 'var(--ink-primary)',
              lineHeight: 1,
            }}
          >
            Оберіть оператора
          </h1>
          <div
            className="playfair"
            style={{
              fontSize: 14,
              color: 'var(--ink-secondary)',
              marginTop: 4,
              fontWeight: 500,
            }}
          >
            The day begins when you do.
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div
            className="tabular"
            style={{
              fontSize: 36,
              fontWeight: 200,
              letterSpacing: '-0.03em',
              lineHeight: 1,
              color: 'var(--ink-primary)',
            }}
          >
            {timeStr}
          </div>
          <div className="micro-label" style={{ marginTop: 4 }}>
            {dateStr}
          </div>
        </div>
      </motion.div>

      {/* ── Operator gallery — horizontal row ───────────────────── */}
      <div
        className="absolute"
        style={{
          top: 178,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 14,
          zIndex: 3,
        }}
        role="listbox"
        aria-label="Select operator"
      >
        <AnimatePresence>
          {visible.map((tile, idx) => (
            <OperatorCard
              key={tile.id}
              tile={tile}
              index={idx}
              active={activeId === tile.id}
              disabled={disabled}
              onActivate={() => setActiveId(tile.id)}
              onPick={() => !disabled && onSelect(tile.username)}
            />
          ))}
          {/* Add-profile tile — only when room remains in the design's
              6-card budget. Tap opens AddProfileWizard which gates on
              ROOT auth before POST /api/v1/users. */}
          {visible.length < 6 && (
            <AddProfileTile
              key="__add__"
              index={visible.length}
              disabled={disabled}
              onActivate={() => setWizardOpen(true)}
            />
          )}
        </AnimatePresence>
      </div>

      <AddProfileWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={() => {
          void reloadPicker();
        }}
      />

      {/* ── Glow under the active card ──────────────────────────── */}
      <SelectedGlow activeIndex={visible.findIndex((t) => t.id === activeId)} count={visible.length} />

      {/* ── Footer row — voice command pill + version line ─────── */}
      <motion.div
        className="absolute flex items-center justify-end"
        style={{ bottom: 56, left: 28, right: 28, zIndex: 3, gap: 12 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
      >
        <VoiceCommandPill />
      </motion.div>

      <div
        className="micro-label"
        style={{
          position: 'absolute',
          bottom: 18,
          left: 0,
          right: 0,
          textAlign: 'center',
          zIndex: 3,
        }}
      >
        PHANTOM OS · sunrise build · trust-circle private
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── SunriseHorizon ── */

function SunriseHorizon() {
  return (
    <svg
      viewBox="0 0 1024 600"
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
      }}
      aria-hidden
    >
      <defs>
        <radialGradient id="phantom-sunrise-orb" cx="50%" cy="48%" r="40%">
          <stop offset="0%" stopColor="#fff8e0" />
          <stop offset="40%" stopColor="#f4af25" />
          <stop offset="70%" stopColor="#fb923c" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#fb923c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="phantom-sunrise-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#fde9b8" />
          <stop offset="60%" stopColor="#f8f7f5" />
        </linearGradient>
      </defs>
      <rect width="1024" height="600" fill="url(#phantom-sunrise-sky)" />
      <circle
        cx="512"
        cy="280"
        r="220"
        fill="url(#phantom-sunrise-orb)"
        style={{ animation: 'orb-breathe 7s ease-in-out infinite' }}
      />
      <g opacity="0.18" style={{ animation: 'orb-breathe 9s ease-in-out infinite' }}>
        {Array.from({ length: 16 }).map((_, i) => {
          const dx = Math.cos((i * Math.PI) / 8) * 600;
          const dy = Math.sin((i * Math.PI) / 8) * 600;
          return (
            <line
              key={i}
              x1="512"
              y1="280"
              x2={512 + dx}
              y2={280 + dy}
              stroke="#f4af25"
              strokeWidth="1.2"
            />
          );
        })}
      </g>
      <line
        x1="0"
        y1="380"
        x2="1024"
        y2="380"
        stroke="rgba(176,122,16,0.25)"
        strokeDasharray="3 6"
      />
      <g opacity="0.55" fill="rgba(255,255,255,0.7)">
        <ellipse cx="160" cy="200" rx="80" ry="10" />
        <ellipse cx="780" cy="180" rx="100" ry="8" />
        <ellipse cx="900" cy="250" rx="60" ry="6" />
        <ellipse cx="120" cy="260" rx="40" ry="5" />
      </g>
    </svg>
  );
}

/* ────────────────────────────────────────────────────────── OperatorCard ── */

interface OperatorCardProps {
  tile: PickerTile;
  index: number;
  active: boolean;
  disabled: boolean;
  onActivate: () => void;
  onPick: () => void;
}

function OperatorCard({ tile, index, active, disabled, onActivate, onPick }: OperatorCardProps) {
  const palette = useMemo(() => mandalaFor(tile.username), [tile.username]);
  const sigil = useMemo(() => sigilFor(tile.username), [tile.username]);
  const stamp = String(index + 1).padStart(2, '0');

  return (
    <motion.button
      type="button"
      role="option"
      aria-selected={active}
      disabled={disabled}
      onClick={onPick}
      onMouseEnter={onActivate}
      onFocus={onActivate}
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -4 }}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: 0.15 + index * 0.08,
        duration: 0.45,
        ease: EASE_PHANTOM as unknown as number[],
      }}
      className="lift relative overflow-hidden text-left"
      style={{
        width: 152,
        height: 224,
        borderRadius: 20,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: active ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.5)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        border: active ? '1.5px solid rgba(244,175,37,0.7)' : '1px solid rgba(255,255,255,0.55)',
        boxShadow: active
          ? '0 0 0 5px rgba(244,175,37,0.15), 0 0 30px 6px rgba(244,175,37,0.32), 0 14px 38px rgba(120,70,10,0.14)'
          : '0 8px 24px rgba(120,70,10,0.08)',
        opacity: disabled ? 0.55 : 1,
        display: 'flex',
        flexDirection: 'column',
        padding: 0,
        minWidth: 0,
        minHeight: 0,
      }}
      data-username={tile.username}
      data-active={active ? '1' : '0'}
    >
      {/* Mandala (or avatar override) */}
      <div style={{ height: 160, position: 'relative', overflow: 'hidden' }}>
        {tile.avatar_url ? (
          <img
            src={tile.avatar_url}
            alt=""
            aria-hidden
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : (
          <Mandala palette={palette} sigil={sigil} active={active} />
        )}

        {/* Sigil badge — top-left, mono, 9px */}
        <div
          className="mono"
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            fontSize: 9,
            fontWeight: 600,
            padding: '3px 7px',
            borderRadius: 6,
            background: 'rgba(0,0,0,0.18)',
            color: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            letterSpacing: '0.1em',
          }}
        >
          {sigil}·{stamp}
        </div>

        {active && (
          <div
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              fontSize: 9,
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.85)',
              color: 'var(--primary-deep)',
              letterSpacing: '0.14em',
            }}
          >
            ● ACTIVE
          </div>
        )}
      </div>

      {/* Meta — only the whitelisted `username`. Role/last_seen are
          intentionally hidden pre-auth (IDB-2 contract). */}
      <div style={{ padding: '8px 12px 10px', textAlign: 'left' }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            color: 'var(--ink-primary)',
          }}
        >
          {tile.username}
        </div>
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.18em',
            color: active ? 'var(--primary-deep)' : 'var(--ink-muted)',
            marginTop: 2,
            textTransform: 'uppercase',
          }}
        >
          Tap to enter
        </div>
      </div>
    </motion.button>
  );
}

/* ────────────────────────────────────────────────────────────── Mandala ── */

interface MandalaProps {
  palette: MandalaPalette;
  sigil: string;
  active: boolean;
}

function Mandala({ palette, sigil, active }: MandalaProps) {
  // Stable gradient ID — palette colours fully define it, so the same
  // operator reuses the same <defs> on remount with no flicker.
  const gid = `${palette.hi}${palette.mid}${palette.deep}`.replace(/#/g, '');
  return (
    <svg
      viewBox="0 0 100 100"
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden
    >
      <defs>
        <radialGradient id={`mg-${gid}`} cx="35%" cy="30%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="40%" stopColor={palette.hi} />
          <stop offset="80%" stopColor={palette.mid} />
          <stop offset="100%" stopColor={palette.deep} />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#mg-${gid})`} />
      {/* concentric rings — a "trust circle" reading */}
      {[44, 36, 28, 20].map((r, i) => (
        <circle
          key={i}
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="0.5"
          strokeDasharray={i % 2 ? '2 3' : ''}
        />
      ))}
      {/* petals */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <ellipse
          key={i}
          cx="50"
          cy="22"
          rx="3"
          ry="14"
          fill="rgba(255,255,255,0.18)"
          transform={`rotate(${i * 45} 50 50)`}
        />
      ))}
      {/* sigil glyph rendered through a serif italic — the sigil text
          itself is reused for accessibility (matches the badge) */}
      <text
        x="50"
        y="58"
        textAnchor="middle"
        fill="rgba(255,255,255,0.85)"
        fontSize="22"
        fontFamily="Playfair Display, Georgia, serif"
        fontStyle="italic"
        fontWeight="600"
      >
        {palette.glyph}
      </text>
      {active && (
        <circle
          cx="50"
          cy="50"
          r="48"
          fill="none"
          stroke="rgba(255,255,255,0.5)"
          strokeWidth="1"
        />
      )}
      {/* hidden fallback label for screen readers — sigil reads the
          same text as the visible top-left badge */}
      <title>{sigil}</title>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────── SelectedGlow ── */

interface SelectedGlowProps {
  activeIndex: number;
  count: number;
}

function SelectedGlow({ activeIndex, count }: SelectedGlowProps) {
  if (activeIndex < 0 || count === 0) return null;
  // Card is 152 wide, gap 14, stack centred on x=512. Glow sits under
  // the card baseline (top: 384 = 178 + 224 - decorative offset).
  const cardW = 152;
  const gap = 14;
  const totalW = count * cardW + (count - 1) * gap;
  const startX = 512 - totalW / 2;
  const glowX = startX + activeIndex * (cardW + gap);
  return (
    <motion.div
      aria-hidden
      animate={{ left: glowX }}
      transition={{ duration: 0.4, ease: EASE_PHANTOM as unknown as number[] }}
      style={{
        position: 'absolute',
        top: 384,
        width: cardW,
        height: 30,
        background: 'radial-gradient(ellipse, rgba(244,175,37,0.4), transparent 70%)',
        filter: 'blur(8px)',
        zIndex: 2,
        pointerEvents: 'none',
      }}
    />
  );
}

/* ───────────────────────────────────────────────────── VoiceCommandPill ── */

function VoiceCommandPill() {
  return (
    <div
      className="glass-strong"
      style={{
        padding: '8px 8px 8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        borderRadius: 999,
        minWidth: 360,
        height: 54,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 22 }} aria-hidden>
        {[6, 12, 18, 10, 16, 8, 14, 20, 12, 8].map((h, i) => (
          <span
            key={i}
            style={{
              width: 2,
              height: h,
              borderRadius: 1,
              background: 'linear-gradient(180deg,#f4af25,#fb923c)',
              opacity: 0.4 + (i % 3) * 0.2,
              animation: `orb-breathe ${1.2 + i * 0.1}s ease-in-out infinite`,
              display: 'inline-block',
            }}
          />
        ))}
      </div>
      <span
        className="playfair"
        style={{
          flex: 1,
          fontSize: 13,
          color: 'var(--ink-secondary)',
        }}
      >
        Тапніть, або скажіть «Я Алекс»
      </span>
      <button
        type="button"
        aria-label="Voice login"
        style={{
          width: 38,
          height: 38,
          minWidth: 38,
          minHeight: 38,
          borderRadius: 999,
          background: 'linear-gradient(135deg,#f4af25,#fb923c)',
          border: 'none',
          cursor: 'pointer',
          color: 'white',
          boxShadow: '0 4px 14px rgba(244,175,37,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        <span
          className="msym"
          style={{
            fontSize: 18,
            fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24",
          }}
        >
          mic
        </span>
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────── AddProfileTile (closes audit
 *  2026-04-30 OPERATOR-ASK — "+ додати профіль"). Stays visually quieter
 *  than OperatorCard so it never competes for the operator's eye, but
 *  stays touch-44+ and keyboard-accessible. */

interface AddProfileTileProps {
  index: number;
  disabled: boolean;
  onActivate: () => void;
}

function AddProfileTile({ index, disabled, onActivate }: AddProfileTileProps) {
  return (
    <motion.button
      type="button"
      onClick={() => !disabled && onActivate()}
      disabled={disabled}
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96 }}
      transition={{ duration: 0.45, delay: 0.06 * index, ease: EASE_PHANTOM as unknown as number[] }}
      whileHover={disabled ? undefined : { y: -3 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      role="option"
      aria-label="Додати новий профіль"
      style={{
        width: 180,
        height: 260,
        borderRadius: 18,
        background:
          'linear-gradient(160deg, rgba(255,255,255,0.45), rgba(244,175,37,0.05))',
        border: '1.5px dashed rgba(244,175,37,0.45)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 12,
        opacity: disabled ? 0.4 : 1,
        fontFamily: 'var(--font-display)',
        boxShadow: '0 6px 18px rgba(120,70,10,0.06)',
      }}
    >
      <div
        style={{
          width: 88,
          height: 88,
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 30% 30%, rgba(244,175,37,0.32), rgba(251,146,60,0.16) 60%, transparent 75%)',
          border: '1px dashed rgba(244,175,37,0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#8a5e0a',
        }}
      >
        <span className="msym" aria-hidden style={{ fontSize: 44, fontVariationSettings: "'wght' 300" }}>
          add
        </span>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--ink-primary)',
            letterSpacing: '0.02em',
          }}
        >
          Додати профіль
        </div>
        <div
          className="playfair"
          style={{
            fontSize: 11,
            color: 'var(--ink-muted)',
            marginTop: 4,
            fontStyle: 'italic',
          }}
        >
          ROOT-only · username + PIN
        </div>
      </div>
    </motion.button>
  );
}
