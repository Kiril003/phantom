/**
 * Day-4 Wave-2 W-3 — AttachDrawer + ModelCard pin.
 *
 * Coverage:
 *
 * 1. AttachDrawer renders 5 entries with the right kind keys (closed
 *    enum AttachKind).
 * 2. Selecting an entry calls onSelect with the matching kind + hint.
 * 3. Selecting an entry calls onClose (single-shot semantics — the
 *    drawer dismisses after each selection).
 * 4. The X button calls onClose.
 * 5. AttachDrawer respects the `open` prop (closed → no DOM, open → DOM).
 * 6. Each tap target meets the 44x44 minimum (CLAUDE.md rule 3).
 *
 * 7. ModelCard reads provider/stt and exposes them as data attrs.
 * 8. ModelCard renders the dash placeholder when provider is null.
 * 9. ModelCard hides the STT chip when sttEngine is null/empty.
 * 10. ModelCard renders the optional `overlay` text when provided.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  AttachDrawer,
  type AttachSelection,
} from '../components/chat/AttachDrawer';
import { ModelCard } from '../components/chat/ModelCard';

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<object>('framer-motion');
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    motion: new Proxy(
      {},
      {
        get: () => (props: Record<string, unknown>) => {
          const { children, ...rest } = props as {
            children?: React.ReactNode;
          };
          return <div {...(rest as object)}>{children}</div>;
        },
      }
    ),
  };
});

describe('AttachDrawer (W-3)', () => {
  it('renders 5 entries when open', () => {
    render(
      <AttachDrawer open onClose={() => {}} onSelect={() => {}} />
    );
    const drawer = screen.getByTestId('attach-drawer');
    const buttons = drawer.querySelectorAll('[data-attach-kind]');
    expect(buttons).toHaveLength(5);
    const kinds = Array.from(buttons).map((el) =>
      el.getAttribute('data-attach-kind')
    );
    expect(kinds).toEqual(['file', 'screenshot', 'recall', 'code', 'sandbox']);
  });

  it('renders nothing when open=false', () => {
    render(
      <AttachDrawer open={false} onClose={() => {}} onSelect={() => {}} />
    );
    expect(screen.queryByTestId('attach-drawer')).not.toBeInTheDocument();
  });

  it('calls onSelect + onClose when an entry is tapped', () => {
    const onSelect = vi.fn<(s: AttachSelection) => void>();
    const onClose = vi.fn();
    render(<AttachDrawer open onClose={onClose} onSelect={onSelect} />);

    const screenshotBtn = screen
      .getByTestId('attach-drawer')
      .querySelector('[data-attach-kind="screenshot"]')!;
    fireEvent.click(screenshotBtn);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].kind).toBe('screenshot');
    expect(typeof onSelect.mock.calls[0][0].hint).toBe('string');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the X button is tapped', () => {
    const onClose = vi.fn();
    render(<AttachDrawer open onClose={onClose} onSelect={() => {}} />);
    const closeBtn = screen.getByLabelText('Close attach drawer');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('every tap target meets the 44x44 minimum', () => {
    render(<AttachDrawer open onClose={() => {}} onSelect={() => {}} />);
    const drawer = screen.getByTestId('attach-drawer');
    const tappable = drawer.querySelectorAll('[data-attach-kind], button');
    expect(tappable.length).toBeGreaterThan(0);
    for (const el of Array.from(tappable)) {
      const style = (el as HTMLElement).style;
      // The component sets minWidth/minHeight inline; assert >= 44 px.
      const minW = parseInt(style.minWidth || '0', 10);
      const minH = parseInt(style.minHeight || '0', 10);
      expect(minW).toBeGreaterThanOrEqual(44);
      expect(minH).toBeGreaterThanOrEqual(44);
    }
  });
});

describe('ModelCard (W-3)', () => {
  it('exposes provider + stt as data attrs', () => {
    render(<ModelCard provider="gemini" sttEngine="whisper" />);
    const card = screen.getByTestId('model-card');
    expect(card.getAttribute('data-provider')).toBe('gemini');
    expect(card.getAttribute('data-stt')).toBe('whisper');
    expect(card).toHaveTextContent(/gemini/i);
    expect(card).toHaveTextContent(/whisper/i);
  });

  it('renders dash placeholder when provider is null', () => {
    render(<ModelCard provider={null} />);
    const card = screen.getByTestId('model-card');
    expect(card.getAttribute('data-provider')).toBe('unknown');
    expect(card).toHaveTextContent('—');
  });

  it('hides the STT chip when sttEngine omitted', () => {
    render(<ModelCard provider="ollama" />);
    const card = screen.getByTestId('model-card');
    expect(card.getAttribute('data-stt')).toBe('none');
    // No `whisper`/`vosk` text — STT chip not rendered.
    expect(card.textContent).not.toMatch(/whisper|vosk/i);
  });

  it('renders the optional overlay text when provided', () => {
    render(
      <ModelCard provider="gemini" sttEngine="vosk" overlay="ctx 2.4k" />
    );
    expect(screen.getByText('ctx 2.4k')).toBeInTheDocument();
  });
});
