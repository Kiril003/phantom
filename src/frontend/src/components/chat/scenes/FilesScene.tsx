/**
 * Phase-5 R1 — FilesScene (B-17).
 *
 * Inline glass card returned from `files.search`. Mirrors the design DNA
 * from `docs/design-handoff/project/screen-8-inline.jsx` → `SceneFiles`:
 * 3-column thumbnail grid with tone-coloured icon tiles, "BEST" ribbon
 * on the highlighted match, an inline filter pill, and a NEXUS commentary
 * footer.
 *
 * Pure render. The filter chip is presentational; the parent is expected
 * to wire keyboard/voice via the floating toolbar.
 */
import type { FilesSceneData, FilesIconKey, FilesTone, FilesMatch } from '@shared/types';
import { PhantomIcon } from '../../core/PhantomIcon';

interface FilesSceneProps {
  data: FilesSceneData;
}

const ICON_FOR: Record<FilesIconKey, string> = {
  image: 'image',
  movie: 'movie',
  audiotrack: 'audiotrack',
  description: 'description',
  folder: 'folder',
  code: 'code',
  archive: 'inventory_2',
  unknown: 'draft',
};

const TONE_COLOURS: Record<FilesTone, { bg: string; icon: string }> = {
  amber: { bg: 'rgba(244,175,37,0.18)', icon: 'var(--primary-deep)' },
  neutral: { bg: 'rgba(176,122,16,0.10)', icon: '#876b2a' },
  coral: { bg: 'rgba(239,68,68,0.15)', icon: 'var(--coral-deep)' },
  green: { bg: 'rgba(132,180,90,0.18)', icon: '#3d5b1c' },
};

/** Display name should never leak the abs path; clamp to basename. */
function displayName(match: FilesMatch): string {
  if (!match.name) return '—';
  // Defensive: if BE accidentally sent a path, take last segment.
  const idx = match.name.lastIndexOf('/');
  return idx >= 0 ? match.name.slice(idx + 1) : match.name;
}

export function FilesScene({ data }: FilesSceneProps) {
  const matches = data.matches.slice(0, 9);

  return (
    <div
      className="glass lift"
      style={{ width: 540, padding: 16, position: 'relative', overflow: 'hidden' }}
      data-testid="scene-files"
      data-files-root={data.root_display}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PhantomIcon name="folder_open" size={14} color="var(--primary-deep)" aria-hidden />
          <span className="eyebrow-amber">
            FILES · {data.root_display.toUpperCase()} · {data.total_matches} MATCHES
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 10px',
            borderRadius: 'var(--radius-pill)',
            background: 'rgba(255,255,255,0.55)',
            border: '1px solid rgba(255,255,255,0.55)',
          }}
        >
          <PhantomIcon name="search" size={11} color="var(--ink-muted)" aria-hidden />
          <span
            className="playfair"
            style={{ fontSize: 10, fontStyle: 'italic', color: 'var(--ink-muted)' }}
          >
            {data.filter_placeholder ?? 'filter…'}
          </span>
          <PhantomIcon name="mic" size={10} color="var(--primary-deep)" aria-hidden />
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 6,
          marginTop: 10,
        }}
      >
        {matches.map((match) => {
          const tone = TONE_COLOURS[match.tone];
          const icon = ICON_FOR[match.icon];
          return (
            <div
              key={match.match_id}
              className="lift"
              data-files-action="open"
              data-files-match-id={match.match_id}
              style={{
                padding: 8,
                borderRadius: 9,
                background: match.highlight ? 'rgba(244,175,37,0.14)' : 'rgba(255,255,255,0.5)',
                border: match.highlight
                  ? '1px solid rgba(244,175,37,0.5)'
                  : '1px solid rgba(255,255,255,0.55)',
                boxShadow: match.highlight ? '0 0 0 2px rgba(244,175,37,0.15)' : 'none',
                position: 'relative',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  width: '100%',
                  aspectRatio: '4 / 3',
                  borderRadius: 6,
                  background: tone.bg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 5,
                  border: '1px solid rgba(255,255,255,0.4)',
                }}
              >
                <PhantomIcon name={icon} size={24} color={tone.icon} aria-hidden />
              </div>
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  color: 'var(--ink-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontFamily: 'var(--font-display)',
                }}
              >
                {displayName(match)}
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 8,
                  color: 'var(--ink-muted)',
                  marginTop: 1,
                }}
              >
                <span className="tabular">{match.size_display}</span>
                <span>{match.date_display}</span>
              </div>
              {match.highlight && (
                <div
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    padding: '2px 6px',
                    background: 'linear-gradient(135deg,var(--primary),var(--orange))',
                    color: 'white',
                    fontSize: 7,
                    fontWeight: 800,
                    letterSpacing: '0.1em',
                    borderRadius: 'var(--radius-pill)',
                    boxShadow: '0 2px 6px rgba(244,175,37,0.4)',
                    fontFamily: 'var(--font-display)',
                  }}
                >
                  BEST
                </div>
              )}
            </div>
          );
        })}
      </div>

      {data.ai_note && (
        <div
          style={{
            marginTop: 8,
            padding: '7px 10px',
            borderRadius: 8,
            background: 'rgba(244,175,37,0.06)',
            border: '1px solid rgba(244,175,37,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <PhantomIcon name="auto_awesome" size={11} color="var(--primary-deep)" aria-hidden />
          <span
            className="playfair"
            style={{
              flex: 1,
              fontSize: 11,
              fontStyle: 'italic',
              color: 'var(--ink-secondary)',
            }}
          >
            “{data.ai_note}”
          </span>
          <PhantomIcon name="check_circle" size={13} color="var(--primary-deep)" aria-hidden />
        </div>
      )}
    </div>
  );
}
