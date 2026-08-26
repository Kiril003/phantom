import React, { useState } from 'react';
import {
  Split,
  X,
  FileText,
  Highlighter,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface AudioMarker {
  timeSec: number;
  label: string;
  author: string;
}

interface InteractiveMediaAnnotationModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const InteractiveMediaAnnotationModal: React.FC<InteractiveMediaAnnotationModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Інтерактивні медіа',
}) => {
  const [activeTab, setActiveTab] = useState<'audio_scrubber' | 'before_after' | 'pdf_annotator'>('audio_scrubber');
  const [audioProgress, setAudioProgress] = useState(14);
  const [sliderPosition, setSliderPosition] = useState(50);
  const [highlightedText] = useState('Безпечний E2EE тунель поверх WireGuard');

  const [audioMarkers] = useState<AudioMarker[]>([
    { timeSec: 5, label: 'Початок обговорення таймінгів', author: 'Кирило' },
    { timeSec: 14, label: '⚠️ Блокер: прошивка SX1262', author: 'Марина' },
    { timeSec: 28, label: 'Погоджено релізний план', author: 'Саня' },
  ]);

  if (!isOpen) return null;

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
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <Split className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Audio Waveform Scrubber, Before/After & PDF Анотатор
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Голосові таймкоди, слайдер дизайнів та спільні PDF виноски
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('audio_scrubber')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'audio_scrubber' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Waveform Scrubber
              </button>
              <button
                onClick={() => setActiveTab('before_after')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'before_after' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Before/After Слайдер
              </button>
              <button
                onClick={() => setActiveTab('pdf_annotator')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'pdf_annotator' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                PDF Анотатор
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] hover:text-[#21261F] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar space-y-4">
          {/* TAB 1: Audio Waveform Scrubber */}
          {activeTab === 'audio_scrubber' && (
            <div className="space-y-4">
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-[#21261F]">Голосове повідомлення (0:36) від @Марина</span>
                  <span className="font-mono text-[#D96C35] font-bold">0:{audioProgress < 10 ? `0${audioProgress}` : audioProgress} / 0:36</span>
                </div>

                {/* Waveform Bars */}
                <div className="h-16 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl flex items-center px-4 gap-1 relative cursor-pointer">
                  {[4, 8, 12, 20, 32, 45, 28, 16, 38, 52, 40, 24, 18, 35, 48, 22, 14, 8, 12, 19, 33, 44, 25, 12].map((h, i) => (
                    <div
                      key={i}
                      onClick={() => {
                        soundFx.playTap();
                        setAudioProgress(Math.round((i / 24) * 36));
                      }}
                      className={`flex-1 rounded-xs transition-all ${
                        (i / 24) * 36 <= audioProgress ? 'bg-[#D96C35]' : 'bg-[#E5DEC9]'
                      }`}
                      style={{ height: `${h}px` }}
                    />
                  ))}
                </div>

                {/* Timestamp Pin Comments */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-[10px] text-[#8A9186] font-bold uppercase block">Текстові мітки команди на аудіодоріжці:</span>
                  {audioMarkers.map((m) => (
                    <div
                      key={m.timeSec}
                      onClick={() => {
                        soundFx.playTap();
                        setAudioProgress(m.timeSec);
                      }}
                      className="p-2 bg-[#FAF8F5] hover:bg-[#F3EDE2] border border-[#E8E1D3] rounded-lg text-xs flex justify-between items-center cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-[#D96C35] text-[11px]">0:{m.timeSec < 10 ? `0${m.timeSec}` : m.timeSec}</span>
                        <span className="text-[#21261F]">{m.label}</span>
                      </div>
                      <span className="text-[10px] text-[#8A9186]">@{m.author}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Before/After Comparison Slider */}
          {activeTab === 'before_after' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-1 text-xs text-indigo-950">
                <span className="font-bold text-indigo-900">Інтерактивне порівняння макетів (Before / After)</span>
                <p className="text-[11px]">
                  Перетягуйте повзунок для візуальної перевірки редизайну інтерфейсу.
                </p>
              </div>

              <div className="relative h-56 border border-[#E5DEC9] rounded-xl overflow-hidden shadow-2xs select-none">
                {/* Left Side: Before (Old UI) */}
                <div className="absolute inset-0 bg-[#3E453A] text-white p-6 flex flex-col justify-between">
                  <div>
                    <span className="text-xs font-bold bg-white/20 px-2 py-1 rounded">BEFORE: v1.0 Старий UI</span>
                    <p className="text-xs mt-2 text-white/80">Звичайні прямокутні картки без глибини та орба</p>
                  </div>
                  <span className="text-[10px] text-white/50">Статична сітка без рідких переходів</span>
                </div>

                {/* Right Side: After (New Alien Elegance UI) */}
                <div
                  className="absolute inset-0 bg-[#21261F] text-emerald-300 p-6 flex flex-col justify-between"
                  style={{ clipPath: `inset(0 0 0 ${sliderPosition}%)` }}
                >
                  <div>
                    <span className="text-xs font-bold bg-emerald-500/20 px-2 py-1 rounded border border-emerald-500/40">
                      AFTER: v2.4 Alien Elegance
                    </span>
                    <p className="text-xs mt-2 text-emerald-200">GlassCard, аудіо-реактивний Орб та теплі акценти</p>
                  </div>
                  <span className="text-[10px] text-emerald-400">Швидкість відгуку 60 FPS</span>
                </div>

                {/* Divider Handle */}
                <div
                  className="absolute top-0 bottom-0 w-1 bg-white cursor-ew-resize flex items-center justify-center shadow-lg"
                  style={{ left: `${sliderPosition}%` }}
                >
                  <div className="w-6 h-6 bg-[#D96C35] rounded-full text-white text-[10px] font-bold flex items-center justify-center shadow-md">
                    ⇄
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center text-xs">
                <span>Положення повзунка порівняння:</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={sliderPosition}
                  onChange={(e) => setSliderPosition(Number(e.target.value))}
                  className="w-48 accent-[#D96C35]"
                />
              </div>
            </div>
          )}

          {/* TAB 3: Local PDF/EPUB Annotator */}
          {activeTab === 'pdf_annotator' && (
            <div className="space-y-4">
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                <div className="flex justify-between items-center text-xs border-b border-[#E8E1D3] pb-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#D96C35]" />
                    <span className="font-bold text-[#21261F]">phantom_os_whitepaper_v2.pdf (Стор. 12)</span>
                  </div>
                  <span className="text-[10px] font-mono text-[#8A9186]">3 анотації команди</span>
                </div>

                <div className="p-4 bg-[#FAF8F5] border border-[#E8E1D3] rounded-lg text-xs leading-relaxed text-[#21261F] space-y-2 font-serif">
                  <p>
                    Архітектура передбачає децентралізоване збереження стану за допомогою CRDT.{' '}
                    <span className="bg-amber-200 px-1 py-0.5 rounded text-amber-950 font-sans font-bold cursor-pointer">
                      «{highlightedText}»
                    </span>{' '}
                    гарантує відсутність витоку метаданих навіть у відкритих публічних Wi-Fi мережах.
                  </p>
                </div>

                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs flex justify-between items-center text-amber-950">
                  <div className="flex items-center gap-1.5">
                    <Highlighter className="w-3.5 h-3.5 text-amber-700" />
                    <span><b>Виноска @Саня:</b> Додати тестування пропускної здатності на 10G каналах</span>
                  </div>
                  <button
                    onClick={() => {
                      soundFx.playTap();
                      alert('Виноску додано до списку завдань Canvas ✓');
                    }}
                    className="px-2 py-0.5 bg-amber-800 text-white rounded text-[10px] font-bold"
                  >
                    В задачі
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Interactive Media Annotation Engine</span>
          <span className="font-mono">Waveform DSP v2.1</span>
        </div>
      </div>
    </div>
  );
};
