import React, { useState } from 'react';
import {
  Palette,
  Share2,
  Globe,
  PenTool,
  Plus,
  X,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface MoodboardItem {
  id: string;
  title: string;
  category: 'Palette' | 'Font' | 'Texture' | 'Layout';
  preview: string;
  meta: string;
}

interface TimecodeComment {
  id: string;
  timecode: string;
  author: string;
  comment: string;
  mediaType: 'audio' | 'video';
}

interface CreativeStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const CreativeStudioModal: React.FC<CreativeStudioModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Креативна студія',
}) => {
  const [activeTab, setActiveTab] = useState<'moodboard' | 'timecode' | 'sketch' | 'portfolio'>('moodboard');
  const [isPortfolioPublished, setIsPortfolioPublished] = useState(false);

  const moodboardItems: MoodboardItem[] = [
    {
      id: 'm1',
      title: 'Alien Elegance Warm Glass',
      category: 'Palette',
      preview: '#E87A42, #FAF8F5, #21261F, #528A4B',
      meta: '4 кольори · Hex Codes',
    },
    {
      id: 'm2',
      title: 'Space Grotesk & JetBrains Mono',
      category: 'Font',
      preview: 'Typography Pair v2.4',
      meta: 'Display 36px / Mono 13px',
    },
    {
      id: 'm3',
      title: 'Frosted Glass Refraction Shader',
      category: 'Texture',
      preview: 'GLSL Raymarching Grain',
      meta: 'Canvas WebGL 60fps',
    },
  ];

  const timecodeComments: TimecodeComment[] = [
    {
      id: 'tc1',
      timecode: '00:42',
      author: 'Марина',
      comment: 'Тут перехід занадто різкий, варто додати 0.3s cubic-bezier ease-out.',
      mediaType: 'video',
    },
    {
      id: 'tc2',
      timecode: '01:18',
      author: 'Кирило',
      comment: 'Зменшити бас на фоновому треку на 2dB, щоб голос звучав розбірливо.',
      mediaType: 'audio',
    },
  ];

  if (!isOpen) return null;

  const handlePublishPortfolio = () => {
    soundFx.playSend();
    setIsPortfolioPublished(true);
  };

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#F6E7DE] border-b border-[#E7C8B7] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-white text-[#8C461A] border border-[#E7C8B7] shadow-2xs">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#8C461A]">
                Сфера: Творчість, Медіа & Дизайн · {chatTitle}
              </h3>
              <p className="text-[11px] text-[#A25A2E]">
                Мудборди, таймкодні ревʼю відео/аудіо, скетчинг та P2P-портфоліо
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#ECD5C8] p-0.5 rounded-lg text-xs font-medium text-[#8C461A]">
              <button
                onClick={() => setActiveTab('moodboard')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'moodboard' ? 'bg-white text-[#8C461A] font-bold shadow-2xs' : 'hover:text-[#5E2B0C]'
                }`}
              >
                Мудборд
              </button>
              <button
                onClick={() => setActiveTab('timecode')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'timecode' ? 'bg-white text-[#8C461A] font-bold shadow-2xs' : 'hover:text-[#5E2B0C]'
                }`}
              >
                Таймкоди
              </button>
              <button
                onClick={() => setActiveTab('sketch')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'sketch' ? 'bg-white text-[#8C461A] font-bold shadow-2xs' : 'hover:text-[#5E2B0C]'
                }`}
              >
                Скетчборд
              </button>
              <button
                onClick={() => setActiveTab('portfolio')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'portfolio' ? 'bg-white text-[#8C461A] font-bold shadow-2xs' : 'hover:text-[#5E2B0C]'
                }`}
              >
                P2P Портфоліо
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-[#E5C3B0] rounded-lg text-[#8C461A] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar space-y-4">
          {/* TAB 1: Moodboard */}
          {activeTab === 'moodboard' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-[#21261F]">Візуальний мудборд ассетів та референсів</h4>
                <button
                  onClick={() => soundFx.playTap()}
                  className="px-3 py-1 bg-[#8C461A] hover:bg-[#723712] text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Додати ассет</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {moodboardItems.map((item) => (
                  <div key={item.id} className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase text-[#8C461A] bg-[#F6E7DE] px-2 py-0.5 rounded">
                        {item.category}
                      </span>
                    </div>
                    <h5 className="font-bold text-xs text-[#21261F]">{item.title}</h5>
                    <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-lg text-center font-mono text-xs text-[#6E7568]">
                      {item.preview}
                    </div>
                    <p className="text-[10px] text-[#8A9186]">{item.meta}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: Timecode Review */}
          {activeTab === 'timecode' && (
            <div className="space-y-3">
              <h4 className="font-bold text-xs text-[#21261F]">Frame.io / SoundCloud-стиль: коментарі до секунд</h4>
              <div className="space-y-2.5">
                {timecodeComments.map((tc) => (
                  <div key={tc.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-start gap-3 shadow-2xs">
                    <div className="px-2 py-1 bg-[#8C461A] text-white font-mono font-bold text-xs rounded-lg shrink-0">
                      {tc.timecode}
                    </div>
                    <div className="space-y-0.5 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-[#21261F]">@{tc.author}</span>
                        <span className="text-[10px] text-[#8A9186] uppercase">{tc.mediaType} review</span>
                      </div>
                      <p className="text-xs text-[#6E7568] leading-relaxed">{tc.comment}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: Sketch Canvas */}
          {activeTab === 'sketch' && (
            <div className="space-y-3">
              <h4 className="font-bold text-xs text-[#21261F]">Нескінченне полотно швидких замальовок (Stylus Ready)</h4>
              <div className="h-60 bg-[#FAF8F5] border-2 border-dashed border-[#D5CEBF] rounded-2xl flex flex-col items-center justify-center text-center p-4">
                <PenTool className="w-8 h-8 text-[#8C461A] mb-2" />
                <p className="font-bold text-xs text-[#21261F]">Інтерактивний скетчборд готовий до малювання</p>
                <p className="text-[11px] text-[#6E7568] max-w-sm mt-1">
                  Підтримка векторного малювання, стікерів та розкадровок із векторним збереженням у SVG.
                </p>
              </div>
            </div>
          )}

          {/* TAB 4: P2P Portfolio */}
          {activeTab === 'portfolio' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs text-amber-900">
                <div className="flex items-center gap-2 font-bold text-amber-950">
                  <Globe className="w-4 h-4 text-[#8C461A]" />
                  <span>Публікація P2P Веб-портфоліо без хмарного хостингу</span>
                </div>
                <p className="leading-relaxed">
                  Ваш вузол генерує чисту статичну сторінку робіт, доступну через IPFS або персональний домен з TLS-сертифікатом.
                </p>
              </div>

              {isPortfolioPublished ? (
                <div className="p-4 bg-white border border-emerald-300 rounded-xl space-y-2 shadow-xs">
                  <span className="text-xs font-bold text-emerald-800">Портфоліо успішно опубліковано ✓</span>
                  <p className="font-mono text-xs text-[#21261F] bg-[#FAF8F5] p-2 rounded border border-[#E5DEC9]">
                    https://kiril.portfolio.phantom.eth
                  </p>
                </div>
              ) : (
                <button
                  onClick={handlePublishPortfolio}
                  className="w-full py-2.5 bg-[#8C461A] hover:bg-[#723712] text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                >
                  <Share2 className="w-4 h-4" />
                  <span>Опублікувати портфоліо в один клік</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#F6E7DE] border-t border-[#E7C8B7] flex items-center justify-between text-[11px] text-[#8C461A]">
          <span>Креативний простір митця</span>
          <span className="font-mono">Asset Mesh / IPFS Ready</span>
        </div>
      </div>
    </div>
  );
};
