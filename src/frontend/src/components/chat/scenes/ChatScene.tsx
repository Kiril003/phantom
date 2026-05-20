/**
 * Phase-5 R1 — `ChatScene` router (B-17).
 *
 * `ChatScene` is the single entry point for any rich card embedded in
 * the chat transcript. It accepts the super-union `ChatScene` envelope
 * from `@shared/types` and dispatches to:
 *
 *  - the Day-4 W-2 panel composer (`SceneComposer`), for the original
 *    panel-shaped envelopes (`kind: 'text'|'list'|'map-pin'|'plan'|
 *    'code-preview'|'identity-card'`); OR
 *  - one of the eight Phase-5 tool-result scene cards, for the new
 *    `kind: 'timer'|'alarm'|'calendar'|'files'|'audit'|'wardriving'|
 *    'location'|'checkpoint'|'sandbox'` envelopes returned by
 *    `tool_executor.py`.
 *
 * The two arms are disjoint by `kind`; we narrow at runtime by the
 * presence of the `data` field, then by `kind` value, with an exhaustive
 * `_exhaustive: never` check at the bottom of the switch.
 *
 * Back-compat invariant per ADR-CS-002 §60: any persisted `ChatMessage`
 * with a Day-4 panel-shaped scene MUST keep rendering byte-identical
 * through `SceneComposer`. Adding a new tool-scene kind requires
 * (a) extending `ChatToolScene` in `@shared/types/chat.ts`,
 * (b) adding a `case` here, and (c) implementing the matching
 * `*Scene.tsx` component under `./` plus a re-export in `./index.ts`.
 *
 * The router NEVER fetches data, NEVER mutates the envelope, and NEVER
 * decides reveal choreography for tool scenes — those cards are
 * self-contained and animate themselves on mount.
 */
import type { ChatScene as ChatSceneEnvelope } from '@shared/types';
import { SceneComposer, STAGGER_CLAMP_MAX_MS } from './SceneComposer';
import { TimerScene } from './TimerScene';
import { AlarmScene } from './AlarmScene';
import { CalendarScene } from './CalendarScene';
import { FilesScene } from './FilesScene';
import { AuditScene } from './AuditScene';
import { WardrivingScene } from './WardrivingScene';
import { LocationScene } from './LocationScene';
import { CheckpointScene } from './CheckpointScene';
import { SandboxScene } from './SandboxScene';
import { PhantomManifestScene } from './PhantomManifestScene';
import { OrchestrationFlowScene } from './OrchestrationFlowScene';
import { ObjectionScene } from './ObjectionScene';
import { PatchFileScene } from './PatchFileScene';

export { STAGGER_CLAMP_MAX_MS };

export interface ChatSceneProps {
  scene: ChatSceneEnvelope;
  /** Suppress reveal animation; honoured by the W-2 composer path. */
  reduceMotion?: boolean;
}

/**
 * Discriminator: the W-2 composer arm carries a `panels` array; the
 * tool-scene arm carries a `data` object. We branch on `'data' in scene`
 * because both arms set a `kind` but with disjoint string values.
 */
function isToolScene(scene: ChatSceneEnvelope): scene is Extract<ChatSceneEnvelope, { data: unknown }> {
  return Object.prototype.hasOwnProperty.call(scene, 'data');
}

export function ChatScene({ scene, reduceMotion = false }: ChatSceneProps) {
  if (!isToolScene(scene)) {
    return <SceneComposer scene={scene} reduceMotion={reduceMotion} />;
  }

  switch (scene.kind) {
    case 'timer':
      return <TimerScene data={scene.data} />;
    case 'alarm':
      return <AlarmScene data={scene.data} />;
    case 'calendar':
      return <CalendarScene data={scene.data} />;
    case 'files':
      return <FilesScene data={scene.data} />;
    case 'audit':
      return <AuditScene data={scene.data} />;
    case 'wardriving':
      return <WardrivingScene data={scene.data} />;
    case 'location':
      return <LocationScene data={scene.data} />;
    case 'checkpoint':
      return <CheckpointScene data={scene.data} />;
    case 'sandbox':
      return <SandboxScene data={scene.data} />;
    case 'phantom_manifest':
      return <PhantomManifestScene data={scene.data} />;
    case 'orchestration_flow':
      return <OrchestrationFlowScene data={scene.data} />;
    case 'objection':
      return <ObjectionScene data={scene.data} />;
    case 'patch_file':
      return <PatchFileScene data={scene.data} />;
    default: {
      // Exhaustiveness check — adding a new ToolSceneKind without a case
      // here triggers a compile error at `_exhaustive: never`.
      const _exhaustive: never = scene;
      void _exhaustive;
      return <UnknownSceneFallback />;
    }
  }
}

function UnknownSceneFallback() {
  return (
    <div
      role="alert"
      className="sub-glass"
      style={{
        padding: '10px 14px',
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--fs-xs)',
        color: 'var(--ink-muted)',
        letterSpacing: 'var(--tracking-wide)',
      }}
      data-testid="chat-scene-unknown"
    >
      <span className="micro-label" style={{ marginRight: 8 }}>
        SCENE
      </span>
      unknown scene kind — operator should refresh.
    </div>
  );
}
