/**
 * Day-4 W-2 — `text` scene panel.
 *
 * Renders the markdown text body of a scene panel. Day-4 ships a
 * lightweight pre-formatted rendering (whitespace preserved, line
 * wraps respected); a full markdown parser is Day-5+ polish.
 * Whatever renders here MUST be wrappable in 1024px width without
 * horizontal scrolling (CLAUDE.md rule 3).
 */
import type { ScenePanel } from '@shared/types';

type TextPanelData = Extract<ScenePanel, { kind: 'text' }>['data'];

export function SceneTextPanel({ data }: { data: TextPanelData }) {
  return (
    <div
      className="whitespace-pre-wrap break-words"
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--fs-base)',
        color: 'var(--ink-primary)',
        lineHeight: 'var(--lh-normal)',
      }}
      data-testid="scene-text-panel"
    >
      {data.markdown}
    </div>
  );
}
