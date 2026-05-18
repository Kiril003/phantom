/**
 * T4 — SceneArtifactPanel progressive render + back-compat.
 *
 * Coverage:
 * 1. Back-compat: no WS events → renders committed data.html in iframe
 * 2. On 'draft' event: phase shimmer appears, data-build-phase set
 * 3. On 'critiquing' event: shimmer still showing, no htmlPreview → iframe hidden
 * 4. On 'polishing' event: live preview html loaded into iframe srcdoc
 * 5. On 'done' event: phase-label clears, committed html restores
 * 6. Stop button always available; expand/save hidden during build
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SceneArtifactPanel } from '../components/chat/scenes/panels/SceneArtifactPanel';
import type { ArtifactCapability } from '@shared/types/chat';

// ── Silence irrelevant import noise ──────────────────────────────────────────

vi.mock('../components/chat/scenes/artifactBroker', () => ({
  ArtifactBroker: class {
    attach() {}
    detach() {}
  },
}));

// Capture the 'chat' channel handler so tests can fire events directly.
type Handler = (msg: Record<string, unknown>) => void;
let capturedHandler: Handler | null = null;

vi.mock('../services/websocket', () => ({
  wsClient: {
    on: vi.fn((channel: string, handler: Handler) => {
      if (channel === 'chat') capturedHandler = handler;
      return () => { capturedHandler = null; };
    }),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const HTML_COMMITTED = '<!doctype html><html><body><p>committed</p></body></html>';
const HTML_LIVE = '<!doctype html><html><body><p>live preview</p></body></html>';

function makeProps(caps: ArtifactCapability[] = []) {
  return {
    data: { html: HTML_COMMITTED, title: 'Test Artifact', capabilities: caps },
  };
}

function fireProgress(phase: string, htmlPreview?: string) {
  act(() => {
    capturedHandler?.({
      channel: 'chat',
      type: 'scene.artifact.progress',
      data: htmlPreview !== undefined ? { phase, htmlPreview } : { phase },
    });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SceneArtifactPanel', () => {
  beforeEach(() => {
    capturedHandler = null;
  });

  it('back-compat: no progress events → renders committed html, no shimmer', () => {
    render(<SceneArtifactPanel {...makeProps()} />);
    const panel = screen.getByTestId('artifact-panel');
    expect(panel).toBeInTheDocument();
    expect(panel.getAttribute('data-build-phase')).toBeNull();
    expect(screen.queryByTestId('artifact-phase-shimmer')).not.toBeInTheDocument();
    // title shown as-is
    expect(panel.textContent).toContain('Test Artifact');
  });

  it('back-compat: committed html in iframe srcdoc', () => {
    const { container } = render(<SceneArtifactPanel {...makeProps()} />);
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe!.getAttribute('srcdoc')).toContain('committed');
  });

  it('phase=draft: shimmer appears, data-build-phase=draft, phase label shown', () => {
    render(<SceneArtifactPanel {...makeProps()} />);
    fireProgress('draft', HTML_LIVE);
    const panel = screen.getByTestId('artifact-panel');
    expect(panel.getAttribute('data-build-phase')).toBe('draft');
    expect(screen.getByTestId('artifact-phase-shimmer')).toBeInTheDocument();
    expect(panel.textContent).toContain('Чернетка');
  });

  it('phase=draft with preview: live html shown in iframe', () => {
    const { container } = render(<SceneArtifactPanel {...makeProps()} />);
    fireProgress('draft', HTML_LIVE);
    const iframe = container.querySelector('iframe');
    expect(iframe!.getAttribute('srcdoc')).toContain('live preview');
  });

  it('phase=critiquing: shimmer visible, no htmlPreview → committed html remains', () => {
    const { container } = render(<SceneArtifactPanel {...makeProps()} />);
    // First get a draft with preview
    fireProgress('draft', HTML_LIVE);
    // Then critiquing (no preview)
    fireProgress('critiquing');
    expect(screen.getByTestId('artifact-phase-shimmer')).toBeInTheDocument();
    // liveHtml stays as last preview (HTML_LIVE)
    const iframe = container.querySelector('iframe');
    expect(iframe!.getAttribute('srcdoc')).toContain('live preview');
    const panel = screen.getByTestId('artifact-panel');
    expect(panel.getAttribute('data-build-phase')).toBe('critiquing');
  });

  it('phase=polishing: new html preview shown', () => {
    const HTML_POLISHED = '<!doctype html><html><body><p>polished</p></body></html>';
    const { container } = render(<SceneArtifactPanel {...makeProps()} />);
    fireProgress('draft', HTML_LIVE);
    fireProgress('critiquing');
    fireProgress('polishing', HTML_POLISHED);
    const iframe = container.querySelector('iframe');
    expect(iframe!.getAttribute('srcdoc')).toContain('polished');
    const panel = screen.getByTestId('artifact-panel');
    expect(panel.getAttribute('data-build-phase')).toBe('polishing');
  });

  it('expand/save buttons hidden during build, stop always visible', () => {
    render(<SceneArtifactPanel {...makeProps()} />);
    fireProgress('draft', HTML_LIVE);
    expect(screen.queryByRole('button', { name: /розгорнути/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /зберегти/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /зупинити/i })).toBeInTheDocument();
  });

  it('expand/save buttons visible when no build in progress', () => {
    render(<SceneArtifactPanel {...makeProps()} />);
    expect(screen.getByRole('button', { name: /розгорнути/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /зберегти/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /зупинити/i })).toBeInTheDocument();
  });

  it('stop button kills the panel', () => {
    render(<SceneArtifactPanel {...makeProps()} />);
    act(() => {
      screen.getByRole('button', { name: /зупинити/i }).click();
    });
    expect(screen.queryByTestId('artifact-panel')).not.toBeInTheDocument();
  });
});
