import React, { useState } from 'react';
import {
  Boxes,
  Cpu,
  HardDrive,
  Clipboard,
  X,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface WasmApp {
  id: string;
  name: string;
  category: '3D Viewer' | 'Simulation' | 'Math Engine' | 'Media Lab';
  sizeKB: number;
  status: 'Ready' | 'Running' | 'Sandboxed';
  description: string;
}

interface WasmAppSandboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const WasmAppSandboxModal: React.FC<WasmAppSandboxModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Бесіда',
}) => {
  const [activeTab, setActiveTab] = useState<'apps' | 'fuse' | 'clipboard'>('apps');
  const [runningAppId, setRunningAppId] = useState<string | null>('w1');
  const [isFuseMounted, setIsFuseMounted] = useState(true);

  const wasmApps: WasmApp[] = [
    {
      id: 'w1',
      name: '3D GLTF/GLB Offline Model Viewer',
      category: '3D Viewer',
      sizeKB: 840,
      status: 'Running',
      description: 'Рендеринг 3D-моделей на WebGL2 без надсилання файлів у хмару.',
    },
    {
      id: 'w2',
      name: 'P2P Physics 2D Rigid Body Sandbox',
      category: 'Simulation',
      sizeKB: 420,
      status: 'Ready',
      description: 'Фізичний симулятор взаємодії обʼєктів на Rust/WASM.',
    },
    {
      id: 'w3',
      name: 'Fast Fourier Transform (FFT) Audio Engine',
      category: 'Media Lab',
      sizeKB: 310,
      status: 'Ready',
      description: 'Спектральний аналіз звукових файлів та фільтрація шумів офлайн.',
    },
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
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Embedded WASM Apps & Системний шар OS
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Пісочниця WebAssembly, FUSE монтування та буфер обміну
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('apps')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'apps' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                WASM Додатки
              </button>
              <button
                onClick={() => setActiveTab('fuse')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'fuse' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                FUSE Диск
              </button>
              <button
                onClick={() => setActiveTab('clipboard')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'clipboard' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Буфер обміну
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
          {/* TAB 1: WASM Apps Sandbox */}
          {activeTab === 'apps' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-950 flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-indigo-900">
                  <Cpu className="w-4 h-4 text-indigo-600" />
                  <span>Ізольована WebAssembly пісочниця (0 мс доступ до пам'яті)</span>
                </div>
                <span className="font-mono font-bold">Wasmtime Core</span>
              </div>

              <div className="space-y-3">
                {wasmApps.map((app) => (
                  <div key={app.id} className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-[#D96C35] bg-[#FDF5ED] px-2 py-0.5 rounded">
                            {app.category}
                          </span>
                          <h5 className="font-bold text-xs text-[#21261F]">{app.name}</h5>
                        </div>
                        <p className="text-[11px] text-[#6E7568] mt-1">{app.description}</p>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="font-mono text-[10px] text-[#8A9186] block">{app.sizeKB} KB WASM</span>
                        <button
                          onClick={() => {
                            soundFx.playTap();
                            setRunningAppId(app.id);
                          }}
                          className={`mt-1 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                            runningAppId === app.id
                              ? 'bg-emerald-600 text-white'
                              : 'bg-[#FAF8F5] hover:bg-[#EFE9DC] border border-[#E5DEC9] text-[#21261F]'
                          }`}
                        >
                          {runningAppId === app.id ? 'Запущено ✓' : 'Запустити'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: FUSE Virtual Drive */}
          {activeTab === 'fuse' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 text-xs text-emerald-950">
                <div className="flex items-center gap-2 font-bold text-emerald-900">
                  <HardDrive className="w-4 h-4 text-emerald-600" />
                  <span>Монтування просторів як віртуального диска ОС (FUSE / WebDAV)</span>
                </div>
                <p className="leading-relaxed">
                  Працюйте з файлами чатів і документами Canvas через нативний файловий менеджер вашої ОС (Nautilus, Finder, Explorer) так само природно, як зі звичайною папкою на диску.
                </p>
              </div>

              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div>
                    <h5 className="font-bold text-xs text-[#21261F]">Точка монтування FUSE</h5>
                    <p className="font-mono text-[11px] text-[#6E7568]">/mnt/phantom/spaces/{chatTitle}</p>
                  </div>

                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    {isFuseMounted ? 'Змонтовано' : 'Вимкнено'}
                  </span>
                </div>

                <button
                  onClick={() => {
                    soundFx.playTap();
                    setIsFuseMounted(!isFuseMounted);
                  }}
                  className="w-full py-2 bg-[#21261F] hover:bg-[#3E453A] text-white rounded-xl text-xs font-bold transition-all"
                >
                  {isFuseMounted ? 'Відмонтувати віртуальний диск' : 'Змонтувати FUSE диск'}
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: Smart Clipboard Bridge */}
          {activeTab === 'clipboard' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs text-amber-950">
                <div className="flex items-center gap-2 font-bold text-amber-900">
                  <Clipboard className="w-4 h-4 text-[#D96C35]" />
                  <span>Інтелектуальний міст буфера обміну (Contextual Clipboard)</span>
                </div>
                <p className="leading-relaxed">
                  Скопійований у будь-якій програмі ОС фрагмент коду або скриншот автоматично аналізується системою та пропонує збереження у відповідний робочий простір і сферу.
                </p>
              </div>

              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl text-xs space-y-2">
                <h5 className="font-bold text-xs text-[#21261F]">Глобальні системні комбінації клавіш</h5>
                <div className="space-y-1.5 font-mono text-[11px] text-[#6E7568]">
                  <div><span className="font-bold text-[#21261F]">Super + Shift + P:</span> Швидкий скриншот до Canvas</div>
                  <div><span className="font-bold text-[#21261F]">Super + Shift + K:</span> Глобальна командна палітра Phantom</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Zero-Latency System Layer</span>
          <span className="font-mono">WASM / FUSE Bridge v2</span>
        </div>
      </div>
    </div>
  );
};
