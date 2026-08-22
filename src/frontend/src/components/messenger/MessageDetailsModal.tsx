import React from 'react';
import { X, Info, CheckCheck, Clock, Radio } from 'lucide-react';
import { Message, ChatMember } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

const deliveryStatusLabel: Record<NonNullable<Message['status']>, string> = {
  sending: 'Надсилається',
  queued: 'Записано вузлом, до співрозмовника ще не доїхало',
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
        className="w-full max-w-md bg-[#FDFCF9] border border-[#DDD4C4] rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col max-h-[85vh] text-[#1E2521]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#FDFCF9] border-b border-[#E6DFD3] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#F9F7F1] text-[#E87A42] border border-[#DDD4C4] rounded-xl">
              <Info className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#1E2521]">Інформація про повідомлення</h3>
              <p className="text-[11px] text-[#5F6A60]">{chatTitle}</p>
            </div>
          </div>
          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="p-1.5 hover:bg-[#F1EDE3] text-[#5F6A60] hover:text-[#1E2521] rounded-xl transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Sender card */}
          <div className="p-3 bg-[#FDFCF9] border border-[#E6DFD3] rounded-2xl flex items-center gap-3">
            <img
              src={message.senderAvatar}
              alt={message.senderName}
              className="w-10 h-10 rounded-xl object-cover ring-1 ring-white/10 shrink-0"
            />
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-xs text-[#1E2521] truncate">{message.senderName}</h4>
              <p className="text-[11px] text-[#5F6A60]">ID: {message.senderId}</p>
            </div>
            <span className="px-2 py-0.5 bg-[#F9F7F1] text-[#E87A42] font-semibold text-[10px] rounded-lg border border-[#DDD4C4]">
              {message.isSelf ? 'Ви' : 'Учасник'}
            </span>
          </div>

          {/* Delivery & Timestamps */}
          <div className="p-3.5 bg-[#FDFCF9] border border-[#E6DFD3] rounded-2xl space-y-2.5 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-[#E6DFD3]">
              <span className="text-[#5F6A60] flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#E87A42]" />
                <span>Час відправки</span>
              </span>
              <span className="font-mono font-medium text-[#1E2521]">{message.timestamp}</span>
            </div>

            {message.status && (
              <div className="flex items-center justify-between pb-2 border-b border-[#E6DFD3]">
                <span className="text-[#5F6A60] flex items-center gap-1.5">
                  <CheckCheck className="w-3.5 h-3.5 text-[#5F6A60]" />
                  <span>Статус доставки</span>
                </span>
                <span className={`font-semibold ${
                  message.status === 'failed' ? 'text-[#F87171]' : 'text-[#1E2521]'
                }`}>
                  {deliveryStatusLabel[message.status]}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-[#5F6A60] flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-[#5F6A60]" />
                <span>Транспорт</span>
              </span>
              <span className="font-mono text-[11px] text-[#1E2521]">
                {message.transport ? transportLabel[message.transport] : '—'}
              </span>
            </div>
          </div>

          {/* Message Content preview & stats */}
          <div className="p-3.5 bg-[#FDFCF9] border border-[#E6DFD3] rounded-2xl space-y-2.5 text-xs">
            <div className="flex items-center justify-between text-[11px] text-[#5F6A60]">
              <span className="font-bold uppercase tracking-wider text-[10px]">Тип вмісту</span>
              <span className="font-mono px-2 py-0.5 bg-[#F7F5EE] border border-[#E6DFD3] rounded-md font-semibold text-[#E87A42]">
                {message.type}
              </span>
            </div>

            {message.text && (
              <>
                <div className="p-3 bg-[#F7F5EE] border border-[#E6DFD3] rounded-xl text-xs text-[#1E2521] select-text max-h-32 overflow-y-auto leading-relaxed">
                  {message.text}
                </div>
                <div className="flex items-center justify-between text-[11px] text-[#5F6A60] pt-1">
                  <span>Символів: <strong className="text-[#1E2521]">{textLength}</strong></span>
                  <span>Слів: <strong className="text-[#1E2521]">{wordCount}</strong></span>
                  {message.isEdited && <span className="text-[#FBBF24] font-semibold">Було відредаговано</span>}
                </div>
              </>
            )}
          </div>

          {/* Reactions breakdown */}
          {message.reactions && message.reactions.length > 0 && (
            <div className="p-3.5 bg-[#FDFCF9] border border-[#E6DFD3] rounded-2xl space-y-2.5 text-xs">
              <h5 className="font-bold text-[11px] text-[#1E2521] uppercase tracking-wider">
                Реакції учасників ({message.reactions.reduce((acc, r) => acc + r.count, 0)})
              </h5>
              <div className="space-y-1.5">
                {message.reactions.map((r, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 bg-[#F7F5EE] rounded-xl border border-[#E6DFD3]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{r.emoji}</span>
                      <span className="text-xs text-[#5F6A60] truncate">
                        {r.users.join(', ')}
                      </span>
                    </div>
                    <span className="font-mono font-bold text-xs text-[#E87A42]">{r.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-[#FDFCF9] border-t border-[#E6DFD3] flex justify-end">
          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="px-4 py-1.5 bg-[#F9F7F1] border border-[#DDD4C4] text-[#E87A42] hover:bg-[#F1EDE3] rounded-xl text-xs font-semibold transition-colors"
          >
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
};
