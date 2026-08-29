import React, { useState } from 'react';
import {
  Network,
  X,
  Sparkles,
  Plus,
  Trash2,
  Search,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useAgenticStore, MemoryNode } from '../../stores/agenticStore';

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
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedNode, setSelectedNode] = useState<MemoryNode | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<MemoryNode['category']>('insight');

  const { memoryNodes, addMemoryNode, deleteMemoryNode } = useAgenticStore();

  if (!isOpen) return null;

  const filteredNodes = memoryNodes.filter((n) => {
    if (filterCategory !== 'all' && n.category !== filterCategory) return false;
    if (
      search &&
      !n.title.toLowerCase().includes(search.toLowerCase()) &&
      !n.content.toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const handleCreateNode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    soundFx.playSend();
    const created = addMemoryNode({
      title: newTitle.trim(),
      content: newContent.trim(),
      category: newCategory,
      tags: ['manual', newCategory],
      connections: [],
    });
    setSelectedNode(created);
    setNewTitle('');
    setNewContent('');
    setIsAdding(false);
  };

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <Network className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Project Memory Graph (Семантична памʼять проєкту)
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Граф знань, архітектурних рішень та контекстних зв'язків
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                soundFx.playTap();
                setIsAdding(!isAdding);
              }}
              className="px-3 py-1.5 bg-[#D96C35] text-white rounded-lg text-xs font-bold hover:bg-[#C25B27] transition-all flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Додати вузол
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#6E7568] hover:text-[#21261F] hover:bg-[#F1EBDD] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="px-5 py-2.5 bg-[#FDFCF9] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-[#8A8577] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Пошук у графі памʼяті..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-[#F7F5EE] border border-[#E8E1D3] rounded-lg text-xs outline-none focus:border-[#D96C35]"
            />
          </div>

          <div className="flex items-center gap-1">
            {(['all', 'architecture', 'decision', 'task', 'insight'] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  filterCategory === cat
                    ? 'bg-[#21261F] text-white font-bold'
                    : 'text-[#6E7568] hover:bg-[#EFE9DC]'
                }`}
              >
                {cat === 'all' ? 'Всі' : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {/* Node List / Grid */}
          <div className="flex-1 p-5 overflow-y-auto space-y-3 bg-[#FAF8F5]">
            {isAdding && (
              <form onSubmit={handleCreateNode} className="p-4 bg-white border border-[#D96C35] rounded-xl space-y-3">
                <h4 className="font-bold text-xs text-[#D96C35]">Новий вузол графу</h4>
                <input
                  type="text"
                  placeholder="Заголовок знання..."
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-1.5 border border-[#E8E1D3] rounded-lg text-xs"
                />
                <textarea
                  placeholder="Опис / контекст..."
                  rows={3}
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="w-full px-3 py-1.5 border border-[#E8E1D3] rounded-lg text-xs"
                />
                <div className="flex items-center justify-between">
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as any)}
                    className="px-2 py-1 border border-[#E8E1D3] rounded text-xs"
                  >
                    <option value="architecture">architecture</option>
                    <option value="decision">decision</option>
                    <option value="task">task</option>
                    <option value="insight">insight</option>
                  </select>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsAdding(false)}
                      className="px-2.5 py-1 text-xs text-[#6E7568]"
                    >
                      Скасувати
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1 bg-[#D96C35] text-white font-bold text-xs rounded-lg"
                    >
                      Зберегти
                    </button>
                  </div>
                </div>
              </form>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredNodes.map((node) => (
                <div
                  key={node.id}
                  onClick={() => setSelectedNode(node)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    selectedNode?.id === node.id
                      ? 'bg-white border-[#D96C35] shadow-md ring-1 ring-[#D96C35]'
                      : 'bg-white border-[#E8E1D3] hover:border-[#D96C35]/50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-[#F7F5EE] text-[#6E7568]">
                      {node.category}
                    </span>
                    <span className="text-[10px] text-[#8A8577]">{new Date(node.createdAt).toLocaleDateString()}</span>
                  </div>
                  <h4 className="font-bold text-xs text-[#21261F] mb-1">{node.title}</h4>
                  <p className="text-[11px] text-[#6E7568] line-clamp-2 leading-relaxed">{node.content}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Details Sidebar */}
          {selectedNode && (
            <div className="w-full md:w-80 p-5 bg-white border-t md:border-t-0 md:border-l border-[#E8E1D3] flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-[#FDF5ED] text-[#D96C35]">
                    {selectedNode.category}
                  </span>
                  <button
                    onClick={() => {
                      soundFx.playTap();
                      deleteMemoryNode(selectedNode.id);
                      setSelectedNode(null);
                    }}
                    className="text-red-500 hover:text-red-700 p-1"
                    title="Видалити вузол"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <h4 className="font-bold text-sm text-[#21261F]">{selectedNode.title}</h4>
                <p className="text-xs text-[#4A5043] leading-relaxed whitespace-pre-wrap">{selectedNode.content}</p>
                <div className="pt-2">
                  <span className="text-[11px] font-bold text-[#8A8577]">Зв'язки ({selectedNode.connections.length})</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedNode.connections.map((cId) => (
                      <span key={cId} className="px-2 py-0.5 bg-[#F7F5EE] border border-[#E8E1D3] rounded text-[10px] text-[#21261F]">
                        #{cId}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-[#E8E1D3] flex items-center gap-1.5 text-[11px] text-[#8A8577]">
                <Sparkles className="w-3.5 h-3.5 text-[#D96C35]" />
                <span>Автоматично індексується AIRouter</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
