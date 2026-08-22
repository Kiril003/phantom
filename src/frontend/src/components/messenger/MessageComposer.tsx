import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Smile,
  X,
  Plus,
  Clock,
  Check,
  Layers,
  AtSign,
  Reply,
  Sparkles,
  Type,
  Bold,
  Italic,
  Code
} from 'lucide-react';
import { Message, ChatMember, MessageReplyInfo } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';
import { chatApi } from '../../services/api';

interface MessageComposerProps {
  onSendMessage: (text: string, scheduledTime?: string) => void;
  onSendVoiceMessage: (duration: number, transcript: string) => void;
  onOpenActions: () => void;
  onOpenScheduler: () => void;
  onOpenScheduledList?: () => void;
  scheduledCountInCurrentChat?: number;
  replyingTo: MessageReplyInfo | null;
  onCancelReply: () => void;
  onRemoveReplyQuote?: (quoteId: string) => void;
  editingMessage: Message | null;
  onCancelEdit: () => void;
  onSaveEdit: (messageId: string, newText: string) => void;
  selectedMessagesForQuote: Message[];
  onSynthesizeMultiQuote: (title: string, userCommentary: string) => void;
  onClearSelectedQuotes: () => void;
  scheduledTime?: string;
  onClearScheduledTime?: () => void;
  chatMembers?: ChatMember[];
  chatId?: string;
  initialDraft?: string;
  onDraftChange?: (chatId: string, draftText: string) => void;
}

const emojiList = ['✨', '🌱', '☕', '❤️', '👍', '🔥', '👏', '🙌', '💡', '📌', '🎯', '🚀', '🌿', '🤝', '😊', '👌', '🤩', '🫡', '🎉', '🏆'];

const stylePresets = [
  { id: 'concise', label: 'Лаконічно ⚡', desc: 'Прибрати зайве та виділити суть', prompt: 'Перепиши текст стисло, зберігши зміст.' },
  { id: 'warm', label: 'Тепло & Дружньо ☕', desc: 'Тепліший, дружній тон', prompt: 'Перепиши текст теплішим, дружнім тоном.' },
  { id: 'business', label: 'Діловий тон 💼', desc: 'Стриманий робочий тон', prompt: 'Перепиши текст стриманим діловим тоном.' },
  { id: 'polite', label: 'Ввічливо & М’яко 🌿', desc: 'Делікатніше формулювання', prompt: 'Перепиши текст ввічливіше й делікатніше.' },
  { id: 'translate_en', label: 'Перекласти на English 🌐', desc: 'Переклад тексту англійською', prompt: 'Переклади текст англійською.' },
  { id: 'fix_grammar', label: 'Виправити граматику ✨', desc: 'Правопис і пунктуація', prompt: 'Виправ орфографію та пунктуацію, не змінюючи змісту й тону.' },
];

export const MessageComposer: React.FC<MessageComposerProps> = ({
  onSendMessage,
  onSendVoiceMessage: _onSendVoiceMessage,
  onOpenActions,
  onOpenScheduler: _onOpenScheduler,
  onOpenScheduledList,
  scheduledCountInCurrentChat = 0,
  replyingTo,
  onCancelReply,
  onRemoveReplyQuote,
  editingMessage,
  onCancelEdit,
  onSaveEdit,
  selectedMessagesForQuote,
  onSynthesizeMultiQuote,
  onClearSelectedQuotes,
  scheduledTime,
  onClearScheduledTime,
  chatMembers = [],
  chatId,
  initialDraft = '',
  onDraftChange,
}) => {
  const [text, setText] = useState(initialDraft);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showStyleMenu, setShowStyleMenu] = useState(false);
  const [showFormattingBar, setShowFormattingBar] = useState(false);
  const [styleBusyId, setStyleBusyId] = useState<string | null>(null);
  const [styleError, setStyleError] = useState<string | null>(null);
  const [multiQuoteTitle, setMultiQuoteTitle] = useState('Зведена цитата домовленостей');

  // Mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionCursorPos, setMentionCursorPos] = useState<number>(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevChatIdRef = useRef<string | undefined>(chatId);
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;

  // Sync draft when switching chats
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      // Switching to another chat: load this chat's initial draft
      prevChatIdRef.current = chatId;
      setText(initialDraft || '');
      setShowEmojiPicker(false);
      setShowStyleMenu(false);
      setShowFormattingBar(false);
      setMentionQuery(null);
    }
  }, [chatId, initialDraft]);

  // Sync editing message
  useEffect(() => {
    if (editingMessage) {
      setText(editingMessage.text || '');
      textareaRef.current?.focus();
    }
  }, [editingMessage]);

  // Track mentions in text and save draft per chat when typing
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const cursorPos = e.target.selectionStart || 0;
    setText(val);

    if (chatId && !editingMessage && onDraftChangeRef.current) {
      onDraftChangeRef.current(chatId, val);
    }

    // Look back from cursor to see if inside @mention
    const textBeforeCursor = val.slice(0, cursorPos);
    const match = textBeforeCursor.match(/@([a-zA-Z0-9_\u0400-\u04FF]*)$/);

    if (match) {
      setMentionQuery(match[1].toLowerCase());
      setMentionCursorPos(cursorPos);
    } else {
      setMentionQuery(null);
    }
  };

  const handleSelectMention = (member: ChatMember) => {
    soundFx.playTap();
    if (!textareaRef.current) return;
    const cursorPos = mentionCursorPos;
    const textBefore = text.slice(0, cursorPos);
    const atIndex = textBefore.lastIndexOf('@');
    const textAfter = text.slice(cursorPos);

    const replacement = `@${member.name} `;
    const newText = text.slice(0, atIndex) + replacement + textAfter;
    setText(newText);
    if (chatId && !editingMessage && onDraftChangeRef.current) {
      onDraftChangeRef.current(chatId, newText);
    }
    setMentionQuery(null);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newCursor = atIndex + replacement.length;
        textareaRef.current.setSelectionRange(newCursor, newCursor);
      }
    }, 50);
  };

  const insertFormatting = (prefix: string, suffix: string = prefix) => {
    soundFx.playTap();
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const selected = text.slice(start, end);

    const newText = text.slice(0, start) + prefix + selected + suffix + text.slice(end);
    setText(newText);
    if (chatId && !editingMessage && onDraftChangeRef.current) {
      onDraftChangeRef.current(chatId, newText);
    }

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newCursor = start + prefix.length + selected.length;
        textareaRef.current.setSelectionRange(newCursor, newCursor);
      }
    }, 50);
  };

  const handleSend = () => {
    if (editingMessage) {
      if (text.trim()) {
        onSaveEdit(editingMessage.id, text.trim());
        setText('');
        if (chatId && onDraftChangeRef.current) {
          onDraftChangeRef.current(chatId, '');
        }
      }
      return;
    }

    if (selectedMessagesForQuote.length > 0) {
      onSynthesizeMultiQuote(multiQuoteTitle, text.trim());
      setText('');
      if (chatId && onDraftChangeRef.current) {
        onDraftChangeRef.current(chatId, '');
      }
      return;
    }

    if (!text.trim()) return;
    soundFx.playSend();
    onSendMessage(text.trim(), scheduledTime);
    setText('');
    if (chatId && onDraftChangeRef.current) {
      onDraftChangeRef.current(chatId, '');
    }
    setMentionQuery(null);
    setShowFormattingBar(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const applyStyle = async (styleId: string) => {
    soundFx.playTap();
    const source = text.trim();
    const preset = stylePresets.find((s) => s.id === styleId);
    if (!source || !preset || styleBusyId) return;

    setStyleBusyId(styleId);
    setStyleError(null);
    try {
      const res = await chatApi.sendMessage({
        content: `${preset.prompt} У відповідь дай лише готовий текст, без коментарів.\n\n${source}`,
        input_method: 'text',
      });
      const newText = (res?.message?.content || '').trim();
      if (!newText) {
        setStyleError('Локальний агент не повернув тексту');
        return;
      }
      setText(newText);
      if (chatId && !editingMessage && onDraftChangeRef.current) {
        onDraftChangeRef.current(chatId, newText);
      }
      setShowStyleMenu(false);
    } catch {
      setStyleError('Локальний агент недоступний');
    } finally {
      setStyleBusyId(null);
    }
  };

  const canSend = !!text.trim() || selectedMessagesForQuote.length > 0 || !!editingMessage;

  const filteredMembers = mentionQuery !== null
    ? chatMembers.filter((m) =>
        m.name.toLowerCase().includes(mentionQuery) ||
        m.handle.toLowerCase().includes(mentionQuery)
      )
    : [];

  return (
    <div className="px-4 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.25rem)] bg-[#FDFCF9]/95 backdrop-blur-xl border-t border-[#E6DFD3] shrink-0 select-none relative z-30 shadow-md text-[#1E2521]">
      {/* Mention Autocomplete Dropdown */}
      {mentionQuery !== null && filteredMembers.length > 0 && (
        <div className="absolute bottom-full left-4 mb-2 bg-[#FDFCF9]/98 backdrop-blur-2xl border border-[#DDD4C4] rounded-2xl shadow-2xl w-64 max-h-48 overflow-y-auto p-1.5 z-30 animate-in fade-in zoom-in-95 duration-100 text-[#1E2521]">
          <p className="text-[10px] font-bold text-[#5F6A60] px-2 py-1 uppercase tracking-wider">
            Згадати учасника
          </p>
          {filteredMembers.map((member) => (
            <button
              key={member.id}
              onClick={() => handleSelectMention(member)}
              className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-[#F1EDE3] rounded-xl text-left transition-colors"
            >
              <img src={member.avatar} alt={member.name} className="w-6 h-6 rounded-lg object-cover ring-1 ring-white/10" />
              <div className="min-w-0 flex-1 text-xs">
                <p className="font-bold text-[#1E2521] truncate">{member.name}</p>
                <p className="text-[10px] text-[#5F6A60] truncate">{member.handle}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 1. Multi-Quote Synthesis Banner */}
      {selectedMessagesForQuote.length > 0 && (
        <div className="mb-2 p-2.5 bg-[#F9F7F1] border border-[#E6DFD3] rounded-2xl space-y-2 shadow-sm animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-[#E87A42]" />
              <span className="font-bold text-xs text-[#E87A42]">
                Зведена цитата з {selectedMessagesForQuote.length} повідомлень
              </span>
            </div>
            <button
              onClick={onClearSelectedQuotes}
              className="p-1 text-[#5F6A60] hover:text-[#1E2521] rounded-lg"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <input
            type="text"
            value={multiQuoteTitle}
            onChange={(e) => setMultiQuoteTitle(e.target.value)}
            placeholder="Заголовок зведеної цитати..."
            className="w-full px-2.5 py-1.5 bg-[#F7F5EE] border border-[#F1EDE3] rounded-xl text-xs font-semibold text-[#1E2521] placeholder-[#7A8479] focus:outline-none focus:border-[#E87A42]"
          />

          <div className="space-y-1 max-h-20 overflow-y-auto">
            {selectedMessagesForQuote.map((m) => (
              <div key={m.id} className="text-[11px] text-[#5F6A60] bg-[#F7F5EE] p-1.5 rounded-xl border border-[#E6DFD3] truncate">
                <span className="font-bold text-[#E87A42]">{m.senderName}: </span>
                <span>{m.text || m.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. Replying-to Banner */}
      {replyingTo && (
        <div className="mb-2 p-2.5 bg-[#FDFCF9] border border-[#E6DFD3] border-l-4 border-l-[#E87A42] rounded-2xl space-y-1.5 shadow-sm animate-in fade-in duration-150">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Reply className="w-3.5 h-3.5 text-[#E87A42] shrink-0" />
              {replyingTo.quotes && replyingTo.quotes.length > 1 ? (
                <span className="font-bold text-[#E87A42] text-[11px] truncate">
                  Відповідь на {replyingTo.quotes.length} повідомлень
                </span>
              ) : replyingTo.quoteSelectedText ? (
                <span className="font-bold text-[#E87A42] text-[11px] truncate">
                  Цитата фрагмента від {replyingTo.senderName}
                </span>
              ) : (
                <span className="font-bold text-[#E87A42] text-[11px] truncate">
                  Відповідь для {replyingTo.senderName}
                </span>
              )}
            </div>
            <button
              onClick={onCancelReply}
              className="p-1 text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3] rounded-lg transition-colors shrink-0"
              title="Скасувати відповідь"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* If Multi-message quotes */}
          {replyingTo.quotes && replyingTo.quotes.length > 0 ? (
            <div className="space-y-1 max-h-28 overflow-y-auto pr-0.5">
              {replyingTo.quotes.map((q) => (
                <div
                  key={q.id}
                  className="flex items-center justify-between gap-2 bg-[#F7F5EE] px-2 py-1 rounded-xl border border-[#E6DFD3] text-[11px]"
                >
                  <div className="min-w-0 flex items-center gap-1.5 truncate">
                    {q.senderAvatar && (
                      <img src={q.senderAvatar} alt="" className="w-3.5 h-3.5 rounded-full object-cover shrink-0" />
                    )}
                    <span className="font-bold text-[#E87A42] shrink-0">{q.senderName}:</span>
                    <span className="text-[#5F6A60] truncate">{q.text}</span>
                  </div>
                  {onRemoveReplyQuote && (
                    <button
                      onClick={() => onRemoveReplyQuote(q.id)}
                      className="p-0.5 text-[#7A8479] hover:text-red-400 rounded-md shrink-0"
                      title="Прибрати цю цитату"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : replyingTo.quoteSelectedText ? (
            <div className="bg-[#F7F5EE] p-2 rounded-xl border border-[#E6DFD3] text-xs">
              <p className="italic text-[#5F6A60] leading-relaxed">
                «{replyingTo.quoteSelectedText}»
              </p>
            </div>
          ) : (
            <p className="text-[#5F6A60] truncate text-[11px] pl-5">
              {replyingTo.text}
            </p>
          )}
        </div>
      )}

      {/* 3. Editing Message Banner */}
      {editingMessage && (
        <div className="mb-2 p-2.5 bg-[#F9F7F1] border-l-4 border-[#F4AF25] rounded-xl flex items-center justify-between gap-2 text-xs animate-in fade-in border border-[#E6DFD3]">
          <div className="min-w-0">
            <p className="font-bold text-[#F4AF25] text-[11px]">Редагування повідомлення</p>
            <p className="text-[#5F6A60] truncate text-[11px]">{editingMessage.text}</p>
          </div>
          <button
            onClick={onCancelEdit}
            className="p-1 hover:bg-[#F9F7F1] rounded-lg text-[#5F6A60] hover:text-[#1E2521]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 4. Scheduled Time Badge */}
      {scheduledTime ? (
        <div className="mb-2 p-2 bg-[#F9F7F1] border border-[#E6DFD3] rounded-xl flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-[#FBBF24] font-semibold text-[11px]">
            <Clock className="w-3.5 h-3.5 text-[#F4AF25]" />
            <span>Заплановано на: {scheduledTime}</span>
          </div>
          <div className="flex items-center gap-1">
            {onOpenScheduledList && (
              <button
                type="button"
                onClick={() => {
                  soundFx.playTap();
                  onOpenScheduledList();
                }}
                className="text-[10px] font-bold text-[#F4AF25] hover:underline px-1"
              >
                Всі відкладені
              </button>
            )}
            <button
              onClick={onClearScheduledTime}
              className="p-1 hover:bg-[#F9F7F1] rounded-lg text-[#5F6A60] hover:text-[#1E2521]"
              title="Скасувати таймер"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : scheduledCountInCurrentChat > 0 && onOpenScheduledList ? (
        <div className="mb-2 px-3 py-1.5 bg-[#FDFCF9]/95 border border-[#DDD4C4] rounded-xl flex items-center justify-between gap-2 text-[11px] backdrop-blur-md animate-in fade-in shadow-md">
          <button
            type="button"
            onClick={() => {
              soundFx.playTap();
              onOpenScheduledList();
            }}
            className="flex items-center gap-1.5 text-[#E87A42] hover:text-[#1E2521] font-semibold text-left transition-colors"
          >
            <Clock className="w-3.5 h-3.5 text-[#E87A42]" />
            <span>
              У цьому чаті заплановано <strong className="text-[#1E2521]">{scheduledCountInCurrentChat}</strong> повідомл.
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              soundFx.playTap();
              onOpenScheduledList();
            }}
            className="text-[10px] font-bold text-[#E87A42] hover:underline"
          >
            Переглянути →
          </button>
        </div>
      ) : null}

      {/* 5. Main Clean Message Composer Bar */}
      <div className="flex items-end gap-2">
          {/* Action Studio & Attachments Button (+) */}
          <button
            onClick={() => {
              soundFx.playTap();
              onOpenActions();
            }}
            className="w-10 h-10 bg-[#F9F7F1] hover:bg-[#E6DFD3] border border-[#E6DFD3] rounded-full transition-colors shrink-0 flex items-center justify-center active:scale-95"
            title="Створити картку або додати вкладення (+)"
          >
            <Plus className="w-5 h-5 text-[#E87A42]" />
          </button>

          {/* Center Input Box */}
          <div className="flex-1 min-w-0 bg-[#FDFCF9] border border-[#E6DFD3] focus-within:border-[#E87A42] focus-within:ring-1 focus-within:ring-[#E87A42]/30 rounded-2xl pl-4 pr-2.5 py-1.5 flex items-end gap-2 transition-colors">
            {/* Text Input */}
            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              placeholder={
                selectedMessagesForQuote.length > 0
                  ? 'Додайте коментар до цитати...'
                  : editingMessage
                  ? 'Редагувати повідомлення...'
                  : 'Написати повідомлення (Enter — відправити, Shift+Enter — новий рядок, @ для згадки)...'
              }
              className="flex-1 min-w-0 max-h-32 min-h-[28px] py-1 bg-transparent text-sm text-[#1E2521] placeholder-[#7A8479] resize-none focus:outline-none select-text leading-relaxed"
            />

            {/* Праві іконки поля — одна група з власним проміжком, щоб не злипались */}
            <div className="flex items-center gap-2 shrink-0 pb-1">
              {/* Переписування чернетки локальним агентом */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    soundFx.playTap();
                    setShowStyleMenu(!showStyleMenu);
                    setStyleError(null);
                    setShowEmojiPicker(false);
                    setShowFormattingBar(false);
                  }}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                    showStyleMenu ? 'text-[#C25925] bg-[#F1EDE3]' : 'text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3]'
                  }`}
                  title="Переписати чернетку локальним агентом"
                >
                  <Sparkles className={`w-[18px] h-[18px] ${styleBusyId ? 'animate-pulse' : ''}`} />
                </button>

                {showStyleMenu && (
                  <div className="absolute bottom-12 right-0 bg-[#FDFCF9]/98 backdrop-blur-2xl border border-[#DDD4C4] rounded-2xl p-2 shadow-2xl w-64 z-30 space-y-1 animate-in fade-in select-none text-[#1E2521]">
                    <div className="px-2 py-1 text-[11px] font-extrabold text-[#5F6A60] uppercase tracking-wide border-b border-[#F1EDE3]">
                      Переписати локальним агентом
                    </div>
                    {stylePresets.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        disabled={!text.trim() || !!styleBusyId}
                        onClick={() => applyStyle(s.id)}
                        className="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-[#F1EDE3] text-xs flex flex-col transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        <span className="font-bold text-[#1E2521]">{s.label}</span>
                        <span className="text-[10px] text-[#5F6A60]">
                          {styleBusyId === s.id ? 'Опрацьовую…' : s.desc}
                        </span>
                      </button>
                    ))}
                    {styleError && (
                      <div className="px-2.5 py-1.5 text-[10px] text-red-300 border-t border-[#F1EDE3]">
                        {styleError}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Inline Formatting Menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    soundFx.playTap();
                    setShowFormattingBar(!showFormattingBar);
                    setShowStyleMenu(false);
                    setShowEmojiPicker(false);
                  }}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                    showFormattingBar ? 'text-[#C25925] bg-[#F1EDE3]' : 'text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3]'
                  }`}
                  title="Форматування тексту (Markdown)"
                >
                  <Type className="w-[18px] h-[18px]" />
                </button>

                {showFormattingBar && (
                  <div className="absolute bottom-12 right-0 bg-[#FDFCF9]/98 backdrop-blur-2xl border border-[#DDD4C4] rounded-2xl p-1.5 shadow-2xl flex items-center gap-1 z-30 animate-in fade-in select-none text-[#1E2521]">
                    <button
                      type="button"
                      onClick={() => insertFormatting('**')}
                      className="p-1.5 hover:bg-[#F1EDE3] rounded-lg text-xs font-bold"
                      title="Жирний (**текст**)"
                    >
                      <Bold className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => insertFormatting('*')}
                      className="p-1.5 hover:bg-[#F1EDE3] rounded-lg text-xs font-bold"
                      title="Курсив (*текст*)"
                    >
                      <Italic className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => insertFormatting('`')}
                      className="p-1.5 hover:bg-[#F1EDE3] rounded-lg text-xs font-bold"
                      title="Код (`код`)"
                    >
                      <Code className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Inline Emoji Picker Button */}
              <div className="relative">
                <button
                  onClick={() => {
                    soundFx.playTap();
                    setShowEmojiPicker(!showEmojiPicker);
                    setShowStyleMenu(false);
                    setShowFormattingBar(false);
                  }}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                    showEmojiPicker ? 'text-[#C25925] bg-[#F1EDE3]' : 'text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3]'
                  }`}
                  title="Емодзі"
                >
                  <Smile className="w-[18px] h-[18px]" />
                </button>

                {showEmojiPicker && (
                  <div className="absolute bottom-12 right-0 bg-[#FDFCF9]/98 backdrop-blur-2xl border border-[#DDD4C4] rounded-2xl p-2.5 shadow-2xl grid grid-cols-5 gap-1.5 w-56 z-30 animate-in fade-in">
                    {emojiList.map((e) => (
                      <button
                        key={e}
                        onClick={() => {
                          soundFx.playTap();
                          const newText = text + e;
                          setText(newText);
                          if (chatId && !editingMessage && onDraftChangeRef.current) {
                            onDraftChangeRef.current(chatId, newText);
                          }
                          setShowEmojiPicker(false);
                        }}
                        className="p-1 text-base hover:scale-125 transition-transform"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Inline @ Mention Button */}
              <button
                onClick={() => {
                  soundFx.playTap();
                  const newText = text + '@';
                  setText(newText);
                  setMentionQuery('');
                  setMentionCursorPos(newText.length);
                  textareaRef.current?.focus();
                }}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3] transition-colors"
                title="Згадати учасника (@)"
              >
                <AtSign className="w-[18px] h-[18px]" />
              </button>
            </div>
          </div>

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={!canSend}
            className={`w-10 h-10 rounded-full transition-colors shrink-0 flex items-center justify-center ${
              canSend
                ? 'bg-[#E87A42] hover:bg-[#C25925] text-[#FDFCF9] active:scale-95 shadow-sm'
                : 'bg-[#F9F7F1] text-[#7A8479] border border-[#E6DFD3] cursor-not-allowed'
            }`}
            title="Надіслати повідомлення"
          >
            {editingMessage ? <Check className="w-5 h-5" /> : <Send className="w-[18px] h-[18px] -rotate-12 translate-x-0.5" />}
          </button>
        </div>
    </div>
  );
};
