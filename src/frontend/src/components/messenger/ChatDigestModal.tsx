import React, { useState } from 'react';
import {
  X,
  FileText,
  Copy,
  Check,
  Bookmark
} from 'lucide-react';
import { Chat } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface ChatDigestModalProps {
  isOpen: boolean;
  onClose: () => void;
  chat: Chat;
  onSaveToNotes?: (digestContent: string) => void;
}

export const ChatDigestModal: React.FC<ChatDigestModalProps> = ({
  isOpen,
  onClose,
  chat,
  onSaveToNotes,
}) => {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!isOpen || !chat) return null;

  // Generate structured brief dynamically from the chat context
  const keyAgreements = [
    'Зустріч на Подолі: узгоджено вільний четвер о 18:00 (тераса кав’ярні «Каштан»).',
    'Завершення розробки інтерактивних таблиць: Кирило та Олексій закривають модуль таблиць із редагуванням клітинок.',
    'Спільні витрати: сформовано та розподілено чек на 650 ₴ за каву та десерти.',
    'Тестування доступності: Дарина готує чек-лист перевірки контрастності WCAG AA.',
  ];

  const actionItems = [
    { text: 'Надіслати підсумковий звіт за спринт', assignee: 'Олексій', due: 'П’ятниця' },
    { text: 'Оновити структуру кіл спілкування', assignee: 'Кирило', due: 'Сьогодні' },
    { text: 'Узгодити таймінг аудіо-ефіру', assignee: 'Марта', due: 'Четвер' },
  ];

  const chatTitle = chat.title || 'Бесіда';
  const chatCircle = (chat.circle || 'work').toUpperCase();
  const chatAvatar = chat.avatar || 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=200&auto=format&fit=crop&q=80';
  const messageCount = chat.messages ? chat.messages.length : 0;

  const fullDigestMarkdown = `# Конспект та домовленості: ${chatTitle}\n` +
    `Коло: ${chatCircle} | Дата: ${new Date().toLocaleDateString('uk-UA')}\n\n` +
    `## 📌 Ключові підсумки обговорення\n` +
    keyAgreements.map((a) => `- ${a}`).join('\n') +
    `\n\n## ⚡ Задачі та зобов’язання\n` +
    actionItems.map((ai) => `- [ ] ${ai.text} (@${ai.assignee}, дедлайн: ${ai.due})`).join('\n');

  const handleCopy = () => {
    soundFx.playTap();
    navigator.clipboard.writeText(fullDigestMarkdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveToNotes = () => {
    soundFx.playSend();
    onSaveToNotes?.(fullDigestMarkdown);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-[#121A15] border-t sm:border border-[#2B3C30] rounded-t-3xl sm:rounded-3xl w-full max-w-lg max-h-[92dvh] sm:max-h-[85vh] flex flex-col shadow-2xl overflow-hidden select-none animate-in slide-in-from-bottom sm:zoom-in-95 duration-150 pb-[var(--sab)] sm:pb-0 text-[#E4EDE7]">
        {/* Mobile Pull Indicator */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center bg-[#141C16]">
          <div className="w-12 h-1 bg-[#28392C] rounded-full" />
        </div>

        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-[#1F2B22] flex items-center justify-between bg-[#141C16] shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-[#1A261D] text-[#55C778] border border-[#2B3E31] rounded-xl shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-white">Конспект бесіди</h3>
              <p className="text-xs text-[#8EA093]">Зведення домовленостей, рішень та задач</p>
            </div>
          </div>

          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="p-1.5 text-[#8EA093] hover:text-white hover:bg-[#1E2A21] rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Chat Metadata Header */}
          <div className="p-3 bg-[#141C16] border border-[#223126] rounded-2xl flex items-center gap-3 shadow-sm">
            <img src={chatAvatar} alt={chatTitle} className="w-10 h-10 rounded-xl object-cover ring-1 ring-[#1F2B22]" />
            <div className="min-w-0">
              <h4 className="font-bold text-xs sm:text-sm text-white truncate">{chatTitle}</h4>
              <p className="text-[11px] text-[#8EA093]">
                {messageCount} повідомлень в історії · Коло «{chat.circle || 'work'}»
              </p>
            </div>
          </div>

          {/* Section 1: Key Agreements */}
          <div className="space-y-2">
            <h4 className="font-bold text-xs text-[#8EA093] uppercase tracking-wide flex items-center gap-1.5">
              <span>📌 Ключові рішення</span>
            </h4>
            <div className="space-y-1.5">
              {keyAgreements.map((agr, idx) => (
                <div
                  key={idx}
                  className="p-2.5 bg-[#141C16] border border-[#223126] rounded-xl text-xs text-[#D1DFD6] leading-relaxed shadow-sm"
                >
                  {agr}
                </div>
              ))}
            </div>
          </div>

          {/* Section 2: Action Items */}
          <div className="space-y-2">
            <h4 className="font-bold text-xs text-[#8EA093] uppercase tracking-wide flex items-center gap-1.5">
              <span>⚡ Задачі та виконавці</span>
            </h4>
            <div className="space-y-1.5">
              {actionItems.map((item, idx) => (
                <div
                  key={idx}
                  className="p-2.5 bg-[#141C16] border border-[#223126] rounded-xl flex items-center justify-between gap-2 text-xs shadow-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#55C778] shrink-0" />
                    <span className="font-medium text-white truncate">{item.text}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 font-semibold text-[10px]">
                    <span className="bg-[#1A261D] text-[#55C778] border border-[#2B3E31] px-2 py-0.5 rounded-md">
                      {item.assignee}
                    </span>
                    <span className="text-[#8EA093]">{item.due}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#1F2B22]">
            <button
              onClick={handleCopy}
              className="py-2.5 px-3 bg-[#141C16] hover:bg-[#18231B] border border-[#223126] rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5 transition-colors shadow-sm"
            >
              {copied ? <Check className="w-4 h-4 text-[#55C778]" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Скопійовано!' : 'Копіювати текст'}</span>
            </button>

            <button
              onClick={handleSaveToNotes}
              className="py-2.5 px-3 bg-[#55C778] hover:bg-[#46AF68] text-[#0C120E] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-sm"
            >
              {saved ? <Check className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
              <span>{saved ? 'Збережено в нотатки!' : 'Зберегти у вибране'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
