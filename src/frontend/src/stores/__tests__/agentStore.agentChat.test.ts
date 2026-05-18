/**
 * T5 — agentStore agentChat slice: persistence, WS events, actions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the agentApi module before importing the store so the store binds
// to the stub rather than making real HTTP calls.
vi.mock('../../services/agentApi', () => ({
  agentApi: {
    parallelChat: vi.fn(),
    getChatThread: vi.fn(),
    // Stubs for other methods the store references at init-time via closures.
    startTask: vi.fn(),
    setSafety: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    intervene: vi.fn(),
    cancelStep: vi.fn(),
    stop: vi.fn(),
    getTask: vi.fn(),
    feedback: vi.fn(),
    getReport: vi.fn(),
    dismissReport: vi.fn(),
    resumeAsConversation: vi.fn(),
    listTasks: vi.fn(),
    getProgress: vi.fn(),
    submitInfoResponse: vi.fn(),
    runCouncilRound: vi.fn(),
  },
}));

import { useAgentStore } from '../agentStore';
import { agentApi } from '../../services/agentApi';

const api = agentApi as unknown as {
  parallelChat: ReturnType<typeof vi.fn>;
  getChatThread: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  useAgentStore.getState().reset();
  vi.clearAllMocks();
});

describe('agentChat initial state', () => {
  it('starts with empty thread', () => {
    const { agentChat } = useAgentStore.getState();
    expect(agentChat.threadId).toBeNull();
    expect(agentChat.messages).toHaveLength(0);
    expect(agentChat.streaming).toBe(false);
  });
});

describe('sendAgentMessage', () => {
  it('appends user message optimistically and resolves assistant reply', async () => {
    api.parallelChat.mockResolvedValueOnce({ reply: 'привіт', task_id: 'tid-1' });

    await useAgentStore.getState().sendAgentMessage('ping');

    const { agentChat } = useAgentStore.getState();
    expect(agentChat.threadId).toBe('tid-1');
    expect(agentChat.messages).toHaveLength(2);
    expect(agentChat.messages[0]).toMatchObject({ role: 'user', content: 'ping' });
    expect(agentChat.messages[1]).toMatchObject({ role: 'assistant', content: 'привіт' });
    expect(agentChat.streaming).toBe(false);
  });

  it('sets streaming=true during the call and false after', async () => {
    let streamingDuringCall = false;
    api.parallelChat.mockImplementationOnce(async () => {
      streamingDuringCall = useAgentStore.getState().agentChat.streaming;
      return { reply: 'ok', task_id: 'tid-2' };
    });

    await useAgentStore.getState().sendAgentMessage('test');

    expect(streamingDuringCall).toBe(true);
    expect(useAgentStore.getState().agentChat.streaming).toBe(false);
  });

  it('clears streaming on API error and rethrows', async () => {
    api.parallelChat.mockRejectedValueOnce(new Error('503'));

    await expect(useAgentStore.getState().sendAgentMessage('fail')).rejects.toThrow('503');
    expect(useAgentStore.getState().agentChat.streaming).toBe(false);
  });

  it('passes existing threadId to parallelChat when thread already open', async () => {
    // Pre-set a threadId via a prior successful call.
    api.parallelChat.mockResolvedValueOnce({ reply: 'r1', task_id: 'existing-thread' });
    await useAgentStore.getState().sendAgentMessage('first');

    api.parallelChat.mockResolvedValueOnce({ reply: 'r2', task_id: 'existing-thread' });
    await useAgentStore.getState().sendAgentMessage('second');

    expect(api.parallelChat).toHaveBeenNthCalledWith(2, 'second', 'existing-thread');
  });
});

describe('loadAgentThread', () => {
  it('hydrates messages from REST response', async () => {
    api.getChatThread.mockResolvedValueOnce({
      task_id: 'tid-hydrate',
      messages: [
        { role: 'user', content: 'запит', created_at: '2026-05-16T10:00:00' },
        { role: 'assistant', content: 'відповідь', created_at: '2026-05-16T10:00:01' },
      ],
    });

    await useAgentStore.getState().loadAgentThread('tid-hydrate');

    const { agentChat } = useAgentStore.getState();
    expect(agentChat.threadId).toBe('tid-hydrate');
    expect(agentChat.messages).toHaveLength(2);
    expect(agentChat.messages[0].role).toBe('user');
    expect(agentChat.messages[1].content).toBe('відповідь');
    expect(agentChat.streaming).toBe(false);
  });

  it('silently ignores network errors', async () => {
    api.getChatThread.mockRejectedValueOnce(new Error('network'));
    // Should not throw.
    await expect(useAgentStore.getState().loadAgentThread()).resolves.toBeUndefined();
  });
});

describe('clearAgentChat', () => {
  it('resets thread to initial empty state', async () => {
    api.parallelChat.mockResolvedValueOnce({ reply: 'x', task_id: 'tid-x' });
    await useAgentStore.getState().sendAgentMessage('hi');

    useAgentStore.getState().clearAgentChat();

    const { agentChat } = useAgentStore.getState();
    expect(agentChat.threadId).toBeNull();
    expect(agentChat.messages).toHaveLength(0);
    expect(agentChat.streaming).toBe(false);
  });
});

describe('reset() clears agentChat', () => {
  it('wipes agentChat on full store reset', async () => {
    api.parallelChat.mockResolvedValueOnce({ reply: 'bye', task_id: 'tid-r' });
    await useAgentStore.getState().sendAgentMessage('msg');

    useAgentStore.getState().reset();

    expect(useAgentStore.getState().agentChat).toEqual({
      threadId: null,
      messages: [],
      streaming: false,
    });
  });
});

describe('handleEvent — WS chat events', () => {
  const ts = Date.now();

  it('agent.chat.user_message appends a user turn', () => {
    useAgentStore.getState().handleEvent({
      type: 'agent.chat.user_message',
      ts,
      payload: { content: 'зовнішній запит', task_id: 'ws-thread' },
    });

    const { agentChat } = useAgentStore.getState();
    expect(agentChat.messages).toHaveLength(1);
    expect(agentChat.messages[0]).toMatchObject({ role: 'user', content: 'зовнішній запит' });
    expect(agentChat.threadId).toBe('ws-thread');
  });

  it('agent.chat.reply appends an assistant turn and clears streaming', () => {
    // Put store into streaming state to verify it's cleared.
    useAgentStore.setState((s) => ({
      agentChat: { ...s.agentChat, streaming: true },
    }));

    useAgentStore.getState().handleEvent({
      type: 'agent.chat.reply',
      ts,
      payload: { content: 'відповідь агента', task_id: 'ws-thread' },
    });

    const { agentChat } = useAgentStore.getState();
    expect(agentChat.messages).toHaveLength(1);
    expect(agentChat.messages[0]).toMatchObject({ role: 'assistant', content: 'відповідь агента' });
    expect(agentChat.streaming).toBe(false);
  });

  it('WS events accumulate correctly across user+reply pair', () => {
    useAgentStore.getState().handleEvent({
      type: 'agent.chat.user_message',
      ts,
      payload: { content: 'msg1', task_id: 'ws-2' },
    });
    useAgentStore.getState().handleEvent({
      type: 'agent.chat.reply',
      ts,
      payload: { content: 'reply1', task_id: 'ws-2' },
    });

    const { messages } = useAgentStore.getState().agentChat;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });

  it('ignores agent.chat.user_message with empty content', () => {
    useAgentStore.getState().handleEvent({
      type: 'agent.chat.user_message',
      ts,
      payload: { content: '', task_id: 'ws-3' },
    });
    expect(useAgentStore.getState().agentChat.messages).toHaveLength(0);
  });
});
