import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { ChatMessage, ResponseForm, ChatAttachment } from '@shared/types';
import { ResponseRenderer } from '../components/chat/ResponseRenderer';

function msg(form: ResponseForm, attachments: ChatAttachment[], content = ''): ChatMessage {
  return { response_form: form, content, attachments } as unknown as ChatMessage;
}

describe('rich response forms', () => {
  it('renders a comparison with winner + recommendation', () => {
    const { getByText } = render(
      <ResponseRenderer
        message={msg('comparison', [{
          type: 'comparison_data',
          data: {
            title: 'Vite vs Webpack',
            options: ['Vite', 'Webpack'],
            rows: [{ criterion: 'Швидкість', values: ['швидко', 'повільно'], winner: 0 }],
            recommendation: 'Бери Vite',
          },
        }])}
      />
    );
    expect(getByText('Vite vs Webpack')).toBeTruthy();
    expect(getByText('Швидкість')).toBeTruthy();
    expect(getByText('Бери Vite')).toBeTruthy();
  });

  it('renders a timeline with events', () => {
    const { getByText } = render(
      <ResponseRenderer
        message={msg('timeline', [{
          type: 'timeline_data',
          data: { title: 'План', events: [
            { time: '09:00', title: 'Старт', detail: 'почали', status: 'done' },
            { title: 'Зараз', status: 'active' },
          ] },
        }])}
      />
    );
    expect(getByText('Старт')).toBeTruthy();
    expect(getByText('09:00')).toBeTruthy();
    expect(getByText('Зараз')).toBeTruthy();
  });

  it('renders a definition with examples', () => {
    const { getByText } = render(
      <ResponseRenderer
        message={msg('definition', [{
          type: 'definition_data',
          data: {
            term: 'Симбіоз',
            category: 'біологія',
            definition: 'співіснування',
            examples: ['лишайник'],
          },
        }])}
      />
    );
    expect(getByText('Симбіоз')).toBeTruthy();
    expect(getByText('співіснування')).toBeTruthy();
    expect(getByText('«лишайник»')).toBeTruthy();
  });

  it('renders a stat highlight with delta', () => {
    const { getByText } = render(
      <ResponseRenderer
        message={msg('stat_highlight', [{
          type: 'stat_data',
          data: { value: '42', label: 'Відповідь', unit: 'млн', delta: '+12%', trend: 'up' },
        }])}
      />
    );
    expect(getByText('42')).toBeTruthy();
    expect(getByText('Відповідь')).toBeTruthy();
    expect(getByText('+12%')).toBeTruthy();
  });

  it('falls back to text when attachment missing', () => {
    const { container } = render(
      <ResponseRenderer message={msg('comparison', [], 'просто текст')} />
    );
    expect(container.textContent).toContain('просто текст');
  });

  // chat-teardown §2.2 — `response_form` is typed `ResponseForm` (a
  // closed union in @shared/types/chat.ts) but arrives over the wire as
  // an untyped string with no runtime enforcement on either side. This
  // shipped for real: the backend's `_FORM_MAP` mapped `respond_artifact`
  // to `'react_artifact'`, which is a SceneKind/ChatToolScene
  // discriminator (chat.ts:613), never a member of ResponseForm
  // (chat.ts:4-18). It went unnoticed because such messages always also
  // carried a `scene` envelope, which MessageBubble renders instead of
  // ever calling ResponseRenderer — so this exact illegal value never
  // hit the switch below in production. If it ever does (this message
  // has no scene, forcing MessageBubble to fall through to
  // ResponseRenderer), it must be surfaced loudly, not quietly rendered
  // as if it were ordinary markdown.
  it('surfaces an unknown response_form instead of silently degrading to plain markdown', () => {
    const illegalForm = 'react_artifact' as unknown as ResponseForm;
    const { getByRole } = render(
      <ResponseRenderer message={msg(illegalForm, [], 'секретний вміст артефакту')} />
    );
    const alert = getByRole('alert');
    expect(alert.textContent).toContain('react_artifact');
    expect(alert.textContent).toContain('секретний вміст артефакту');
  });
});
