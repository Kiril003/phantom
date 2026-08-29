import React, { useState } from 'react';
import {
  Layers,
  ZoomIn,
  Code,
  Kanban,
  Presentation,
  X,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface SpatialProjectionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const SpatialProjectionsModal: React.FC<SpatialProjectionsModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Простір',
}) => {
  const [activeTab, setActiveTab] = useState<'projections' | 'zoom'>('projections');
  const [currentProjection, setCurrentProjection] = useState<'engineer' | 'manager' | 'client'>('engineer');
  const [zoomLevel, setZoomLevel] = useState<number>(3); // 1 = Symbol, 2 = Block/Canvas, 3 = Space, 4 = Global 3D Mesh

  if (!isOpen) return null;

  const zoomLabels: Record<number, string> = {
    1: 'Рівень 1: Символ коду / Точкове значення',
    2: 'Рівень 2: Канвас & Живий документ',
    3: 'Рівень 3: Повний робочий простір (Простір + Чат + Віджети)',
    4: 'Рівень 4: Глобальна P2P-топологія звʼязків команди',
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
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Проекційні шари & Infinite Semantic Zoom
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Інженерна, Менеджерська, Клієнтська проекція та плавний зум
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('projections')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'projections' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Проекційні шари
              </button>
              <button
                onClick={() => setActiveTab('zoom')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'zoom' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Semantic Zoom
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
          {/* TAB 1: View Projections */}
          {activeTab === 'projections' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-[#21261F]">Оберіть проекцію для відображення</h4>
                <span className="text-[11px] text-[#6E7568]">Дані залишаються спільними</span>
              </div>

              {/* Projection Switcher */}
              <div className="grid grid-cols-3 gap-2.5">
                <button
                  onClick={() => {
                    soundFx.playTap();
                    setCurrentProjection('engineer');
                  }}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    currentProjection === 'engineer'
                      ? 'bg-indigo-50/50 border-indigo-300 shadow-2xs'
                      : 'bg-white border-[#E5DEC9] hover:bg-[#FAF8F5]'
                  }`}
                >
                  <Code className="w-4 h-4 text-indigo-600 mb-1" />
                  <div className="font-bold text-xs text-[#21261F]">Інженерний вигляд</div>
                  <p className="text-[10px] text-[#6E7568] mt-0.5">Коміти, системні логи, термінал</p>
                </button>

                <button
                  onClick={() => {
                    soundFx.playTap();
                    setCurrentProjection('manager');
                  }}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    currentProjection === 'manager'
                      ? 'bg-amber-50/50 border-amber-300 shadow-2xs'
                      : 'bg-white border-[#E5DEC9] hover:bg-[#FAF8F5]'
                  }`}
                >
                  <Kanban className="w-4 h-4 text-[#D96C35] mb-1" />
                  <div className="font-bold text-xs text-[#21261F]">Менеджерський вигляд</div>
                  <p className="text-[10px] text-[#6E7568] mt-0.5">Борди, дедлайни, ресурси</p>
                </button>

                <button
                  onClick={() => {
                    soundFx.playTap();
                    setCurrentProjection('client');
                  }}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    currentProjection === 'client'
                      ? 'bg-emerald-50/50 border-emerald-300 shadow-2xs'
                      : 'bg-white border-[#E5DEC9] hover:bg-[#FAF8F5]'
                  }`}
                >
                  <Presentation className="w-4 h-4 text-emerald-600 mb-1" />
                  <div className="font-bold text-xs text-[#21261F]">Клієнтський вигляд</div>
                  <p className="text-[10px] text-[#6E7568] mt-0.5">Презентація без технічного шуму</p>
                </button>
              </div>

              {/* Projection Content Preview */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#21261F]">
                    Активна проекція: {currentProjection.toUpperCase()}
                  </span>
                  <span className="text-[10px] font-mono text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    Live Reactive Lens
                  </span>
                </div>

                {currentProjection === 'engineer' && (
                  <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-lg font-mono text-[11px] text-[#21261F] space-y-1">
                    <div>commit a4f470f (HEAD -&gt; main) — feat(mesh): Add zero-latency bare-metal radio loop</div>
                    <div className="text-emerald-700">✓ Unit tests: 82/82 passed · Coverage 94.2%</div>
                    <div className="text-[#6E7568]">&gt; Cargo daemon listening on 127.0.0.1:8448...</div>
                  </div>
                )}

                {currentProjection === 'manager' && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 bg-[#FAF8F5] border border-[#E8E1D3] rounded-lg space-y-1">
                      <span className="text-[10px] font-semibold text-[#8A9186]">Дедлайн релізу</span>
                      <p className="font-bold text-xs text-[#21261F]">02 Вересня 2026 (6 днів)</p>
                    </div>
                    <div className="p-2.5 bg-[#FAF8F5] border border-[#E8E1D3] rounded-lg space-y-1">
                      <span className="text-[10px] font-semibold text-[#8A9186]">Блокери</span>
                      <p className="font-bold text-xs text-emerald-700">0 критичних блокерів</p>
                    </div>
                  </div>
                )}

                {currentProjection === 'client' && (
                  <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-lg text-xs space-y-1">
                    <div className="font-bold text-[#21261F]">Phantom Companion v1.0 — Демонстраційний звіт</div>
                    <p className="text-[11px] text-[#6E7568]">
                      Усі заплановані модулі суверенної взаємодії успішно розгорнуті на тестовому стенді.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: Infinite Semantic Zoom */}
          {activeTab === 'zoom' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2 text-xs text-indigo-950">
                <div className="flex items-center gap-2 font-bold text-indigo-900">
                  <ZoomIn className="w-4 h-4 text-indigo-600" />
                  <span>Infinite Semantic Zoom (Символ → Документ → Простір → Граф)</span>
                </div>
                <p className="leading-relaxed">
                  Масштабуйте інтерфейс скролом миші: від окремого рядка коду до глобальної топології всієї команди.
                </p>
              </div>

              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <h5 className="font-bold text-xs text-[#21261F]">{zoomLabels[zoomLevel]}</h5>
                  <span className="font-mono text-xs font-bold text-[#D96C35]">Zoom x{zoomLevel}</span>
                </div>

                <input
                  type="range"
                  min={1}
                  max={4}
                  step={1}
                  value={zoomLevel}
                  onChange={(e) => {
                    soundFx.playTap();
                    setZoomLevel(Number(e.target.value));
                  }}
                  className="w-full accent-[#D96C35]"
                />

                <div className="flex justify-between text-[10px] text-[#8A9186] font-mono">
                  <span>Символ (1)</span>
                  <span>Канвас (2)</span>
                  <span>Простір (3)</span>
                  <span>3D Граф (4)</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Spatial Information Topology</span>
          <span className="font-mono">Adaptive Projection v2.1</span>
        </div>
      </div>
    </div>
  );
};
