/**
 * Day-4 W-2 — barrel export for the ChatScene composer family.
 *
 * Always import from this barrel (`'./scenes'`) so a future move
 * of the panels directory doesn't ripple through callers. Adding a
 * new panel kind requires (a) a new file under `./panels/`, (b)
 * a re-export here, (c) a `case` in `ChatScene.PanelByKind`, and
 * (d) the matching `ScenePanelKind` member in `@shared/types`.
 */
export { ChatScene, STAGGER_CLAMP_MAX_MS } from './ChatScene';
export type { ChatSceneProps } from './ChatScene';
export { SceneTextPanel } from './panels/SceneTextPanel';
export { SceneListPanel } from './panels/SceneListPanel';
export { SceneMapPinPanel } from './panels/SceneMapPinPanel';
export { ScenePlanStepPanel } from './panels/ScenePlanStepPanel';
export { SceneCodePreviewPanel } from './panels/SceneCodePreviewPanel';
export { SceneIdentityCardPanel } from './panels/SceneIdentityCardPanel';
