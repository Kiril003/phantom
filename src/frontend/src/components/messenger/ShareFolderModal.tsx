import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  QrCode,
  Shield,
  Layers,
  Link,
  Send,
  RefreshCw
} from 'lucide-react';
import { Chat, SmartFolder } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface ShareFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  folder: SmartFolder | null;
  chats: Chat[];
  onSendToChat?: (folder: SmartFolder, inviteUrl: string) => void;
}

export const ShareFolderModal: React.FC<ShareFolderModalProps> = ({
  isOpen,
  onClose,
  folder,
  chats,
  onSendToChat,
}) => {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [allowJoinAll, setAllowJoinAll] = useState(true);
  const [autoSyncTopics, setAutoSyncTopics] = useState(true);
  
  const [tokenSeed, setTokenSeed] = useState(() => Math.random().toString(36).substring(2, 9));

  if (!isOpen || !folder) return null;

  // Filter chats belonging to this folder
  const folderChats = chats.filter((c) => {
    if (folder.id === 'all') return true;
    if (folder.chatIds && folder.chatIds.includes(c.id)) return true;
    if (
      folder.filterRules?.includeCircles &&
      folder.filterRules.includeCircles.includes(c.circle)
    ) {
      return true;
    }
    return false;
  });

  const inviteUrl = `https://aura.chat/folder/${folder.id}-${tokenSeed}?join=1`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    soundFx.playSend();
    setTimeout(() => setCopied(false), 2500);
  };

  const handleRegenerate = () => {
    soundFx.playTap();
    setTokenSeed(Math.random().toString(36).substring(2, 9));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150">
      <div
        className="w-full max-w-md bg-[#121A15] border border-[#2B3C30] rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-[#E4EDE7] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 border-b border-[#1F2B22] bg-[#141C16] flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg shadow-2xs shrink-0 bg-[#1A261D] border border-[#2B3E31]"
            >
              <span>{folder.emoji}</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-sm text-white truncate">
                  {folder.name}
                </h3>
                <span className="text-[10px] px-2 py-0.5 bg-[#1A261D] text-[#55C778] font-bold rounded-full border border-[#2B3E31]">
                  Поділитися
                </span>
              </div>
              <p className="text-[11px] text-[#8EA093] truncate">
                {folder.vibe || 'Спільна структура чатів та каналів'}
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="p-1.5 hover:bg-[#1E2A21] rounded-xl text-[#8EA093] hover:text-white transition-colors"
            title="Закрити"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* 1. Invite Link Box */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-[#8EA093] uppercase tracking-wider">
              Унікальне посилання для запрошення
            </label>
            <div className="flex items-center gap-1.5 p-1.5 bg-[#0E1410] border border-[#223126] rounded-2xl shadow-sm">
              <Link className="w-4 h-4 text-[#55C778] ml-1.5 shrink-0" />
              <input
                type="text"
                readOnly
                value={inviteUrl}
                className="flex-1 bg-transparent text-xs font-mono text-white focus:outline-none truncate px-1"
              />
              <button
                onClick={handleRegenerate}
                className="p-1.5 hover:bg-[#18231B] text-[#8EA093] hover:text-white rounded-xl transition-colors shrink-0"
                title="Оновити посилання"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleCopyLink}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shrink-0 ${
                  copied
                    ? 'bg-[#183021] text-[#55C778] border border-[#2B3E31]'
                    : 'bg-[#55C778] hover:bg-[#46AF68] text-[#0C120E]'
                }`}
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Скопійовано!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Копіювати</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 2. QR Code Toggle & Preview */}
          <div className="bg-[#141C16] border border-[#223126] rounded-2xl p-3 space-y-2 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-white">
                <QrCode className="w-4 h-4 text-[#55C778]" />
                <span>QR-код для мобільних пристроїв</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  soundFx.playTap();
                  setShowQr(!showQr);
                }}
                className="text-[11px] font-extrabold text-[#55C778] hover:underline"
              >
                {showQr ? 'Сховати' : 'Показати'}
              </button>
            </div>

            {showQr && (
              <div className="pt-2 flex flex-col items-center justify-center gap-2 border-t border-[#1F2B22] animate-in fade-in duration-150">
                <div className="p-3 bg-[#0E1410] border border-[#2B3C30] rounded-2xl shadow-sm flex items-center justify-center">
                  {/* Stylized QR Code Graphic */}
                  <div className="w-36 h-36 bg-[#141C16] border border-[#233127] rounded-xl flex flex-col items-center justify-center p-2 relative overflow-hidden">
                    <div className="grid grid-cols-6 gap-1 w-full h-full opacity-80">
                      {Array.from({ length: 36 }).map((_, i) => (
                        <div
                          key={i}
                          className={`rounded-xs ${
                            (i % 2 === 0 && i % 3 === 0) || i === 0 || i === 5 || i === 30 || i === 35
                              ? 'bg-[#55C778]'
                              : i % 5 === 0
                              ? 'bg-[#3E9457]'
                              : 'bg-[#1C281F]'
                          }`}
                        />
                      ))}
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-8 h-8 rounded-xl bg-[#0E1410] border border-[#55C778] flex items-center justify-center shadow-md text-sm">
                        {folder.emoji}
                      </div>
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-[#8EA093] text-center">
                  Відскануйте камерою телефону для автоматичного імпорту простору
                </p>
              </div>
            )}
          </div>

          {/* 3. Included Chats & Topics Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-[#8EA093] uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#55C778]" />
                <span>Чати у структурі ({folderChats.length})</span>
              </label>
              <span className="text-[10px] text-[#8EA093]">
                Всі учасники отримають доступ
              </span>
            </div>

            <div className="bg-[#141C16] border border-[#223126] rounded-2xl p-2 max-h-36 overflow-y-auto space-y-1 shadow-sm">
              {folderChats.length === 0 ? (
                <div className="py-3 text-center text-[#8EA093] text-[11px]">
                  У цій папці поки немає чатів
                </div>
              ) : (
                folderChats.map((chat) => (
                  <div
                    key={chat.id}
                    className="p-1.5 rounded-xl hover:bg-[#18231B] flex items-center justify-between gap-2 transition-colors border border-transparent hover:border-[#26372B]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <img
                        src={chat.avatar}
                        alt={chat.title}
                        className="w-6 h-6 rounded-lg object-cover ring-1 ring-white/10 shrink-0"
                      />
                      <div className="min-w-0">
                        <h4 className="font-bold text-xs text-white truncate">
                          {chat.title}
                        </h4>
                        <span className="text-[9px] text-[#8EA093] truncate block">
                          {chat.topic || chat.customVibe || 'Чат спільноти'}
                        </span>
                      </div>
                    </div>

                    <span className="text-[10px] px-1.5 py-0.5 bg-[#0E1410] border border-[#223126] text-[#55C778] rounded font-medium shrink-0">
                      {chat.type === 'dm' || chat.type === 'direct' ? 'Особистий' : 'Група'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 4. Permissions & Rules */}
          <div className="bg-[#141C16] border border-[#223126] rounded-2xl p-3 space-y-2.5 shadow-sm">
            <div className="text-[11px] font-bold text-[#8EA093] uppercase tracking-wider flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-[#55C778]" />
              <span>Параметри запрошення</span>
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allowJoinAll}
                onChange={(e) => setAllowJoinAll(e.target.checked)}
                className="mt-0.5 rounded text-[#55C778] focus:ring-[#55C778] bg-[#0E1410] border-[#2B3C30]"
              />
              <div>
                <span className="font-bold text-xs text-white block">
                  Автоматичний вступ до всіх чатів папки
                </span>
                <span className="text-[10px] text-[#8EA093]">
                  Усі користувачі за посиланням одразу додаються до списку учасників.
                </span>
              </div>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoSyncTopics}
                onChange={(e) => setAutoSyncTopics(e.target.checked)}
                className="mt-0.5 rounded text-[#55C778] focus:ring-[#55C778] bg-[#0E1410] border-[#2B3C30]"
              />
              <div>
                <span className="font-bold text-xs text-white block">
                  Синхронізація майбутніх тем & каналів
                </span>
                <span className="text-[10px] text-[#8EA093]">
                  Нові чати, додані у цю папку пізніше, автоматично зʼявляться у підписників.
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 border-t border-[#1F2B22] bg-[#141C16] flex items-center justify-between gap-2">
          {onSendToChat && (
            <button
              onClick={() => {
                soundFx.playSend();
                onSendToChat(folder, inviteUrl);
                onClose();
              }}
              className="px-3.5 py-2 bg-[#1A261D] hover:bg-[#233529] text-[#55C778] border border-[#2B3E31] rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors shadow-sm"
            >
              <Send className="w-3.5 h-3.5 text-[#55C778]" />
              <span>Надіслати у чат</span>
            </button>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => {
                soundFx.playTap();
                onClose();
              }}
              className="px-3.5 py-2 hover:bg-[#1E2A21] text-[#8EA093] hover:text-white rounded-xl font-bold text-xs transition-colors"
            >
              Закрити
            </button>
            <button
              onClick={handleCopyLink}
              className="px-4 py-2 bg-[#1C2920] hover:bg-[#233529] border border-[#2B3E31] text-[#55C778] rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors shadow-sm"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Скопійовано!' : 'Копіювати посилання'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
