import React, { useMemo } from 'react';
import {
  X,
  MessageSquare,
  Users,
  Inbox
} from 'lucide-react';
import { Chat, SmartFolder } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface FolderInsightsModalProps {
  isOpen: boolean;
  onClose: () => void;
  folder: SmartFolder | null;
  chats: Chat[];
}

export const FolderInsightsModal: React.FC<FolderInsightsModalProps> = ({
  isOpen,
  onClose,
  folder,
  chats,
}) => {
  // Filter chats in this folder
  const folderChats = useMemo(() => {
    if (!folder) return [];
    return chats.filter((c) => {
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
  }, [folder, chats]);

  // Рахуємо тільки те, що справді лежить у сховищі: історії з датами тут немає
  const { totalMessages, totalUnread, sortedChats } = useMemo(() => {
    const sorted = [...folderChats].sort(
      (a, b) => (b.messages?.length || 0) - (a.messages?.length || 0)
    );
    return {
      totalMessages: folderChats.reduce((acc, c) => acc + (c.messages?.length || 0), 0),
      totalUnread: folderChats.reduce((acc, c) => acc + (c.unreadCount || 0), 0),
      sortedChats: sorted,
    };
  }, [folderChats]);

  if (!isOpen || !folder) return null;

  const accentColor = folder.color || '#E87A42';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150 select-none">
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-[#121A15] border border-[#2B3C30] rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-[#E4EDE7] animate-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="p-4 border-b border-[#1F2B22] bg-[#141C16] flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg shadow-sm shrink-0"
              style={{
                backgroundColor: `${accentColor}25`,
                border: `1px solid ${accentColor}45`,
              }}
            >
              <span>{folder.emoji}</span>
            </div>
            <div className="min-w-0">
              <h3 className="font-extrabold text-sm text-white truncate">
                {folder.name}
              </h3>
              <p className="text-[11px] text-[#8EA093] truncate">
                Склад папки та обсяг збережених повідомлень
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="p-1.5 hover:bg-[#1E2A21] rounded-xl text-[#8EA093] hover:text-white transition-colors shrink-0"
            title="Закрити"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* Реальні лічильники */}
          <div className="grid grid-cols-3 gap-2">
            <div className="p-3 bg-[#141C16] border border-[#223126] rounded-2xl space-y-1">
              <div className="flex items-center justify-between text-[#8EA093]">
                <span className="text-[10px] font-bold uppercase tracking-wider">Бесід</span>
                <Users className="w-3.5 h-3.5" style={{ color: accentColor }} />
              </div>
              <div className="text-xl font-black text-white tracking-tight">
                {folderChats.length}
              </div>
            </div>

            <div className="p-3 bg-[#141C16] border border-[#223126] rounded-2xl space-y-1">
              <div className="flex items-center justify-between text-[#8EA093]">
                <span className="text-[10px] font-bold uppercase tracking-wider">Повідомлень</span>
                <MessageSquare className="w-3.5 h-3.5 text-[#55C778]" />
              </div>
              <div className="text-xl font-black text-white tracking-tight">
                {totalMessages}
              </div>
              <div className="text-[10px] text-[#8EA093]">в історії на цьому вузлі</div>
            </div>

            <div className="p-3 bg-[#141C16] border border-[#223126] rounded-2xl space-y-1">
              <div className="flex items-center justify-between text-[#8EA093]">
                <span className="text-[10px] font-bold uppercase tracking-wider">Непрочитаних</span>
                <Inbox className="w-3.5 h-3.5 text-[#F4AF25]" />
              </div>
              <div className="text-xl font-black text-white tracking-tight">
                {totalUnread}
              </div>
            </div>
          </div>

          {/* Розподіл повідомлень за бесідами */}
          <div className="bg-[#141C16] border border-[#223126] rounded-2xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#8EA093] uppercase tracking-wider">
                Розподіл повідомлень за бесідами
              </span>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {folderChats.length === 0 ? (
                <p className="text-center text-[#8EA093] py-2">У цій папці немає чатів</p>
              ) : (
                sortedChats.map((chat, idx) => {
                  const msgs = chat.messages?.length || 0;
                  const percent = totalMessages > 0 ? Math.round((msgs / totalMessages) * 100) : 0;
                  return (
                    <div key={chat.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <img
                            src={chat.avatar}
                            alt={chat.title}
                            className="w-5 h-5 rounded-lg object-cover ring-1 ring-[#1F2B22] shrink-0"
                          />
                          <span className="font-bold text-white truncate">
                            {chat.title}
                          </span>
                        </div>
                        <span className="font-mono text-[11px] text-[#8EA093] shrink-0">
                          {msgs} пов. ({percent}%)
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-[#0E1410] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${percent}%`,
                            backgroundColor: idx === 0 ? accentColor : '#55C778',
                          }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 border-t border-[#1F2B22] bg-[#141C16] flex items-center justify-end">
          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="px-4 py-2 bg-[#55C778] hover:bg-[#46AF68] text-[#0C120E] rounded-xl font-bold text-xs transition-colors"
          >
            Зрозуміло
          </button>
        </div>
      </div>
    </div>
  );
};
