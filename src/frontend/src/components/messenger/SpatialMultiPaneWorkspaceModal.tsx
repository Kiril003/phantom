import React, { useState } from 'react';
import {
  LayoutGrid,
  X,
  Terminal,
  FileCode,
  PenTool,
  MessageSquare,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface SpatialMultiPaneWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const SpatialMultiPaneWorkspaceModal: React.FC<SpatialMultiPaneWorkspaceModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Робочий простір',
}) => {
  const [activeLayout, setActiveLayout] = useState<'4pane' | 'fullscreen_canvas' | 'heatmaps'>('4pane');
  const [isFullscreenFocus, setIsFullscreenFocus] = useState(false);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <LayoutGrid className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Spatial Multi-Pane Workspace & Activity Heatmaps
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Тайлінговий Grid, Canvas Focus Mode та добові карти активності
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveLayout('4pane')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeLayout === '4pane' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Тайлінг Grid (4 Вікна)
              </button>
              <button
                onClick={() => setActiveLayout('fullscreen_canvas')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeLayout === 'fullscreen_canvas' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Focus Canvas
              </button>
              <button
                onClick={() => setActiveLayout('heatmaps')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeLayout === 'heatmaps' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Activity Heatmaps
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
          {/* TAB 1: 4-Pane Tiling Grid Layout */}
          {activeLayout === '4pane' && (
            <div className="space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-[#21261F]">Гнучкий 4-віконний тайлінг простору</span>
                <span className="text-[11px] text-[#6E7568]">Ctrl + Alt + G для швидкого перемикання</span>
              </div>

              {/* Grid representation */}
              <div className="grid grid-cols-3 grid-rows-2 gap-2 h-72 border border-[#E5DEC9] p-2 rounded-xl bg-[#FAF8F5]">
                {/* Pane 1: Chat Stream */}
                <div className="col-span-1 row-span-1 bg-white border border-[#E8E1D3] rounded-lg p-2.5 flex flex-col justify-between shadow-2xs">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#21261F]">
                    <MessageSquare className="w-3.5 h-3.5 text-[#D96C35]" />
                    <span>Стрічка чату</span>
                  </div>
                  <p className="text-[10px] text-[#6E7568]">@Марина: відправила патч VFS mount</p>
                </div>

                {/* Pane 2: Live Canvas Document */}
                <div className="col-span-1 row-span-1 bg-white border border-[#E8E1D3] rounded-lg p-2.5 flex flex-col justify-between shadow-2xs">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#21261F]">
                    <FileCode className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Canvas Document</span>
                  </div>
                  <p className="text-[10px] text-[#6E7568]"># Специфікація LoRa Mesh v2.4</p>
                </div>

                {/* Pane 3: Whiteboard */}
                <div className="col-span-1 row-span-1 bg-white border border-[#E8E1D3] rounded-lg p-2.5 flex flex-col justify-between shadow-2xs">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#21261F]">
                    <PenTool className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Інтерактивна дошка</span>
                  </div>
                  <p className="text-[10px] text-[#6E7568]">3 стікери активні</p>
                </div>

                {/* Pane 4: Bottom Terminal */}
                <div className="col-span-3 row-span-1 bg-[#21261F] text-emerald-400 font-mono rounded-lg p-2.5 flex flex-col justify-between text-[11px] shadow-2xs">
                  <div className="flex items-center justify-between text-xs text-[#8A9186]">
                    <div className="flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Нижній термінал (Build Logs)</span>
                    </div>
                    <span>[radxa-node-01: active]</span>
                  </div>
                  <div className="text-[10px]">✓ Vite build completed in 1.42s | Listening on 10.42.0.1:8491</div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Fullscreen Focus Workspace */}
          {activeLayout === 'fullscreen_canvas' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 text-xs text-emerald-950">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-900">Canvas-to-App Focus Workspace</span>
                  <button
                    onClick={() => {
                      soundFx.playSend();
                      setIsFullscreenFocus(!isFullscreenFocus);
                    }}
                    className="px-3 py-1 bg-emerald-800 text-white rounded-lg font-bold text-xs shadow-xs"
                  >
                    {isFullscreenFocus ? 'Згорнути Focus Mode' : 'Увімкнути повний екран (F11)'}
                  </button>
                </div>
                <p className="text-[11px]">
                  Згортає всі списки чатів і бічні панелі, перетворюючи Canvas на повноцінне робоче IDE без відволікаючих факторів.
                </p>
              </div>

              <div className="p-6 bg-white border border-[#E5DEC9] rounded-xl h-52 flex flex-col justify-between font-mono text-xs shadow-2xs">
                <div className="flex justify-between border-b border-[#E8E1D3] pb-2 text-[#8A9186]">
                  <span>docs/specifications/mesh_routing.md</span>
                  <span>142 lines · UTF-8</span>
                </div>
                <div className="text-[#21261F] space-y-1">
                  <div className="text-emerald-700 font-bold"># Protocol Specification: P2P Multi-Transport Failover</div>
                  <p className="text-[#6E7568] font-sans">
                    Кожен вузол транслює свій стан за допомогою протоколу Gossip over Noise E2EE...
                  </p>
                </div>
                <div className="text-[10px] text-[#8A9186] flex justify-between pt-2 border-t border-[#E8E1D3]">
                  <span>Синхронізовано з Radxa Node</span>
                  <span>Без перешкод</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Activity Heatmaps */}
          {activeLayout === 'heatmaps' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-1 text-xs text-indigo-950">
                <span className="font-bold text-indigo-900">Піктографічні міні-карти активності (24h Activity Sparklines)</span>
                <p className="text-[11px]">
                  Показують піки обговорень та активність колег за останні 24 години без необхідності заходити в чат.
                </p>
              </div>

              <div className="space-y-3">
                {[
                  { name: '#engineering (Aura Core)', count: '142 пов/добу', peak: '14:00 - 16:00', bars: [2, 4, 8, 12, 18, 24, 16, 9, 3] },
                  { name: '#hardware-pcb (LoRa & CAD)', count: '86 пов/добу', peak: '11:00 - 13:00', bars: [1, 2, 6, 14, 10, 8, 5, 2, 0] },
                  { name: '#general (Штаб)', count: '34 пов/добу', peak: '09:00 - 10:00', bars: [4, 8, 3, 2, 5, 4, 2, 1, 1] },
                ].map((item) => (
                  <div key={item.name} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div className="space-y-0.5">
                      <h5 className="font-bold text-xs text-[#21261F]">{item.name}</h5>
                      <span className="text-[10px] text-[#6E7568]">{item.count} · Пік: {item.peak}</span>
                    </div>

                    {/* Sparkline Bars */}
                    <div className="flex items-end gap-1 h-8 px-2">
                      {item.bars.map((val, idx) => (
                        <div
                          key={idx}
                          className="w-2 bg-[#D96C35] rounded-xs"
                          style={{ height: `${(val / 24) * 100}%` }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Spatial Multi-Pane Workspace</span>
          <span className="font-mono">Tiling Engine v2.0</span>
        </div>
      </div>
    </div>
  );
};
