import React, { useState } from 'react';
import {
  Compass,
  Play,
  X,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface KnowledgeNode {
  id: string;
  label: string;
  category: 'Публікація' | 'Датасет' | 'Тема дипломної' | 'Лабораторія';
  connections: number;
}

interface NotebookCell {
  id: string;
  code: string;
  output: string;
  isRunning: boolean;
}

interface AdvancedResearchMeshModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const AdvancedResearchMeshModal: React.FC<AdvancedResearchMeshModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Науково-дослідний простір',
}) => {
  const [activeTab, setActiveTab] = useState<'atlas' | 'notebooks'>('atlas');

  const [nodes] = useState<KnowledgeNode[]>([
    { id: 'n1', label: 'Ratchet Trees in Byzantine Fault Tolerant Mesh', category: 'Публікація', connections: 5 },
    { id: 'n2', label: 'Dataset: 868MHz LoRa Signal Degradation (Kyiv Urban)', category: 'Датасет', connections: 3 },
    { id: 'n3', label: 'Диплом: Zero-Knowledge Range Proofs на ESP32', category: 'Тема дипломної', connections: 4 },
    { id: 'n4', label: 'Lab #4: Розподілена криптографія та апаратні анклави', category: 'Лабораторія', connections: 7 },
  ]);

  const [cells, setCells] = useState<NotebookCell[]>([
    {
      id: 'c1',
      code: 'import numpy as np\nimport matplotlib.pyplot as plt\n\n# Симуляція затримки пакета в LoRa Mesh\nt = np.linspace(0, 10, 100)\nlatency = 12 * np.exp(-0.2 * t) + np.random.normal(0, 0.5, 100)\nprint(f"Mean latency: {latency.mean():.2f} ms | Convergence: 99.8%")',
      output: 'Mean latency: 8.42 ms | Convergence: 99.8%\n[Графік згенеровано у векторному форматі SVG 3D Plot]',
      isRunning: false,
    },
  ]);

  if (!isOpen) return null;

  const handleRunCell = (id: string) => {
    soundFx.playSend();
    setCells(cells.map((c) => (c.id === id ? { ...c, isRunning: true } : c)));
    setTimeout(() => {
      setCells(cells.map((c) => (c.id === id ? { ...c, isRunning: false } : c)));
    }, 800);
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
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Семантичний Атлас Знань & Наукові Блокноти
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · 3D Граф знань кафедри та спільні обчислення Distributed Notebooks
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('atlas')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'atlas' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Атлас знань (Граф)
              </button>
              <button
                onClick={() => setActiveTab('notebooks')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'notebooks' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Scientific Notebooks
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
          {/* TAB 1: Knowledge Graph Atlas */}
          {activeTab === 'atlas' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-1 text-xs text-indigo-950">
                <span className="font-bold text-indigo-900">3D Семантичний граф наукових досліджень</span>
                <p className="text-[11px]">
                  Зв'язує публікації, теми дипломних робіт, експериментальні датасети та лабораторії в єдину мапу.
                </p>
              </div>

              <div className="space-y-2.5">
                {nodes.map((node) => (
                  <div key={node.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-[#D96C35] bg-[#FDF5ED] px-2 py-0.5 rounded">
                          {node.category}
                        </span>
                        <h5 className="font-bold text-xs text-[#21261F]">{node.label}</h5>
                      </div>
                    </div>

                    <span className="text-[11px] font-mono text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      {node.connections} зв'язків
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: Distributed Scientific Notebooks */}
          {activeTab === 'notebooks' && (
            <div className="space-y-4">
              {cells.map((cell) => (
                <div key={cell.id} className="border border-[#E5DEC9] rounded-xl overflow-hidden shadow-2xs">
                  <div className="bg-[#FAF8F5] px-3.5 py-2 border-b border-[#E8E1D3] flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-[#6E7568]">Python / WASM Kernel [In 1]</span>
                    <button
                      onClick={() => handleRunCell(cell.id)}
                      disabled={cell.isRunning}
                      className="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>{cell.isRunning ? 'Обчислення...' : 'Виконати клітинку'}</span>
                    </button>
                  </div>

                  <div className="p-3 bg-[#21261F] text-emerald-400 font-mono text-xs overflow-x-auto">
                    <pre>{cell.code}</pre>
                  </div>

                  <div className="p-3 bg-[#FAF8F5] border-t border-[#E8E1D3] font-mono text-xs text-[#21261F] space-y-1">
                    <span className="text-[10px] text-[#8A9186] font-bold block">[Out 1]:</span>
                    <pre className="text-xs text-[#21261F]">{cell.output}</pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Advanced Scientific & Academic Mesh</span>
          <span className="font-mono">Distributed Notebook Kernel</span>
        </div>
      </div>
    </div>
  );
};
