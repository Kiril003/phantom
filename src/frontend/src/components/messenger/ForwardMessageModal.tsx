import React, { useState } from 'react';
import { X, Forward, Search } from 'lucide-react';
import { Chat, Message } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface ForwardMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  chats: Chat[];
  currentChatId: string;
  messagesToForward: Message[];
  onConfirmForward: (targetChatId: string) => void;
}

export const ForwardMessageModal: React.FC<ForwardMessageModalProps> = ({
  isOpen,
  onClose,
  chats,
  currentChatId,
  messagesToForward,
  onConfirmForward,
}) => {
  const [search, setSearch] = useState('');
  

  if (!isOpen) return null;

  const targetChats = chats.filter(
    (c) => c.id !== currentChatId && c.title.toLowerCase().includes(search.toLowerCase())
  );

  const handleForward = (chatId: string) => {
    soundFx.playSend();
    onConfirmForward(chatId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-4">
      <div className="bg-[#121A15] border border-[#2B3C30] rounded-3xl w-full max-w-md shadow-2xl overflow-hidden select-none animate-in fade-in zoom-in-95 duration-150 text-[#E4EDE7]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1F2B22] flex items-center justify-between bg-[#141C16]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#1A261D] text-[#55C778] border border-[#2B3E31] rounded-xl">
              <Forward className="w-5 h-5 text-[#55C778]" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-white">
                Переслати повідомлення
              </h3>
              <p className="text-xs text-[#8EA093]">
                {messagesToForward.length} {messagesToForward.length === 1 ? 'повідомлення' : 'повідомлень'}
              </p>
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

        {/* Search */}
        <div className="p-3 border-b border-[#1F2B22] bg-[#0E1410]">
          <div className="relative">
            <Search className="w-4 h-4 text-[#6B8072] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Пошук чату або групи для пересилання..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-[#141C16] border border-[#233127] rounded-xl text-xs text-white placeholder-[#6B8072] focus:outline-none focus:border-[#55C778]"
            />
          </div>
        </div>

        {/* Chat List */}
        <div className="max-h-72 overflow-y-auto p-2 space-y-1 bg-[#121A15]">
          {targetChats.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#8EA093]">Чатів не знайдено</div>
          ) : (
            targetChats.map((chat) => (
              <div
                key={chat.id}
                onClick={() => handleForward(chat.id)}
                className="p-2.5 rounded-2xl hover:bg-[#18231B] border border-transparent hover:border-[#26372B] cursor-pointer flex items-center justify-between gap-3 transition-all group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={chat.avatar}
                    alt={chat.title}
                    className="w-9 h-9 rounded-xl object-cover ring-1 ring-white/10 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="font-bold text-xs text-white truncate group-hover:text-[#55C778] transition-colors">{chat.title}</p>
                    <p className="text-[10px] text-[#8EA093] truncate">{chat.circle}</p>
                  </div>
                </div>

                <span className="text-xs text-[#55C778] font-bold">Надіслати →</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
