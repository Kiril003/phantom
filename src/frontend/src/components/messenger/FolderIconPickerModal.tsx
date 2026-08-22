import React, { useState } from 'react';
import {
  X,
  Sparkles,
  Check,
  Search,
  Leaf,
  Coffee,
  Zap,
  Compass,
  Heart,
  Wand2
} from 'lucide-react';
import { SmartFolder } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface FolderIconPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  folder: SmartFolder;
  onSelectIcon: (folderId: string, iconEmoji: string) => void;
}

interface IconCategory {
  id: string;
  name: string;
  icon: any;
  items: string[];
}

const curatedCategories: IconCategory[] = [
  {
    id: 'nature',
    name: 'Флора & Природа',
    icon: Leaf,
    items: [
      '🌿', '🍃', '🌱', '🌸', '🍄', '🌻', '🌾', '🌴', '🌲',
      '🍂', '🌵', '🍀', '🌺', '🪴', '🎋', '🌳', '🌰', '🌼',
      '🍁', '🌷', '🪻', '🪷', '🌾', '🪵'
    ],
  },
  {
    id: 'cozy',
    name: 'Тепло & Затишок',
    icon: Coffee,
    items: [
      '☕', '🍵', '🫖', '🕯️', '🥐', '🍞', '🍯', '🧶', '🏡',
      '🛋️', '🍪', '🥞', '🧇', '🥨', '🍂', '🧦', '📖', '🪆',
      '🪴', '🥧', '☕️', '🪑', '🛖', '🫓'
    ],
  },
  {
    id: 'focus',
    name: 'Фокус & Ритм',
    icon: Zap,
    items: [
      '⚡', '💡', '🧭', '🎯', '📚', '✍️', '🚀', '🔭', '💼',
      '🔬', '🛠️', '🪐', '🎨', '🔮', '📊', '📐', '🧠', '⚙️',
      '💻', '⏱️', '📌', '🏷️', '💎', '🔑'
    ],
  },
  {
    id: 'elements',
    name: 'Стихії & Небо',
    icon: Compass,
    items: [
      '🌊', '☁️', '☀️', '🌙', '⭐', '⛰️', '🏕️', '🕊️', '🌅',
      '🌌', '🪐', '🫧', '🌈', '🔥', '⚡', '💧', '🏔️', '🌋',
      '🏜️', '☄️', '💫', '🌤️', '🌄', '✨'
    ],
  },
  {
    id: 'community',
    name: 'Коло & Спільнота',
    icon: Heart,
    items: [
      '🤝', '💬', '💫', '💖', '🫂', '🐾', '🎈', '🕊️', '🛡️',
      '🗝️', '📮', '💌', '🧩', '🎙️', '🎉', '🌟', '🪅', '🎁',
      '🧿', '🪬', '🏮', '🎐', '🤍', '🧡'
    ],
  },
];

export const FolderIconPickerModal: React.FC<FolderIconPickerModalProps> = ({
  isOpen,
  onClose,
  folder,
  onSelectIcon,
}) => {
  const [selectedEmoji, setSelectedEmoji] = useState<string>(folder.emoji || '📁');
  const [activeCategoryId, setActiveCategoryId] = useState<string>('nature');
  const [customInput, setCustomInput] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  if (!isOpen) return null;

  const currentCategory = curatedCategories.find((c) => c.id === activeCategoryId) || curatedCategories[0];

  // Filtered items across all categories if searching, else current category
  const displayedItems = searchQuery.trim()
    ? curatedCategories.flatMap((c) => c.items).filter((item, index, self) => self.indexOf(item) === index)
    : currentCategory.items;

  const handlePickEmoji = (emoji: string) => {
    soundFx.playTap();
    setSelectedEmoji(emoji);
    setCustomInput('');
  };

  const handleSave = () => {
    soundFx.playSend();
    const finalEmoji = customInput.trim() || selectedEmoji;
    onSelectIcon(folder.id, finalEmoji);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-[#FDFCF9] border border-[#DDD4C4] rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200 text-[#1E2521]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-[#E6DFD3] flex items-center justify-between bg-[#FDFCF9]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#F9F7F1] border border-[#DDD4C4] flex items-center justify-center text-[#E87A42]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-[#1E2521]">
                Іконка простору
              </h3>
              <p className="text-[11px] text-[#5F6A60]">
                Оберіть органічний символ для «{folder.name}»
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="p-1.5 rounded-xl hover:bg-[#F1EDE3] text-[#5F6A60] hover:text-[#1E2521] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Live Interactive Avatar Preview Card */}
        <div className="p-4 bg-gradient-to-b from-[#F5EFE4] to-[#FDFCF9] border-b border-[#E8DFD1] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* Interactive avatar preview */}
            <div className="relative group">
              <div
                className="w-13 h-13 rounded-2xl flex items-center justify-center text-2xl shadow-md border-2 transition-transform duration-200 hover:scale-105"
                style={{
                  backgroundColor: folder.color ? `${folder.color}25` : '#F0E8DC',
                  borderColor: folder.color || '#E87A42',
                  boxShadow: folder.color ? `0 4px 14px -2px ${folder.color}40` : undefined,
                }}
              >
                <span className="animate-in zoom-in-75 duration-150">
                  {customInput.trim() || selectedEmoji}
                </span>
              </div>
              <span
                className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center text-[8px]"
                style={{ backgroundColor: folder.color || '#E87A42', color: '#fff' }}
              >
                ✓
              </span>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-[#1E2521] truncate max-w-48">
                  {folder.name}
                </span>
                {folder.vibe && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-white border border-[#DFD6C5] text-[#5E6B62] font-mono">
                    {folder.vibe}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#7A8479] mt-0.5">
                Вибраний символ: <span className="font-bold text-[#1E2521]">{customInput.trim() || selectedEmoji}</span>
              </p>
            </div>
          </div>

          {/* Quick randomizer button */}
          <button
            type="button"
            onClick={() => {
              const allItems = curatedCategories.flatMap((c) => c.items);
              const random = allItems[Math.floor(Math.random() * allItems.length)];
              handlePickEmoji(random);
            }}
            className="px-2.5 py-1.5 bg-white hover:bg-[#F2ECE2] text-[#4A574E] rounded-xl border border-[#DFD6C5] text-xs font-bold transition-all flex items-center gap-1 shadow-2xs hover:scale-102"
            title="Випадковий символ"
          >
            <Wand2 className="w-3.5 h-3.5 text-[#E87A42]" />
            <span className="text-[11px]">Мікс</span>
          </button>
        </div>

        {/* Search & Category Tabs */}
        <div className="px-4 pt-3 space-y-2.5">
          {/* Custom Input / Search */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="w-3.5 h-3.5 text-[#8C988E] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Пошук або власний символ..."
                className="w-full pl-8.5 pr-3 py-1.5 text-xs bg-white border border-[#DFD6C5] rounded-xl text-[#1E2521] placeholder-[#8C988E] focus:outline-none focus:border-[#E87A42] focus:ring-1 focus:ring-[#E87A42]/30"
              />
            </div>
            <div className="flex items-center gap-1 min-w-28">
              <input
                type="text"
                maxLength={4}
                value={customInput}
                onChange={(e) => {
                  setCustomInput(e.target.value);
                  if (e.target.value.trim()) {
                    setSelectedEmoji(e.target.value.trim());
                  }
                }}
                placeholder="Введіть emoji"
                className="w-full px-2.5 py-1.5 text-xs text-center font-bold bg-white border border-[#DFD6C5] rounded-xl text-[#1E2521] placeholder-[#8C988E] focus:outline-none focus:border-[#E87A42]"
              />
            </div>
          </div>

          {/* Categories bar */}
          {!searchQuery.trim() && (
            <div className="flex gap-1 overflow-x-auto no-scrollbar pb-1">
              {curatedCategories.map((cat) => {
                const isSelected = activeCategoryId === cat.id;
                const Icon = cat.icon;
                return (
                  <button
                    key={cat.id}
                    onClick={() => {
                      soundFx.playTap();
                      setActiveCategoryId(cat.id);
                    }}
                    className={`px-2.5 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-[#E6DFD3] text-[#1E2521] shadow-xs'
                        : 'bg-white text-[#5E6B62] hover:bg-[#F2ECE2] border border-[#DFD6C5]'
                    }`}
                  >
                    <Icon className={`w-3 h-3 ${isSelected ? 'text-[#E87A42]' : 'text-[#7A8479]'}`} />
                    <span>{cat.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Curated Emojis Grid */}
        <div className="p-4 overflow-y-auto max-h-56">
          <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
            {displayedItems.map((emoji, idx) => {
              const isSelected = (customInput.trim() || selectedEmoji) === emoji;
              return (
                <button
                  key={`${emoji}-${idx}`}
                  type="button"
                  onClick={() => handlePickEmoji(emoji)}
                  className={`h-10 rounded-xl flex items-center justify-center text-lg transition-all ${
                    isSelected
                      ? 'bg-white ring-2 ring-[#E87A42] scale-110 shadow-sm font-bold'
                      : 'bg-white/70 hover:bg-white hover:scale-105 border border-[#E8DFD1]'
                  }`}
                  style={{
                    backgroundColor: isSelected && folder.color ? `${folder.color}20` : undefined,
                  }}
                >
                  <span className="select-none">{emoji}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3.5 border-t border-[#E6DFD3] bg-[#FDFCF9] flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl text-xs font-bold text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3] transition-colors"
          >
            Скасувати
          </button>

          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 bg-[#E87A42] hover:bg-[#C25925] text-[#F7F5EE] text-xs font-bold rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5 text-[#F7F5EE]" />
            <span>Застосувати іконку</span>
          </button>
        </div>
      </div>
    </div>
  );
};
