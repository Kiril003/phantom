import React, { useState } from 'react';
import { Share2, X, ShieldCheck, Plus } from 'lucide-react';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { soundFx } from '../../utils/messengerSound';
import { useMeshStore } from '../../stores/meshStore';

interface P2PFileSwarmModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const P2PFileSwarmModal: React.FC<P2PFileSwarmModalProps> = ({
  isOpen,
  onClose,
}) => {
  useEscapeClose(isOpen, onClose);

  const [isAdding, setIsAdding] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileSizeMB, setNewFileSizeMB] = useState('120');

  const { swarmFiles, seedSwarmFile } = useMeshStore();

  if (!isOpen) return null;

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const handleSeed = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;
    soundFx.playSend();
    const sizeBytes = (parseFloat(newFileSizeMB) || 10) * 1024 * 1024;
    seedSwarmFile(newFileName.trim(), sizeBytes);
    setNewFileName('');
    setIsAdding(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[#FDFCF9] border border-[#E5DEC9] rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 text-[#21261F]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#FDF5ED] border border-[#E5DEC9] flex items-center justify-center text-[#D96C35]">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-[#21261F]">P2P File Swarm (BitTorrent Mesh)</h3>
              <p className="text-xs text-[#6E7568]">
                Безсерверна роздача великих бінарних файлів та моделей без лімітів розміру
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsAdding(!isAdding)}
              className="px-3 py-1.5 bg-[#D96C35] text-white rounded-lg text-xs font-bold hover:bg-[#C25B27] flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Роздати файл
            </button>
            <button
              onClick={onClose}
              className="p-2 text-[#6E7568] hover:text-[#21261F] hover:bg-[#EFE9DC] rounded-xl transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          {isAdding && (
            <form onSubmit={handleSeed} className="p-4 bg-white border border-[#D96C35] rounded-2xl space-y-3">
              <h4 className="font-bold text-xs text-[#D96C35]">Роздача нового файлу в Swarm</h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Назва файлу (напр. model.onnx)..."
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  className="flex-1 px-3 py-1.5 border border-[#E8E1D3] rounded-lg text-xs"
                />
                <input
                  type="number"
                  placeholder="Розмір (MB)..."
                  value={newFileSizeMB}
                  onChange={(e) => setNewFileSizeMB(e.target.value)}
                  className="w-24 px-3 py-1.5 border border-[#E8E1D3] rounded-lg text-xs"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="px-2.5 py-1 text-xs text-[#6E7568]"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 bg-[#D96C35] text-white font-bold text-xs rounded-lg"
                >
                  Почати сідинг
                </button>
              </div>
            </form>
          )}

          <div className="space-y-3">
            {swarmFiles.map((transfer) => {
              const progress = Math.round((transfer.chunksAvailable / transfer.chunksTotal) * 100) || 100;
              return (
                <div
                  key={transfer.id}
                  className="p-4 bg-white border border-[#E8E1D3] rounded-2xl space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-[#21261F] truncate">
                          {transfer.name}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                            transfer.isSeeding
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-indigo-100 text-indigo-800'
                          }`}
                        >
                          {transfer.isSeeding ? 'seeding' : 'leeching'}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#6E7568] flex items-center gap-3">
                        <span>{formatSize(transfer.sizeBytes)}</span>
                        <span>•</span>
                        <span>{transfer.seedersCount} сідерів · {transfer.chunksAvailable}/{transfer.chunksTotal} чанків</span>
                      </div>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-1">
                    <div className="w-full h-1.5 bg-[#F1EBDD] rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          transfer.isSeeding ? 'bg-emerald-500' : 'bg-[#D96C35]'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-[#8A8577]">
                      <span>{progress}% доступно</span>
                      <span className="font-mono text-[10px]">SHA-256: {transfer.hashSha256.substring(0, 16)}...</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-xs text-[#6E7568]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Chunk-level verification & BitTorrent Merkle Tree</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#EFE9DC] text-[#21261F] font-medium rounded-xl hover:bg-[#E5DEC9] transition-colors"
          >
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
};
