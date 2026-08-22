import React from 'react';
import { X, Download } from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface MediaLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  mediaUrl: string;
  mediaTitle?: string;
  mediaDate?: string;
}

export const MediaLightboxModal: React.FC<MediaLightboxModalProps> = ({
  isOpen,
  onClose,
  mediaUrl,
  mediaTitle = 'Медіафайл',
  mediaDate,
}) => {
  if (!isOpen || !mediaUrl) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col justify-between p-4 select-none animate-in fade-in duration-200">
      {/* Top Bar */}
      <div className="flex items-center justify-between text-[#1E2521]/80 z-10 px-2 py-1">
        <div>
          <h3 className="font-bold text-sm text-[#1E2521]">{mediaTitle}</h3>
          {mediaDate && <p className="text-xs text-[#1E2521]/50">{mediaDate}</p>}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              soundFx.playTap();
              const a = document.createElement('a');
              a.href = mediaUrl;
              a.download = 'aura_media';
              a.target = '_blank';
              a.click();
            }}
            className="p-2 bg-white/10 hover:bg-white/20 text-[#1E2521] rounded-xl transition-colors"
            title="Завантажити оригінал"
          >
            <Download className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="p-2 bg-white/10 hover:bg-white/20 text-[#1E2521] rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Image Stage */}
      <div className="flex-1 flex items-center justify-center p-2 relative overflow-hidden">
        <img
          src={mediaUrl}
          alt={mediaTitle}
          className="max-h-[80vh] max-w-[90vw] object-contain rounded-2xl shadow-2xl ring-1 ring-white/10"
        />
      </div>

      {/* Bottom info bar */}
      <div className="text-center text-xs text-[#1E2521]/50 py-2">
        Перегляд медіа
      </div>
    </div>
  );
};
