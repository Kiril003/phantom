import React from 'react';
import { X, Info, CheckCheck, Clock, Radio } from 'lucide-react';
import { Message, ChatMember } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

const deliveryStatusLabel: Record<NonNullable<Message['status']>, string> = {
  sending: 'Надсилається',
  sent: 'Надіслано',
  delivered: 'Доставлено',
  read: 'Прочитано',
  failed: 'Не надіслано',
};

const transportLabel: Record<NonNullable<Message['transport']>, string> = {
  p2p: 'WebRTC DataChannel (DTLS)',
  server: 'Через вузол (WebSocket)',
  relay: 'Через релей-вузол',
};

interface MessageDetailsModalProps {
  message: Message | null;
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
  members?: ChatMember[];
}

export const MessageDetailsModal: React.FC<MessageDetailsModalProps> = ({
  message,
  isOpen,
  onClose,
  chatTitle = 'Бесіда',
  members: _members = [],
}) => {
  if (!isOpen || !message) return null;

  const textLength = message.text ? message.text.length : 0;
  const wordCount = message.text ? message.text.trim().split(/\s+/).filter(Boolean).length : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#121A15] border border-[#2B3C30] rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col max-h-[85vh] text-[#E4EDE7]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#141C16] border-b border-[#1F2B22] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#1A261D] text-[#55C778] border border-[#2B3E31] rounded-xl">
              <Info className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Інформація про повідомлення</h3>
              <p className="text-[11px] text-[#8EA093]">{chatTitle}</p>
            </div>
          </div>
          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="p-1.5 hover:bg-[#1E2A21] text-[#8EA093] hover:text-white rounded-xl transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Sender card */}
          <div className="p-3 bg-[#141C16] border border-[#223126] rounded-2xl flex items-center gap-3">
            <img
              src={message.senderAvatar}
              alt={message.senderName}
              className="w-10 h-10 rounded-xl object-cover ring-1 ring-white/10 shrink-0"
            />
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-xs text-white truncate">{message.senderName}</h4>
              <p className="text-[11px] text-[#8EA093]">ID: {message.senderId}</p>
            </div>
            <span className="px-2 py-0.5 bg-[#1A261D] text-[#55C778] font-semibold text-[10px] rounded-lg border border-[#2B3E31]">
              {message.isSelf ? 'Ви' : 'Учасник'}
            </span>
          </div>

          {/* Delivery & Timestamps */}
          <div className="p-3.5 bg-[#141C16] border border-[#223126] rounded-2xl space-y-2.5 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-[#1F2B22]">
              <span className="text-[#8EA093] flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#55C778]" />
                <span>Час відправки</span>
              </span>
              <span className="font-mono font-medium text-white">{message.timestamp}</span>
            </div>

            {message.status && (
              <div className="flex items-center justify-between pb-2 border-b border-[#1F2B22]">
                <span className="text-[#8EA093] flex items-center gap-1.5">
                  <CheckCheck className="w-3.5 h-3.5 text-[#8EA093]" />
                  <span>Статус доставки</span>
                </span>
                <span className={`font-semibold ${
                  message.status === 'failed' ? 'text-[#F87171]' : 'text-white'
                }`}>
                  {deliveryStatusLabel[message.status]}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-[#8EA093] flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-[#8EA093]" />
                <span>Транспорт</span>
              </span>
              <span className="font-mono text-[11px] text-white">
                {message.transport ? transportLabel[message.transport] : '—'}
              </span>
            </div>
          </div>

          {/* Message Content preview & stats */}
          <div className="p-3.5 bg-[#141C16] border border-[#223126] rounded-2xl space-y-2.5 text-xs">
            <div className="flex items-center justify-between text-[11px] text-[#8EA093]">
              <span className="font-bold uppercase tracking-wider text-[10px]">Тип вмісту</span>
              <span className="font-mono px-2 py-0.5 bg-[#0E1410] border border-[#223126] rounded-md font-semibold text-[#55C778]">
                {message.type}
              </span>
            </div>

            {message.text && (
              <>
                <div className="p-3 bg-[#0E1410] border border-[#1F2B22] rounded-xl text-xs text-white select-text max-h-32 overflow-y-auto leading-relaxed">
                  {message.text}
                </div>
                <div className="flex items-center justify-between text-[11px] text-[#8EA093] pt-1">
                  <span>Символів: <strong className="text-white">{textLength}</strong></span>
                  <span>Слів: <strong className="text-white">{wordCount}</strong></span>
                  {message.isEdited && <span className="text-[#FBBF24] font-semibold">Було відредаговано</span>}
                </div>
              </>
            )}
          </div>

          {/* Reactions breakdown */}
          {message.reactions && message.reactions.length > 0 && (
            <div className="p-3.5 bg-[#141C16] border border-[#223126] rounded-2xl space-y-2.5 text-xs">
              <h5 className="font-bold text-[11px] text-white uppercase tracking-wider">
                Реакції учасників ({message.reactions.reduce((acc, r) => acc + r.count, 0)})
              </h5>
              <div className="space-y-1.5">
                {message.reactions.map((r, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 bg-[#0E1410] rounded-xl border border-[#1F2B22]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{r.emoji}</span>
                      <span className="text-xs text-[#A4B8AB] truncate">
                        {r.users.join(', ')}
                      </span>
                    </div>
                    <span className="font-mono font-bold text-xs text-[#55C778]">{r.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-[#141C16] border-t border-[#1F2B22] flex justify-end">
          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="px-4 py-1.5 bg-[#1C2920] border border-[#2B3E31] text-[#55C778] hover:bg-[#233529] rounded-xl text-xs font-semibold transition-colors"
          >
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
};
