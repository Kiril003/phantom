import React, { useState } from 'react';
import {
  Compass,
  ChevronRight,
  GitBranch,
  FileCode,
  Radio,
  Users,
  X,
} from 'lucide-react';

interface SmartBreadcrumbsContextPeekModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const SmartBreadcrumbsContextPeekModal: React.FC<SmartBreadcrumbsContextPeekModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Контекстна навігація',
}) => {
  const [activeTab, setActiveTab] = useState<'breadcrumbs' | 'quick_peek' | 'pinned_bar'>('breadcrumbs');
  const [hoveredItem, setHoveredItem] = useState<'task' | 'commit' | 'file' | null>(null);

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
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Smart Breadcrumbs, Hover Peek & Context Pinned Bar
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Хлібні крихти, плаваючий перегляд та закріплена лінія ресурсів
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('breadcrumbs')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'breadcrumbs' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Хлібні крихти
              </button>
              <button
                onClick={() => setActiveTab('quick_peek')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'quick_peek' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Hover Quick Peek
              </button>
              <button
                onClick={() => setActiveTab('pinned_bar')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'pinned_bar' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Context Pinned Bar
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
          {/* TAB 1: Smart Breadcrumbs Trail */}
          {activeTab === 'breadcrumbs' && (
            <div className="space-y-4">
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                <span className="font-bold text-xs text-[#21261F]">Повна ієрархія навігації (Breadcrumb Trail)</span>
                
                {/* Visual Trail */}
                <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl flex items-center gap-2 text-xs flex-wrap font-medium">
                  <span className="px-2 py-0.5 bg-white border border-[#E5DEC9] rounded-md text-[#21261F] font-bold">
                    🏛️ Сфера: Робота
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-[#8A9186]" />
                  <span className="px-2 py-0.5 bg-white border border-[#E5DEC9] rounded-md text-[#21261F] font-bold">
                    ⚡ Простір: Aura Core
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-[#8A9186]" />
                  <span className="px-2 py-0.5 bg-[#FDF5ED] border border-[#E5DEC9] text-[#D96C35] rounded-md font-bold">
                    # Рефакторинг UI v2.4
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-[#8A9186]" />
                  <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-300 text-emerald-950 rounded-md font-bold">
                    📄 Canvas
                  </span>
                </div>

                <p className="text-[11px] text-[#6E7568]">
                  Клік на будь-який елемент ланцюжка миттєво перемикає область видимості без втрати набраного тексту в чаті.
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: Hover Quick Peek */}
          {activeTab === 'quick_peek' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-1 text-xs text-indigo-950">
                <span className="font-bold text-indigo-900">Плаваюче вікно попереднього перегляду (Hover Quick Peek)</span>
                <p className="text-[11px]">
                  Наведіть курсор на посилання, задачу або коміт, щоб побачити зміст без переходу.
                </p>
              </div>

              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                <div className="flex gap-3 text-xs">
                  <span
                    onMouseEnter={() => setHoveredItem('task')}
                    className="underline text-indigo-700 font-bold cursor-pointer"
                  >
                    Задача #8491
                  </span>
                  <span
                    onMouseEnter={() => setHoveredItem('commit')}
                    className="underline text-[#D96C35] font-mono font-bold cursor-pointer"
                  >
                    commit 9205e27
                  </span>
                  <span
                    onMouseEnter={() => setHoveredItem('file')}
                    className="underline text-emerald-700 font-mono font-bold cursor-pointer"
                  >
                    /spaces/work/vfs.ts
                  </span>
                </div>

                {/* Popover Preview Box */}
                <div className="p-3.5 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl text-xs space-y-1">
                  <span className="text-[10px] text-[#8A9186] font-bold uppercase block">Швидкий перегляд:</span>
                  {hoveredItem === 'task' && (
                    <div>
                      <div className="font-bold text-[#21261F]">Задача #8491: Інтеграція WebGL 3D Viewport</div>
                      <p className="text-[11px] text-[#6E7568]">Виконавець: @Кирило · Пріоритет: High · Спринт A</p>
                    </div>
                  )}
                  {hoveredItem === 'commit' && (
                    <div className="font-mono">
                      <div className="font-bold text-[#21261F]">feat(system-scale): Headless Node Daemon & Universal Clipboard</div>
                      <p className="text-[11px] text-[#6E7568]">Автор: @radxa · 6 files changed, 1140 insertions(+)</p>
                    </div>
                  )}
                  {hoveredItem === 'file' && (
                    <div className="font-mono">
                      <div className="font-bold text-[#21261F]">src/services/vfsStorage.ts (FUSE driver)</div>
                      <p className="text-[11px] text-[#6E7568]">Розмір: 48.5 KB · Останнє оновлення: 5 хв тому</p>
                    </div>
                  )}
                  {!hoveredItem && (
                    <span className="text-[#8A9186] italic">Наведіть курсор на одне з посилань вище...</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Context Pinned Bar */}
          {activeTab === 'pinned_bar' && (
            <div className="space-y-4">
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                <span className="font-bold text-xs text-[#21261F]">Закріплена контекстна лінія простору (Pinned Bar)</span>
                
                <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl flex items-center justify-between gap-2 text-xs flex-wrap">
                  <div className="flex items-center gap-1.5 font-mono text-[#21261F]">
                    <GitBranch className="w-3.5 h-3.5 text-[#D96C35]" />
                    <span className="font-bold">main (v2.4-stable)</span>
                  </div>

                  <div className="flex items-center gap-1.5 text-emerald-800 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    <FileCode className="w-3.5 h-3.5" />
                    <span>Live Canvas Doc</span>
                  </div>

                  <div className="flex items-center gap-1.5 text-red-700 font-bold bg-red-50 px-2 py-0.5 rounded border border-red-200">
                    <Radio className="w-3.5 h-3.5" />
                    <span>Huddle (3 онлайн)</span>
                  </div>

                  <div className="flex items-center gap-1.5 text-[#6E7568]">
                    <Users className="w-3.5 h-3.5" />
                    <span>Черговий: @Марина</span>
                  </div>
                </div>

                <p className="text-[11px] text-[#6E7568]">
                  Завжди зафіксована у верхній частині кожного простору для миттєвого доступу до ключових ресурсів команди.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Spatial Navigation & Context Peek</span>
          <span className="font-mono">Breadcrumbs Engine v2.0</span>
        </div>
      </div>
    </div>
  );
};
