import React, { useState } from 'react';
import {
  X,
  Users,
  Radio,
  MessagesSquare,
  Check,
  Sparkles,
  Lock,
  Globe,
  Clock,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';
import { ChatCircle, ChatType, GroupPermissions } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface CreateChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateChat: (newChatData: {
    title: string;
    type: ChatType;
    circle: ChatCircle;
    description: string;
    topic: string;
    avatar: string;
    isPublic?: boolean;
    publicHandle?: string;
    isForum?: boolean;
    historyVisibilityForNewMembers?: 'visible' | 'hidden';
    slowModeSeconds?: number;
    permissions?: GroupPermissions;
  }) => void;
}

const circleOptions: { id: ChatCircle; label: string; desc: string; emoji: string }[] = [
  { id: 'work', label: 'Робота & Проєкти', desc: 'Спринти, задачі, колеги', emoji: '⚡' },
  { id: 'family', label: 'Сім’я & Дім', desc: 'Рідні, дім, спільні плани', emoji: '🏡' },
  { id: 'friends', label: 'Друзі & Кава', desc: 'Зустрічі, прогулянки, дозвілля', emoji: '☕' },
  { id: 'study', label: 'Навчання & Дослідження', desc: 'Курси, лекції, практика', emoji: '🎓' },
  { id: 'communities', label: 'Спільноти & Клуби', desc: 'Урбаністика, дизайн, відкриті кола', emoji: '🌿' },
];

const avatarPresets = [
  'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1497366216548-37526070297c?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1531403009284-440f080d1e12?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=200&auto=format&fit=crop&q=80',
];

export const CreateChatModal: React.FC<CreateChatModalProps> = ({
  isOpen,
  onClose,
  onCreateChat,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [chatType, setChatType] = useState<ChatType>('group');
  const [isForum, setIsForum] = useState(false);
  const [title, setTitle] = useState('');
  const [handle, setHandle] = useState('');
  const [description, setDescription] = useState('');
  const [topic, setTopic] = useState('');
  const [selectedCircle, setSelectedCircle] = useState<ChatCircle>('work');
  const [selectedAvatar, setSelectedAvatar] = useState(avatarPresets[0]);
  const [customAvatarUrl, setCustomAvatarUrl] = useState('');

  // Privacy & Permissions
  const [isPublic, setIsPublic] = useState(false);
  const [historyVisibility, setHistoryVisibility] = useState<'visible' | 'hidden'>('visible');
  const [slowMode, setSlowMode] = useState<number>(0);
  const [permissions, setPermissions] = useState<GroupPermissions>({
    sendMessages: true,
    sendMedia: true,
    sendStickersAndGifs: true,
    sendPolls: true,
    embedLinks: true,
    addMembers: true,
    pinMessages: false,
    changeChatInfo: false,
  });

  if (!isOpen) return null;

  const handleFinish = () => {
    if (!title.trim()) return;

    soundFx.playSend();
    const finalAvatar = customAvatarUrl.trim() || selectedAvatar;
    onCreateChat({
      title: title.trim(),
      type: chatType,
      circle: selectedCircle,
      description: description.trim() || 'Простір спілкування в Aura',
      topic: topic.trim() || 'Актуальні обговорення',
      avatar: finalAvatar,
      isPublic,
      publicHandle: handle.trim() ? (handle.startsWith('@') ? handle : `@${handle}`) : undefined,
      isForum,
      historyVisibilityForNewMembers: historyVisibility,
      slowModeSeconds: slowMode,
      permissions,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-[#121A15] border-t sm:border border-[#2B3C30] rounded-t-3xl sm:rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden select-none animate-in slide-in-from-bottom sm:zoom-in-95 duration-150 flex flex-col max-h-[92dvh] sm:max-h-[88vh] pb-[var(--sab)] sm:pb-0 text-[#E4EDE7]">
        {/* Mobile Pull Indicator */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center bg-[#141C16]">
          <div className="w-12 h-1 bg-[#28392C] rounded-full" />
        </div>

        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-[#1F2B22] flex items-center justify-between bg-[#141C16] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#1A261D] text-[#55C778] border border-[#2B3E31] flex items-center justify-center font-extrabold text-xs">
              {step}/3
            </div>
            <div>
              <h3 className="font-extrabold text-base text-white">
                {step === 1 && 'Тип та формат простору'}
                {step === 2 && 'Брендинг, назва та коло'}
                {step === 3 && 'Дозволи та приватність'}
              </h3>
              <p className="text-xs text-[#8EA093]">Telegram-grade конфігурація для Aura</p>
            </div>
          </div>

          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="p-1.5 text-[#8EA093] hover:text-white hover:bg-[#1E2A21] rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="grid grid-cols-3 gap-1.5 px-5 pt-3 pb-2 bg-[#0E1410] border-b border-[#1F2B22] shrink-0">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all ${
                s <= step ? 'bg-[#55C778]' : 'bg-[#1F2B22]'
              }`}
            />
          ))}
        </div>

        {/* Form Body Scrollable */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* STEP 1: TYPE & FORMAT */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-extrabold text-[#3F4C42] uppercase tracking-wide mb-2">
                  Оберіть тип простору
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    {
                      id: 'group',
                      forum: false,
                      title: 'Звичайна група',
                      desc: 'Ідеально для команди, друзів чи сім’ї. До 200 000 учасників, спільна історія.',
                      icon: Users,
                      badge: 'Стандарт',
                    },
                    {
                      id: 'group',
                      forum: true,
                      title: 'Супергрупа / Форум',
                      desc: 'Розподіл на тематичні гілки (Topics), розширені права та структуровані гілки.',
                      icon: MessagesSquare,
                      badge: 'Теми & Гілки',
                    },
                    {
                      id: 'channel',
                      forum: false,
                      title: 'Канал трансляції',
                      desc: 'Публікації лише від адміністраторів, коментарі, необмежена аудиторія підписників.',
                      icon: Radio,
                      badge: 'Мовлення',
                    },
                    {
                      id: 'dm',
                      forum: false,
                      title: 'Приватне коло',
                      desc: 'Особистий простір для двох або вузького кола з окремим шифруванням.',
                      icon: Lock,
                      badge: 'Приватно',
                    },
                  ].map((item, idx) => {
                    const Icon = item.icon;
                    const isSelected = chatType === item.id && isForum === item.forum;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          soundFx.playTap();
                          setChatType(item.id as any);
                          setIsForum(item.forum);
                        }}
                        className={`p-3.5 rounded-2xl border text-left flex flex-col gap-2 transition-all ${
                          isSelected
                            ? 'bg-white border-[#1F2521] shadow-xs ring-1 ring-[#1F2521]'
                            : 'bg-white/70 hover:bg-white border-[#DFD6C5]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="p-2 rounded-xl bg-[#FAF3E8] text-[#E87A42]">
                            <Icon className="w-5 h-5" />
                          </div>
                          <span className="px-2 py-0.5 bg-[#FAF8F3] text-[#717E75] border border-[#DFD6C5] rounded-md text-[10px] font-bold">
                            {item.badge}
                          </span>
                        </div>

                        <div>
                          <h4 className="font-extrabold text-sm text-[#1F2521]">{item.title}</h4>
                          <p className="text-xs text-[#556157] mt-0.5 leading-relaxed">{item.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: DETAILS & BRANDING */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Title & Handle */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#445047] mb-1">
                    Назва простору *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="напр. Реновація Подолу 2026"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-[#DFD6C5] rounded-xl text-xs focus:outline-none focus:border-[#E87A42]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#445047] mb-1">
                    Публічний тег (Handle)
                  </label>
                  <input
                    type="text"
                    placeholder="@aura_podil_design"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-[#DFD6C5] rounded-xl text-xs focus:outline-none focus:border-[#E87A42]"
                  />
                </div>
              </div>

              {/* Circle Categorization */}
              <div>
                <label className="block text-xs font-bold text-[#445047] mb-1.5">
                  Призначення до кола
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {circleOptions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        soundFx.playTap();
                        setSelectedCircle(c.id);
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        selectedCircle === c.id
                          ? 'bg-[#1F2521] text-white border-[#1F2521] shadow-2xs'
                          : 'bg-white text-[#4A574E] border-[#DFD6C5] hover:bg-[#FAF6EE]'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <span>{c.emoji}</span>
                        <span className="truncate">{c.label}</span>
                      </div>
                      <p className={`text-[10px] mt-0.5 truncate ${selectedCircle === c.id ? 'text-[#D5DDD7]' : 'text-[#717E75]'}`}>
                        {c.desc}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Description & Topic */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-[#445047] mb-1">
                    Опис простору
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Короткий опис цілей та правил бесіди..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-[#DFD6C5] rounded-xl text-xs focus:outline-none focus:border-[#E87A42] resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#445047] mb-1">
                    Актуальна тема / Пін фокусу
                  </label>
                  <input
                    type="text"
                    placeholder="напр. Реліз v2.5 та дизайн-токен палітри"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-[#DFD6C5] rounded-xl text-xs focus:outline-none focus:border-[#E87A42]"
                  />
                </div>
              </div>

              {/* Avatar Selector */}
              <div>
                <label className="block text-xs font-bold text-[#445047] mb-1.5">
                  Аватар простору
                </label>
                <div className="flex items-center gap-3 overflow-x-auto pb-1 no-scrollbar">
                  {avatarPresets.map((imgUrl, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        soundFx.playTap();
                        setSelectedAvatar(imgUrl);
                        setCustomAvatarUrl('');
                      }}
                      className={`relative shrink-0 rounded-2xl overflow-hidden border-2 transition-transform ${
                        selectedAvatar === imgUrl && !customAvatarUrl
                          ? 'border-[#E87A42] scale-105 shadow-xs'
                          : 'border-transparent opacity-75 hover:opacity-100'
                      }`}
                    >
                      <img src={imgUrl} alt="preset" className="w-12 h-12 object-cover" />
                      {selectedAvatar === imgUrl && !customAvatarUrl && (
                        <span className="absolute inset-0 bg-[#E87A42]/20 flex items-center justify-center">
                          <Check className="w-4 h-4 text-white drop-shadow" />
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="mt-2">
                  <input
                    type="url"
                    placeholder="Або вставте пряме посилання на зображення (URL)..."
                    value={customAvatarUrl}
                    onChange={(e) => setCustomAvatarUrl(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-[#DFD6C5] rounded-xl text-xs focus:outline-none focus:border-[#E87A42]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: PRIVACY & PERMISSIONS */}
          {step === 3 && (
            <div className="space-y-4">
              {/* Privacy Type */}
              <div className="p-4 bg-white border border-[#DFD6C5] rounded-3xl space-y-3 shadow-2xs">
                <h4 className="font-extrabold text-sm text-[#1F2521]">Тип доступу</h4>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      soundFx.playTap();
                      setIsPublic(false);
                    }}
                    className={`p-3 rounded-2xl border text-left flex items-start gap-2.5 transition-all ${
                      !isPublic
                        ? 'bg-[#FAF3E8] border-[#E87A42] shadow-2xs'
                        : 'bg-[#FAF8F3] border-[#DFD6C5] opacity-75'
                    }`}
                  >
                    <Lock className="w-4 h-4 text-[#E87A42] shrink-0 mt-0.5" />
                    <div>
                      <span className="font-extrabold text-xs text-[#1F2521]">Приватний простір</span>
                      <p className="text-[11px] text-[#717E75] mt-0.5">Вхід лише за запрошенням або заявкою</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      soundFx.playTap();
                      setIsPublic(true);
                    }}
                    className={`p-3 rounded-2xl border text-left flex items-start gap-2.5 transition-all ${
                      isPublic
                        ? 'bg-[#FAF3E8] border-[#E87A42] shadow-2xs'
                        : 'bg-[#FAF8F3] border-[#DFD6C5] opacity-75'
                    }`}
                  >
                    <Globe className="w-4 h-4 text-[#528A4B] shrink-0 mt-0.5" />
                    <div>
                      <span className="font-extrabold text-xs text-[#1F2521]">Публічний простір</span>
                      <p className="text-[11px] text-[#717E75] mt-0.5">Доступний у глобальному пошуку</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* History Visibility */}
              <div className="p-4 bg-white border border-[#DFD6C5] rounded-3xl space-y-2.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-xs text-[#1F2521]">Історія для нових учасників</span>
                  <div className="flex gap-1.5">
                    {(['visible', 'hidden'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          soundFx.playTap();
                          setHistoryVisibility(mode);
                        }}
                        className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                          historyVisibility === mode
                            ? 'bg-[#1F2521] text-white'
                            : 'bg-[#FAF8F3] border border-[#DFD6C5] text-[#4A574E]'
                        }`}
                      >
                        {mode === 'visible' ? 'Видна' : 'Прихована'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Slow Mode Selector */}
              <div className="p-4 bg-white border border-[#DFD6C5] rounded-3xl space-y-2.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[#E87A42]" />
                    <span className="font-extrabold text-xs text-[#1F2521]">Повільний режим (Slow Mode)</span>
                  </div>
                  <span className="text-xs font-bold text-[#8C461A]">
                    {slowMode === 0 ? 'Вимкнено' : `${slowMode} секунд`}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  {[0, 10, 30, 60].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        soundFx.playTap();
                        setSlowMode(s);
                      }}
                      className={`py-1.5 rounded-xl border text-xs font-bold transition-all ${
                        slowMode === s
                          ? 'bg-[#1F2521] text-white border-[#1F2521]'
                          : 'bg-[#FAF8F3] border-[#DFD6C5] text-[#4A574E]'
                      }`}
                    >
                      {s === 0 ? 'Вимк' : `${s}с`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Granular Permissions */}
              <div className="p-4 bg-white border border-[#DFD6C5] rounded-3xl space-y-2.5 shadow-2xs">
                <h4 className="font-extrabold text-xs text-[#3F4C42] uppercase tracking-wide">
                  Базові права учасників
                </h4>

                <div className="space-y-2">
                  {[
                    { key: 'sendMessages', label: 'Надсилати текстові повідомлення' },
                    { key: 'sendMedia', label: 'Надсилати фото, файли та таблиці' },
                    { key: 'sendPolls', label: 'Створювати опитування та спільні чеки' },
                    { key: 'addMembers', label: 'Запрошувати нових учасників' },
                    { key: 'pinMessages', label: 'Закріплювати повідомлення' },
                  ].map((perm) => {
                    const isChecked = (permissions as any)[perm.key];
                    return (
                      <label
                        key={perm.key}
                        className="flex items-center justify-between p-2 bg-[#FAF8F3] hover:bg-[#F4EEE2] rounded-xl cursor-pointer transition-colors"
                      >
                        <span className="text-xs font-semibold text-[#1F2521]">{perm.label}</span>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) =>
                            setPermissions({
                              ...permissions,
                              [perm.key]: e.target.checked,
                            })
                          }
                          className="w-4 h-4 accent-[#E87A42] rounded"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="px-5 py-3.5 border-t border-[#1F2B22] bg-[#141C16] flex items-center justify-between shrink-0">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => {
                soundFx.playTap();
                setStep((s) => (s - 1) as any);
              }}
              className="px-4 py-2 bg-[#141C16] hover:bg-[#18231B] border border-[#223126] rounded-xl text-xs font-bold text-[#A4B8AB] hover:text-white flex items-center gap-1.5 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Назад</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                soundFx.playTap();
                onClose();
              }}
              className="px-4 py-2 text-xs font-bold text-[#8EA093] hover:text-white"
            >
              Скасувати
            </button>
          )}

          {step < 3 ? (
            <button
              type="button"
              disabled={step === 2 && !title.trim()}
              onClick={() => {
                soundFx.playTap();
                setStep((s) => (s + 1) as any);
              }}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold text-white flex items-center gap-1.5 shadow-sm transition-colors ${
                step === 2 && !title.trim()
                  ? 'bg-gray-700 cursor-not-allowed text-gray-500'
                  : 'bg-[#1C2920] border border-[#2B3E31] text-[#55C778] hover:bg-[#233529]'
              }`}
            >
              <span>Далі</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              className="px-5 py-2.5 bg-[#55C778] hover:bg-[#46AF68] text-[#0C120E] rounded-xl text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              <span>Створити простір</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
