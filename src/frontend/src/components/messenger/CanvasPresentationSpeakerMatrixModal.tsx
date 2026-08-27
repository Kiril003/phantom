import React, { useState } from 'react';
import {
  Presentation,
  X,
  ChevronLeft,
  ChevronRight,
  AlertOctagon,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useUIStore } from '../../stores/uiStore';

interface Slide {
  title: string;
  subtitle: string;
  points: string[];
}

interface SpeakerSegment {
  speaker: string;
  color: string;
  durationSec: number;
  snippet: string;
}

interface DependencyBlocker {
  fromTask: string;
  toTask: string;
  team: string;
  isCritical: boolean;
}

interface CanvasPresentationSpeakerMatrixModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const CanvasPresentationSpeakerMatrixModal: React.FC<CanvasPresentationSpeakerMatrixModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Презентація & Аналітика',
}) => {
  const [activeTab, setActiveTab] = useState<'presentation' | 'speaker_audio' | 'matrix_blockers'>('presentation');
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

  const slides: Slide[] = [
    {
      title: 'Phantom OS: Архітектура Стійкості',
      subtitle: 'Релізний огляд v2.4 (Sprint A - H)',
      points: [
        'Повна автономність вузлів (Phantom Headless Daemon)',
        'Мультитранспортна стійкість (Wi-Fi Direct + LoRa SX1262)',
        'Децентралізований Merkle Tree аудит та SecOps',
      ],
    },
    {
      title: 'Wasm POSIX VFS & Runtime',
      subtitle: 'Ізольовані середовища виконання',
      points: [
        'FUSE монтування /spaces/work/assets/',
        'Shared Memory IPC між віджетами (0.12 ms затримка)',
        'Безпечний CAD та 3D WebGL рушій',
      ],
    },
    {
      title: 'Інтерактивні Робочі Простори',
      subtitle: 'Мультиплеєр та командна взаємодія',
      points: [
        'Collaborative Whiteboard з конвертацією стікерів у задачі',
        'Planning Poker зі схемою Ed25519 розкриття',
        'Інтерактивний тайлінг на 4 робочі вікна',
      ],
    },
  ];

  const speakerSegments: SpeakerSegment[] = [
    { speaker: 'Кирило (Lead)', color: 'bg-indigo-500', durationSec: 45, snippet: 'Огляд архітектури P2P Mesh' },
    { speaker: 'Марина (SecOps)', color: 'bg-emerald-500', durationSec: 30, snippet: 'DLP фільтри та Merkle Tree' },
    { speaker: 'Саня (Hardware)', color: 'bg-amber-500', durationSec: 40, snippet: 'Тестування антени LoRa 868MHz' },
  ];

  const blockers: DependencyBlocker[] = [
    { fromTask: 'Схема антени SX1262', toTask: 'Збірка корпусу Radxa', team: 'Hardware', isCritical: true },
    { fromTask: 'Wasm Kernel API', toTask: '3D CAD віджет', team: 'Core Dev', isCritical: false },
  ];

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
              <Presentation className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Canvas Презентація, Спікери Дзвінка & Матриця Блокерів
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Слайди з Canvas, сегменти голосів та аналіз критичних залежностей
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('presentation')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'presentation' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Презентація
              </button>
              <button
                onClick={() => setActiveTab('speaker_audio')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'speaker_audio' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Спікери Аудіо
              </button>
              <button
                onClick={() => setActiveTab('matrix_blockers')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'matrix_blockers' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Матриця Блокерів
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
          {/* TAB 1: Canvas-to-Slides Presentation Mode */}
          {activeTab === 'presentation' && (
            <div className="space-y-4">
              <div className="p-6 bg-[#21261F] text-white rounded-xl h-56 flex flex-col justify-between shadow-2xs">
                <div>
                  <span className="text-[10px] text-emerald-400 font-mono uppercase tracking-wider">
                    Слайд {currentSlideIndex + 1} з {slides.length}
                  </span>
                  <h4 className="font-bold text-lg text-white mt-1">{slides[currentSlideIndex].title}</h4>
                  <p className="text-xs text-[#8A9186] mt-0.5">{slides[currentSlideIndex].subtitle}</p>
                </div>

                <ul className="space-y-1 text-xs text-white/90">
                  {slides[currentSlideIndex].points.map((pt, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#D96C35]" />
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>

                <div className="flex justify-between items-center text-xs pt-2 border-t border-[#3E453A]">
                  <span className="text-[#8A9186] text-[10px]">Керування: Стрілки клавіатури ← →</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        soundFx.playTap();
                        setCurrentSlideIndex(Math.max(0, currentSlideIndex - 1));
                      }}
                      disabled={currentSlideIndex === 0}
                      className="p-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        soundFx.playTap();
                        setCurrentSlideIndex(Math.min(slides.length - 1, currentSlideIndex + 1));
                      }}
                      disabled={currentSlideIndex === slides.length - 1}
                      className="p-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Audio Scrubbing with Speaker Segments */}
          {activeTab === 'speaker_audio' && (
            <div className="space-y-4">
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-[#21261F]">Запис Huddle мітингу (1:55)</span>
                  <span className="font-mono text-xs text-[#6E7568]">3 Спікери</span>
                </div>

                {/* Segment Color Bar */}
                <div className="h-6 rounded-lg overflow-hidden flex shadow-xs">
                  {speakerSegments.map((seg, i) => (
                    <div
                      key={i}
                      className={`${seg.color} h-full cursor-pointer hover:opacity-90 transition-opacity`}
                      style={{ width: `${(seg.durationSec / 115) * 100}%` }}
                      title={`${seg.speaker}: ${seg.snippet}`}
                    />
                  ))}
                </div>

                {/* Speaker List */}
                <div className="space-y-2 pt-1">
                  {speakerSegments.map((seg, i) => (
                    <div
                      key={i}
                      onClick={() => {
                        soundFx.playTap();
                        useUIStore.getState().toast({ kind: 'info', message: `Перемотано до репліки: ${seg.speaker}` });
                      }}
                      className="p-2.5 bg-[#FAF8F5] hover:bg-[#F3EDE2] border border-[#E8E1D3] rounded-lg text-xs flex justify-between items-center cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-3 h-3 rounded-full ${seg.color}`} />
                        <span className="font-bold text-[#21261F]">{seg.speaker}</span>
                        <span className="text-[#6E7568]">«{seg.snippet}»</span>
                      </div>
                      <span className="font-mono text-[11px] text-[#8A9186]">{seg.durationSec}s</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Matrix Dependency Map */}
          {activeTab === 'matrix_blockers' && (
            <div className="space-y-4">
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-1 text-xs text-red-950">
                <div className="flex items-center gap-1.5 font-bold text-red-900">
                  <AlertOctagon className="w-4 h-4 text-red-600" />
                  <span>Матриця взаємозалежностей: Критичні блокери</span>
                </div>
                <p className="text-[11px]">
                  Червоним підсвічені завдання, які гальмують роботу інших підрозділів.
                </p>
              </div>

              <div className="space-y-2.5">
                {blockers.map((b, i) => (
                  <div
                    key={i}
                    className={`p-3.5 rounded-xl border flex items-center justify-between shadow-2xs ${
                      b.isCritical ? 'bg-red-50/50 border-red-300' : 'bg-white border-[#E5DEC9]'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-white border border-[#E8E1D3]">
                          {b.team}
                        </span>
                        <h5 className="font-bold text-xs text-[#21261F]">{b.fromTask}</h5>
                        <span className="text-[#8A9186]">→</span>
                        <span className="text-xs text-[#6E7568]">{b.toTask}</span>
                      </div>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        b.isCritical ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {b.isCritical ? 'Критичний блокер ⚠️' : 'Норма'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Canvas Slides & Dependency Matrix</span>
          <span className="font-mono">Presentation Engine v2.0</span>
        </div>
      </div>
    </div>
  );
};
