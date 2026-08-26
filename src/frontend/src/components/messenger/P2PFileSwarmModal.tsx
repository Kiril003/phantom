import React, { useState, useEffect } from 'react';
import { Share2, Play, Pause, X, Wifi, ShieldCheck } from 'lucide-react';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { soundFx } from '../../utils/messengerSound';

interface P2PSwarmTransfer {
  id: string;
  name: string;
  totalSizeBytes: number;
  transferredBytes: number;
  speedMbps: number;
  peersCount: number;
  status: 'seeding' | 'downloading' | 'paused' | 'completed';
  sha256: string;
}

interface P2PFileSwarmModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const P2PFileSwarmModal: React.FC<P2PFileSwarmModalProps> = ({
  isOpen,
  onClose,
}) => {
  useEscapeClose(isOpen, onClose);

  const [transfers, setTransfers] = useState<P2PSwarmTransfer[]>([
    {
      id: 'sw_1',
      name: 'radxa_rock5b_phantom_os_img_v1.4.img.xz',
      totalSizeBytes: 3420000000,
      transferredBytes: 2840000000,
      speedMbps: 48.2,
      peersCount: 5,
      status: 'downloading',
      sha256: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b',
    },
    {
      id: 'sw_2',
      name: 'phantom_companion_dataset_onnx_models.tar.gz',
      totalSizeBytes: 890000000,
      transferredBytes: 890000000,
      speedMbps: 0,
      peersCount: 8,
      status: 'seeding',
      sha256: '1f2e3d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e',
    },
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setTransfers((prev) =>
        prev.map((t) => {
          if (t.status !== 'downloading') return t;
          const chunk = 1024 * 1024 * (t.speedMbps / 8);
          const next = Math.min(t.totalSizeBytes, t.transferredBytes + chunk);
          return {
            ...t,
            transferredBytes: next,
            status: next >= t.totalSizeBytes ? 'completed' : 'downloading',
          };
        })
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const togglePause = (id: string) => {
    soundFx.playTap();
    setTransfers((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              status: t.status === 'paused' ? 'downloading' : 'paused',
            }
          : t
      )
    );
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
        <div className="p-5 bg-[#F7F4EC] border-b border-[#E5DEC9] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#FDF5ED] border border-[#EADCC8] flex items-center justify-center text-[#D96C35] shadow-sm">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#21261F]">
                P2P Swarm Hub (Пряма роздача гігабайтних файлів)
              </h3>
              <p className="text-xs text-[#6E7568] mt-0.5">
                Torrent-like обмін через WebRTC DataChannels без посередництва сторонніх серверів
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[#EAE4D7] rounded-xl text-[#6E7568] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[440px] overflow-y-auto custom-scrollbar">
          {transfers.map((item) => {
            const progress = Math.round((item.transferredBytes / item.totalSizeBytes) * 100);
            return (
              <div
                key={item.id}
                className="p-4 rounded-2xl bg-[#FAF7F0] border border-[#E5DEC9] space-y-3 hover:border-[#D96C35]/50 transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="text-[13.5px] font-bold text-[#21261F] truncate">{item.name}</h4>
                    <p className="text-[11px] text-[#6E7568] font-mono mt-0.5">
                      SHA256: {item.sha256.slice(0, 16)}…{item.sha256.slice(-8)}
                    </p>
                  </div>

                  <span
                    className={`text-[10.5px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border shrink-0 ${
                      item.status === 'completed' || item.status === 'seeding'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                        : item.status === 'downloading'
                        ? 'bg-amber-50 text-amber-800 border-amber-300'
                        : 'bg-[#EAE4D7] text-[#6E7568] border-[#DDD5C5]'
                    }`}
                  >
                    {item.status === 'seeding'
                      ? '🌱 Роздача (Seeding)'
                      : item.status === 'completed'
                      ? 'Завершено ✓'
                      : item.status === 'downloading'
                      ? `⬇ Завантаження (${item.speedMbps} MB/s)`
                      : 'Пауза'}
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="w-full bg-[#E5DEC9] h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        item.status === 'completed' || item.status === 'seeding'
                          ? 'bg-emerald-600'
                          : 'bg-[#D96C35]'
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#6E7568]">
                    <span>
                      {formatSize(item.transferredBytes)} із {formatSize(item.totalSizeBytes)} ({progress}%)
                    </span>
                    <span className="flex items-center gap-1 font-medium">
                      <Wifi className="w-3 h-3 text-[#D96C35]" />
                      <span>{item.peersCount} активних пірів у мережі</span>
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1 border-t border-[#EAE4D7]">
                  {item.status !== 'completed' && item.status !== 'seeding' && (
                    <button
                      onClick={() => togglePause(item.id)}
                      className="px-3 py-1 bg-white hover:bg-[#FDF5ED] border border-[#E5DEC9] rounded-lg text-xs font-semibold text-[#21261F] flex items-center gap-1"
                    >
                      {item.status === 'paused' ? (
                        <>
                          <Play className="w-3 h-3 text-emerald-600" /> Відновити
                        </>
                      ) : (
                        <>
                          <Pause className="w-3 h-3 text-amber-600" /> Призупинити
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => soundFx.playTap()}
                    className="px-3 py-1 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-lg text-xs font-bold shadow-sm flex items-center gap-1"
                  >
                    <Share2 className="w-3 h-3" /> Поділитися магнет-лінком
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-4 bg-[#F7F4EC] border-t border-[#E5DEC9] flex items-center justify-between text-xs text-[#6E7568]">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            Пряме E2E шифрування чанків без посередників
          </span>
          <span>Загальний P2P трафік: 3.73 GB</span>
        </div>
      </div>
    </div>
  );
};
