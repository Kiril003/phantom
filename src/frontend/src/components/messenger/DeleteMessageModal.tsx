import React, { useState } from 'react';
import { Trash2, X, User, Users } from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface DeleteMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmDelete: (deleteForEveryone: boolean) => void;
  isSelfMessage: boolean;
  messageTextPreview?: string;
}

export const DeleteMessageModal: React.FC<DeleteMessageModalProps> = ({
  isOpen,
  onClose,
  onConfirmDelete,
  isSelfMessage,
  messageTextPreview,
}) => {
  const [deleteForEveryone, setDeleteForEveryone] = useState(true);

  if (!isOpen) return null;

  const handleConfirm = () => {
    soundFx.playTap();
    onConfirmDelete(deleteForEveryone);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center phantom-scrim p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-[#FDFCF9] border border-[#DDD4C4] rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 p-5 text-[#1E2521]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon & Title */}
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2.5 bg-red-950/60 text-red-400 border border-red-900/50 rounded-2xl shrink-0">
            <Trash2 className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-sm text-[#1E2521]">Видалити повідомлення?</h3>
            <p className="text-xs text-[#5F6A60] mt-0.5">Цю дію неможливо буде скасувати.</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[#F1EDE3] text-[#5F6A60] hover:text-[#1E2521] rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Message preview snippet */}
        {messageTextPreview && (
          <div className="p-2.5 bg-[#F7F5EE] border border-[#E6DFD3] rounded-xl text-xs text-[#5F6A60] mb-4 truncate italic">
            «{messageTextPreview}»
          </div>
        )}

        {/* Choice: For Me vs For Everyone (if self message) */}
        {isSelfMessage && (
          <div className="space-y-2 mb-4">
            <label
              onClick={() => setDeleteForEveryone(true)}
              className={`p-3 rounded-2xl border flex items-center gap-3 cursor-pointer transition-all ${
                deleteForEveryone
                  ? 'bg-[#F9F7F1] border-[#E87A42] ring-1 ring-[#E87A42]'
                  : 'bg-[#FDFCF9] border-[#E6DFD3] hover:bg-[#F9F7F1]'
              }`}
            >
              <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                deleteForEveryone ? 'border-[#E87A42] bg-[#E87A42]' : 'border-[#4A5D50]'
              }`}>
                {deleteForEveryone && <div className="w-1.5 h-1.5 bg-[#F7F5EE] rounded-full" />}
              </div>
              <div className="flex-1 text-xs">
                <p className="font-bold text-[#1E2521] flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-[#E87A42]" />
                  <span>Видалити для всіх учасників</span>
                </p>
                <p className="text-[11px] text-[#5F6A60]">Повідомлення зникне з історії для кожного</p>
              </div>
            </label>

            <label
              onClick={() => setDeleteForEveryone(false)}
              className={`p-3 rounded-2xl border flex items-center gap-3 cursor-pointer transition-all ${
                !deleteForEveryone
                  ? 'bg-[#F9F7F1] border-[#E87A42] ring-1 ring-[#E87A42]'
                  : 'bg-[#FDFCF9] border-[#E6DFD3] hover:bg-[#F9F7F1]'
              }`}
            >
              <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                !deleteForEveryone ? 'border-[#E87A42] bg-[#E87A42]' : 'border-[#4A5D50]'
              }`}>
                {!deleteForEveryone && <div className="w-1.5 h-1.5 bg-[#F7F5EE] rounded-full" />}
              </div>
              <div className="flex-1 text-xs">
                <p className="font-bold text-[#1E2521] flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-[#5F6A60]" />
                  <span>Видалити тільки для мене</span>
                </p>
                <p className="text-[11px] text-[#5F6A60]">Залишиться в історії інших співрозмовників</p>
              </div>
            </label>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E6DFD3]">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 hover:bg-[#F1EDE3] text-[#5F6A60] hover:text-[#1E2521] font-semibold text-xs rounded-xl transition-colors"
          >
            Скасувати
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-[#1E2521] font-semibold text-xs rounded-xl shadow-sm transition-colors"
          >
            Видалити
          </button>
        </div>
      </div>
    </div>
  );
};
