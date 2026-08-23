import React, { useState } from 'react';
import {
  X,
  Clock,
  Send,
  Trash2,
  Edit2,
  Check,
  Plus,
  Search,
  Sparkles,
  Copy,
  ExternalLink,
  Layers
} from 'lucide-react';
import { Chat, ScheduledMessage } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';
import { Avatar } from './Avatar';

interface ScheduledMessagesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  scheduledMessages: ScheduledMessage[];
  currentChatId: string;
  chats: Chat[];
  onSendNow: (scheduledId: string) => void;
  onDeleteScheduled: (scheduledId: string) => void;
  onUpdateScheduled: (scheduledId: string, updated: Partial<ScheduledMessage>) => void;
  onCreateScheduled: (newScheduled: Omit<ScheduledMessage, 'id' | 'createdAt'>) => void;
  onSelectChat?: (chatId: string) => void;
}

export const ScheduledMessagesDrawer: React.FC<ScheduledMessagesDrawerProps> = ({
  isOpen,
  onClose,
  scheduledMessages,
  currentChatId,
  chats,
  onSendNow,
  onDeleteScheduled,
  onUpdateScheduled,
  onCreateScheduled,
  onSelectChat,
}) => {
  const [filterScope, setFilterScope] = useState<'current' | 'all'>('current');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editChatId, setEditChatId] = useState('');

  // Creation State
  const [isCreating, setIsCreating] = useState(false);
  const [newText, setNewText] = useState('');
  const [newChatId, setNewChatId] = useState(currentChatId);
  const [newPreset, setNewPreset] = useState('Сьогодні о 18:00');
  const [newCustomDate, setNewCustomDate] = useState(new Date().toISOString().split('T')[0]);
  const [newCustomTime, setNewCustomTime] = useState('18:00');
  const [isCustomTime, setIsCustomTime] = useState(false);

  // Copied feedback toast
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentChat = chats.find((c) => c.id === currentChatId) || chats[0];

  // Filtering
  const filteredMessages = scheduledMessages.filter((msg) => {
    if (filterScope === 'current' && msg.chatId !== currentChatId) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchText = (msg.text || '').toLowerCase().includes(q);
      const matchChat = (msg.chatTitle || '').toLowerCase().includes(q);
      const matchTime = (msg.scheduledTime || '').toLowerCase().includes(q);
      return matchText || matchChat || matchTime;
    }
    return true;
  });

  const currentChatCount = scheduledMessages.filter((m) => m.chatId === currentChatId).length;
  const totalCount = scheduledMessages.length;

  const handleStartEdit = (msg: ScheduledMessage) => {
    soundFx.playTap();
    setEditingId(msg.id);
    setEditText(msg.text || '');
    setEditTime(msg.scheduledExactTime || '18:00');
    setEditDate(msg.scheduledDate || new Date().toISOString().split('T')[0]);
    setEditChatId(msg.chatId);
  };

  const handleSaveEdit = (id: string) => {
    soundFx.playTap();
    const targetChat = chats.find((c) => c.id === editChatId);
    onUpdateScheduled(id, {
      text: editText.trim(),
      chatId: editChatId,
      chatTitle: targetChat ? targetChat.title : undefined,
      chatAvatar: targetChat ? targetChat.avatar : undefined,
      scheduledDate: editDate,
      scheduledExactTime: editTime,
      scheduledTime: `${editDate} о ${editTime}`,
    });
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    soundFx.playTap();
    setEditingId(null);
  };

  const handleCopyText = (msg: ScheduledMessage) => {
    soundFx.playTap();
    if (msg.text) {
      navigator.clipboard?.writeText(msg.text);
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;

    soundFx.playSend();
    const targetChat = chats.find((c) => c.id === newChatId) || currentChat;
    const finalScheduledTime = isCustomTime
      ? `${newCustomDate} о ${newCustomTime}`
      : newPreset;

    onCreateScheduled({
      chatId: targetChat.id,
      chatTitle: targetChat.title,
      chatAvatar: targetChat.avatar,
      scheduledTime: finalScheduledTime,
      scheduledDate: isCustomTime ? newCustomDate : new Date().toISOString().split('T')[0],
      scheduledExactTime: isCustomTime ? newCustomTime : '18:00',
      type: 'text',
      text: newText.trim(),
    });

    setNewText('');
    setIsCreating(false);
  };

  const quickTemplates = [
    { label: '🚀 Реліз-деплой', text: 'Нагадування: Фінальний білд перевірено, починаємо деплой та оновлення серверів.' },
    { label: '☕ Запрошення на каву', text: 'Привіт! Зустрічаємось на каву через 20 хвилин на терасі.' },
    { label: '📋 Синхрон статусів', text: 'Доброго ранку! Будь ласка, оновіть статуси задач перед щоденним синхроном.' },
    { label: '🎯 Підсумок спринту', text: 'Колеги, підсумковий звіт закриття завдань готовий, перегляньте у вкладенні.' },
  ];

  return (
    <div className="fixed inset-0 z-50 phantom-scrim flex justify-end animate-in fade-in duration-200">
      <div className="bg-[#FDFCF9] border-l border-[#DDD4C4] w-full max-w-lg h-full shadow-2xl flex flex-col select-none animate-in slide-in-from-right duration-250 text-[#1E2521]">
        {/* Top Header */}
        <div className="p-4 sm:p-5 border-b border-[#E6DFD3] bg-[#FDFCF9] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#F9F7F1] text-[#E87A42] border border-[#DDD4C4] flex items-center justify-center shadow-sm">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-base text-[#1E2521]">
                  Відкладені повідомлення
                </h3>
                <span className="px-2 py-0.5 bg-[#F1EDE3] text-[#E87A42] border border-[#DDD4C4] text-[11px] font-bold rounded-full shadow-sm">
                  {totalCount}
                </span>
              </div>
              <p className="text-xs text-[#5F6A60]">
                Керування чергою повідомлень до їх відправки
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                soundFx.playTap();
                setIsCreating(!isCreating);
              }}
              className={`p-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                isCreating
                  ? 'bg-[#F9F7F1] text-[#E87A42] border border-[#DDD4C4]'
                  : 'bg-[#FDFCF9] hover:bg-[#F9F7F1] text-[#1E2521] border border-[#E6DFD3]'
              }`}
              title="Запланувати нове повідомлення"
            >
              <Plus className="w-4 h-4 text-[#E87A42]" />
              <span className="hidden sm:inline">Створити</span>
            </button>

            <button
              onClick={() => {
                soundFx.playTap();
                onClose();
              }}
              className="p-2 text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3] rounded-xl transition-colors"
              title="Закрити"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scope Tabs & Search Bar */}
        <div className="p-3.5 sm:p-4 border-b border-[#E6DFD3] space-y-3 bg-[#FDFCF9] shrink-0">
          {/* Tabs */}
          <div className="flex items-center gap-2 bg-[#F7F5EE] p-1 rounded-2xl border border-[#E6DFD3]">
            <button
              onClick={() => {
                soundFx.playTap();
                setFilterScope('current');
              }}
              className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                filterScope === 'current'
                  ? 'bg-[#F9F7F1] text-[#E87A42] border border-[#DDD4C4] shadow-sm'
                  : 'text-[#5F6A60] hover:text-[#1E2521]'
              }`}
            >
              <span>Цей чат</span>
              <span
                className={`px-1.5 py-0.5 rounded-md text-[10px] ${
                  filterScope === 'current' ? 'bg-[#F1EDE3] text-[#E87A42]' : 'bg-[#FDFCF9] text-[#5F6A60]'
                }`}
              >
                {currentChatCount}
              </span>
            </button>

            <button
              onClick={() => {
                soundFx.playTap();
                setFilterScope('all');
              }}
              className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                filterScope === 'all'
                  ? 'bg-[#F9F7F1] text-[#E87A42] border border-[#DDD4C4] shadow-sm'
                  : 'text-[#5F6A60] hover:text-[#1E2521]'
              }`}
            >
              <span>Всі чати</span>
              <span
                className={`px-1.5 py-0.5 rounded-md text-[10px] ${
                  filterScope === 'all' ? 'bg-[#F1EDE3] text-[#E87A42]' : 'bg-[#FDFCF9] text-[#5F6A60]'
                }`}
              >
                {totalCount}
              </span>
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8C9A90]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Пошук за текстом, чатом або датою..."
              className="w-full pl-9 pr-8 py-2 bg-white border border-[#DFD6C5] rounded-xl text-xs text-[#1E2521] placeholder-[#8C9A90] focus:outline-none focus:border-[#E87A42]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8C9A90] hover:text-[#1E2521]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Creation Sub-Panel (Collapsible) */}
        {isCreating && (
          <form
            onSubmit={handleCreateSubmit}
            className="p-4 bg-[#F5EFE4] border-b border-[#E8DFD1] space-y-3 shrink-0 animate-in fade-in slide-in-from-top-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-[#1E2521] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#E87A42]" />
                <span>Нове відкладене повідомлення</span>
              </span>
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="text-[11px] font-bold text-[#7A8479] hover:text-[#1E2521]"
              >
                Скасувати
              </button>
            </div>

            {/* Target Chat Selector */}
            <div>
              <label className="text-[11px] font-bold text-[#8A9186] block mb-1">Цільовий чат:</label>
              <select
                value={newChatId}
                onChange={(e) => setNewChatId(e.target.value)}
                className="w-full p-2 bg-white border border-[#DFD6C5] rounded-xl text-xs font-semibold text-[#1E2521] focus:outline-none focus:border-[#E87A42]"
              >
                {chats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.circle})
                  </option>
                ))}
              </select>
            </div>

            {/* Message Text Input */}
            <div>
              <label className="text-[11px] font-bold text-[#8A9186] block mb-1">Текст повідомлення:</label>
              <textarea
                rows={2}
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                placeholder="Введіть текст повідомлення..."
                className="w-full p-2.5 bg-white border border-[#DFD6C5] rounded-xl text-xs text-[#1E2521] placeholder-[#8C9A90] focus:outline-none focus:border-[#E87A42] resize-none"
              />
            </div>

            {/* Quick Templates */}
            <div className="flex flex-wrap gap-1.5">
              {quickTemplates.map((tpl, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    soundFx.playTap();
                    setNewText(tpl.text);
                  }}
                  className="px-2 py-1 bg-white hover:bg-[#FAF6EE] border border-[#DFD6C5] rounded-lg text-[10px] font-semibold text-[#7A8479] transition-colors"
                >
                  {tpl.label}
                </button>
              ))}
            </div>

            {/* Timing Options */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-[11px] font-bold text-[#8A9186]">
                <span>Час відправки:</span>
                <button
                  type="button"
                  onClick={() => setIsCustomTime(!isCustomTime)}
                  className="text-[#E87A42] hover:underline"
                >
                  {isCustomTime ? 'Використати пресети' : 'Власний календар/час'}
                </button>
              </div>

              {!isCustomTime ? (
                <div className="grid grid-cols-2 gap-1.5">
                  {['Сьогодні о 18:00', 'Сьогодні о 20:30', 'Завтра о 09:30', 'Понеділок о 10:00'].map(
                    (p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          soundFx.playTap();
                          setNewPreset(p);
                        }}
                        className={`p-2 rounded-xl text-[11px] font-bold text-left border transition-all ${
                          newPreset === p
                            ? 'bg-[#FCE7D8] border-[#E87A42] text-[#8C461A]'
                            : 'bg-white border-[#DFD6C5] text-[#7A8479] hover:bg-[#FAF6EE]'
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-[#7A8479] block mb-0.5">Дата:</label>
                    <input
                      type="date"
                      value={newCustomDate}
                      onChange={(e) => setNewCustomDate(e.target.value)}
                      className="w-full p-2 bg-white border border-[#DFD6C5] rounded-xl text-xs font-mono text-[#1E2521]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#7A8479] block mb-0.5">Час:</label>
                    <input
                      type="time"
                      value={newCustomTime}
                      onChange={(e) => setNewCustomTime(e.target.value)}
                      className="w-full p-2 bg-white border border-[#DFD6C5] rounded-xl text-xs font-mono text-[#1E2521]"
                    />
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={!newText.trim()}
              className="w-full py-2.5 bg-[#E87A42] hover:bg-[#D46B35] disabled:opacity-50 text-[#1E2521] font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 mt-2"
            >
              <Check className="w-4 h-4" />
              <span>Запланувати повідомлення</span>
            </button>
          </form>
        )}

        {/* Scrollable Scheduled Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
          {filteredMessages.length === 0 ? (
            <div className="py-12 px-6 text-center space-y-3">
              <div className="w-14 h-14 mx-auto rounded-3xl bg-[#F0EAE0] text-[#8C9A90] flex items-center justify-center">
                <Clock className="w-7 h-7" />
              </div>
              <h4 className="font-extrabold text-sm text-[#1E2521]">
                Немає відкладених повідомлень
              </h4>
              <p className="text-xs text-[#7A8479] max-w-xs mx-auto">
                {filterScope === 'current'
                  ? 'У цьому чаті поки що немає запланованих повідомлень. Натисніть "Створити" зверху або іконку годинника в полі вводу.'
                  : 'Черга відкладених повідомлень порожня.'}
              </p>
              <button
                onClick={() => setIsCreating(true)}
                className="px-4 py-2 bg-[#E87A42] text-[#1E2521] text-xs font-bold rounded-xl shadow-xs hover:bg-[#D46B35] transition-colors inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Запланувати перше повідомлення</span>
              </button>
            </div>
          ) : (
            filteredMessages.map((msg) => {
              const isEditingThis = editingId === msg.id;

              return (
                <div
                  key={msg.id}
                  className={`bg-white border rounded-2xl p-4 shadow-2xs transition-all ${
                    isEditingThis
                      ? 'border-[#E87A42] ring-2 ring-[#E87A42]/10'
                      : 'border-[#DFD6C5] hover:border-[#C4B7A2]'
                  }`}
                >
                  {/* Item Header */}
                  <div className="flex items-start justify-between gap-3 mb-2.5">
                    {/* Chat Info & Tag */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      {msg.chatAvatar ? (
                        <Avatar src={msg.chatAvatar} name={msg.chatTitle} className="w-7 h-7 shrink-0" />
                      ) : (
                        <div className="w-7 h-7 rounded-xl bg-[#EFE8DC] flex items-center justify-center text-xs font-bold shrink-0">
                          💬
                        </div>
                      )}

                      <div className="min-w-0">
                        <h5 className="font-extrabold text-xs text-[#1E2521] truncate">
                          {msg.chatTitle}
                        </h5>
                        <span className="text-[10px] text-[#7A8479]">
                          Створено о {msg.createdAt}
                        </span>
                      </div>
                    </div>

                    {/* Timing Badge */}
                    <div className="px-2.5 py-1 bg-[#FCE7D8] text-[#8C461A] border border-[#F6D0B7] rounded-xl text-[11px] font-bold font-mono flex items-center gap-1 shrink-0">
                      <Clock className="w-3 h-3 text-[#E87A42]" />
                      <span>{msg.scheduledTime}</span>
                    </div>
                  </div>

                  {/* Body Content / Inline Edit Form */}
                  {isEditingThis ? (
                    <div className="space-y-2.5 pt-1 border-t border-[#F0EAE0]">
                      <div>
                        <label className="text-[10px] font-bold text-[#8A9186] block mb-0.5">
                          Цільовий чат:
                        </label>
                        <select
                          value={editChatId}
                          onChange={(e) => setEditChatId(e.target.value)}
                          className="w-full p-2 bg-[#FDFCF9] border border-[#DFD6C5] rounded-xl text-xs font-semibold text-[#1E2521]"
                        >
                          {chats.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-[#8A9186] block mb-0.5">
                          Текст повідомлення:
                        </label>
                        <textarea
                          rows={2}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="w-full p-2.5 bg-[#FDFCF9] border border-[#DFD6C5] rounded-xl text-xs text-[#1E2521] focus:outline-none focus:border-[#E87A42] resize-none"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-[#7A8479] block mb-0.5">Дата:</label>
                          <input
                            type="date"
                            value={editDate}
                            onChange={(e) => setEditDate(e.target.value)}
                            className="w-full p-2 bg-[#FDFCF9] border border-[#DFD6C5] rounded-xl text-xs font-mono text-[#1E2521]"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-[#7A8479] block mb-0.5">Час:</label>
                          <input
                            type="time"
                            value={editTime}
                            onChange={(e) => setEditTime(e.target.value)}
                            className="w-full p-2 bg-[#FDFCF9] border border-[#DFD6C5] rounded-xl text-xs font-mono text-[#1E2521]"
                          />
                        </div>
                      </div>

                      {/* Edit Actions */}
                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          className="px-3 py-1.5 bg-[#EFE8DC] hover:bg-[#E3DACB] text-[#8A9186] font-bold text-xs rounded-xl transition-colors"
                        >
                          Скасувати
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(msg.id)}
                          className="px-3.5 py-1.5 bg-[#E87A42] hover:bg-[#D46B35] text-[#1E2521] font-bold text-xs rounded-xl shadow-2xs transition-colors flex items-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Зберегти зміни</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Message Content Preview */}
                      <div className="bg-[#FDFCF9] border border-[#EDE4D6] rounded-xl p-3 text-xs text-[#1E2521] space-y-1.5">
                        {msg.type !== 'text' && (
                          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#E87A42]">
                            <Layers className="w-3 h-3" />
                            <span>Тип: {msg.type}</span>
                          </div>
                        )}

                        <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>

                        {/* Task list preview if present */}
                        {msg.taskListData && (
                          <div className="mt-2 p-2 bg-white rounded-lg border border-[#E2D8C7] space-y-1">
                            <span className="text-[10px] font-bold text-[#8A9186] block">
                              {msg.taskListData.title}
                            </span>
                            {msg.taskListData.tasks.slice(0, 3).map((t) => (
                              <div
                                key={t.id}
                                className="flex items-center gap-1.5 text-[11px] text-[#7A8479]"
                              >
                                <span className="w-2.5 h-2.5 rounded border border-[#8C9A90]" />
                                <span className="truncate">{t.title}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Control Toolbar */}
                      <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-[#F0EAE0]">
                        {/* Send Now Button */}
                        <button
                          onClick={() => {
                            soundFx.playSend();
                            onSendNow(msg.id);
                          }}
                          className="px-3 py-1.5 bg-[#528A4B] hover:bg-[#43723E] text-[#1E2521] rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-all hover:scale-102"
                          title="Надіслати повідомлення негайно зараз"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Надіслати зараз</span>
                        </button>

                        <div className="flex items-center gap-1">
                          {/* Jump to Chat button if not active */}
                          {onSelectChat && msg.chatId !== currentChatId && (
                            <button
                              onClick={() => {
                                soundFx.playTap();
                                onSelectChat(msg.chatId);
                              }}
                              className="p-1.5 hover:bg-[#F2ECE0] text-[#8A9186] hover:text-[#1E2521] rounded-xl transition-colors text-xs font-semibold flex items-center gap-1"
                              title="Перейти до цього чату"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">До чату</span>
                            </button>
                          )}

                          {/* Copy Text */}
                          {msg.text && (
                            <button
                              onClick={() => handleCopyText(msg)}
                              className="p-1.5 hover:bg-[#F2ECE0] text-[#8A9186] hover:text-[#1E2521] rounded-xl transition-colors"
                              title="Скопіювати текст"
                            >
                              {copiedId === msg.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}

                          {/* Edit Button */}
                          <button
                            onClick={() => handleStartEdit(msg)}
                            className="p-1.5 hover:bg-[#FCE7D8] text-[#8A9186] hover:text-[#E87A42] rounded-xl transition-colors"
                            title="Редагувати вміст або час"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete / Cancel Button */}
                          <button
                            onClick={() => {
                              soundFx.playTap();
                              onDeleteScheduled(msg.id);
                            }}
                            className="p-1.5 hover:bg-rose-100 text-[#8A9186] hover:text-rose-600 rounded-xl transition-colors"
                            title="Видалити зі списку відкладених"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer Info */}
        <div className="p-3 bg-[#F5EFE4] border-t border-[#E8DFD1] text-[11px] text-[#7A8479] flex items-center justify-between shrink-0">
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-[#E87A42]" />
            <span>Автоматичне фонове надсилання активне</span>
          </span>
          <span className="font-mono font-bold text-[#1E2521]">
            {filteredMessages.length} з {totalCount}
          </span>
        </div>
      </div>
    </div>
  );
};
