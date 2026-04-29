/**
 * PhantomManifestScene — chat-router arm for `kind: 'phantom_manifest'`.
 *
 * Doesn't render the creature itself — the global `<PhantomFamiliar />`
 * overlay does that. Instead, it:
 *   1. asks `familiarStore.manifest('ai-summon', { pose, message,
 *      durationMs, target })` on mount (exactly once per scene instance);
 *   2. renders a small caption card in the chat transcript so there's a
 *      durable record of what the Familiar said when the user scrolls
 *      back later.
 *
 * The `ai-summon` trigger bypasses the rarity gate, so when the AI emits
 * this scene the Familiar is guaranteed to appear.
 */
import { useEffect, useRef } from 'react';
import { useFamiliarStore } from '../../../stores/familiarStore';
import type { PhantomManifestSceneData } from '@shared/types';

export interface PhantomManifestSceneProps {
  data: PhantomManifestSceneData;
}

export function PhantomManifestScene({ data }: PhantomManifestSceneProps) {
  const summonedRef = useRef<boolean>(false);

  useEffect(() => {
    if (summonedRef.current) return;
    summonedRef.current = true;
    useFamiliarStore.getState().manifest('ai-summon', {
      pose: data.pose,
      message: data.message,
      durationMs: data.durationMs,
      target: data.target,
    });
  }, [data]);

  return (
    <div
      className="sub-glass"
      data-testid="scene-phantom-manifest"
      data-pose={data.pose}
      style={{
        padding: '10px 14px',
        borderRadius: 12,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        maxWidth: 420,
        background: 'rgba(244,175,37,0.08)',
        border: '1px solid rgba(244,175,37,0.28)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background:
            'radial-gradient(circle at 30% 30%, #ffffff, #f4af25 70%)',
          boxShadow: '0 0 12px rgba(244,175,37,0.55)',
          flexShrink: 0,
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span
          className="micro-label"
          style={{
            fontSize: 9,
            letterSpacing: '0.14em',
            color: '#b07a10',
            fontWeight: 700,
            textTransform: 'uppercase',
          }}
        >
          Familiar · {data.pose}
        </span>
        {data.message && (
          <span
            className="playfair"
            style={{
              fontSize: 12,
              fontStyle: 'italic',
              color: 'var(--ink-secondary, #5b5147)',
              lineHeight: 1.35,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            “{data.message}”
          </span>
        )}
      </div>
    </div>
  );
}

export default PhantomManifestScene;
