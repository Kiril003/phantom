import React, { useState } from 'react';
import {
  BarChart3,
  X,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface InteractiveVisualization3DModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const InteractiveVisualization3DModal: React.FC<InteractiveVisualization3DModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Візуалізація даних',
}) => {
  const [activeTab, setActiveTab] = useState<'charts' | 'mermaid' | 'cad3d'>('charts');
  const [chartType, setChartType] = useState<'line' | 'bar' | 'heatmap'>('line');
  const [modelRotation, setModelRotation] = useState(45);
  const [activePin, setActivePin] = useState<string | null>(null);

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
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Data-to-Graph, Mermaid Схеми & 3D CAD В'ювер
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Інтерактивні графіки в стрічці, архітектурні діаграми та 3D моделі
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('charts')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'charts' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Live Графіки
              </button>
              <button
                onClick={() => setActiveTab('mermaid')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'mermaid' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Mermaid Схеми
              </button>
              <button
                onClick={() => setActiveTab('cad3d')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'cad3d' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                3D CAD В'ювер
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
          {/* TAB 1: Data-to-Graph & Live Charts */}
          {activeTab === 'charts' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-xs text-[#21261F]">Трансляція пропускної здатності Mesh (KB/s)</h4>
                  <span className="text-[11px] text-[#6E7568]">Дані з SQLite / Dev Pipe у реальному часі</span>
                </div>

                <div className="flex items-center gap-1.5 bg-[#FAF8F5] p-1 rounded-lg border border-[#E5DEC9] text-xs">
                  <button
                    onClick={() => {
                      soundFx.playTap();
                      setChartType('line');
                    }}
                    className={`px-2 py-0.5 rounded ${chartType === 'line' ? 'bg-[#D96C35] text-white font-bold' : 'text-[#6E7568]'}`}
                  >
                    Лінійний
                  </button>
                  <button
                    onClick={() => {
                      soundFx.playTap();
                      setChartType('bar');
                    }}
                    className={`px-2 py-0.5 rounded ${chartType === 'bar' ? 'bg-[#D96C35] text-white font-bold' : 'text-[#6E7568]'}`}
                  >
                    Стовпчастий
                  </button>
                  <button
                    onClick={() => {
                      soundFx.playTap();
                      setChartType('heatmap');
                    }}
                    className={`px-2 py-0.5 rounded ${chartType === 'heatmap' ? 'bg-[#D96C35] text-white font-bold' : 'text-[#6E7568]'}`}
                  >
                    Heatmap
                  </button>
                </div>
              </div>

              {/* Chart Visual Area */}
              <div className="p-4 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl h-48 flex items-end justify-between gap-2 px-6">
                {[45, 68, 92, 74, 110, 85, 140, 125, 160, 135, 180, 195].map((val, idx) => (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                    <div
                      className="w-full bg-[#D96C35] hover:bg-[#B85425] rounded-t transition-all cursor-pointer relative group"
                      style={{ height: `${(val / 200) * 100}%` }}
                    >
                      <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-[#21261F] text-white text-[10px] py-0.5 px-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        {val} KB/s
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-[#8A9186]">{idx + 1}m</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: Mermaid Live Diagrams */}
          {activeTab === 'mermaid' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-1 text-xs text-indigo-950">
                <span className="font-bold text-indigo-900">Архітектурні діаграми Mermaid / PlantUML на льоту</span>
                <p className="text-[11px]">
                  Введіть опис архітектури текстом — вузли можна перетягувати прямо у вікні чату.
                </p>
              </div>

              <div className="border border-[#E5DEC9] rounded-xl overflow-hidden shadow-2xs">
                <div className="bg-[#FAF8F5] p-3 border-b border-[#E8E1D3] font-mono text-[11px] text-[#6E7568]">
                  flowchart TD: [Client] → |P2P E2EE| [Radxa Node] → |Noise Protocol| [Mesh Swarm]
                </div>
                <div className="p-6 bg-white flex items-center justify-around gap-4 text-xs font-mono">
                  <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-950 font-bold shadow-2xs cursor-move">
                    💻 Client (Local)
                  </div>
                  <span className="text-[#8A9186]">───────►</span>
                  <div className="p-3 bg-indigo-50 border border-indigo-300 rounded-xl text-indigo-950 font-bold shadow-2xs cursor-move">
                    ⚡ Radxa Node (#8491)
                  </div>
                  <span className="text-[#8A9186]">───────►</span>
                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-amber-950 font-bold shadow-2xs cursor-move">
                    📡 LoRa Mesh Swarm
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: 3D CAD & WebGL Viewport */}
          {activeTab === 'cad3d' && (
            <div className="space-y-4">
              <div className="p-4 bg-[#21261F] text-white rounded-xl h-56 flex flex-col justify-between relative overflow-hidden shadow-2xs">
                <div className="flex justify-between items-center text-xs text-[#8A9186]">
                  <span>WebGL / WebGPU 3D Viewport: antenna_casing_v4.step</span>
                  <span className="font-mono text-emerald-400">FPS: 60 (Hardware Accelerated)</span>
                </div>

                {/* 3D Wireframe Representation */}
                <div
                  className="flex items-center justify-center transition-transform duration-200"
                  style={{ transform: `rotateY(${modelRotation}deg)` }}
                >
                  <div className="w-28 h-28 border-2 border-emerald-400/80 rounded-2xl flex items-center justify-center relative bg-emerald-950/20 backdrop-blur-xs">
                    <span className="text-[10px] font-mono text-emerald-300">Radxa Casing</span>
                    <button
                      onClick={() => setActivePin('pin1')}
                      className="absolute -top-2 -right-2 w-5 h-5 bg-[#D96C35] rounded-full text-white text-[10px] font-bold flex items-center justify-center shadow-md animate-bounce"
                    >
                      !
                    </button>
                  </div>
                </div>

                {/* Spatial Pin Annotation */}
                {activePin && (
                  <div className="absolute bottom-3 left-3 right-3 p-2 bg-white/95 text-[#21261F] rounded-lg text-xs flex justify-between items-center shadow-lg">
                    <span>📍 <b>Просторова 3D-мітка:</b> Збільшити радіус монтажного отвору антени до 4.2 мм</span>
                    <button
                      onClick={() => setActivePin(null)}
                      className="text-[#6E7568] hover:text-[#21261F] font-bold"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-[#6E7568]">Обертання 3D-моделі команди:</span>
                <input
                  type="range"
                  min="0"
                  max="360"
                  value={modelRotation}
                  onChange={(e) => setModelRotation(Number(e.target.value))}
                  className="w-48 accent-[#D96C35]"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Interactive Visualizations & 3D CAD</span>
          <span className="font-mono">WebGL / Mermaid Engine v2.0</span>
        </div>
      </div>
    </div>
  );
};
