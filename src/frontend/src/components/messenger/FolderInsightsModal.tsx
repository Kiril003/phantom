import React, { useMemo } from 'react';
import {
  X,
  MessageSquare,
  Users,
  Inbox
} from 'lucide-react';
import { Chat, SmartFolder } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';
import { Avatar } from './Avatar';
import { useEscapeClose } from '../../hooks/useEscapeClose';

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

  // Escape виводить із шару так само, як хрестик.
  useEscapeClose(isOpen, onClose);

  if (!isOpen || !folder) return null;

  const accentColor = folder.color || '#E87A42';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 phantom-scrim animate-in fade-in duration-150 select-none">
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-[#FDFCF9] border border-[#DDD4C4] rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-[#1E2521] animate-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="p-4 border-b border-[#E6DFD3] bg-[#FDFCF9] flex items-center justify-between">
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
              <h3 className="font-extrabold text-sm text-[#1E2521] truncate">
                {folder.name}
              </h3>
              <p className="text-[11px] text-[#5F6A60] truncate">
                Склад папки та обсяг збережених повідомлень
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="p-1.5 hover:bg-[#F1EDE3] rounded-xl text-[#5F6A60] hover:text-[#1E2521] transition-colors shrink-0"
            title="Закрити"
          >
            <X className="w-5 h-5" strokeWidth={1.75} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* Реальні лічильники */}
          <div className="grid grid-cols-3 gap-2">
            <div className="p-3 bg-[#FDFCF9] border border-[#E6DFD3] rounded-2xl space-y-1">
              <div className="flex items-center justify-between text-[#5F6A60]">
                <span className="text-[10px] font-bold uppercase tracking-wider">Бесід</span>
                <Users className="w-3.5 h-3.5" style={{ color: accentColor }} strokeWidth={1.75} />
              </div>
              <div className="text-xl font-black text-[#1E2521] tracking-tight">
                {folderChats.length}
              </div>
            </div>

            <div className="p-3 bg-[#FDFCF9] border border-[#E6DFD3] rounded-2xl space-y-1">
              <div className="flex items-center justify-between text-[#5F6A60]">
                <span className="text-[10px] font-bold uppercase tracking-wider">Повідомлень</span>
                <MessageSquare className="w-3.5 h-3.5 text-[#E87A42]" strokeWidth={1.75} />
              </div>
              <div className="text-xl font-black text-[#1E2521] tracking-tight">
                {totalMessages}
              </div>
              <div className="text-[10px] text-[#5F6A60]">в історії на цьому вузлі</div>
            </div>

            <div className="p-3 bg-[#FDFCF9] border border-[#E6DFD3] rounded-2xl space-y-1">
              <div className="flex items-center justify-between text-[#5F6A60]">
                <span className="text-[10px] font-bold uppercase tracking-wider">Непрочитаних</span>
                <Inbox className="w-3.5 h-3.5 text-[#F4AF25]" strokeWidth={1.75} />
              </div>
              <div className="text-xl font-black text-[#1E2521] tracking-tight">
                {totalUnread}
              </div>
            </div>
          </div>

          {/* Розподіл повідомлень за бесідами */}
          <div className="bg-[#FDFCF9] border border-[#E6DFD3] rounded-2xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#5F6A60] uppercase tracking-wider">
                Розподіл повідомлень за бесідами
              </span>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {folderChats.length === 0 ? (
                <p className="text-center text-[#5F6A60] py-2">У цій папці немає чатів</p>
              ) : (
                sortedChats.map((chat, idx) => {
                  const msgs = chat.messages?.length || 0;
                  const percent = totalMessages > 0 ? Math.round((msgs / totalMessages) * 100) : 0;
                  return (
                    <div key={chat.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Avatar src={chat.avatar} name={chat.title} className="w-5 h-5 shrink-0" radius="rounded-lg" />
                          <span className="font-bold text-[#1E2521] truncate">
                            {chat.title}
                          </span>
                        </div>
                        <span className="font-mono text-[11px] text-[#5F6A60] shrink-0">
                          {msgs} пов. ({percent}%)
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-[#F7F5EE] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${percent}%`,
                            backgroundColor: idx === 0 ? accentColor : '#E87A42',
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
        <div className="p-3.5 border-t border-[#E6DFD3] bg-[#FDFCF9] flex items-center justify-end">
          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="px-4 py-2 bg-[#E87A42] hover:bg-[#C25925] text-[#F7F5EE] rounded-xl font-bold text-xs transition-colors"
          >
            Зрозуміло
          </button>
        </div>
      </div>
    </div>
  );
};
