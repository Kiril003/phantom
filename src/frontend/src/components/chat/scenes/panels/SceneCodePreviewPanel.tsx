/**
 * Day-4 W-2 — `code-preview` scene panel.
 *
 * Single-language code block. Day-4 ships flat `<pre>` rendering;
 * Day-5 brings highlight.js / shiki. The `runnable` flag is exposed
 * as a data attribute (`data-runnable`) but the run button
 * lands with Y-2 (sandbox retarget) — until then a runnable preview
 * is just a styled hint.
 *
 * The block is horizontally scrollable inside a fixed
 * 1024px chat area — long lines must NOT push siblings off the
 * viewport.
 */
import type { ScenePanel } from '@shared/types';
import { Code2 } from 'lucide-react';

type CodePreviewPanelData = Extract<ScenePanel, { kind: 'code-preview' }>['data'];

export function SceneCodePreviewPanel({ data }: { data: CodePreviewPanelData }) {
  return (
    <div
      className="rounded glass-subtle"
      style={{ overflow: 'hidden' }}
      data-testid="scene-code-preview-panel"
      data-language={data.language}
      data-runnable={data.runnable ? '1' : '0'}
    >
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 border-b"
        style={{
          borderColor: 'var(--glass-border)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-micro)',
          color: 'var(--ink-secondary)',
          letterSpacing: 'var(--tracking-wide)',
          textTransform: 'lowercase',
        }}
      >
        <Code2 size={11} strokeWidth={1.75} aria-hidden />
        <span>{data.language || 'text'}</span>
        {data.runnable && (
          <span
            className="ml-auto inline-flex items-center gap-1"
            style={{ color: 'var(--accent)' }}
          >
            ▷ runnable
          </span>
        )}
      </div>
      <pre
        className="px-3 py-2 overflow-x-auto"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-micro)',
          color: 'var(--ink-primary)',
          lineHeight: 'var(--lh-tight)',
          margin: 0,
        }}
      >
        <code>{data.code}</code>
      </pre>
    </div>
  );
}
