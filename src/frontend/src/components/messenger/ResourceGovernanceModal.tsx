import React, { useState } from 'react';
import {
  BatteryCharging,
  Cpu,
  HardDrive,
  X,
  Gauge,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface WorkerSandbox {
  id: string;
  name: string;
  type: 'WebAssembly' | 'Web Worker';
  memoryUsedMB: number;
  memoryLimitMB: number;
  status: 'Healthy' | 'Throttled';
}

interface ResourceGovernanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const ResourceGovernanceModal: React.FC<ResourceGovernanceModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Система',
}) => {
  const [activeTab, setActiveTab] = useState<'throttling' | 'diffing' | 'workers'>('throttling');
  const [isBatteryAdaptive, setIsBatteryAdaptive] = useState(true);
  const [isBinaryDiffingEnabled] = useState(true);

  const [workers] = useState<WorkerSandbox[]>([
    { id: 'w1', name: 'KaTeX Math Parser Worker', type: 'Web Worker', memoryUsedMB: 12.4, memoryLimitMB: 64, status: 'Healthy' },
    { id: 'w2', name: '3D GLTF Render Sandbox', type: 'WebAssembly', memoryUsedMB: 38.1, memoryLimitMB: 128, status: 'Healthy' },
    { id: 'w3', name: 'SQLite CRDT Merge Worker', type: 'Web Worker', memoryUsedMB: 8.5, memoryLimitMB: 64, status: 'Healthy' },
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
              <BatteryCharging className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Енергоефективність & Стійкість ОС
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Battery Throttling, Binary Diffing та ізоляція пам'яті воркерів
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('throttling')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'throttling' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Battery Throttling
              </button>
              <button
                onClick={() => setActiveTab('diffing')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'diffing' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Binary Diffing
              </button>
              <button
                onClick={() => setActiveTab('workers')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'workers' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Ізоляція пам'яті
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
          {/* TAB 1: Battery Throttling */}
          {activeTab === 'throttling' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 text-xs text-emerald-950">
                <div className="flex items-center gap-2 font-bold text-emerald-900">
                  <Gauge className="w-4 h-4 text-emerald-600" />
                  <span>Adaptive Battery & Bandwidth Throttling</span>
                </div>
                <p className="leading-relaxed">
                  При низькому рівні заряду акумулятора (&lt;20%) або дорогому стільниковому інтернеті система автоматично знижує частоту P2P-пінгів та відкладає важкі синхронізації до підключення до мережі живлення.
                </p>
              </div>

              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                <div>
                  <h5 className="font-bold text-xs text-[#21261F]">Адаптивний енергозберігаючий режим</h5>
                  <p className="text-[11px] text-[#6E7568]">Економія до 40% батареї при фоновій роботі</p>
                </div>

                <button
                  onClick={() => {
                    soundFx.playTap();
                    setIsBatteryAdaptive(!isBatteryAdaptive);
                  }}
                  className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                    isBatteryAdaptive ? 'bg-emerald-600' : 'bg-[#D5CEBF]'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      isBatteryAdaptive ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: Bit-Level Binary Diffing */}
          {activeTab === 'diffing' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2 text-xs text-indigo-950">
                <div className="flex items-center gap-2 font-bold text-indigo-900">
                  <HardDrive className="w-4 h-4 text-indigo-600" />
                  <span>Bit-Level Binary Diffing (Fossil Delta Compression)</span>
                </div>
                <p className="leading-relaxed">
                  Синхронізація баз даних SQLite та великих документів передає лише змінені байти (deltas) замість перезавантаження всього файлу, що скорочує витрати трафіку на 98%.
                </p>
              </div>

              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                <div>
                  <h5 className="font-bold text-xs text-[#21261F]">Бінарне дельта-стиснення активне</h5>
                  <p className="text-[11px] text-[#6E7568]">Середній розмір оновлення: ~1.4 KB</p>
                </div>

                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                  {isBinaryDiffingEnabled ? 'Увімкнено ✓' : 'Вимкнено'}
                </span>
              </div>
            </div>
          )}

          {/* TAB 3: Worker Memory Quotas */}
          {activeTab === 'workers' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs text-amber-950">
                <div className="flex items-center gap-2 font-bold text-amber-900">
                  <Cpu className="w-4 h-4 text-[#D96C35]" />
                  <span>Ізоляція пам'яті через Web Workers & WebAssembly</span>
                </div>
                <p className="leading-relaxed">
                  Жоден сторонній віджет чи скрипт не може спричинити збій основного інтерфейсу — кожен модуль виконується в ізольованій пісочниці з жорсткими квотами пам'яті.
                </p>
              </div>

              <div className="space-y-2.5">
                {workers.map((w) => (
                  <div key={w.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div>
                      <h5 className="font-bold text-xs text-[#21261F]">{w.name}</h5>
                      <p className="text-[10px] text-[#6E7568]">{w.type} · Квота: {w.memoryLimitMB} MB</p>
                    </div>

                    <div className="text-right">
                      <span className="font-mono font-bold text-xs text-emerald-700">
                        {w.memoryUsedMB} MB
                      </span>
                      <span className="block text-[9px] text-[#8A9186] font-semibold">{w.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>OS-Level Resource Governance</span>
          <span className="font-mono">Fossil Delta & Workers Sandbox</span>
        </div>
      </div>
    </div>
  );
};
