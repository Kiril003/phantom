import { describe, it, expect, beforeEach } from 'vitest';
import { useMessengerStore } from '../stores/messengerStore';
import { callEngine } from '../services/callEngine';

describe('Messenger Store & Real Messaging / Calling Actions', () => {
  beforeEach(() => {
    // Reset store state
    useMessengerStore.setState({
      chats: [
        {
          id: 'chat_test_1',
          title: 'Олександр',
          avatar: '',
          type: 'dm',
          circle: 'work',
          unreadCount: 0,
          messages: [
            {
              id: 'm1',
              senderId: 'user_alex',
              senderName: 'Олександр',
              senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200',
              timestamp: '12:00',
              type: 'text',
              text: 'Привіт! Як стан кластера?',
              isSelf: false,
            },
          ],
        },
      ],
      activeChatId: 'chat_test_1',
      selectedMessageIds: [],
      multiSelectMode: false,
      replyingTo: null,
      editingMessage: null,
    });
  });

  it('sends text message with local transport and optimistic update', () => {
    const store = useMessengerStore.getState();
    store.sendMessage('Все працює стабільно!');

    const updated = useMessengerStore.getState().getActiveChat();
    expect(updated?.messages.length).toBe(2);
    expect(updated?.messages[1].text).toBe('Все працює стабільно!');
    expect(updated?.messages[1].isSelf).toBe(true);
  });

  it('edits existing message text cleanly', () => {
    const store = useMessengerStore.getState();
    store.editMessage('m1', 'Оновлений текст повідомлення');

    const updated = useMessengerStore.getState().getActiveChat();
    const editedMsg = updated?.messages.find((m) => m.id === 'm1');
    expect(editedMsg?.text).toBe('Оновлений текст повідомлення');
    expect(editedMsg?.isEdited).toBe(true);
  });

  it('deletes message for self (removes item)', async () => {
    const store = useMessengerStore.getState();
    await store.deleteMessage('m1', false);

    const updated = useMessengerStore.getState().getActiveChat();
    expect(updated?.messages.find((m) => m.id === 'm1')).toBeUndefined();
  });

  it('deletes message for everyone (tombstone marker)', async () => {
    const store = useMessengerStore.getState();
    await store.deleteMessage('m1', true);

    const updated = useMessengerStore.getState().getActiveChat();
    const tombstone = updated?.messages.find((m) => m.id === 'm1');
    expect(tombstone).toBeDefined();
    expect(tombstone?.isDeleted).toBe(true);
  });

  it('toggles pin on message', () => {
    const store = useMessengerStore.getState();
    store.togglePinMessage('m1');

    let updated = useMessengerStore.getState().getActiveChat();
    expect(updated?.messages.find((m) => m.id === 'm1')?.isPinned).toBe(true);

    store.togglePinMessage('m1');
    updated = useMessengerStore.getState().getActiveChat();
    expect(updated?.messages.find((m) => m.id === 'm1')?.isPinned).toBe(false);
  });

  it('adds and toggles reaction emojis on message', () => {
    const store = useMessengerStore.getState();
    store.addReaction('m1', '🔥');

    let updated = useMessengerStore.getState().getActiveChat();
    let msg = updated?.messages.find((m) => m.id === 'm1');
    expect(msg?.reactions?.length).toBe(1);
    expect(msg?.reactions?.[0].emoji).toBe('🔥');
    expect(msg?.reactions?.[0].count).toBe(1);

    // Toggle same emoji removes reaction
    store.addReaction('m1', '🔥');
    updated = useMessengerStore.getState().getActiveChat();
    msg = updated?.messages.find((m) => m.id === 'm1');
    expect(msg?.reactions?.length).toBe(0);
  });

  it('sends voice message with calculated duration and transcript', () => {
    const store = useMessengerStore.getState();
    store.sendVoiceMessage(12, 'Голосове повідомлення про статус релізу');

    const updated = useMessengerStore.getState().getActiveChat();
    const voiceMsg = updated?.messages.find((m) => m.type === 'voice');
    expect(voiceMsg).toBeDefined();
    expect(voiceMsg?.voiceData?.duration).toBe(12);
    expect(voiceMsg?.voiceData?.transcript).toBe('Голосове повідомлення про статус релізу');
  });

  it('handles call engine initial state and hangup', () => {
    const snapshot = callEngine.getSnapshot();
    expect(snapshot).toBeDefined();
    expect(snapshot.state).toBe('idle');

    callEngine.hangup();
    expect(callEngine.getSnapshot().state).toBe('idle');
  });
});
