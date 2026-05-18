import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ChatMessage, ChatScene as ChatSceneEnvelope } from '@shared/types';
import { MessageBubble } from '../components/chat/MessageBubble';

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<object>('framer-motion');
  return { ...actual };
});

const artifactScene: ChatSceneEnvelope = {
  kind: 'artifact',
  reveal: { policy: 'instant', staggerMs: 0 },
  panels: [
    {
      id: 'p0',
      kind: 'artifact',
      data: { html: '<b>x</b>', title: 'Pulse', capabilities: [] },
    },
  ],
} as ChatSceneEnvelope;

function msg(over: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: '',
    created_at: new Date().toISOString(),
    ...over,
  } as ChatMessage;
}

describe('MessageBubble artifact breakout', () => {
  it('renders an artifact scene full-bleed, outside the 82% text bubble', () => {
    const { container, getByTestId } = render(
      <MessageBubble message={msg({ scene: artifactScene })} />,
    );
    // The artifact must escape the narrow padded chat bubble.
    const breakout = getByTestId('scene-breakout');
    expect(breakout).toBeTruthy();
    expect(container.querySelector('iframe')).not.toBeNull();
    // No ancestor caps the artifact at the text-bubble 82%.
    const capped = Array.from(
      container.querySelectorAll<HTMLElement>('*'),
    ).some((el) => el.style.maxWidth === '82%' && el.contains(breakout));
    expect(capped).toBe(false);
  });

  it('keeps a normal text reply inside the standard bubble (no breakout)', () => {
    const { queryByTestId } = render(
      <MessageBubble message={msg({ content: 'привіт' })} />,
    );
    expect(queryByTestId('scene-breakout')).toBeNull();
  });
});
