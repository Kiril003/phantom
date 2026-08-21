import React, { useState, useEffect } from 'react';
import {
  Trash2,
  X,
  Check,
  SlidersHorizontal,
  Briefcase,
  Home,
  Coffee,
  GraduationCap,
  Compass,
  Bookmark,
  Smile,
  Wand2
} from 'lucide-react';
import { Chat, ChatCircle, SmartFolder } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface SmartFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  folderToEdit?: SmartFolder | null;
  chats: Chat[];
  onSaveFolder: (folder: SmartFolder) => void;
  onDeleteFolder?: (folderId: string) => void;
}

interface EmojiCategory {
  id: string;
  name: string;
  icon: string;
  emojis: string[];
}

const emojiCategories: EmojiCategory[] = [
  {
    id: 'product',
    name: 'Продукт & Код',
    icon: '⚡',
    emojis: ['🚀', '⚡', '💻', '🛠️', '🤖', '🧪', '📐', '🔬', '💡', '📊', '📈', '🗂️', '🎯', '⚙️', '🖥️', '📱'],
  },
  {
    id: 'creative',
    name: 'Творчість & Арт',
    icon: '🎨',
    emojis: ['🎨', '🎭', '🎬', '📸', '🎧', '🎙️', '✍️', '🔮', '🪐', '🕹️', '🧩', '🎲', '✨', '🌈', '🎪', '🖌️'],
  },
  {
    id: 'cozy',
    name: 'Затишок & Стиль',
    icon: '🌿',
    emojis: ['🌿', '☕', '🏡', '🌻', '🧘', '🍵', '🍞', '🪴', '🏕️', '🚲', '🕯️', '🌙', '🌊', '🐱', '🐶', '🥑'],
  },
  {
    id: 'business',
    name: 'Бізнес & Задачі',
    icon: '💼',
    emojis: ['💼', '💎', '🏆', '🔑', '🛡️', '🔒', '⏳', '📌', '🧭', '🏛️', '📑', '👑', '🔥', '🪙', '💶', '⚖️'],
  },
  {
    id: 'social',
    name: 'Люди & Родина',
    icon: '💬',
    emojis: ['💬', '🫂', '💌', '🎉', '❤️', '✈️', '🌴', '📚', '🎓', '🔖', '💛', '🌟', '🔔', '🎁', '🏖️', '🍿'],
  },
];

const colorOptions = [
  { id: 'terracotta', hex: '#E87A42', label: 'Теракота' },
  { id: 'sage', hex: '#528A4B', label: 'Шавлія' },
  { id: 'amber', hex: '#D97706', label: 'Бурштин' },
  { id: 'chestnut', hex: '#8C461A', label: 'Каштан' },
  { id: 'cobalt', hex: '#2563EB', label: 'Кобальт' },
  { id: 'purple', hex: '#7C3AED', label: 'Лаванда' },
  { id: 'rose', hex: '#E11D48', label: 'Корал' },
  { id: 'charcoal', hex: '#1F2521', label: 'Графіт' },
];

const workspaceTemplates = [
  {
    name: 'Project Alpha',
    emoji: '🚀',
    color: '#E87A42',
    vibe: '⚡ Deep Work & Design Sprint',
  },
  {
    name: 'Urban Specialty',
    emoji: '☕',
    color: '#528A4B',
    vibe: '☕ Urban Chill & Specialty',
  },
  {
    name: 'Creative Lab',
    emoji: '🎨',
    color: '#7C3AED',
    vibe: '✨ UI/UX Concept & Visuals',
  },
  {
    name: 'Родинний Затишок',
    emoji: '🏡',
    color: '#D97706',
    vibe: '💛 Теплий дім & плани',
  },
  {
    name: 'Private Vault',
    emoji: '🔒',
    color: '#1F2521',
    vibe: '🛡️ Конфіденційно & Особисте',
  },
];

const circlesConfig: { id: ChatCircle; label: string; icon: any }[] = [
  { id: 'work', label: 'Робота ⚡', icon: Briefcase },
  { id: 'family', label: 'Сім’я 🏡', icon: Home },
  { id: 'friends', label: 'Друзі ☕', icon: Coffee },
  { id: 'study', label: 'Навчання 🎓', icon: GraduationCap },
  { id: 'communities', label: 'Спільноти 🌿', icon: Compass },
  { id: 'saved', label: 'Збережене 🔖', icon: Bookmark },
];

export const SmartFolderModal: React.FC<SmartFolderModalProps> = ({
  isOpen,
  onClose,
  folderToEdit,
  chats,
  onSaveFolder,
  onDeleteFolder,
}) => {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🚀');
  const [customEmojiInput, setCustomEmojiInput] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('product');
  const [color, setColor] = useState('#E87A42');
  const [vibe, setVibe] = useState('');
  const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);
  const [includedCircles, setIncludedCircles] = useState<ChatCircle[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [searchChatQuery, setSearchChatQuery] = useState('');

  useEffect(() => {
    if (folderToEdit) {
      setName(folderToEdit.name);
      setEmoji(folderToEdit.emoji);
      setCustomEmojiInput('');
      setColor(folderToEdit.color || '#E87A42');
      setVibe(folderToEdit.vibe || '');
      setSelectedChatIds(folderToEdit.chatIds || []);
      setIncludedCircles(folderToEdit.filterRules?.includeCircles || []);
      setUnreadOnly(folderToEdit.filterRules?.unreadOnly || false);
    } else {
      setName('');
      setEmoji('🚀');
      setCustomEmojiInput('');
      setColor('#E87A42');
      setVibe('');
      setSelectedChatIds([]);
      setIncludedCircles([]);
      setUnreadOnly(false);
    }
  }, [folderToEdit, isOpen]);

  if (!isOpen) return null;

  const toggleChatSelection = (chatId: string) => {
    soundFx.playTap();
    setSelectedChatIds((prev) =>
      prev.includes(chatId) ? prev.filter((id) => id !== chatId) : [...prev, chatId]
    );
  };

  const toggleCircleRule = (circleId: ChatCircle) => {
    soundFx.playTap();
    setIncludedCircles((prev) =>
      prev.includes(circleId) ? prev.filter((c) => c !== circleId) : [...prev, circleId]
    );
  };

  const handleApplyTemplate = (tpl: (typeof workspaceTemplates)[0]) => {
    soundFx.playSend();
    setName(tpl.name);
    setEmoji(tpl.emoji);
    setColor(tpl.color);
    setVibe(tpl.vibe);
  };

  const handleCustomEmojiChange = (val: string) => {
    setCustomEmojiInput(val);
    if (val.trim()) {
      // Pick the last emoji or character typed
      const chars = Array.from(val.trim());
      const chosen = chars[chars.length - 1];
      if (chosen) {
        setEmoji(chosen);
      }
    }
  };

  const handleSave = () => {
    if (!name.trim()) return;

    soundFx.playSend();
    const folderData: SmartFolder = {
      id: folderToEdit?.id || `folder_${Date.now()}`,
      name: name.trim(),
      emoji: emoji || '📁',
      color,
      vibe: vibe.trim() || undefined,
      isMuted: folderToEdit?.isMuted || false,
      chatIds: selectedChatIds,
      isBuiltIn: folderToEdit?.isBuiltIn || false,
      filterRules: {
        includeCircles: includedCircles.length > 0 ? includedCircles : undefined,
        unreadOnly: unreadOnly || undefined,
      },
    };

    onSaveFolder(folderData);
    onClose();
  };

  const filteredChats = chats.filter((c) =>
    c.title.toLowerCase().includes(searchChatQuery.toLowerCase())
  );

  const currentCategoryObj = emojiCategories.find((cat) => cat.id === activeCategory) || emojiCategories[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150">
      <div
        className="bg-[#121A15] border border-[#2B3C30] w-full max-w-lg rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-[#E4EDE7]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 border-b border-[#1F2B22] bg-[#141C16] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center text-white text-xl shadow-sm transition-all"
              style={{ backgroundColor: color }}
            >
              {emoji}
            </div>
            <div>
              <h2 className="text-base font-extrabold text-white flex items-center gap-2">
                {folderToEdit ? 'Налаштування простору' : 'Створити Smart Workspace'}
              </h2>
              <p className="text-xs text-[#8EA093]">
                Призначте кастомну іконку, колір та правила сортування
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="p-2 hover:bg-[#1E2A21] text-[#8EA093] hover:text-white rounded-full transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Quick Preset Templates (1-click setup) */}
          {!folderToEdit && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-extrabold uppercase tracking-wider text-[#717E75] flex items-center gap-1">
                  <Wand2 className="w-3 h-3 text-[#E87A42]" />
                  Швидкі шаблони воркспейсів
                </label>
                <span className="text-[10px] text-[#8C988E]">1 клік для заповнення</span>
              </div>
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
                {workspaceTemplates.map((tpl) => (
                  <button
                    key={tpl.name}
                    type="button"
                    onClick={() => handleApplyTemplate(tpl)}
                    className="px-2.5 py-1.5 bg-white hover:bg-[#FAF5ED] border border-[#DFD6C5] rounded-xl text-xs font-semibold text-[#1F2521] flex items-center gap-1.5 shrink-0 transition-colors shadow-2xs"
                  >
                    <span>{tpl.emoji}</span>
                    <span>{tpl.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Name & Live Preview Banner */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold uppercase tracking-wider text-[#717E75]">
              Назва простору
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="наприклад, Project Alpha, Private Interests..."
                className="flex-1 px-3.5 py-2.5 bg-white border border-[#DFD6C5] rounded-2xl text-sm font-semibold text-[#1F2521] placeholder-[#8C988E] focus:outline-none focus:border-[#E87A42] transition-colors shadow-2xs"
                autoFocus
              />
              <div
                className="px-3.5 py-2.5 rounded-2xl flex items-center gap-1.5 text-xs font-bold text-white shadow-2xs shrink-0 select-none transition-all"
                style={{ backgroundColor: color }}
              >
                <span className="text-sm">{emoji}</span>
                <span className="max-w-28 truncate">{name || 'Попередній перегляд'}</span>
              </div>
            </div>
          </div>

          {/* Folder Vibe / Focus Note */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold uppercase tracking-wider text-[#717E75]">
                Folder Vibe / Статус простору
              </label>
              <span className="text-[10px] text-[#8C988E]">Короткий фокус чи слоган</span>
            </div>
            <input
              type="text"
              value={vibe}
              onChange={(e) => setVibe(e.target.value)}
              placeholder="наприклад, ⚡ Deep Work & Sprint, ☕ Urban Chill..."
              className="w-full px-3.5 py-2 bg-white border border-[#DFD6C5] rounded-2xl text-xs font-medium text-[#1F2521] placeholder-[#8C988E] focus:outline-none focus:border-[#E87A42] transition-colors shadow-2xs"
            />
          </div>

          {/* CUSTOM ICON & EMOJI PICKER (Expanded Categories + Custom Input) */}
          <div className="space-y-2.5 p-3.5 bg-white border border-[#DFD6C5] rounded-2xl">
            <div className="flex items-center justify-between">
              <label className="text-xs font-extrabold text-[#1F2521] flex items-center gap-1.5">
                <Smile className="w-3.5 h-3.5 text-[#E87A42]" />
                Іконка або Emoji папки
              </label>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-[#717E75]">Обрано:</span>
                <span className="text-sm font-bold bg-[#FAF8F3] px-2 py-0.5 rounded-lg border border-[#DFD6C5]">
                  {emoji}
                </span>
              </div>
            </div>

            {/* Custom Emoji / Symbol text input */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={customEmojiInput}
                  onChange={(e) => handleCustomEmojiChange(e.target.value)}
                  placeholder="Введіть будь-яке власне emoji або символ (напр. 🥑, 🛡️, 🪐)..."
                  className="w-full pl-3 pr-8 py-1.5 bg-[#FAF8F3] border border-[#DFD6C5] rounded-xl text-xs text-[#1F2521] placeholder-[#8C988E] focus:outline-none focus:border-[#E87A42]"
                />
                {customEmojiInput && (
                  <button
                    onClick={() => setCustomEmojiInput('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <span className="text-[10px] text-[#717E75] shrink-0 font-medium">або виберіть нижче 👇</span>
            </div>

            {/* Category Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar border-b border-[#F2ECE2] pb-1.5 pt-0.5">
              {emojiCategories.map((cat) => {
                const isActive = activeCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      soundFx.playTap();
                      setActiveCategory(cat.id);
                    }}
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all flex items-center gap-1 whitespace-nowrap ${
                      isActive
                        ? 'bg-[#1F2521] text-white shadow-2xs'
                        : 'bg-[#FAF8F3] text-[#5E6B62] hover:bg-[#F2ECE2] border border-[#DFD6C5]'
                    }`}
                  >
                    <span>{cat.icon}</span>
                    <span>{cat.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Emoji Grid for Selected Category */}
            <div className="grid grid-cols-8 gap-1.5 p-1 bg-[#FAF8F3] border border-[#EAE0D0] rounded-xl max-h-32 overflow-y-auto">
              {currentCategoryObj.emojis.map((em) => {
                const isSelected = emoji === em;
                return (
                  <button
                    key={em}
                    type="button"
                    onClick={() => {
                      soundFx.playTap();
                      setEmoji(em);
                      setCustomEmojiInput('');
                    }}
                    className={`h-9 text-base rounded-xl transition-all flex items-center justify-center ${
                      isSelected
                        ? 'bg-[#1F2521] text-white scale-110 shadow-xs ring-2 ring-[#E87A42]'
                        : 'hover:bg-white text-[#1F2521]'
                    }`}
                    title={em}
                  >
                    {em}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Color Accent Selection */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold uppercase tracking-wider text-[#717E75]">
              Колірний акцент простору
            </label>
            <div className="flex items-center gap-2 flex-wrap p-2 bg-white border border-[#DFD6C5] rounded-2xl">
              {colorOptions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    soundFx.playTap();
                    setColor(c.hex);
                  }}
                  className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                    color === c.hex ? 'ring-2 ring-offset-2 ring-[#1F2521] scale-110' : 'hover:opacity-90'
                  }`}
                  style={{ backgroundColor: c.hex }}
                  title={c.label}
                >
                  {color === c.hex && <Check className="w-4 h-4 text-white" />}
                </button>
              ))}
            </div>
          </div>

          {/* Smart Automation Rules */}
          <div className="space-y-2 p-3.5 bg-white border border-[#DFD6C5] rounded-2xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-[#1F2521] flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#E87A42]" />
                Автоматичні правила (Smart Inclusion)
              </span>
              <span className="text-[10px] text-[#717E75]">Опціонально</span>
            </div>
            <p className="text-[11px] text-[#717E75]">
              Автоматично включати в цю папку бесіди з вибраних кіл спілкування:
            </p>

            <div className="grid grid-cols-2 gap-1.5 pt-1">
              {circlesConfig.map((circle) => {
                const isChecked = includedCircles.includes(circle.id);
                return (
                  <button
                    key={circle.id}
                    type="button"
                    onClick={() => toggleCircleRule(circle.id)}
                    className={`p-2 rounded-xl text-left text-xs font-semibold flex items-center justify-between transition-colors border ${
                      isChecked
                        ? 'bg-[#F2EDE4] border-[#1F2521] text-[#1F2521]'
                        : 'bg-white border-[#DFD6C5] text-[#717E75] hover:bg-[#FAF8F3]'
                    }`}
                  >
                    <span>{circle.label}</span>
                    <div
                      className={`w-4 h-4 rounded-md flex items-center justify-center border text-[10px] ${
                        isChecked ? 'bg-[#1F2521] text-white border-[#1F2521]' : 'border-[#DFD6C5]'
                      }`}
                    >
                      {isChecked && <Check className="w-3 h-3" />}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="pt-2 border-t border-[#F2EDE4] flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-[#1F2521]">Тільки непрочитані</div>
                <div className="text-[10px] text-[#717E75]">
                  Відображати бесіди лише коли є нові повідомлення
                </div>
              </div>
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
                className="w-4 h-4 accent-[#E87A42] rounded cursor-pointer"
              />
            </div>
          </div>

          {/* Included Chats Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-[#717E75]">
                Включені бесіди ({selectedChatIds.length})
              </label>
              <span className="text-[11px] text-[#8C461A] font-medium">
                Також можна перетягувати (drag & drop) у списку!
              </span>
            </div>

            <input
              type="text"
              value={searchChatQuery}
              onChange={(e) => setSearchChatQuery(e.target.value)}
              placeholder="Пошук бесіди для додавання..."
              className="w-full px-3 py-1.5 bg-white border border-[#DFD6C5] rounded-xl text-xs text-[#1F2521] placeholder-[#8C988E] focus:outline-none focus:border-[#E87A42]"
            />

            <div className="max-h-48 overflow-y-auto space-y-1 p-1 bg-white border border-[#DFD6C5] rounded-2xl divide-y divide-[#F2EDE4]">
              {filteredChats.map((chat) => {
                const isSelected = selectedChatIds.includes(chat.id);
                return (
                  <div
                    key={chat.id}
                    onClick={() => toggleChatSelection(chat.id)}
                    className={`p-2 rounded-xl flex items-center justify-between cursor-pointer transition-colors ${
                      isSelected ? 'bg-[#F9F4EB]' : 'hover:bg-[#FAF8F3]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={chat.avatar}
                        alt={chat.title}
                        className="w-8 h-8 rounded-xl object-cover"
                      />
                      <div className="min-w-0">
                        <div className="font-extrabold text-xs text-[#1F2521] truncate">
                          {chat.title}
                        </div>
                        <div className="text-[10px] text-[#717E75] truncate">
                          {chat.customVibe || chat.description || `Коло: ${chat.circle}`}
                        </div>
                      </div>
                    </div>

                    <div
                      className={`w-5 h-5 rounded-lg flex items-center justify-center border transition-colors shrink-0 ${
                        isSelected
                          ? 'bg-[#E87A42] border-[#E87A42] text-white'
                          : 'border-[#DFD6C5] bg-white'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-[#1F2B22] bg-[#141C16] flex items-center justify-between">
          {folderToEdit && !folderToEdit.isBuiltIn && onDeleteFolder ? (
            <button
              type="button"
              onClick={() => {
                soundFx.playTap();
                if (confirm(`Ви дійсно бажаєте видалити папку «${folderToEdit.name}»? (Чати залишаться в системі)`)) {
                  onDeleteFolder(folderToEdit.id);
                  onClose();
                }
              }}
              className="px-3 py-2 text-xs font-bold text-red-400 hover:bg-red-950/40 rounded-xl transition-colors flex items-center gap-1.5 border border-red-900/50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Видалити папку</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                soundFx.playTap();
                onClose();
              }}
              className="px-4 py-2 bg-[#141C16] hover:bg-[#18231B] text-[#8EA093] hover:text-white border border-[#223126] rounded-xl text-xs font-bold transition-colors"
            >
              Скасувати
            </button>

            <button
              type="button"
              disabled={!name.trim()}
              onClick={handleSave}
              className="px-4 py-2 bg-[#55C778] hover:bg-[#46AF68] disabled:opacity-50 text-[#0C120E] rounded-xl text-xs font-bold transition-colors shadow-sm flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{folderToEdit ? 'Зберегти зміни' : 'Створити Workspace'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
