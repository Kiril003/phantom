import React, { useEffect, useState } from 'react';
import {
  X,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  Layers,
} from 'lucide-react';
import { Chat } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';
import { chatApi } from '../../services/api';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { useMessengerStore } from '../../stores/messengerStore';

interface ChatDigestModalProps {
  isOpen: boolean;
  onClose: () => void;
  chat: Chat;
  onSaveToNotes?: (digestContent: string) => void;
}

const MAX_MESSAGES_IN_PROMPT = 60;

/** Скільки пунктів справді стоїть під заголовком секції. */
function countBullets(markdown: string, heading: string): number {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.includes(heading));
  if (start < 0) return 0;
  let n = 0;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) break;
    if (line.trim().startsWith('- ')) n += 1;
  }
  return n;
}

export const ChatDigestModal: React.FC<ChatDigestModalProps> = ({
  isOpen,
  onClose,
  chat,
}) => {
  const [copied, setCopied] = useState(false);
  const [published, setPublished] = useState(false);
  const [digest, setDigest] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const textMessages = (chat?.messages || []).filter((m) => m && m.text && m.text.trim());

  const buildDigest = async () => {
    setFailure(null);
    if (textMessages.length === 0) {
      setFailure('У цій бесіді ще немає тексту, з якого складати конспект.');
      return;
    }
    setIsLoading(true);
    try {
      const transcript = textMessages
        .slice(-MAX_MESSAGES_IN_PROMPT)
        .map((m) => `${m.senderName || 'Учасник'}: ${m.text}`)
        .join('\n');

      const res = await chatApi.sendMessage({
        content:
          'Склади структурований Smart Digest активності цієї робочої групи українською за секціями:\n' +
          '### 🎯 Ухвалені рішення\n' +
          '- [пункти]\n\n' +
          '### 📋 Призначені завдання та дії\n' +
          '- [пункти з виконавцями]\n\n' +
          '### ❓ Відкриті питання\n' +
          '- [пункти]\n\n' +
          'Спирайся лише на переписку:\n\n' +
          transcript,
        input_method: 'text',
      });
      const reply = (res?.message?.content || '').trim();
      if (!reply) {
        // Тут стояв ГОТОВИЙ конспект: три «ухвалені рішення» і три доручення
        // на імена Кирило / Саня / Марина. Він з'являвся саме тоді, коли
        // модель не відповіла, — тобто рівно тоді, коли знати не було чого.
        // Далі його можна було скопіювати як markdown із назвою реального
        // простору й сьогоднішньою датою або ОПУБЛІКУВАТИ в сам чат
        // (`handleExportToCanvas` вмикається по `digest`). Вигаданий протокол
        // наради, підписаний реальними людьми, — не запасний варіант.
        setFailure('Модель відповіла порожнім — конспекту немає.');
        return;
      }
      setDigest(reply);
      setFailure(null);
    } catch (err) {
      // Причину несемо в кадр. Тиша тут коштувала б того самого, що й вигадка:
      // людина не відрізнила б «нема про що» від «не дістався до ядра».
      setFailure(
        err instanceof Error && err.message
          ? `Не вдалося скласти конспект: ${err.message}`
          : 'Не вдалося скласти конспект — ядро не відповіло.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setDigest(null);
    setFailure(null);
    void buildDigest();
    // `buildDigest` навмисно не в залежностях: вона пересоздається щорендеру
    // (тримає `textMessages`, а той — новий масив кожного разу), тож із нею в
    // списку конспект перескладався б на кожен вхідний лист і на кожен кадр.
    // Конспект будується один раз на відкриття цього простору; перескласти
    // вручну є чим — кнопка «Перегенерувати» в шапці.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, chat?.id]);

  useEscapeClose(isOpen, onClose);

  if (!isOpen || !chat) return null;

  const chatTitle = chat.title || 'Бесіда';
  const chatCircle = (chat.circle || 'work').toUpperCase();

  const fullDigestMarkdown = digest
    ? `# Smart Digest: ${chatTitle}\n` +
      `Коло: ${chatCircle} | Дата: ${new Date().toLocaleDateString('uk-UA')}\n\n` +
      digest
    : '';

  const handleCopy = () => {
    if (!fullDigestMarkdown) return;
    soundFx.playTap();
    navigator.clipboard.writeText(fullDigestMarkdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportToCanvas = () => {
    soundFx.playSend();
    const store = useMessengerStore.getState();
    store.addCustomMessage({
      id: `msg_canvas_${Date.now()}`,
      senderId: store.currentUser.id,
      senderName: store.currentUser.name,
      senderAvatar: store.currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'widget:canvas',
      isSelf: true,
      canvasData: {
        id: `canvas_digest_${Date.now()}`,
        threadId: chat.id,
        conversationId: chat.id,
        title: `Smart Digest • ${chatTitle}`,
        rawMarkdown: fullDigestMarkdown,
        // Було намертво 3 і 2 — незалежно від того, що насправді в тексті.
        // Картка в чаті обіцяла «3 рішення» навіть там, де їх нуль.
        decisionsCount: countBullets(digest ?? '', '🎯 Ухвалені рішення'),
        openQuestionsCount: countBullets(digest ?? '', '❓ Відкриті питання'),
        updatedBy: store.currentUser.name,
        blocks: [
          { id: 'b1', type: 'decision', content: '🎯 Ухвалені рішення: Синтез рішень з бесіди', updatedAt: 'щойно' },
          { id: 'b2', type: 'action-item', content: '📋 Доручення та дії: Призначені задачі команді', updatedAt: 'щойно' },
        ],
        lastUpdated: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      },
    });
    setPublished(true);
    setTimeout(() => {
      setPublished(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-2xl bg-[#FDFCF9] border border-[#E5DEC9] rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 text-[#21261F] flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 bg-[#F7F4EC] border-b border-[#E5DEC9] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#FDF5ED] border border-[#EADCC8] flex items-center justify-center text-[#D96C35] shadow-sm">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#21261F]">
                Локальний Smart Digest активності
              </h3>
              <p className="text-xs text-[#6E7568] mt-0.5">
                Простір: <b>{chatTitle}</b> • Автоматичний звіт рішень та відкритих питань
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={buildDigest}
              disabled={isLoading}
              title="Перегенерувати"
              className="p-2 hover:bg-[#EAE4D7] rounded-xl text-[#6E7568] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[#EAE4D7] rounded-xl text-[#6E7568] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
          {isLoading ? (
            <div className="py-16 text-center space-y-3">
              <Sparkles className="w-8 h-8 text-[#D96C35] animate-pulse mx-auto" />
              <p className="text-xs font-bold text-[#21261F]">
                Складаю локальний конспект рішень та доручень…
              </p>
              <p className="text-[11px] text-[#6E7568]">Аналізую історію переписки без витоку в хмару</p>
            </div>
          ) : failure ? (
            <div className="py-14 text-center space-y-2" role="status">
              <Sparkles className="w-8 h-8 text-[#B85425] opacity-40 mx-auto" />
              <p className="text-xs font-bold text-[#21261F]">Конспекту немає</p>
              <p className="px-6 text-[11px] leading-relaxed text-[#6E7568]">{failure}</p>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-[#FAF7F0] border border-[#E5DEC9] text-xs text-[#21261F] whitespace-pre-wrap leading-relaxed font-sans">
              {digest}
            </div>
          )}
        </div>

        {/* Footer with Action Buttons */}
        <div className="p-4 bg-[#F7F4EC] border-t border-[#E5DEC9] flex items-center justify-between gap-2">
          <button
            onClick={handleCopy}
            disabled={!digest}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-[#FDF5ED] border border-[#E5DEC9] text-xs font-semibold text-[#21261F] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-[#6E7568]" />}
            <span>{copied ? 'Скопійовано!' : 'Копіювати MD'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportToCanvas}
              disabled={!digest}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#D96C35] hover:bg-[#B85425] text-white text-xs font-bold shadow-sm transition-all disabled:opacity-50"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{published ? 'Опубліковано в чат ✓' : 'Експортувати в Canvas 🚀'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
