import React, { useState } from 'react';
import {
  Network,
  X,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  User,
  Search,
} from 'lucide-react';

interface MemoryNode {
  id: string;
  type: 'decision' | 'blocker' | 'task' | 'person' | 'artifact';
  label: string;
  detail: string;
  assignee?: string;
  status?: 'active' | 'resolved' | 'blocked';
  x: number;
  y: number;
}

interface ProjectMemoryGraphModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const ProjectMemoryGraphModal: React.FC<ProjectMemoryGraphModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Бесіда',
}) => {
  const [filterType, setFilterType] = useState<string>('all');
  const [search, setSearch] = useState('');

  const nodes: MemoryNode[] = [
    {
      id: 'n1',
      type: 'decision',
      label: 'Гібридна Work OS Модель',
      detail: 'Спліт-екран із живим Canvas та підтримкою P2P',
      status: 'resolved',
      x: 120,
      y: 80,
    },
    {
      id: 'n2',
      type: 'task',
      label: 'P2P DataChannel Mesh Sync',
      detail: 'Прямий обмін повідомленнями через WebRTC без серверів',
      assignee: 'Саня',
      status: 'active',
      x: 380,
      y: 70,
    },
    {
      id: 'n3',
      type: 'blocker',
      label: 'NAT Traversal на симетричних мережах',
      detail: 'Потрібен автоматичний STUN/TURN fallback через релей',
      status: 'blocked',
      assignee: 'Кирило',
      x: 380,
      y: 220,
    },
    {
      id: 'n4',
      type: 'person',
      label: 'Кирило (ROOT Trust)',
      detail: 'Головний архітектор та криптографія',
      status: 'active',
      x: 120,
      y: 240,
    },
    {
      id: 'n5',
      type: 'artifact',
      label: 'SQLCipher Vault Schema',
      detail: 'Локальне зашифроване сховище ключів та історії',
      status: 'resolved',
      x: 250,
      y: 350,
    },
    {
      id: 'n6',
      type: 'task',
      label: 'Vim Navigation Mode',
      detail: 'Повна підтримка j/k, i, Tab без миші',
      assignee: 'Марина',
      status: 'active',
      x: 520,
      y: 150,
    },
  ];

  if (!isOpen) return null;

  const filteredNodes = nodes.filter((n) => {
    if (filterType !== 'all' && n.type !== filterType) return false;
    if (search && !n.label.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col h-[82vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <Network className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Project Memory Graph · {chatTitle}
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                Автономна карта рішень, блокерів та звʼязків простору
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-[#E5DEC9] rounded-lg text-xs">
              <Search className="w-3.5 h-3.5 text-[#8A9186]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Пошук у памʼяті..."
                className="w-28 sm:w-36 bg-transparent focus:outline-none text-xs"
              />
            </div>

            {/* Filter */}
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-2 py-1 bg-white border border-[#E5DEC9] rounded-lg text-xs text-[#21261F] focus:outline-none font-medium"
            >
              <option value="all">Усі звʼязки</option>
              <option value="decision">Рішення</option>
              <option value="task">Завдання</option>
              <option value="blocker">Блокери</option>
              <option value="person">Учасники</option>
            </select>

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] hover:text-[#21261F] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Interactive Graph Canvas */}
        <div className="flex-1 min-h-0 relative overflow-hidden bg-[#FAF8F5] bg-[radial-gradient(#D9CFBB_1px,transparent_1px)] [background-size:16px_16px]">
          <div className="absolute inset-0 p-6 overflow-auto custom-scrollbar">
            {/* SVG Connecting Edges */}
            <svg className="absolute inset-0 w-[1200px] h-[900px] pointer-events-none stroke-[#D96C35]/30 stroke-2">
              <line x1="220" y1="120" x2="380" y2="100" />
              <line x1="220" y1="120" x2="380" y2="240" strokeDasharray="4 4" stroke="#DC2626" />
              <line x1="220" y1="260" x2="380" y2="240" />
              <line x1="220" y1="260" x2="250" y2="350" />
              <line x1="380" y1="100" x2="520" y2="170" />
            </svg>

            {/* Nodes */}
            {filteredNodes.map((n) => (
              <div
                key={n.id}
                style={{
                  position: 'absolute',
                  left: `${n.x}px`,
                  top: `${n.y}px`,
                  width: '210px',
                }}
                className={`bg-white border-2 rounded-xl p-3 shadow-md space-y-1.5 transition-all select-none hover:scale-105 z-10 ${
                  n.type === 'blocker'
                    ? 'border-red-400 bg-red-50/20'
                    : n.type === 'decision'
                    ? 'border-[#D96C35] bg-[#FDF5ED]/40'
                    : n.type === 'person'
                    ? 'border-indigo-400'
                    : 'border-[#E5DEC9]'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] pb-1 border-b border-[#F5EFE3]">
                  <span className={`font-bold uppercase flex items-center gap-1 ${
                    n.type === 'blocker'
                      ? 'text-red-600'
                      : n.type === 'decision'
                      ? 'text-[#D96C35]'
                      : 'text-[#6E7568]'
                  }`}>
                    {n.type === 'blocker' && <AlertTriangle className="w-3 h-3 text-red-500" />}
                    {n.type === 'decision' && <CheckCircle2 className="w-3 h-3 text-[#D96C35]" />}
                    {n.type === 'person' && <User className="w-3 h-3 text-indigo-500" />}
                    {n.type}
                  </span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-semibold ${
                    n.status === 'resolved'
                      ? 'bg-emerald-100 text-emerald-800'
                      : n.status === 'blocked'
                      ? 'bg-red-100 text-red-800'
                      : 'bg-[#EFE9DC] text-[#6E7568]'
                  }`}>
                    {n.status}
                  </span>
                </div>

                <p className="font-bold text-xs text-[#21261F] leading-tight">
                  {n.label}
                </p>
                <p className="text-[11px] text-[#6E7568] leading-snug line-clamp-2">
                  {n.detail}
                </p>

                {n.assignee && (
                  <div className="flex items-center gap-1 pt-1 text-[10px] text-[#D96C35] font-semibold">
                    <User className="w-3 h-3" />
                    <span>@{n.assignee}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>{filteredNodes.length} активних вузлів памʼяті</span>
          <span className="flex items-center gap-1 text-[#D96C35] font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Local AI Chronicler Active</span>
          </span>
        </div>
      </div>
    </div>
  );
};
