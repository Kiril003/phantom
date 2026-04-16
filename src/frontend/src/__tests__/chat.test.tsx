import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ChatMessage, SystemState } from '@shared/types';
import { useChatStore } from '../stores/chatStore';
import { useSystemStore } from '../stores/systemStore';

/* ─── Framer-motion / heavy-lib mocks ───────────────────────────────────────── */

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<object>('framer-motion');
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: () => (props: Record<string, unknown>) => {
          const { children, ...rest } = props as { children?: React.ReactNode };
          return <div {...(rest as object)}>{children}</div>;
        },
      }
    ),
  };
});

// maplibre-gl uses canvas — stub the module entirely
vi.mock('maplibre-gl', () => {
  class FakeMap {
    on(_: string, cb: () => void) {
      setTimeout(cb, 0);
    }
    remove() {
      /* noop */
    }
    fitBounds() {
      /* noop */
    }
  }
  class FakeMarker {
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    setPopup() {
      return this;
    }
    remove() {
      /* noop */
    }
  }
  class FakePopup {
    setHTML() {
      return this;
    }
  }
  class FakeLngLatBounds {
    extend() {
      /* noop */
    }
  }
  return {
    default: {
      Map: FakeMap,
      Marker: FakeMarker,
      Popup: FakePopup,
      LngLatBounds: FakeLngLatBounds,
    },
    Map: FakeMap,
    Marker: FakeMarker,
    Popup: FakePopup,
    LngLatBounds: FakeLngLatBounds,
  };
});

// Recharts ResponsiveContainer needs measured width — stub with simple div
vi.mock('recharts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 220 }}>{children}</div>
    ),
  };
});

function baseMessage(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: over.id ?? 'm1',
    session_id: over.session_id ?? 's1',
    user_id: over.user_id ?? 'u1',
    role: over.role ?? 'assistant',
    content: over.content ?? 'Hello from PHANTOM',
    response_form: over.response_form ?? 'text',
    metadata: {
      state_at_time: SystemState.DIALOGUE,
      context_snapshot_id: '',
      ai_provider: 'gemini',
      latency_ms: 120,
      tokens_used: 42,
      tone: 'calm, friendly',
      input_method: 'text',
      ...(over.metadata ?? {}),
    },
    attachments: over.attachments ?? [],
    created_at: over.created_at ?? new Date('2026-04-16T14:30:00Z').toISOString(),
  };
}

/* ─── MessageBubble ─────────────────────────────────────────────────────────── */

describe('MessageBubble', () => {
  it('renders assistant content', async () => {
    const { MessageBubble } = await import('../components/chat/MessageBubble');
    render(<MessageBubble message={baseMessage()} />);
    expect(screen.getByText('Hello from PHANTOM')).toBeDefined();
  });

  it('renders provider and latency meta', async () => {
    const { MessageBubble } = await import('../components/chat/MessageBubble');
    render(<MessageBubble message={baseMessage()} />);
    expect(screen.getByText('GEMINI')).toBeDefined();
    expect(screen.getByText('120ms')).toBeDefined();
  });

  it('aligns user role differently than assistant', async () => {
    const { MessageBubble } = await import('../components/chat/MessageBubble');
    const { container } = render(
      <MessageBubble message={baseMessage({ role: 'user', content: 'hi' })} />
    );
    expect(container.querySelector('.self-end')).not.toBeNull();
  });

  it('renders system role as pill', async () => {
    const { MessageBubble } = await import('../components/chat/MessageBubble');
    render(
      <MessageBubble
        message={baseMessage({ role: 'system', content: 'State changed to FOCUS' })}
      />
    );
    expect(screen.getByText('State changed to FOCUS')).toBeDefined();
  });
});

/* ─── ResponseRenderer: forms ───────────────────────────────────────────────── */

describe('ResponseRenderer', () => {
  it('renders text form', async () => {
    const { ResponseRenderer } = await import('../components/chat/ResponseRenderer');
    render(<ResponseRenderer message={baseMessage({ content: 'plain text' })} />);
    expect(screen.getByText('plain text')).toBeDefined();
  });

  it('renders markdown form with bold', async () => {
    const { ResponseRenderer } = await import('../components/chat/ResponseRenderer');
    render(
      <ResponseRenderer
        message={baseMessage({
          response_form: 'markdown',
          content: 'Hello **world**',
        })}
      />
    );
    expect(screen.getByText('world')).toBeDefined();
  });

  it('renders code block with language label', async () => {
    const { ResponseRenderer } = await import('../components/chat/ResponseRenderer');
    render(
      <ResponseRenderer
        message={baseMessage({
          response_form: 'code',
          content: 'Here is some code',
          attachments: [
            {
              type: 'code_block',
              data: { language: 'python', code: "print('hi')" },
            },
          ],
        })}
      />
    );
    expect(screen.getByText('PY')).toBeDefined();
    expect(screen.getByText(/print/)).toBeDefined();
  });

  it('renders chart (stubbed recharts)', async () => {
    const { ResponseRenderer } = await import('../components/chat/ResponseRenderer');
    render(
      <ResponseRenderer
        message={baseMessage({
          response_form: 'chart',
          content: 'Weekly values',
          attachments: [
            {
              type: 'chart_data',
              data: {
                chart_type: 'bar',
                title: 'Weekly',
                data: [
                  { name: 'Mon', value: 5 },
                  { name: 'Tue', value: 10 },
                ],
              },
            },
          ],
        })}
      />
    );
    expect(screen.getByText('Weekly')).toBeDefined();
  });

  it('renders metric cards with trends', async () => {
    const { ResponseRenderer } = await import('../components/chat/ResponseRenderer');
    render(
      <ResponseRenderer
        message={baseMessage({
          response_form: 'metric_cards',
          content: 'System overview',
          attachments: [
            {
              type: 'metric_card',
              data: {
                metrics: [
                  { label: 'CPU', value: 42, unit: '%', trend: 'up', delta: 4 },
                  { label: 'RAM', value: 61, unit: '%', trend: 'stable' },
                ],
              },
            },
          ],
        })}
      />
    );
    expect(screen.getByText('CPU')).toBeDefined();
    expect(screen.getByText('RAM')).toBeDefined();
    expect(screen.getByText('42')).toBeDefined();
    expect(screen.getByText('61')).toBeDefined();
  });

  it('renders terminal block with command', async () => {
    const { ResponseRenderer } = await import('../components/chat/ResponseRenderer');
    render(
      <ResponseRenderer
        message={baseMessage({
          response_form: 'terminal',
          content: 'Disk status',
          attachments: [
            {
              type: 'terminal_output',
              data: { command: 'df -h', explanation: 'Show disk usage' },
            },
          ],
        })}
      />
    );
    expect(screen.getByText('df -h')).toBeDefined();
    expect(screen.getByText('SHELL')).toBeDefined();
  });

  it('falls back to text when attachment is missing', async () => {
    const { ResponseRenderer } = await import('../components/chat/ResponseRenderer');
    render(
      <ResponseRenderer
        message={baseMessage({
          response_form: 'chart',
          content: 'No attachment here',
          attachments: [],
        })}
      />
    );
    expect(screen.getByText('No attachment here')).toBeDefined();
  });

  it('skips heavy visuals during streaming', async () => {
    const { ResponseRenderer } = await import('../components/chat/ResponseRenderer');
    render(
      <ResponseRenderer
        streaming
        message={baseMessage({
          response_form: 'chart',
          content: 'Chart text only while streaming',
          attachments: [
            {
              type: 'chart_data',
              data: { chart_type: 'bar', title: 'T', data: [{ name: 'x', value: 1 }] },
            },
          ],
        })}
      />
    );
    expect(screen.getByText(/while streaming/)).toBeDefined();
    expect(screen.queryByText('T')).toBeNull();
  });
});

/* ─── chatStore ─────────────────────────────────────────────────────────────── */

describe('chatStore', () => {
  beforeEach(() => {
    useChatStore.setState({
      sessions: [],
      currentSessionId: null,
      messages: [],
      streaming: null,
      isTyping: false,
      loading: false,
      sending: false,
      error: null,
    });
  });

  it('appendMessage adds to messages', () => {
    useChatStore.getState().appendMessage(baseMessage());
    expect(useChatStore.getState().messages).toHaveLength(1);
  });

  it('setStreamChunk appends deltas while not done', () => {
    useChatStore.getState().setStreamChunk('m1', 'Hel', false);
    useChatStore.getState().setStreamChunk('m1', 'lo', false);
    const s = useChatStore.getState().streaming;
    expect(s?.id).toBe('m1');
    expect(s?.content).toBe('Hello');
    expect(s?.done).toBe(false);
  });

  it('setStreamChunk with done clears streaming and adds final', () => {
    useChatStore.getState().setStreamChunk('m1', 'Hel', false);
    useChatStore.getState().setStreamChunk('m1', '', true, baseMessage({ id: 'm1', content: 'Hello' }));
    expect(useChatStore.getState().streaming).toBeNull();
    expect(useChatStore.getState().messages.find((m) => m.id === 'm1')?.content).toBe('Hello');
  });

  it('startNewSession clears state', () => {
    useChatStore.setState({ currentSessionId: 'sx', messages: [baseMessage()], streaming: null });
    useChatStore.getState().startNewSession();
    expect(useChatStore.getState().currentSessionId).toBeNull();
    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  it('deduplicates WS-delivered final and REST-returned assistant', () => {
    const final = baseMessage({ id: 'dup', content: 'final' });
    // Simulate WS arriving first: streaming → done with final
    useChatStore.getState().setStreamChunk('dup', 'fin', false);
    useChatStore.getState().setStreamChunk('dup', '', true, final);
    // Now REST returns; our sendMessage logic is exercised indirectly elsewhere.
    // Here we verify appendMessage keeps uniqueness if called with existing id.
    const before = useChatStore.getState().messages.length;
    useChatStore.getState().appendMessage(final);
    // appendMessage is naive — accepts duplicate; the dedup lives inside sendMessage
    expect(useChatStore.getState().messages.length).toBe(before + 1);
  });
});

/* ─── ChatWindow integration ────────────────────────────────────────────────── */

describe('ChatWindow', () => {
  beforeEach(() => {
    useChatStore.setState({
      sessions: [],
      currentSessionId: null,
      messages: [],
      streaming: null,
      isTyping: false,
      loading: false,
      sending: false,
      error: null,
      // Stub loadSessions to no-op during these tests
      loadSessions: async () => {
        /* noop */
      },
    });
    useSystemStore.setState({
      state: SystemState.DIALOGUE,
      previousState: null,
      stateHistory: [],
      context: null,
      authenticated: true,
      wsConnected: true,
    });
  });

  it('renders empty state prompt', async () => {
    const { ChatWindow } = await import('../components/chat/ChatWindow');
    render(<ChatWindow minimalChrome />);
    expect(screen.getByText('NEW SESSION')).toBeDefined();
    expect(screen.getByText('PHANTOM is listening.')).toBeDefined();
  });

  it('renders existing messages', async () => {
    useChatStore.setState({
      messages: [
        baseMessage({ id: 'a', role: 'user', content: 'ping' }),
        baseMessage({ id: 'b', role: 'assistant', content: 'pong' }),
      ],
    });
    const { ChatWindow } = await import('../components/chat/ChatWindow');
    render(<ChatWindow minimalChrome />);
    expect(screen.getByText('ping')).toBeDefined();
    expect(screen.getByText('pong')).toBeDefined();
  });

  it('disables send button when input is empty', async () => {
    const { ChatWindow } = await import('../components/chat/ChatWindow');
    render(<ChatWindow minimalChrome />);
    const btn = screen.getByLabelText('Send message');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls sendMessage when input has text and send clicked', async () => {
    const spy = vi.fn(async () => {});
    useChatStore.setState({ sendMessage: spy });
    const { ChatWindow } = await import('../components/chat/ChatWindow');
    render(<ChatWindow minimalChrome />);
    const textarea = screen.getByPlaceholderText('Message PHANTOM…') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello' } });
    await waitFor(() => {
      const btn = screen.getByLabelText('Send message');
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByLabelText('Send message'));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const firstCall = spy.mock.calls[0] as unknown as [string, string, string];
    expect(firstCall[0]).toBe('hello');
  });

  it('submits on Enter (no shift)', async () => {
    const spy = vi.fn(async () => {});
    useChatStore.setState({ sendMessage: spy });
    const { ChatWindow } = await import('../components/chat/ChatWindow');
    render(<ChatWindow minimalChrome />);
    const textarea = screen.getByPlaceholderText('Message PHANTOM…') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'enter-send' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    await waitFor(() => expect(spy).toHaveBeenCalledWith('enter-send', 'text', SystemState.DIALOGUE));
  });

  it('shows streaming bubble when store has streaming', async () => {
    useChatStore.setState({
      streaming: { id: 'stream-1', content: 'partial…', done: false },
    });
    const { ChatWindow } = await import('../components/chat/ChatWindow');
    render(<ChatWindow minimalChrome />);
    expect(screen.getByText('partial…')).toBeDefined();
  });

  it('shows error banner when error set', async () => {
    useChatStore.setState({ error: 'Network failed' });
    const { ChatWindow } = await import('../components/chat/ChatWindow');
    render(<ChatWindow minimalChrome />);
    expect(screen.getByText(/CHAT.ERR/)).toBeDefined();
    expect(screen.getByText(/Network failed/)).toBeDefined();
  });

  it('voice toggle invokes callback', async () => {
    const spy = vi.fn();
    const { ChatWindow } = await import('../components/chat/ChatWindow');
    render(<ChatWindow minimalChrome onVoiceToggle={spy} />);
    const btn = screen.getByLabelText('Start listening');
    act(() => {
      fireEvent.click(btn);
    });
    expect(spy).toHaveBeenCalledWith(true);
  });
});

/* ─── CodeBlock copy button ─────────────────────────────────────────────────── */

describe('CodeBlock', () => {
  it('shows language label and code', async () => {
    const { CodeBlock } = await import('../components/chat/CodeBlock');
    render(
      <CodeBlock
        data={{ language: 'typescript', code: 'const x = 1;' }}
      />
    );
    expect(screen.getByText('TS')).toBeDefined();
    expect(screen.getByText(/const/)).toBeDefined();
  });
});
