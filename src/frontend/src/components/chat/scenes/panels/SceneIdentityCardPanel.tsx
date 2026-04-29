/**
 * Day-4 W-2 — `identity-card` scene panel.
 *
 * Renders a short who-is-this card: avatar slot, display name, trust
 * score, and a compact list of facts. The `sensitive` flag on a fact
 * is rendered with a placeholder dot pattern (•••) by default; clicking
 * the row reveals the value (Day-5 — wire `useState` reveal). For
 * Day-4 sensitive facts stay opaque on first paint, which is the
 * correct privacy default.
 *
 * Trust is rendered as a 0-1 fraction visualised as a 5-segment bar
 * for at-a-glance reading. The composer keeps 1024px-wide sanity:
 * card width caps at 320px so two cards can sit side-by-side in a
 * future grid scene.
 */
import type { ScenePanel } from '@shared/types';
import { ShieldCheck, Eye, EyeOff } from 'lucide-react';

type IdentityCardPanelData = Extract<ScenePanel, { kind: 'identity-card' }>['data'];

function clampTrust(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

export function SceneIdentityCardPanel({ data }: { data: IdentityCardPanelData }) {
  const trust = clampTrust(data.trust);
  const segments = 5;
  const filled = Math.round(trust * segments);

  return (
    <div
      className="rounded glass-panel px-3 py-3 flex flex-col gap-2"
      style={{ maxWidth: 320 }}
      data-testid="scene-identity-card-panel"
      data-user-id={data.user_id}
    >
      <div className="flex items-center gap-2">
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: 28,
            height: 28,
            background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
            border:
              '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
            color: 'var(--accent)',
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-sm)',
          }}
          aria-hidden
        >
          {data.display_name.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-base)',
              color: 'var(--ink-primary)',
            }}
          >
            {data.display_name}
          </span>
          <span
            className="inline-flex items-center gap-1"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-micro)',
              color: 'var(--ink-muted)',
              letterSpacing: 'var(--tracking-wide)',
            }}
          >
            <ShieldCheck size={10} strokeWidth={1.75} aria-hidden />
            trust
            <span className="inline-flex items-center gap-0.5 ml-0.5">
              {Array.from({ length: segments }).map((_, idx) => (
                <span
                  key={idx}
                  aria-hidden
                  className="block rounded-sm"
                  style={{
                    width: 6,
                    height: 4,
                    background:
                      idx < filled
                        ? 'var(--accent)'
                        : 'color-mix(in srgb, var(--ink-muted) 30%, transparent)',
                  }}
                />
              ))}
            </span>
          </span>
        </div>
      </div>

      {data.facts.length > 0 && (
        <ul
          className="flex flex-col gap-1"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-sm)',
          }}
        >
          {data.facts.map((fact) => (
            <li
              key={fact.id}
              className="flex items-center justify-between gap-2"
              data-fact-sensitive={fact.sensitive ? '1' : '0'}
            >
              <span style={{ color: 'var(--ink-secondary)' }}>{fact.label}</span>
              <span
                className="inline-flex items-center gap-1"
                style={{ color: 'var(--ink-primary)' }}
              >
                {fact.sensitive ? (
                  <>
                    <span aria-label="sensitive value hidden">•••</span>
                    <EyeOff
                      size={10}
                      strokeWidth={1.75}
                      color="var(--ink-muted)"
                      aria-hidden
                    />
                  </>
                ) : (
                  <>
                    <span>{fact.value}</span>
                    <Eye
                      size={10}
                      strokeWidth={1.75}
                      color="var(--ink-muted)"
                      aria-hidden
                    />
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
