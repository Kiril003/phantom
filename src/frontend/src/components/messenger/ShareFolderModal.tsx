import React, { useState } from 'react';
import {
  AlertTriangle,
  X,
  Shield,
  Layers,
} from 'lucide-react';
import { Chat, SmartFolder } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface ShareFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  folder: SmartFolder | null;
  chats: Chat[];
}

export const ShareFolderModal: React.FC<ShareFolderModalProps> = ({
  isOpen,
  onClose,
  folder,
  chats,
}) => {
  const [allowJoinAll, setAllowJoinAll] = useState(true);
  const [autoSyncTopics, setAutoSyncTopics] = useState(true);
  

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
          {/* Посилання-запрошення тут не було чим підкріпити: домену aura.chat не
              існує, токен генерувався через Math.random, а QR був сіткою 6×6 за
              формулою i % 2 === 0 && i % 3 === 0 — його неможливо відсканувати.
              Спільного каталогу просторів немає, тож і посилання бути не може. */}
          <div className="p-3 bg-[#2A2013] border border-[#4D3A1F] rounded-2xl space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-[#FBBF24]">
              <AlertTriangle className="w-4 h-4" />
              <span>Посилань-запрошень поки немає</span>
            </div>
            <span className="text-[11px] text-[#B9A88C] block leading-relaxed">
              Спільного каталогу просторів не існує, тож посилання не було б куди вести.
              Щоб хтось зміг вам написати, дайте йому ключ вашого вузла — він у
              налаштуваннях, розділ «Мережа &amp; P2P».
            </span>
          </div>

          {/* Чати у структурі */}
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
          </div>
        </div>
      </div>
    </div>
  );
};
