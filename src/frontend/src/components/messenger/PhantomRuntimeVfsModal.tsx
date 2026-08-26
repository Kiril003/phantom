import React, { useState } from 'react';
import {
  Cpu,
  FolderTree,
  X,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface VfsMount {
  path: string;
  permissions: string;
  sizeMB: number;
  syncedNodes: number;
}

interface WasmApp {
  id: string;
  name: string;
  category: 'CAD/3D' | 'Audio Engine' | 'Vector Graphics' | 'Physics Sim';
  memoryAllocationMB: number;
  status: 'Running' | 'Idle';
}

interface PhantomRuntimeVfsModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const PhantomRuntimeVfsModal: React.FC<PhantomRuntimeVfsModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Робочий простір',
}) => {
  const [activeTab, setActiveTab] = useState<'vfs' | 'wasm_apps' | 'ipc_bus'>('vfs');
  const [ipcParameter, setIpcParameter] = useState(240);

  const [mounts] = useState<VfsMount[]>([
    { path: '/spaces/work/assets/', permissions: 'drwxr-xr-x', sizeMB: 48.5, syncedNodes: 6 },
    { path: '/spaces/work/models/cad_v2.gltf', permissions: '-rw-r--r--', sizeMB: 12.8, syncedNodes: 6 },
    { path: '/spaces/engineering/bin/', permissions: 'drwx------', sizeMB: 104.2, syncedNodes: 3 },
  ]);

  const [wasmApps] = useState<WasmApp[]>([
    { id: 'w1', name: 'Phantom CAD 3D Engine (Zero-Network)', category: 'CAD/3D', memoryAllocationMB: 64, status: 'Running' },
    { id: 'w2', name: 'Spatial Audio DSP Synthesizer', category: 'Audio Engine', memoryAllocationMB: 32, status: 'Running' },
    { id: 'w3', name: 'Vector Canvas Vectorizer WASM', category: 'Vector Graphics', memoryAllocationMB: 16, status: 'Idle' },
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
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Phantom Runtime Environment & POSIX VFS
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Монтована файлова система, Wasm-пісочниці та Shared Memory IPC
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('vfs')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'vfs' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                POSIX VFS
              </button>
              <button
                onClick={() => setActiveTab('wasm_apps')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'wasm_apps' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Wasm Marketplace
              </button>
              <button
                onClick={() => setActiveTab('ipc_bus')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'ipc_bus' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Shared Memory IPC
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
          {/* TAB 1: POSIX VFS Mounts */}
          {activeTab === 'vfs' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-950 flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-emerald-900">
                  <FolderTree className="w-4 h-4 text-emerald-600" />
                  <span>Монтована файлова система VFS з правами POSIX</span>
                </div>
                <span className="font-mono text-[10px] font-bold">FUSE Driver Active</span>
              </div>

              <div className="space-y-2.5 font-mono text-xs">
                {mounts.map((mount) => (
                  <div key={mount.path} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] bg-[#FAF8F5] px-1.5 py-0.5 rounded border border-[#E8E1D3] text-[#8A9186]">
                          {mount.permissions}
                        </span>
                        <span className="font-bold text-[#21261F]">{mount.path}</span>
                      </div>
                      <p className="text-[10px] text-[#6E7568] font-sans">
                        Синхронізовано між {mount.syncedNodes} вузлами простору
                      </p>
                    </div>

                    <span className="font-bold text-emerald-700">{mount.sizeMB} MB</span>
                  </div>
                ))}
              </div>

              <div className="p-3 bg-[#21261F] text-emerald-400 rounded-xl font-mono text-xs space-y-1">
                <div className="text-[#8A9186] text-[10px]">// Термінальна синхронізація в реальному часі:</div>
                <div>$ cp schematic_v3.kicad_pcb /spaces/hardware/assets/</div>
                <div className="text-emerald-300">✓ Файл миттєво з'явився в Canvas у всіх 6 учасників простору</div>
              </div>
            </div>
          )}

          {/* TAB 2: Wasm Micro-Apps Marketplace */}
          {activeTab === 'wasm_apps' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-1 text-xs text-indigo-950">
                <span className="font-bold text-indigo-900">Ізольовані Wasm-пісочниці без виходу в інтернет</span>
                <p className="text-[11px]">
                  Запускайте CAD, секвенсори та симулятори фізики без ризику витоку креслень чи даних.
                </p>
              </div>

              <div className="space-y-2.5">
                {wasmApps.map((app) => (
                  <div key={app.id} className="p-4 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-[#D96C35] bg-[#FDF5ED] px-2 py-0.5 rounded">
                          {app.category}
                        </span>
                        <h5 className="font-bold text-xs text-[#21261F]">{app.name}</h5>
                      </div>
                      <p className="text-[11px] text-[#6E7568]">Виділена пам'ять: {app.memoryAllocationMB} MB</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        {app.status}
                      </span>
                      <button
                        onClick={() => {
                          soundFx.playTap();
                          alert(`Wasm додаток ${app.name} розгорнуто у повному екрані`);
                        }}
                        className="px-3 py-1 bg-[#21261F] hover:bg-[#3E453A] text-white rounded-lg text-xs font-bold transition-all shadow-xs"
                      >
                        Відкрити вікно
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: Shared Memory IPC Event Bus */}
          {activeTab === 'ipc_bus' && (
            <div className="space-y-4">
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div>
                    <h5 className="font-bold text-xs text-[#21261F]">Shared Memory Event Bus: Синхронізація віджетів</h5>
                    <p className="text-[11px] text-[#6E7568]">
                      Зміна параметра в 3D CAD моделі автоматично перераховує кошторис у комерційному віджеті
                    </p>
                  </div>

                  <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-1 rounded border border-indigo-200">
                    RAM IPC Latency: 0.12 ms
                  </span>
                </div>

                <div className="space-y-2 pt-2 border-t border-[#E8E1D3]">
                  <div className="flex justify-between text-xs">
                    <span>Параметр площі радіатора 3D моделі:</span>
                    <span className="font-mono font-bold">{ipcParameter} мм²</span>
                  </div>
                  <input
                    type="range"
                    min="100"
                    max="500"
                    value={ipcParameter}
                    onChange={(e) => {
                      soundFx.playTap();
                      setIpcParameter(Number(e.target.value));
                    }}
                    className="w-full accent-[#D96C35]"
                  />

                  <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl flex justify-between items-center text-xs">
                    <span className="text-[#6E7568]">Автоматичний перерахунок у комерційному віджеті:</span>
                    <span className="font-mono font-bold text-emerald-700 text-sm">
                      {(ipcParameter * 4.85).toFixed(2)} ₴ (Собівартість матеріалу)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Phantom Runtime Environment</span>
          <span className="font-mono">Wasm POSIX IPC v3.4</span>
        </div>
      </div>
    </div>
  );
};
