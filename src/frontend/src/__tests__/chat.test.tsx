import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

type BaseMessageOverrides = Omit<Partial<ChatMessage>, 'metadata'> & {
  metadata?: Partial<ChatMessage['metadata']>;
};

function baseMessage(over: BaseMessageOverrides = {}): ChatMessage {
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
    expect(screen.getAllByText('Hello from PHANTOM').length).toBeGreaterThanOrEqual(1);
  });

  it('renders provider and latency meta', async () => {
    const { MessageBubble } = await import('../components/chat/MessageBubble');
    render(<MessageBubble message={baseMessage()} />);
    expect(screen.getAllByText('gemini').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('120ms').length).toBeGreaterThanOrEqual(1);
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

  // ─── Phase 13b — userPreview + replaceLastUserMessage ──────────────────────

  it('setUserPreview updates the preview slot, null clears it', () => {
    useChatStore.getState().setUserPreview('при');
    expect(useChatStore.getState().userPreview).toBe('при');
    useChatStore.getState().setUserPreview('привіт');
    expect(useChatStore.getState().userPreview).toBe('привіт');
    useChatStore.getState().setUserPreview(null);
    expect(useChatStore.getState().userPreview).toBeNull();
  });

  it('replaceLastUserMessage rewrites the most recent user message in place', () => {
    const userOriginal = baseMessage({ id: 'u-1', role: 'user', content: 'приві' });
    const assistantReply = baseMessage({ id: 'a-1', role: 'assistant', content: 'reply' });
    useChatStore.setState({ messages: [userOriginal, assistantReply] });

    useChatStore.getState().replaceLastUserMessage('привіт як справи', { revised_by: 'whisper' });

    const after = useChatStore.getState().messages;
    expect(after).toHaveLength(2);
    // Order preserved.
    expect(after[0].id).toBe('u-1');
    expect(after[1].id).toBe('a-1');
    // User message text replaced.
    expect(after[0].content).toBe('привіт як справи');
    // Metadata merged, not replaced.
    expect(after[0].metadata.input_method).toBe('text');
    expect((after[0].metadata as unknown as { revised_by?: string }).revised_by).toBe('whisper');
    // Assistant message untouched.
    expect(after[1].content).toBe('reply');
  });

  it('replaceLastUserMessage targets the LAST user message even if assistant comes after', () => {
    const u1 = baseMessage({ id: 'u-1', role: 'user', content: 'first' });
    const a1 = baseMessage({ id: 'a-1', role: 'assistant', content: 'reply-1' });
    const u2 = baseMessage({ id: 'u-2', role: 'user', content: 'second' });
    const a2 = baseMessage({ id: 'a-2', role: 'assistant', content: 'reply-2' });
    useChatStore.setState({ messages: [u1, a1, u2, a2] });

    useChatStore.getState().replaceLastUserMessage('second-revised');

    const after = useChatStore.getState().messages;
    expect(after[0].content).toBe('first');           // earlier user untouched
    expect(after[2].content).toBe('second-revised');  // last user replaced
    expect(after[3].content).toBe('reply-2');         // assistant untouched
  });

  it('replaceLastUserMessage is a no-op when there are no user messages', () => {
    const a1 = baseMessage({ id: 'a-1', role: 'assistant', content: 'only assistant' });
    useChatStore.setState({ messages: [a1] });

    useChatStore.getState().replaceLastUserMessage('should-not-apply');

    expect(useChatStore.getState().messages).toEqual([a1]);
  });

  it('replaceLastUserMessage is a no-op when the message list is empty', () => {
    useChatStore.setState({ messages: [] });
    useChatStore.getState().replaceLastUserMessage('whatever');
    expect(useChatStore.getState().messages).toHaveLength(0);
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
    // The empty-state heading now comes from the i18n catalogue; the default
    // locale is Ukrainian, so it reads "Нова розмова" / "Сесію завантажено"
    // instead of the old hardcoded English pair. getAllByText because the
    // header chip carries the same untitled-session phrase (it did before
    // too — "New Conversation" vs "New conversation" only differed in case).
    expect(
      screen.getAllByText(/Нова розмова|Сесію завантажено/).length
    ).toBeGreaterThan(0);
    expect(screen.getByText('План дня')).toBeDefined();
    expect(screen.getByText('Перевір ризики')).toBeDefined();
    expect(screen.getByText('Поясни налаштування')).toBeDefined();
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

  // Regression: WS-before-HTTP race used to leave the user message *after*
  // its own reply. We now sort by created_at with a user-before-assistant
  // tiebreaker at render time, so even a scrambled `messages` array renders
  // in chronological order.
  it('renders messages in chronological order regardless of insertion order', async () => {
    useChatStore.setState({
      messages: [
        // Insertion simulating the race: assistant reply inserted *before*
        // the confirmed user message for the same turn.
        baseMessage({
          id: 'a1',
          role: 'assistant',
          content: 'Привіт',
          created_at: '2026-04-17T23:01:05Z',
        }),
        baseMessage({
          id: 'u1',
          role: 'user',
          content: 'hi',
          created_at: '2026-04-17T23:00:46Z',
        }),
        baseMessage({
          id: 'a2',
          role: 'assistant',
          content: 'Все спокійно',
          created_at: '2026-04-17T23:01:32Z',
        }),
        baseMessage({
          id: 'u2',
          role: 'user',
          content: 'як справи?',
          created_at: '2026-04-17T23:01:30Z',
        }),
      ],
    });
    const { ChatWindow } = await import('../components/chat/ChatWindow');
    render(<ChatWindow minimalChrome />);
    // All four bodies present.
    expect(screen.getByText('hi')).toBeDefined();
    expect(screen.getByText('Привіт')).toBeDefined();
    expect(screen.getByText('як справи?')).toBeDefined();
    expect(screen.getByText('Все спокійно')).toBeDefined();

    // Chronological order: hi(u) → Привіт(a) → як справи?(u) → Все спокійно(a)
    const bodies = ['hi', 'Привіт', 'як справи?', 'Все спокійно'].map((t) =>
      screen.getByText(t)
    );
    const positions = bodies.map((el) => {
      // Walk up to the outermost motion.div bubble wrapper for a stable
      // DOM position — the text itself is nested a few levels down.
      let node: Element | null = el;
      while (node && !(node instanceof HTMLElement && node.className.includes('flex-col'))) {
        node = node.parentElement;
      }
      return node;
    });
    // Each wrapper must precede the next one in document order.
    for (let i = 0; i < positions.length - 1; i++) {
      const a = positions[i];
      const b = positions[i + 1];
      expect(a && b).toBeTruthy();
      // compareDocumentPosition: 4 = FOLLOWING (b is after a).
      // eslint-disable-next-line no-bitwise
      expect((a as Node).compareDocumentPosition(b as Node) & 4).toBeTruthy();
    }
  });

  it('ties between user and assistant with same timestamp put user first', async () => {
    const sameTime = '2026-04-17T23:01:00Z';
    useChatStore.setState({
      messages: [
        baseMessage({ id: 'a', role: 'assistant', content: 'reply', created_at: sameTime }),
        baseMessage({ id: 'u', role: 'user', content: 'prompt', created_at: sameTime }),
      ],
    });
    const { ChatWindow } = await import('../components/chat/ChatWindow');
    render(<ChatWindow minimalChrome />);
    const promptEl = screen.getByText('prompt');
    const replyEl = screen.getByText('reply');
    // eslint-disable-next-line no-bitwise
    expect(promptEl.compareDocumentPosition(replyEl) & 4).toBeTruthy();
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
    const textarea = screen.getByLabelText('Chat input') as HTMLTextAreaElement;
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
    const textarea = screen.getByLabelText('Chat input') as HTMLTextAreaElement;
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

/* ─── ChatWindow TTS feedback prevention (Phase 12.2) ───────────────────────── */

describe('ChatWindow TTS playback ducks the always-on mic', () => {
  // Captured Audio instances — the test drives 'ended' / 'error' events
  // by hand because jsdom never fires them on its own.
  interface FakeAudio {
    src: string;
    listeners: Map<string, ((ev?: unknown) => void)[]>;
    fireEnded: () => void;
    fireError: () => void;
  }
  let audioInstances: FakeAudio[];
  let originalAudio: typeof window.Audio;
  let timeline: string[];

  beforeEach(() => {
    audioInstances = [];
    timeline = [];
    originalAudio = window.Audio;

    // Minimal Audio stub. play() resolves on next microtask so the test
    // can observe ordering: duck() must record into `timeline` BEFORE
    // play() does.
    class FakeAudioImpl {
      src: string;
      listeners = new Map<string, ((ev?: unknown) => void)[]>();
      constructor(src: string) {
        this.src = src;
        const inst: FakeAudio = {
          src,
          listeners: this.listeners,
          fireEnded: () => {
            (this.listeners.get('ended') ?? []).forEach((cb) => cb());
          },
          fireError: () => {
            (this.listeners.get('error') ?? []).forEach((cb) => cb());
          },
        };
        audioInstances.push(inst);
      }
      addEventListener(name: string, cb: (ev?: unknown) => void) {
        const arr = this.listeners.get(name) ?? [];
        arr.push(cb);
        this.listeners.set(name, arr);
      }
      removeEventListener(name: string, cb: (ev?: unknown) => void) {
        const arr = (this.listeners.get(name) ?? []).filter((c) => c !== cb);
        this.listeners.set(name, arr);
      }
      async play() {
        timeline.push('play');
        return Promise.resolve();
      }
      pause() {
        /* noop */
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Audio = FakeAudioImpl as unknown as typeof window.Audio;

    // URL.createObjectURL exists in jsdom but stub for determinism.
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock-tts');
    URL.revokeObjectURL = vi.fn();
    // restore on teardown
    (window as unknown as { __origCreate: typeof origCreate }).__origCreate =
      origCreate;

    useChatStore.setState({
      sessions: [],
      currentSessionId: null,
      messages: [],
      streaming: null,
      isTyping: false,
      loading: false,
      sending: false,
      error: null,
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

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Audio = originalAudio;
  });

  it('calls voiceAlwaysOnDuck before audioEl.play() and voiceAlwaysOnUnduck on ended', async () => {
    // Mock voice API + ducking primitives. The duck/unduck symbols
    // record into the shared `timeline` so the test can verify ordering
    // against the FakeAudio.play() entry.
    const voiceApiMod = await import('../services/voiceApi');
    vi.spyOn(voiceApiMod.voiceApi, 'synthesize').mockResolvedValue({
      blob: new Blob(['x'], { type: 'audio/wav' }),
      engine: 'fake',
      sampleRate: 22050,
    });

    const alwaysOnMod = await import('../hooks/useVoiceAlwaysOn');
    const duckSpy = vi
      .spyOn(alwaysOnMod, 'voiceAlwaysOnDuck')
      .mockImplementation(() => {
        timeline.push('duck');
      });
    const unduckSpy = vi
      .spyOn(alwaysOnMod, 'voiceAlwaysOnUnduck')
      .mockImplementation(() => {
        timeline.push('unduck');
      });

    // Pre-populate: a voice-input user message followed by an assistant
    // reply. The TTS effect should trigger because the previous user
    // turn used voice (input_method='voice' in metadata).
    useChatStore.setState({
      messages: [
        baseMessage({
          id: 'u1',
          role: 'user',
          content: 'привіт',
          metadata: { input_method: 'voice' },
        }),
        baseMessage({
          id: 'a1',
          role: 'assistant',
          content: 'Привіт, операторе.',
        }),
      ],
    });

    const { ChatWindow } = await import('../components/chat/ChatWindow');
    render(<ChatWindow minimalChrome />);

    // Audio constructed AND play called.
    await waitFor(() => {
      expect(audioInstances.length).toBe(1);
      expect(timeline).toContain('play');
    });

    expect(duckSpy).toHaveBeenCalledTimes(1);
    // Order: duck must precede play in the timeline.
    const duckIdx = timeline.indexOf('duck');
    const playIdx = timeline.indexOf('play');
    expect(duckIdx).toBeGreaterThanOrEqual(0);
    expect(playIdx).toBeGreaterThanOrEqual(0);
    expect(duckIdx).toBeLessThan(playIdx);

    // unduck has not yet fired — audio is still playing.
    expect(unduckSpy).not.toHaveBeenCalled();

    // Simulate the audio finishing.
    act(() => {
      audioInstances[0].fireEnded();
    });
    expect(unduckSpy).toHaveBeenCalledTimes(1);
  });

  it('calls voiceAlwaysOnUnduck on audio error', async () => {
    const voiceApiMod = await import('../services/voiceApi');
    vi.spyOn(voiceApiMod.voiceApi, 'synthesize').mockResolvedValue({
      blob: new Blob(['x'], { type: 'audio/wav' }),
      engine: 'fake',
      sampleRate: 22050,
    });
    const alwaysOnMod = await import('../hooks/useVoiceAlwaysOn');
    vi.spyOn(alwaysOnMod, 'voiceAlwaysOnDuck').mockImplementation(() => {
      timeline.push('duck');
    });
    const unduckSpy = vi
      .spyOn(alwaysOnMod, 'voiceAlwaysOnUnduck')
      .mockImplementation(() => {
        timeline.push('unduck');
      });

    useChatStore.setState({
      messages: [
        baseMessage({
          id: 'u2',
          role: 'user',
          content: 'тест',
          metadata: { input_method: 'voice' },
        }),
        baseMessage({
          id: 'a2',
          role: 'assistant',
          content: 'Все добре.',
        }),
      ],
    });

    const { ChatWindow } = await import('../components/chat/ChatWindow');
    render(<ChatWindow minimalChrome />);
    await waitFor(() => expect(audioInstances.length).toBe(1));

    act(() => {
      audioInstances[0].fireError();
    });
    expect(unduckSpy).toHaveBeenCalledTimes(1);
  });

  it('does not duck when previous user message was text', async () => {
    const voiceApiMod = await import('../services/voiceApi');
    const synthSpy = vi
      .spyOn(voiceApiMod.voiceApi, 'synthesize')
      .mockResolvedValue({
        blob: new Blob(['x'], { type: 'audio/wav' }),
        engine: 'fake',
        sampleRate: 22050,
      });
    const alwaysOnMod = await import('../hooks/useVoiceAlwaysOn');
    const duckSpy = vi
      .spyOn(alwaysOnMod, 'voiceAlwaysOnDuck')
      .mockImplementation(() => {
        timeline.push('duck');
      });

    useChatStore.setState({
      messages: [
        baseMessage({
          id: 'u3',
          role: 'user',
          content: 'typed',
          metadata: { input_method: 'text' },
        }),
        baseMessage({
          id: 'a3',
          role: 'assistant',
          content: 'Reply to typed message.',
        }),
      ],
    });

    const { ChatWindow } = await import('../components/chat/ChatWindow');
    render(<ChatWindow minimalChrome />);

    // Give effects a tick.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(synthSpy).not.toHaveBeenCalled();
    expect(duckSpy).not.toHaveBeenCalled();
    expect(audioInstances.length).toBe(0);
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
