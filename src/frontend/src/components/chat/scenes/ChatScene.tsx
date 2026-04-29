/**
 * Day-4 Wave-2 W-2 — ChatScene composer (ADR-CS-001 / ADR-CS-002).
 *
 * The composer takes a typed `ChatScene` envelope (carried optionally on
 * `ChatMessage.scene` per W-1) and renders the panels in order, applying
 * the scene-level reveal choreography. Each preset panel is its own
 * lightweight component under `./panels/` — the composer only knows how
 * to (a) pick the right panel by `panel.kind`, and (b) sequence them.
 *
 * Closed-enum integrity: the `PanelByKind` switch is *exhaustive*. Adding
 * a 7th `ScenePanelKind` requires the TypeScript compiler to flag the
 * missing case at the `_exhaustive: never` line. No stringly-typed
 * backdoors.
 *
 * Reveal policy:
 *  - `sequential` — each panel arrives `idx * staggerMs` after the
 *    composer mounts. Staggers clamp to [0, 240] ms so a 12-panel
 *    plan-scene cannot block the UI for 10 seconds on a slow render.
 *  - `cascade`    — same as sequential but the first panel arrives
 *    instantly and the rest cascade off it. Identical visually under
 *    the current vocabulary; reserved for Day-5 motion polish.
 *  - `instant`    — all panels render with `delay=0`. Used by the
 *    proactive-emit path (B-1, Day-5) where the operator should
 *    notice the WHOLE scene, not its construction.
 *
 * The composer NEVER fetches data, NEVER mutates `scene`, and NEVER
 * imports from outside `@shared/types` + `../../../styles/motion`. It is
 * a pure transform from envelope → DOM.
 */
import { motion, AnimatePresence } from 'framer-motion';
import type { ChatScene as ChatSceneEnvelope, ScenePanel } from '@shared/types';
import { phantomVariants, getPhantomTransition } from '../../../styles/motion';
import { SceneTextPanel } from './panels/SceneTextPanel';
import { SceneListPanel } from './panels/SceneListPanel';
import { SceneMapPinPanel } from './panels/SceneMapPinPanel';
import { ScenePlanStepPanel } from './panels/ScenePlanStepPanel';
import { SceneCodePreviewPanel } from './panels/SceneCodePreviewPanel';
import { SceneIdentityCardPanel } from './panels/SceneIdentityCardPanel';

/** Operator-tunable; stagger CANNOT exceed this even if the envelope says so. */
export const STAGGER_CLAMP_MAX_MS = 240;

export interface ChatSceneProps {
  scene: ChatSceneEnvelope;
  /** Suppress reveal animation; used for tests + a11y reduce-motion. */
  reduceMotion?: boolean;
}

export function ChatScene({ scene, reduceMotion = false }: ChatSceneProps) {
  const policy = scene.reveal?.policy ?? 'sequential';
  const rawStagger = scene.reveal?.staggerMs ?? 80;
  const staggerMs = Math.min(Math.max(rawStagger, 0), STAGGER_CLAMP_MAX_MS);

  return (
    <div
      className="flex flex-col gap-2"
      data-scene-kind={scene.kind}
      data-reveal-policy={policy}
      data-stagger-ms={staggerMs}
    >
      <AnimatePresence initial={!reduceMotion}>
        {scene.panels.map((panel, idx) => {
          const delaySec =
            reduceMotion || policy === 'instant'
              ? 0
              : (idx * staggerMs) / 1000;
          return (
            <motion.div
              key={panel.id}
              initial={reduceMotion ? false : phantomVariants.panelReveal.initial}
              animate={phantomVariants.panelReveal.animate}
              transition={{
                ...getPhantomTransition('panelReveal'),
                delay: delaySec,
              }}
              data-panel-id={panel.id}
              data-panel-kind={panel.kind}
            >
              <PanelByKind panel={panel} />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function PanelByKind({ panel }: { panel: ScenePanel }) {
  switch (panel.kind) {
    case 'text':
      return <SceneTextPanel data={panel.data} />;
    case 'list':
      return <SceneListPanel data={panel.data} />;
    case 'map-pin':
      return <SceneMapPinPanel data={panel.data} />;
    case 'plan-step':
      return <ScenePlanStepPanel data={panel.data} />;
    case 'code-preview':
      return <SceneCodePreviewPanel data={panel.data} />;
    case 'identity-card':
      return <SceneIdentityCardPanel data={panel.data} />;
    default: {
      // Exhaustiveness check — adding a new ScenePanelKind without a case
      // here triggers a compile error at `_exhaustive: never`.
      const _exhaustive: never = panel;
      void _exhaustive;
      return null;
    }
  }
}
