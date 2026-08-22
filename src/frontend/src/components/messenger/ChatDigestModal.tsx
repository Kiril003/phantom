import React, { useEffect, useState } from 'react';
import {
  X,
  FileText,
  Copy,
  Check,
  Bookmark,
  RefreshCw
} from 'lucide-react';
import { Chat } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';
import { chatApi } from '../../services/api';

interface ChatDigestModalProps {
  isOpen: boolean;
  onClose: () => void;
  chat: Chat;
  onSaveToNotes?: (digestContent: string) => void;
}

const MAX_MESSAGES_IN_PROMPT = 60;

export const ChatDigestModal: React.FC<ChatDigestModalProps> = ({
  isOpen,
  onClose,
  chat,
  onSaveToNotes,
}) => {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [digest, setDigest] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textMessages = (chat?.messages || []).filter((m) => m && m.text && m.text.trim());

  const buildDigest = async () => {
    if (textMessages.length === 0) return;
    setIsLoading(true);
    setError(null);
    try {
      const transcript = textMessages
        .slice(-MAX_MESSAGES_IN_PROMPT)
        .map((m) => `${m.senderName || 'Учасник'}: ${m.text}`)
        .join('\n');
      const res = await chatApi.sendMessage({
        content:
          'Склади короткий конспект цієї переписки українською: домовленості, рішення та завдання. ' +
          'Спирайся лише на текст нижче, нічого не додумуй.\n\n' +
          transcript,
        input_method: 'text',
      });
      const reply = (res?.message?.content || '').trim();
      if (!reply) {
        setError('Локальний агент не повернув конспекту');
        return;
      }
      setDigest(reply);
    } catch {
      setError('Локальний агент недоступний — конспект не сформовано');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setDigest(null);
    setError(null);
    void buildDigest();
    // навмисно лише на відкриття та зміну чату — інакше конспект перезапитувався б на кожен рендер
  }, [isOpen, chat?.id]);

  if (!isOpen || !chat) return null;

  const chatTitle = chat.title || 'Бесіда';
  const chatCircle = (chat.circle || 'work').toUpperCase();
  const chatAvatar = chat.avatar || 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=200&auto=format&fit=crop&q=80';
  const messageCount = chat.messages ? chat.messages.length : 0;

  const fullDigestMarkdown = digest
    ? `# Конспект бесіди: ${chatTitle}\n` +
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

  const handleSaveToNotes = () => {
    if (!fullDigestMarkdown) return;
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
              <p className="text-xs text-[#8EA093]">Складає локальний агент PHANTOM</p>
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

          {textMessages.length === 0 ? (
            <p className="p-3 bg-[#141C16] border border-[#223126] rounded-2xl text-xs text-[#8EA093]">
              У цій бесіді ще немає текстових повідомлень — конспектувати нічого.
            </p>
          ) : isLoading ? (
            <div className="p-3 bg-[#141C16] border border-[#223126] rounded-2xl text-xs text-[#8EA093] flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#55C778]" />
              <span>Читаю бесіду та складаю конспект…</span>
            </div>
          ) : error ? (
            <div className="p-3 bg-[#1E1614] border border-[#4D2424] rounded-2xl text-xs text-red-300 space-y-2">
              <p>{error}</p>
              <button
                onClick={buildDigest}
                className="px-3 py-1.5 bg-[#141C16] hover:bg-[#18231B] border border-[#223126] rounded-xl text-[11px] font-bold text-white transition-colors"
              >
                Спробувати ще раз
              </button>
            </div>
          ) : digest ? (
            <div className="p-3.5 bg-[#141C16] border border-[#223126] rounded-2xl text-xs text-[#D1DFD6] leading-relaxed whitespace-pre-wrap shadow-sm">
              {digest}
            </div>
          ) : null}

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#1F2B22]">
            <button
              onClick={handleCopy}
              disabled={!digest}
              className="py-2.5 px-3 bg-[#141C16] hover:bg-[#18231B] border border-[#223126] rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5 transition-colors shadow-sm disabled:opacity-40"
            >
              {copied ? <Check className="w-4 h-4 text-[#55C778]" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Скопійовано!' : 'Копіювати текст'}</span>
            </button>

            <button
              onClick={handleSaveToNotes}
              disabled={!digest}
              className="py-2.5 px-3 bg-[#55C778] hover:bg-[#46AF68] text-[#0C120E] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-sm disabled:opacity-40"
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
