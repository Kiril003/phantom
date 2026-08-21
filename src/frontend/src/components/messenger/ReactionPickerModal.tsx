import React, { useState } from 'react';
import { Search, X, Sparkles, Smile, Zap, Coffee } from 'lucide-react';
import confetti from 'canvas-confetti';
import { soundFx } from '../../utils/messengerSound';

interface ReactionPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
  position?: { x: number; y: number };
}

const emojiCategories = [
  {
    id: 'frequent',
    name: 'Популярні',
    icon: Sparkles,
    emojis: ['❤️', '🔥', '👍', '👏', '🎉', '💡', '🚀', '😍', '☕', '🌿', '🙌', '✨'],
  },
  {
    id: 'reactions',
    name: 'Емоції',
    icon: Smile,
    emojis: ['😊', '😂', '🥳', '😎', '🤔', '🥺', '😭', '🤯', '🤩', '😴', '🫡', '👀'],
  },
  {
    id: 'work',
    name: 'Продукт & Робота',
    icon: Zap,
    emojis: ['🎯', '📌', '📈', '⚡', '💻', '🛠️', '✅', '⏳', '🏆', '💎', '📑', '🤝'],
  },
  {
    id: 'lifestyle',
    name: 'Лайфстайл & Місто',
    icon: Coffee,
    emojis: ['☕', '🌱', '🚲', '🏙️', '🎨', '🎧', '🥑', '🍕', '🍰', '🌅', '🕯️', '🪄'],
  },
];

export const ReactionPickerModal: React.FC<ReactionPickerModalProps> = ({
  isOpen,
  onClose,
  onSelectEmoji,
}) => {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('frequent');

  if (!isOpen) return null;

  const triggerConfetti = () => {
    try {
      confetti({
        particleCount: 35,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#E87A42', '#528A4B', '#F5A623', '#2C4A34'],
      });
    } catch {
      // ignore
    }
  };

  const handlePick = (emoji: string) => {
    soundFx.playSend();
    if (['❤️', '🔥', '🎉', '🚀', '✨'].includes(emoji)) {
      triggerConfetti();
    }
    onSelectEmoji(emoji);
    onClose();
  };

  const allEmojis = emojiCategories.flatMap((c) => c.emojis);
  const filteredEmojis = search.trim()
    ? allEmojis.filter((e) => e.includes(search.trim()))
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-[#121A15] border border-[#2B3C30] rounded-3xl shadow-2xl p-4 overflow-hidden animate-in zoom-in-95 duration-150 text-[#E4EDE7]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with search */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 flex-1 px-3 py-1.5 bg-[#0E1410] border border-[#233127] rounded-2xl">
            <Search className="w-4 h-4 text-[#6B8072]" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Пошук реакції або емодзі..."
              className="w-full text-xs text-white placeholder-[#6B8072] focus:outline-none bg-transparent"
            />
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[#1E2A21] text-[#8EA093] hover:text-white rounded-xl transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Category Tabs */}
        {!search && (
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-2 mb-2 border-b border-[#1F2B22]">
            {emojiCategories.map((cat) => {
              const Icon = cat.icon;
              const isActive = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 ${
                    isActive
                      ? 'bg-[#1C2920] text-[#55C778] border border-[#2B3E31] shadow-sm'
                      : 'hover:bg-[#18231B] text-[#8EA093] hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{cat.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Emoji Grid */}
        <div className="max-h-56 overflow-y-auto pr-1">
          {filteredEmojis ? (
            <div className="grid grid-cols-6 gap-2">
              {filteredEmojis.map((emoji, idx) => (
                <button
                  key={idx}
                  onClick={() => handlePick(emoji)}
                  className="w-10 h-10 flex items-center justify-center text-2xl rounded-2xl hover:bg-[#1A261D] hover:shadow-xs hover:scale-120 active:scale-95 transition-all"
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-6 gap-2">
              {emojiCategories
                .find((c) => c.id === activeCategory)
                ?.emojis.map((emoji, idx) => (
                  <button
                    key={idx}
                    onClick={() => handlePick(emoji)}
                    className="w-10 h-10 flex items-center justify-center text-2xl rounded-2xl hover:bg-[#1A261D] hover:shadow-xs hover:scale-120 active:scale-95 transition-all"
                  >
                    {emoji}
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Quick hint footer */}
        <div className="mt-3 pt-2.5 border-t border-[#1F2B22] flex items-center justify-between text-[11px] text-[#8EA093]">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#55C778]" />
            <span>Натисніть щоб відправити реакцію</span>
          </span>
          <span className="font-mono text-[10px] text-[#55C778]">Aura Reactions</span>
        </div>
      </div>
    </div>
  );
};
