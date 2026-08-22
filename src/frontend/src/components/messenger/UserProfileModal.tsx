import React, { useState } from 'react';
import {
  X,
  MessageSquare,
  Phone,
  Video,
  Shield,
  Clock,
  MapPin,
  Briefcase,
  User,
  Palette,
  Home,
  Check,
  Edit3,
  ExternalLink,
  Laptop,
  Smartphone,
  Globe,
  Trash2,
  HardDrive
} from 'lucide-react';
import { ChatMember, PersonaSphere, UserProfile, UserProfilePersona } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  onUpdateCurrentUser?: (updated: Partial<UserProfile>) => void;
  viewingMember?: ChatMember | null;
  onOpenDirectChat?: (member: ChatMember) => void;
}

const sphereMeta: Record<PersonaSphere, { label: string; icon: any; color: string; bg: string; border: string }> = {
  work: { label: 'Робота & Продукт', icon: Briefcase, color: '#E87A42', bg: '#FCE7D8', border: '#F4C8AB' },
  personal: { label: 'Особистий простір', icon: User, color: '#528A4B', bg: '#E3EFE1', border: '#C5DEC1' },
  creative: { label: 'Творчість & Арт', icon: Palette, color: '#8C461A', bg: '#F6E7DE', border: '#E7C8B7' },
  family: { label: 'Родина & Дім', icon: Home, color: '#D99026', bg: '#FEF3D6', border: '#F8DF9E' },
};

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUpdateCurrentUser,
  viewingMember,
  onOpenDirectChat,
}) => {
  const isEditingSelf = !viewingMember;
  const [activeTab, setActiveTab] = useState<'profile' | 'privacy' | 'devices' | 'storage'>('profile');
  const [selectedSphere, setSelectedSphere] = useState<PersonaSphere>(
    currentUser.activePersonaSphere || 'work'
  );
  const [isEditMode, setIsEditMode] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  // Editable persona state
  const activePersona: UserProfilePersona = currentUser.personas?.[selectedSphere] || {
    id: selectedSphere,
    title: sphereMeta[selectedSphere].label,
    name: currentUser.name,
    handle: currentUser.handle,
    statusText: currentUser.status,
    statusEmoji: currentUser.statusEmoji,
    bio: currentUser.bio,
    jobTitle: 'Product Designer',
    company: 'PHANTOM',
    phoneVisibility: 'contacts',
    lastSeenVisibility: 'everyone',
  };

  const [formData, setFormData] = useState<UserProfilePersona>(activePersona);

  // Sync form data when sphere changes
  const handleSelectSphere = (sphere: PersonaSphere) => {
    soundFx.playTap();
    setSelectedSphere(sphere);
    if (currentUser.personas?.[sphere]) {
      setFormData(currentUser.personas[sphere]);
    }
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    soundFx.playSend();
    if (onUpdateCurrentUser && currentUser.personas) {
      const updatedPersonas = {
        ...currentUser.personas,
        [selectedSphere]: {
          ...formData,
        },
      };
      onUpdateCurrentUser({
        personas: updatedPersonas,
        name: formData.name,
        handle: formData.handle,
        status: formData.statusText,
        statusEmoji: formData.statusEmoji,
        bio: formData.bio,
        activePersonaSphere: selectedSphere,
      });
    }
    setIsEditMode(false);
  };

  const handleClearCache = () => {
    soundFx.playSend();
    setCacheCleared(true);
    if (onUpdateCurrentUser && currentUser.storageUsageMb) {
      onUpdateCurrentUser({
        storageUsageMb: {
          ...currentUser.storageUsageMb,
          cache: 0,
        },
      });
    }
    setTimeout(() => setCacheCleared(false), 3000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-[#FDFCF9] border-t sm:border border-[#DDD4C4] rounded-t-3xl sm:rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden select-none animate-in slide-in-from-bottom sm:zoom-in-95 duration-150 flex flex-col max-h-[92dvh] sm:max-h-[88vh] pb-[var(--sab)] sm:pb-0 text-[#1E2521]">
        {/* Mobile Pull Indicator */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center bg-[#FDFCF9]">
          <div className="w-12 h-1 bg-[#F1EDE3] rounded-full" />
        </div>

        {/* 1. Header Bar */}
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-[#E6DFD3] flex items-center justify-between bg-[#FDFCF9] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#F9F7F1] text-[#E87A42] border border-[#DDD4C4] rounded-xl shadow-sm">
              <User className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-[#1E2521]">
                {isEditingSelf ? 'Особистий профіль & Сфери' : 'Картка контакту'}
              </h3>
              <p className="text-xs text-[#5F6A60]">
                {isEditingSelf
                  ? 'Керування ідентичностями, приватністю та сховищем'
                  : viewingMember?.role ? `Роль: ${viewingMember.role.toUpperCase()}` : 'Учасник бесіди'}
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="p-1.5 text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3] rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2. Top Navigation Tabs (For Self) */}
        {isEditingSelf && (
          <div className="px-4 py-2 bg-[#F7F5EE] border-b border-[#E6DFD3] flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
            {[
              { id: 'profile', label: 'Сфери та Профіль', icon: Briefcase },
              { id: 'privacy', label: 'Конфіденційність', icon: Shield },
              { id: 'devices', label: `Пристрої (${currentUser.activeDevices?.length ?? 0})`, icon: Laptop },
              { id: 'storage', label: 'Сховище & Дані', icon: HardDrive },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    soundFx.playTap();
                    setActiveTab(tab.id as any);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-[#F9F7F1] text-[#E87A42] border border-[#DDD4C4] shadow-sm'
                      : 'bg-[#FDFCF9] hover:bg-[#F9F7F1] text-[#5F6A60] hover:text-[#1E2521] border border-[#E6DFD3]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* 3. Main Body Scrollable */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* A. If Viewing another Member */}
          {!isEditingSelf && viewingMember && (
            <div className="space-y-4">
              <div className="text-center space-y-2">
                <div className="relative inline-block">
                  <img
                    src={viewingMember.avatar}
                    alt={viewingMember.name}
                    className="w-24 h-24 rounded-3xl object-cover ring-4 ring-white shadow-md mx-auto"
                  />
                  {viewingMember.isOnline && (
                    <span className="absolute bottom-1 right-1 w-4 h-4 bg-[#528A4B] rounded-full ring-2 ring-white" />
                  )}
                </div>

                <div>
                  <h2 className="font-extrabold text-lg text-[#1E2521]">{viewingMember.name}</h2>
                  <p className="text-xs text-[#E87A42] font-semibold">{viewingMember.handle}</p>
                </div>

                {viewingMember.customTitle && (
                  <span className="inline-block px-3 py-1 bg-[#FCE7D8] text-[#8C461A] text-xs rounded-full font-bold border border-[#F4C8AB]">
                    {viewingMember.customTitle}
                  </span>
                )}
              </div>

              {/* Quick Actions */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => {
                    soundFx.playTap();
                    onOpenDirectChat?.(viewingMember);
                    onClose();
                  }}
                  className="p-2.5 bg-[#E87A42] hover:bg-[#D46B35] text-[#1E2521] rounded-2xl flex flex-col items-center gap-1 shadow-2xs font-bold text-xs transition-colors"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Повідомлення</span>
                </button>

                <button
                  onClick={() => {
                    soundFx.playChime();
                    alert(`Аудіодзвінок для ${viewingMember.name}`);
                  }}
                  className="p-2.5 bg-white hover:bg-[#FAF6EE] text-[#7A8479] border border-[#DFD6C5] rounded-2xl flex flex-col items-center gap-1 font-bold text-xs transition-colors shadow-2xs"
                >
                  <Phone className="w-4 h-4 text-[#528A4B]" />
                  <span>Дзвінок</span>
                </button>

                <button
                  onClick={() => {
                    soundFx.playTap();
                    alert(`Відеозв’язок для ${viewingMember.name}`);
                  }}
                  className="p-2.5 bg-white hover:bg-[#FAF6EE] text-[#7A8479] border border-[#DFD6C5] rounded-2xl flex flex-col items-center gap-1 font-bold text-xs transition-colors shadow-2xs"
                >
                  <Video className="w-4 h-4 text-[#8C461A]" />
                  <span>Відео</span>
                </button>
              </div>

              {/* Bio & Details */}
              <div className="p-4 bg-white border border-[#DFD6C5] rounded-2xl space-y-3 shadow-2xs text-xs">
                {viewingMember.bio && (
                  <div>
                    <span className="text-[10px] font-bold text-[#8C988E] uppercase">Про себе</span>
                    <p className="text-[#7A8479] font-medium leading-relaxed mt-0.5">{viewingMember.bio}</p>
                  </div>
                )}

                {viewingMember.phone && (
                  <div className="pt-2 border-t border-[#F0EAE0] flex items-center justify-between">
                    <span className="text-[#8C988E]">Телефон</span>
                    <span className="font-semibold text-[#1E2521]">{viewingMember.phone}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* B. If Managing Self & TAB: PROFILE */}
          {isEditingSelf && activeTab === 'profile' && (
            <div className="space-y-4">
              {/* Persona Sphere Selector Strip */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-extrabold text-[#7A8479] uppercase tracking-wide">
                    Оберіть активну сферу
                  </label>
                  <span className="text-[11px] text-[#7A8479]">
                    Різні кола бачать відповідну ідентичність
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['work', 'personal', 'creative', 'family'] as PersonaSphere[]).map((sphere) => {
                    const meta = sphereMeta[sphere];
                    const Icon = meta.icon;
                    const isSelected = selectedSphere === sphere;
                    return (
                      <button
                        key={sphere}
                        type="button"
                        onClick={() => handleSelectSphere(sphere)}
                        className={`p-2.5 rounded-2xl border text-left flex flex-col gap-1 transition-all ${
                          isSelected
                            ? 'bg-white shadow-xs'
                            : 'bg-white/60 hover:bg-white border-[#DFD6C5]'
                        }`}
                        style={{
                          borderColor: isSelected ? meta.color : undefined,
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className="p-1 rounded-lg shrink-0"
                            style={{ backgroundColor: meta.bg, color: meta.color }}
                          >
                            <Icon className="w-3.5 h-3.5" />
                          </span>
                          {isSelected && (
                            <span
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: meta.color }}
                            />
                          )}
                        </div>
                        <span className="font-extrabold text-xs text-[#1E2521] mt-0.5">
                          {meta.label.split('&')[0]}
                        </span>
                        <span className="text-[10px] text-[#7A8479] truncate">
                          {currentUser.personas?.[sphere]?.statusEmoji}{' '}
                          {currentUser.personas?.[sphere]?.statusText || 'В мережі'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Active Persona Banner / Overview */}
              {!isEditMode ? (
                <div className="p-4 bg-white border border-[#DFD6C5] rounded-3xl space-y-4 shadow-2xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <img
                          src={currentUser.avatar}
                          alt={formData.name}
                          className="w-16 h-16 rounded-2xl object-cover ring-2 ring-[#1E2521] shadow-xs"
                        />
                        <span className="absolute -bottom-1 -right-1 text-sm bg-white p-0.5 rounded-md shadow-2xs">
                          {formData.statusEmoji}
                        </span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-extrabold text-base text-[#1E2521]">{formData.name}</h4>
                          <span
                            className="px-2 py-0.5 text-[10px] font-bold rounded-md uppercase border"
                            style={{
                              backgroundColor: sphereMeta[selectedSphere].bg,
                              color: sphereMeta[selectedSphere].color,
                              borderColor: sphereMeta[selectedSphere].border,
                            }}
                          >
                            {selectedSphere}
                          </span>
                        </div>
                        <p className="text-xs text-[#E87A42] font-semibold">{formData.handle}</p>
                        {formData.jobTitle && (
                          <p className="text-xs text-[#7A8479] font-medium mt-0.5">
                            {formData.jobTitle} {formData.company ? `· ${formData.company}` : ''}
                          </p>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        soundFx.playTap();
                        setIsEditMode(true);
                      }}
                      className="px-3 py-1.5 bg-[#FAF3E8] hover:bg-[#F3E6D5] text-[#8C461A] border border-[#EADBCC] rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Редагувати</span>
                    </button>
                  </div>

                  {/* Status & Bio */}
                  <div className="p-3 bg-[#FDFCF9] rounded-2xl border border-[#EBE2D3] space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs text-[#7A8479]">
                      <span className="font-bold">Поточний статус:</span>
                      <span>«{formData.statusEmoji} {formData.statusText}»</span>
                    </div>
                    <p className="text-xs text-[#525F56] leading-relaxed">{formData.bio}</p>
                  </div>

                  {/* Schedule & Location */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-[#525F56]">
                    {formData.workHours && (
                      <div className="flex items-center gap-2 p-2.5 bg-[#F6F4ED] rounded-xl">
                        <Clock className="w-4 h-4 text-[#E87A42]" />
                        <span>Години: {formData.workHours}</span>
                      </div>
                    )}
                    {formData.locationName && (
                      <div className="flex items-center gap-2 p-2.5 bg-[#F6F4ED] rounded-xl">
                        <MapPin className="w-4 h-4 text-[#528A4B]" />
                        <span>{formData.locationName}</span>
                      </div>
                    )}
                  </div>

                  {/* Tags */}
                  {formData.tags && formData.tags.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[10px] font-bold text-[#8C988E] uppercase tracking-wider">
                        Фокус-теги
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {formData.tags.map((tag, i) => (
                          <span
                            key={i}
                            className="px-2.5 py-1 bg-white border border-[#DFD6C5] text-[#7A8479] rounded-lg text-xs font-semibold"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Links */}
                  {formData.links && formData.links.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[10px] font-bold text-[#8C988E] uppercase tracking-wider">
                        Покликання та портфоліо
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {formData.links.map((link, i) => (
                          <a
                            key={i}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 bg-[#FDFCF9] hover:bg-[#F3EDE2] border border-[#DFD6C5] rounded-xl flex items-center justify-between text-xs text-[#1E2521] font-semibold transition-colors group"
                          >
                            <span className="truncate">{link.title}</span>
                            <ExternalLink className="w-3.5 h-3.5 text-[#8C988E] group-hover:text-[#E87A42]" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Edit Form Mode */
                <form onSubmit={handleSaveProfile} className="p-4 bg-white border border-[#DFD6C5] rounded-3xl space-y-4 shadow-2xs">
                  <div className="flex items-center justify-between pb-2 border-b border-[#E8DFD1]">
                    <h4 className="font-extrabold text-sm text-[#1E2521]">
                      Редагування сфери «{sphereMeta[selectedSphere].label}»
                    </h4>
                    <button
                      type="button"
                      onClick={() => setIsEditMode(false)}
                      className="text-xs text-[#7A8479] hover:text-[#1E2521]"
                    >
                      Скасувати
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-[#8A9186] mb-1">
                        Ім’я у цій сфері
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full px-3 py-2 bg-[#FDFCF9] border border-[#DFD6C5] rounded-xl text-xs focus:outline-none focus:border-[#E87A42]"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-[#8A9186] mb-1">
                        Нікнейм / Handle
                      </label>
                      <input
                        type="text"
                        value={formData.handle}
                        onChange={(e) => setFormData({ ...formData, handle: e.target.value })}
                        className="w-full px-3 py-2 bg-[#FDFCF9] border border-[#DFD6C5] rounded-xl text-xs focus:outline-none focus:border-[#E87A42]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-1">
                      <label className="block text-[11px] font-bold text-[#8A9186] mb-1">Емодзі</label>
                      <input
                        type="text"
                        value={formData.statusEmoji}
                        onChange={(e) => setFormData({ ...formData, statusEmoji: e.target.value })}
                        className="w-full px-3 py-2 bg-[#FDFCF9] border border-[#DFD6C5] rounded-xl text-xs text-center focus:outline-none focus:border-[#E87A42]"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[11px] font-bold text-[#8A9186] mb-1">Текст статусу</label>
                      <input
                        type="text"
                        value={formData.statusText}
                        onChange={(e) => setFormData({ ...formData, statusText: e.target.value })}
                        className="w-full px-3 py-2 bg-[#FDFCF9] border border-[#DFD6C5] rounded-xl text-xs focus:outline-none focus:border-[#E87A42]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-[#8A9186] mb-1">
                        Посада / Роль
                      </label>
                      <input
                        type="text"
                        value={formData.jobTitle || ''}
                        onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })}
                        className="w-full px-3 py-2 bg-[#FDFCF9] border border-[#DFD6C5] rounded-xl text-xs focus:outline-none focus:border-[#E87A42]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-[#8A9186] mb-1">
                        Компанія / Простір
                      </label>
                      <input
                        type="text"
                        value={formData.company || ''}
                        onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                        className="w-full px-3 py-2 bg-[#FDFCF9] border border-[#DFD6C5] rounded-xl text-xs focus:outline-none focus:border-[#E87A42]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[#8A9186] mb-1">
                      Опис (Bio)
                    </label>
                    <textarea
                      rows={3}
                      value={formData.bio}
                      onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                      className="w-full px-3 py-2 bg-[#FDFCF9] border border-[#DFD6C5] rounded-xl text-xs focus:outline-none focus:border-[#E87A42] resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-[#8A9186] mb-1">
                        Графік доступності
                      </label>
                      <input
                        type="text"
                        placeholder="напр. 10:00 – 19:00 (Пн-Пт)"
                        value={formData.workHours || ''}
                        onChange={(e) => setFormData({ ...formData, workHours: e.target.value })}
                        className="w-full px-3 py-2 bg-[#FDFCF9] border border-[#DFD6C5] rounded-xl text-xs focus:outline-none focus:border-[#E87A42]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-[#8A9186] mb-1">
                        Локація
                      </label>
                      <input
                        type="text"
                        placeholder="Київ · Поділ"
                        value={formData.locationName || ''}
                        onChange={(e) => setFormData({ ...formData, locationName: e.target.value })}
                        className="w-full px-3 py-2 bg-[#FDFCF9] border border-[#DFD6C5] rounded-xl text-xs focus:outline-none focus:border-[#E87A42]"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E8DFD1]">
                    <button
                      type="button"
                      onClick={() => setIsEditMode(false)}
                      className="px-4 py-2 bg-white border border-[#DFD6C5] rounded-xl text-xs font-bold text-[#7A8479] hover:bg-[#FDFCF9]"
                    >
                      Скасувати
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-[#E6DFD3] text-[#1E2521] rounded-xl text-xs font-bold shadow-2xs hover:bg-black flex items-center gap-1.5"
                    >
                      <Check className="w-4 h-4" />
                      <span>Зберегти сферу</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* C. TAB: PRIVACY */}
          {isEditingSelf && activeTab === 'privacy' && (
            <div className="space-y-4">
              <div className="p-4 bg-white border border-[#DFD6C5] rounded-3xl space-y-4 shadow-2xs">
                <h4 className="font-extrabold text-sm text-[#1E2521]">Видимість даних для сфери «{sphereMeta[selectedSphere].label}»</h4>

                {/* Phone visibility */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-[#8A9186]">
                    Хто бачить мій номер телефону у цій сфері?
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'everyone', label: 'Усі користувачі' },
                      { id: 'contacts', label: 'Мої контакти' },
                      { id: 'nobody', label: 'Ніхто (Приховано)' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          soundFx.playTap();
                          setFormData({ ...formData, phoneVisibility: opt.id as any });
                        }}
                        className={`p-2.5 rounded-xl border text-xs font-semibold transition-all ${
                          formData.phoneVisibility === opt.id
                            ? 'bg-[#E6DFD3] text-[#1E2521] border-[#E6DFD3] shadow-2xs'
                            : 'bg-[#FDFCF9] border-[#DFD6C5] text-[#7A8479] hover:bg-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Last Seen visibility */}
                <div className="space-y-2 pt-2 border-t border-[#F0EAE0]">
                  <label className="block text-xs font-bold text-[#8A9186]">
                    Час останнього візиту (Last Seen)
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'everyone', label: 'Усі' },
                      { id: 'contacts', label: 'Контакти' },
                      { id: 'nobody', label: 'Ніхто' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          soundFx.playTap();
                          setFormData({ ...formData, lastSeenVisibility: opt.id as any });
                        }}
                        className={`p-2.5 rounded-xl border text-xs font-semibold transition-all ${
                          formData.lastSeenVisibility === opt.id
                            ? 'bg-[#E6DFD3] text-[#1E2521] border-[#E6DFD3] shadow-2xs'
                            : 'bg-[#FDFCF9] border-[#DFD6C5] text-[#7A8479] hover:bg-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* D. TAB: DEVICES */}
          {isEditingSelf && activeTab === 'devices' && (
            <div className="space-y-3">
              {!currentUser.activeDevices?.length && (
                <div className="p-4 bg-white border border-[#DFD6C5] rounded-2xl text-center">
                  <Laptop className="w-7 h-7 text-[#A8B6AB] mx-auto mb-2 opacity-50" />
                  <p className="text-xs font-bold text-[#1E2521]">Немає даних про активні сеанси</p>
                  <p className="text-[11px] text-[#7A8479] mt-1">
                    Реєстр сеансів ще не ведеться, тому список порожній.
                  </p>
                </div>
              )}

              {currentUser.activeDevices?.map((device) => (
                <div
                  key={device.id}
                  className="p-3.5 bg-white border border-[#DFD6C5] rounded-2xl flex items-center justify-between shadow-2xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-[#F0EAE0] text-[#7A8479] rounded-xl">
                      {device.type === 'desktop' ? (
                        <Laptop className="w-5 h-5" />
                      ) : device.type === 'mobile' ? (
                        <Smartphone className="w-5 h-5" />
                      ) : (
                        <Globe className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h5 className="font-bold text-xs text-[#1E2521]">{device.name}</h5>
                        {device.isCurrent && (
                          <span className="px-2 py-0.5 bg-[#E3EFE1] text-[#2E6B27] rounded-md text-[10px] font-bold">
                            Цей пристрій
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#7A8479]">
                        {device.location} · IP: {device.ipAddress}
                      </p>
                      <p className="text-[10px] text-[#8C461A] font-medium mt-0.5">
                        {device.lastActive}
                      </p>
                    </div>
                  </div>

                  {/* Завершення сеансу не реалізоване — кнопка вимкнена, щоб не рапортувати про неіснуючу дію. */}
                  {!device.isCurrent && (
                    <button
                      disabled
                      title="Завершення сеансу ще не реалізоване"
                      className="px-2.5 py-1.5 text-xs text-[#A8B0A9] rounded-xl font-bold cursor-not-allowed"
                    >
                      Завершити
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* E. TAB: STORAGE */}
          {isEditingSelf && activeTab === 'storage' && (
            <div className="space-y-4">
              <div className="p-4 bg-white border border-[#DFD6C5] rounded-3xl space-y-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-extrabold text-sm text-[#1E2521]">Використання сховища</h4>
                    <p className="text-xs text-[#7A8479]">Загалом: 1.18 ГБ на локальному пристрої</p>
                  </div>
                  <button
                    onClick={handleClearCache}
                    className="px-3 py-1.5 bg-[#FCE7D8] hover:bg-[#F9D2BA] text-[#8C461A] rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                  >
                    {cacheCleared ? <Check className="w-3.5 h-3.5 text-green-700" /> : <Trash2 className="w-3.5 h-3.5" />}
                    <span>{cacheCleared ? 'Кеш очищено!' : 'Очистити кеш (85 MB)'}</span>
                  </button>
                </div>

                {/* Storage Meter Visual Bar */}
                <div className="h-3 rounded-full bg-[#EFE9DC] overflow-hidden flex">
                  <div style={{ width: '54%' }} className="bg-[#E87A42]" title="Медіа 640 MB" />
                  <div style={{ width: '26%' }} className="bg-[#528A4B]" title="Файли 310 MB" />
                  <div style={{ width: '12%' }} className="bg-[#8C461A]" title="Голосові 145 MB" />
                  <div style={{ width: '8%' }} className="bg-[#D99026]" title="Кеш 85 MB" />
                </div>

                {/* Legend */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  {[
                    { label: 'Медіа & Фото', size: '640 MB', color: '#E87A42' },
                    { label: 'Документи & Файли', size: '310 MB', color: '#528A4B' },
                    { label: 'Голосові', size: '145 MB', color: '#8C461A' },
                    { label: 'Кеш застосунку', size: '85 MB', color: '#D99026' },
                  ].map((item, i) => (
                    <div key={i} className="p-2 bg-[#FDFCF9] rounded-xl border border-[#DFD6C5]">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="text-[11px] font-bold text-[#1E2521] truncate">{item.label}</span>
                      </div>
                      <p className="text-xs font-semibold text-[#525F56] mt-0.5">{item.size}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
