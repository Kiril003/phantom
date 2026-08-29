import React, { useState, useMemo } from 'react';
import {
  Search,
  Sparkles,
  Layers,
  MessageSquare,
  Code,
  CheckCircle2,
  X,
  ArrowRight,
  FolderTree,
} from 'lucide-react';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { soundFx } from '../../utils/messengerSound';

interface SearchResultItem {
  id: string;
  type: 'canvas' | 'message' | 'code' | 'task' | 'drive';
  title: string;
  snippet: string;
  chatTitle: string;
  author: string;
  date: string;
  score: number;
  payload?: any;
}

interface KnowledgeSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectResult?: (item: SearchResultItem) => void;
}

export const KnowledgeSearchModal: React.FC<KnowledgeSearchModalProps> = ({
  isOpen,
  onClose,
  onSelectResult,
}) => {
  useEscapeClose(isOpen, onClose);

  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'canvas' | 'message' | 'code' | 'task' | 'drive'>('all');

  const knowledgeBase: SearchResultItem[] = useMemo(
    () => [
      {
        id: 'kb_1',
        type: 'canvas',
        title: 'Архітектура P2P Work OS та спліт-документи',
        snippet: 'Погоджено перехід на гібридну Work OS модель із локальними Canvas-документами та CRDT синхронізацією.',
        chatTitle: 'Core Team',
        author: 'Кирило',
        date: 'Сьогодні, 18:40',
        score: 98,
      },
      {
        id: 'kb_2',
        type: 'task',
        title: 'Реалізація Canvas Split-View та віджетів',
        snippet: 'Синхронізувати спліт-екран із гілками обговорення та мікро-віджетами голосування.',
        chatTitle: 'Спринт 14',
        author: 'Саня',
        date: 'Сьогодні, 16:15',
        score: 92,
      },
      {
        id: 'kb_3',
        type: 'code',
        title: 'WebRTC Mesh Call Engine implementation',
        snippet: 'export function initMeshConnection(peerId) { return new RTCPeerConnection(config); }',
        chatTitle: 'Dev Stream',
        author: 'Саня',
        date: 'Вчора, 19:20',
        score: 87,
      },
      {
        id: 'kb_4',
        type: 'drive',
        title: 'phantom_companion_architecture_spec_v2.pdf',
        snippet: 'Специфікація автономного цифрового симбіонта та протокол релею.',
        chatTitle: 'General Drive',
        author: 'Кирило',
        date: '24 сер, 14:00',
        score: 84,
      },
      {
        id: 'kb_5',
        type: 'message',
        title: 'Узгодження дедлайну MVP релізу',
        snippet: 'Домовилися завершити інтеграцію Webhook-хабів та семантичного пошуку до кінця тижня.',
        chatTitle: 'General',
        author: 'Марина',
        date: '23 сер, 11:30',
        score: 79,
      },
    ],
    []
  );

  const filteredResults = useMemo(() => {
    return knowledgeBase.filter((item) => {
      const matchesType = filterType === 'all' || item.type === filterType;
      if (!matchesType) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        item.snippet.toLowerCase().includes(q) ||
        item.author.toLowerCase().includes(q) ||
        item.chatTitle.toLowerCase().includes(q)
      );
    });
  }, [knowledgeBase, query, filterType]);

  if (!isOpen) return null;

  const getTypeIcon = (type: SearchResultItem['type']) => {
    switch (type) {
      case 'canvas':
        return <Layers className="w-4 h-4 text-[#D96C35]" />;
      case 'task':
        return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
      case 'code':
        return <Code className="w-4 h-4 text-amber-700" />;
      case 'drive':
        return <FolderTree className="w-4 h-4 text-indigo-600" />;
      default:
        return <MessageSquare className="w-4 h-4 text-blue-600" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[#FDFCF9] border border-[#E5DEC9] rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 text-[#21261F]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 bg-[#F7F4EC] border-b border-[#E5DEC9]">
          <div className="flex items-center gap-3 bg-white border border-[#E5DEC9] rounded-2xl px-3.5 py-2.5 shadow-sm focus-within:border-[#D96C35] focus-within:ring-1 focus-within:ring-[#D96C35] transition-all">
            <Search className="w-4 h-4 text-[#D96C35]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Семантичний пошук за змістом рішень, документів, коду та файлів..."
              className="w-full text-xs text-[#21261F] placeholder-[#8A9186] bg-transparent focus:outline-none"
              autoFocus
            />
            {query && (
              <button onClick={() => setQuery('')} className="p-1 hover:bg-[#FAF7F0] rounded-lg text-[#8A9186]">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-3 overflow-x-auto custom-scrollbar">
            {(
              [
                { id: 'all', label: 'Всі джерела' },
                { id: 'canvas', label: '📄 Canvas' },
                { id: 'task', label: '✅ Завдання' },
                { id: 'code', label: '💻 Код' },
                { id: 'drive', label: '📁 Файли / Drive' },
                { id: 'message', label: '💬 Повідомлення' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  soundFx.playTap();
                  setFilterType(tab.id);
                }}
                className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${
                  filterType === tab.id
                    ? 'bg-[#D96C35] text-white border-[#D96C35] shadow-sm'
                    : 'bg-white text-[#6E7568] border-[#E5DEC9] hover:bg-[#FDF5ED]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 space-y-2.5 max-h-[420px] overflow-y-auto custom-scrollbar">
          {filteredResults.length === 0 ? (
            <div className="text-center py-12 text-[#8A9186]">
              <Sparkles className="w-8 h-8 text-[#D96C35] mx-auto mb-2 opacity-60" />
              <p className="text-xs font-semibold">Нічого не знайдено за вашим запитом.</p>
              <p className="text-[11px] mt-0.5">Спробуйте перефразувати або обрати іншу категорію фільтра.</p>
            </div>
          ) : (
            filteredResults.map((res) => (
              <div
                key={res.id}
                onClick={() => {
                  soundFx.playTap();
                  onSelectResult?.(res);
                  onClose();
                }}
                className="p-3.5 rounded-2xl bg-[#FAF7F0] border border-[#E5DEC9] hover:border-[#D96C35] hover:bg-[#FDF9F3] transition-all cursor-pointer group"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-[#FDF5ED] border border-[#EADCC8] flex items-center justify-center shrink-0">
                      {getTypeIcon(res.type)}
                    </div>
                    <h4 className="text-[13.5px] font-bold text-[#21261F] group-hover:text-[#D96C35] transition-colors">
                      {res.title}
                    </h4>
                  </div>

                  <span className="text-[10.5px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-300 font-bold shrink-0">
                    {res.score}% збіг
                  </span>
                </div>

                <p className="text-xs text-[#5F6A60] line-clamp-2 pl-8 leading-relaxed mb-2">
                  {res.snippet}
                </p>

                <div className="flex items-center justify-between pl-8 pt-1.5 border-t border-[#EAE4D7] text-[11px] text-[#6E7568]">
                  <span className="flex items-center gap-1.5">
                    <span>Простір: <b>{res.chatTitle}</b></span>
                    <span>•</span>
                    <span>Автор: {res.author}</span>
                  </span>

                  <span className="flex items-center gap-1 group-hover:text-[#D96C35]">
                    <span>{res.date}</span>
                    <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-3.5 bg-[#F7F4EC] border-t border-[#E5DEC9] flex items-center justify-between text-xs text-[#6E7568]">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#D96C35]" />
            Локальний семантичний індекс (Zero Cloud Leak)
          </span>
          <span>Знайдено {filteredResults.length} артефактів</span>
        </div>
      </div>
    </div>
  );
};
