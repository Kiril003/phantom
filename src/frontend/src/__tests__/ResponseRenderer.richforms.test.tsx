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
});
