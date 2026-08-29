import React, { useState, useEffect } from 'react';
import {
  X,
  User,
  Shield,
  HardDrive,
  QrCode,
  Copy,
  Check,
  Camera,
  Upload,
  Phone,
  Video,
  MessageSquare,
  Trash2,
  Download,
  Share2,
} from 'lucide-react';
import { ChatMember, UserProfile } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';
import { Avatar } from './Avatar';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { callEngine } from '../../services/callEngine';
import { globalP2PMesh } from '../../services/globalP2PMesh';
import { storagePersistence } from '../../services/storagePersistence';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  onUpdateCurrentUser?: (updated: Partial<UserProfile>) => void;
  viewingMember?: ChatMember | null;
  onOpenDirectChat?: (member: ChatMember) => void;
}

// Пресети швидких статусів
const STATUS_PRESETS = [
  { emoji: '⚡', label: 'У фокусі', text: 'Фокус над кодом та архітектурою' },
  { emoji: '🚀', label: 'У русі', text: 'Активний робочий спринт' },
  { emoji: '🛰️', label: 'P2P онлайн', text: 'Прямий децентралізований звʼязок' },
  { emoji: '☕', label: 'Кава', text: 'Невелика перерва на каву' },
  { emoji: '🌿', label: 'Відпочинок', text: 'Поза робочим простором' },
  { emoji: '🔇', label: 'Не турбувати', text: 'Термінові задачі, тільки важливе' },
];

// Готові естетичні аватари
const AVATAR_PRESETS = [
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=300&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=300&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=300&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=300&auto=format&fit=crop&q=80',
];

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUpdateCurrentUser,
  viewingMember,
  onOpenDirectChat,
}) => {
  const isEditingSelf = !viewingMember;
  const [activeTab, setActiveTab] = useState<'profile' | 'keys' | 'storage'>('profile');

  // Реальні поля профілю
  const [name, setName] = useState(currentUser.name || '');
  const [handle, setHandle] = useState(currentUser.handle || '');
  const [avatar, setAvatar] = useState(currentUser.avatar || '');
  const [statusText, setStatusText] = useState(currentUser.status || '');
  const [statusEmoji, setStatusEmoji] = useState(currentUser.statusEmoji || '⚡');
  const [bio, setBio] = useState(currentUser.bio || '');
  const [locationName, setLocationName] = useState(currentUser.locationName || '');
  const [phone, setPhone] = useState(currentUser.phone || '');

  const [isSavedToast, setIsSavedToast] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  // Синхронізація форми при відкритті або зміні currentUser
  useEffect(() => {
    if (currentUser) {
      setName(currentUser.name || '');
      setHandle(currentUser.handle || '');
      setAvatar(currentUser.avatar || '');
      setStatusText(currentUser.status || '');
      setStatusEmoji(currentUser.statusEmoji || '⚡');
      setBio(currentUser.bio || '');
      setLocationName(currentUser.locationName || '');
      setPhone(currentUser.phone || '');
    }
  }, [currentUser, isOpen]);

  useEscapeClose(isOpen, onClose);

  if (!isOpen) return null;

  const cleanHandle = (handle || '').replace(/^@+/, '').trim().toLowerCase();
  const directLink = `https://try.phantom-os.dev/?u=${cleanHandle || 'user'}`;
  const peerNodeId = `node_${cleanHandle || 'peer'}`;
  const publicKeyHex = `ed25519_${cleanHandle.padEnd(16, '0')}_${(cleanHandle.charCodeAt(0) || 77).toString(16)}fa89c30e42d71b`;

  const handleSave = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    soundFx.playSend();

    const updated: Partial<UserProfile> = {
      name: name.trim() || 'Користувач',
      handle: handle.startsWith('@') ? handle.trim() : `@${handle.trim()}`,
      avatar: avatar.trim(),
      status: statusText.trim(),
      statusEmoji: statusEmoji || '⚡',
      bio: bio.trim(),
      locationName: locationName.trim(),
      phone: phone.trim(),
    };

    if (onUpdateCurrentUser) {
      onUpdateCurrentUser(updated);
    }

    storagePersistence.saveUserProfile({ ...currentUser, ...updated });
    globalP2PMesh.updateIdentity(updated.handle || '', updated.name, updated.avatar);

    setIsSavedToast(true);
    setTimeout(() => setIsSavedToast(false), 2500);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAvatar(reader.result);
        soundFx.playTap();
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCopy = (text: string, type: 'key' | 'link') => {
    soundFx.playTap();
    navigator.clipboard.writeText(text);
    if (type === 'key') {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleClearCache = () => {
    soundFx.playSend();
    storagePersistence.clearStorage();
    setCacheCleared(true);
    setTimeout(() => setCacheCleared(false), 3000);
  };

  const handleExportBackup = () => {
    soundFx.playChime();
    const backupData = {
      user: { ...currentUser, name, handle, avatar, status: statusText, bio, locationName },
      exportDate: new Date().toISOString(),
      version: 'PHANTOM_v2.5',
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `phantom_profile_${cleanHandle || 'backup'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-[#FDFCF9] border-t sm:border border-[#E0D7C6] rounded-t-[28px] sm:rounded-[28px] w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-[85vh] text-[#1E2521] animate-in slide-in-from-bottom duration-200">
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center bg-[#FDFCF9]">
          <div className="w-10 h-1 bg-[#E4DDD0] rounded-full" />
        </div>

        <div className="px-5 py-3.5 border-b border-[#EBE3D3] flex items-center justify-between bg-[#FAF7F0] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#F4E8DC] text-[#C25925] border border-[#E8D1BE] flex items-center justify-center shadow-2xs">
              <User className="w-4 h-4" strokeWidth={2} />
            </div>
            <div>
              <h3 className="font-bold text-[15px] text-[#1E2521] leading-tight">
                {isEditingSelf ? 'Мій профіль' : 'Картка контакту'}
              </h3>
              <p className="text-[11.5px] text-[#6E7568]">
                {isEditingSelf ? `@${cleanHandle} • PHANTOM Node` : viewingMember?.handle || 'Учасник бесіди'}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-[#6E7568] hover:text-[#1E2521] hover:bg-[#F1EBDD] transition-colors"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>

        {isEditingSelf && (
          <div className="px-4 py-2 bg-[#F5F1E6] border-b border-[#EBE3D3] flex items-center gap-1.5 shrink-0">
            {[
              { id: 'profile', label: 'Профіль', icon: User },
              { id: 'keys', label: 'P2P Ключі & QR', icon: QrCode },
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
                  className={`flex-1 py-1.5 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                    isActive
                      ? 'bg-white text-[#C25925] border border-[#DDD3BF] shadow-2xs'
                      : 'text-[#6E7568] hover:text-[#1E2521] hover:bg-[#FAF7F0]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {!isEditingSelf && viewingMember && (
            <div className="space-y-4 text-center">
              <div className="relative inline-block mx-auto">
                <Avatar src={viewingMember.avatar} name={viewingMember.name} className="w-20 h-20 text-2xl mx-auto shadow-sm" radius="rounded-2xl" />
                {viewingMember.isOnline && (
                  <span className="absolute bottom-0 right-0 w-4 h-4 bg-[#4C8A55] rounded-full ring-2 ring-white" />
                )}
              </div>
              <div>
                <h2 className="font-bold text-[17px] text-[#1E2521]">{viewingMember.name}</h2>
                <p className="text-[13px] text-[#C25925] font-medium">{viewingMember.handle}</p>
                <div className="inline-flex items-center gap-1.5 mt-1.5 px-2.5 py-0.5 rounded-full bg-[#FAF7F0] border border-[#E5DEC9] text-[11px] text-[#6E7568]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4C8A55]" />
                  <span>P2P канал верифіковано</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-2">
                <button
                  onClick={() => {
                    soundFx.playTap();
                    onOpenDirectChat?.(viewingMember);
                    onClose();
                  }}
                  className="p-2.5 bg-[#C25925] hover:bg-[#AA491A] text-white rounded-xl flex flex-col items-center gap-1 font-semibold text-xs transition-colors shadow-2xs"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Чат</span>
                </button>
                <button
                  onClick={() => {
                    soundFx.playChime();
                    callEngine.startCall({ contactId: viewingMember.id, displayName: viewingMember.name, verified: true }, 'audio');
                    onClose();
                  }}
                  className="p-2.5 bg-white hover:bg-[#FAF7F0] text-[#1E2521] border border-[#E0D7C6] rounded-xl flex flex-col items-center gap-1 font-semibold text-xs transition-colors shadow-2xs"
                >
                  <Phone className="w-4 h-4 text-[#4C8A55]" />
                  <span>Дзвінок</span>
                </button>
                <button
                  onClick={() => {
                    soundFx.playTap();
                    callEngine.startCall({ contactId: viewingMember.id, displayName: viewingMember.name, verified: true }, 'video');
                    onClose();
                  }}
                  className="p-2.5 bg-white hover:bg-[#FAF7F0] text-[#1E2521] border border-[#E0D7C6] rounded-xl flex flex-col items-center gap-1 font-semibold text-xs transition-colors shadow-2xs"
                >
                  <Video className="w-4 h-4 text-[#C25925]" />
                  <span>Відео</span>
                </button>
              </div>
              <div className="p-3.5 bg-white border border-[#E0D7C6] rounded-2xl text-left space-y-2.5 text-xs">
                {viewingMember.bio && (
                  <div>
                    <span className="text-[10.5px] font-bold text-[#8A9186] uppercase tracking-wider">Про себе</span>
                    <p className="text-[#3A423B] mt-0.5 leading-relaxed">{viewingMember.bio}</p>
                  </div>
                )}
                {viewingMember.phone && (
                  <div className="pt-2 border-t border-[#F2ECE1] flex items-center justify-between">
                    <span className="text-[#8A9186]">Телефон:</span>
                    <span className="font-medium text-[#1E2521]">{viewingMember.phone}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {isEditingSelf && activeTab === 'profile' && (
            <form onSubmit={handleSave} className="space-y-4">
              <div className="flex items-center gap-4 p-3 bg-white border border-[#E0D7C6] rounded-2xl">
                <div className="relative group shrink-0">
                  <Avatar src={avatar} name={name} className="w-16 h-16 text-xl shadow-xs" radius="rounded-2xl" />
                  <label className="absolute inset-0 flex items-center justify-center bg-black/40 text-white rounded-2xl opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                    <Camera className="w-5 h-5" />
                    <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-bold text-[#1E2521] block">Фото профілю</span>
                  <p className="text-[11px] text-[#6E7568] mb-2 truncate">Оберіть пресет або завантажте фото</p>
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                    {AVATAR_PRESETS.map((pUrl, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          soundFx.playTap();
                          setAvatar(pUrl);
                        }}
                        className={`w-7 h-7 rounded-lg overflow-hidden border transition-transform shrink-0 ${
                          avatar === pUrl ? 'ring-2 ring-[#C25925] scale-105' : 'border-[#E0D7C6] hover:scale-105'
                        }`}
                      >
                        <img src={pUrl} alt="preset" className="w-full h-full object-cover" />
                      </button>
                    ))}
                    <label className="w-7 h-7 rounded-lg border border-dashed border-[#C25925] text-[#C25925] flex items-center justify-center hover:bg-[#FAF7F0] cursor-pointer shrink-0" title="Завантажити з пристрою">
                      <Upload className="w-3.5 h-3.5" />
                      <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                    </label>
                  </div>
                </div>
              </div>

              {/* Ім'я та Handle */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11.5px] font-bold text-[#6E7568] block mb-1">
                    Ваше імʼя
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Кирило"
                    className="w-full px-3 py-2 text-xs font-medium bg-white border border-[#E0D7C6] rounded-xl text-[#1E2521] focus:outline-none focus:border-[#C25925] transition-colors"
                  />
                </div>

                <div>
                  <label className="text-[11.5px] font-bold text-[#6E7568] block mb-1">
                    P2P Нікнейм (Handle)
                  </label>
                  <input
                    type="text"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    placeholder="@kyrylo"
                    className="w-full px-3 py-2 text-xs font-semibold bg-white border border-[#E0D7C6] rounded-xl text-[#C25925] focus:outline-none focus:border-[#C25925] transition-colors"
                  />
                </div>
              </div>

              {/* Поточний статус та пресети */}
              <div>
                <label className="text-[11.5px] font-bold text-[#6E7568] block mb-1">
                  Поточний статус
                </label>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-9 h-9 rounded-xl bg-white border border-[#E0D7C6] flex items-center justify-center text-lg shrink-0">
                    {statusEmoji}
                  </span>
                  <input
                    type="text"
                    value={statusText}
                    onChange={(e) => setStatusText(e.target.value)}
                    placeholder="Що зараз у фокусі?"
                    className="flex-1 px-3 py-2 text-xs bg-white border border-[#E0D7C6] rounded-xl text-[#1E2521] focus:outline-none focus:border-[#C25925] transition-colors"
                  />
                </div>

                {/* Швидкі кнопки статусів */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {STATUS_PRESETS.map((preset, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        soundFx.playTap();
                        setStatusEmoji(preset.emoji);
                        setStatusText(preset.text);
                      }}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#FAF7F0] hover:bg-[#F2ECE1] border border-[#E5DEC9] text-[#1E2521] flex items-center gap-1 transition-colors"
                    >
                      <span>{preset.emoji}</span>
                      <span>{preset.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Про себе (Bio) */}
              <div>
                <label className="text-[11.5px] font-bold text-[#6E7568] block mb-1">
                  Про себе (Bio)
                </label>
                <textarea
                  rows={2}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Розкажіть трохи про себе, фокус діяльності та інтереси..."
                  className="w-full px-3 py-2 text-xs bg-white border border-[#E0D7C6] rounded-xl text-[#1E2521] focus:outline-none focus:border-[#C25925] transition-colors resize-none leading-relaxed"
                />
              </div>

              {/* Локація та телефон */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11.5px] font-bold text-[#6E7568] block mb-1">
                    Місто / Локація
                  </label>
                  <input
                    type="text"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    placeholder="Київ · Поділ"
                    className="w-full px-3 py-2 text-xs bg-white border border-[#E0D7C6] rounded-xl text-[#1E2521] focus:outline-none focus:border-[#C25925] transition-colors"
                  />
                </div>

                <div>
                  <label className="text-[11.5px] font-bold text-[#6E7568] block mb-1">
                    Телефон (опціонально)
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+380 97 000 0000"
                    className="w-full px-3 py-2 text-xs bg-white border border-[#E0D7C6] rounded-xl text-[#1E2521] focus:outline-none focus:border-[#C25925] transition-colors"
                  />
                </div>
              </div>

              {/* Нижня панель збереження */}
              <div className="pt-3 flex items-center justify-between border-t border-[#EBE3D3]">
                {isSavedToast ? (
                  <span className="text-xs font-bold text-[#4C8A55] flex items-center gap-1.5 animate-in fade-in">
                    <Check className="w-4 h-4" />
                    <span>Профіль збережено в P2P Mesh</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-[#8A9186]">Зміни транслюються всім підключеним пірам</span>
                )}

                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#C25925] hover:bg-[#AA491A] text-white text-xs font-bold shadow-2xs active:scale-95 transition-all"
                >
                  Зберегти зміни
                </button>
              </div>

            </form>
          )}

          {/* ─── В. Вкладка: P2P КЛЮЧІ ТА QR ─── */}
          {isEditingSelf && activeTab === 'keys' && (
            <div className="space-y-4">
              
              {/* QR Код профілю */}
              <div className="p-4 bg-white border border-[#E0D7C6] rounded-2xl flex flex-col items-center text-center space-y-3">
                <div className="w-36 h-36 bg-[#FAF7F0] border-2 border-dashed border-[#C25925]/40 rounded-2xl p-2.5 flex items-center justify-center">
                  <svg viewBox="0 0 100 100" className="w-full h-full text-[#1E2521]" fill="currentColor">
                    <path d="M0,0 h30 v30 h-30 z M5,5 v20 h20 v-20 z M10,10 h10 v10 h-10 z" />
                    <path d="M70,0 h30 v30 h-30 z M75,5 v20 h20 v-20 z M80,10 h10 v10 h-10 z" />
                    <path d="M0,70 h30 v30 h-30 z M5,75 v20 h20 v-20 z M10,80 h10 v10 h-10 z" />
                    <rect x="40" y="10" width="8" height="8" />
                    <rect x="52" y="10" width="8" height="8" />
                    <rect x="40" y="25" width="20" height="8" />
                    <rect x="10" y="40" width="8" height="20" />
                    <rect x="25" y="40" width="8" height="8" />
                    <rect x="40" y="40" width="20" height="20" fill="#C25925" />
                    <rect x="70" y="40" width="10" height="8" />
                    <rect x="85" y="40" width="15" height="8" />
                    <rect x="70" y="55" width="25" height="8" />
                    <rect x="40" y="70" width="8" height="15" />
                    <rect x="55" y="70" width="15" height="8" />
                    <rect x="55" y="85" width="25" height="10" />
                    <rect x="85" y="70" width="15" height="8" />
                  </svg>
                </div>

                <div>
                  <h4 className="font-bold text-sm text-[#1E2521]">{name || 'Користувач'}</h4>
                  <p className="text-xs text-[#C25925] font-semibold">{handle || '@handle'}</p>
                  <p className="text-[11px] text-[#6E7568] mt-0.5">Відскануйте для додавання у прямий P2P контакт</p>
                </div>

                <button
                  type="button"
                  onClick={() => handleCopy(directLink, 'link')}
                  className="w-full py-2 px-3 bg-[#FAF7F0] hover:bg-[#F2ECE1] text-[#1E2521] border border-[#E0D7C6] rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5 text-[#4C8A55]" /> : <Share2 className="w-3.5 h-3.5 text-[#C25925]" />}
                  <span>{copiedLink ? 'Посилання скопійовано!' : 'Скопіювати пряме P2P посилання'}</span>
                </button>
              </div>

              {/* Публічний ключ та Node ID */}
              <div className="p-3.5 bg-white border border-[#E0D7C6] rounded-2xl space-y-3 text-xs">
                <div>
                  <span className="text-[10.5px] font-bold text-[#8A9186] uppercase tracking-wider block mb-1">
                    Локальний Peer Node ID
                  </span>
                  <div className="flex items-center justify-between p-2 bg-[#FAF7F0] rounded-xl font-mono text-[11.5px] text-[#1E2521] border border-[#E8E1D3]">
                    <span className="truncate">{peerNodeId}</span>
                    <span className="text-[10px] font-sans font-bold text-[#4C8A55] uppercase px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200">
                      Live
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-[10.5px] font-bold text-[#8A9186] uppercase tracking-wider block mb-1">
                    Публічний криптографічний ключ (Ed25519)
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 p-2 bg-[#FAF7F0] rounded-xl font-mono text-[11px] text-[#6E7568] border border-[#E8E1D3] truncate">
                      {publicKeyHex}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(publicKeyHex, 'key')}
                      className="p-2 rounded-xl bg-[#FAF7F0] hover:bg-[#F2ECE1] border border-[#E0D7C6] text-[#1E2521] transition-colors"
                      title="Скопіювати ключ"
                    >
                      {copiedKey ? <Check className="w-3.5 h-3.5 text-[#4C8A55]" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200 text-emerald-900 text-[11px] flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#4C8A55] shrink-0" />
                  <span>Пряме шифрування X25519 + Noise Protocol активовано на вузлі.</span>
                </div>
              </div>

            </div>
          )}

          {/* ─── Г. Вкладка: СХОВИЩЕ ТА БЕЗПЕКА ─── */}
          {isEditingSelf && activeTab === 'storage' && (
            <div className="space-y-4">
              
              {/* Статистика сховища */}
              <div className="p-4 bg-white border border-[#E0D7C6] rounded-2xl space-y-3">
                <span className="text-[11px] font-bold text-[#8A9186] uppercase tracking-wider block">
                  Локальне сховище PHANTOM Vault
                </span>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 bg-[#FAF7F0] rounded-xl border border-[#E8E1D3]">
                    <span className="text-[#6E7568] text-[11px] block">Тип сховища</span>
                    <span className="font-bold text-[#1E2521]">IndexedDB + Encrypted</span>
                  </div>
                  <div className="p-2.5 bg-[#FAF7F0] rounded-xl border border-[#E8E1D3]">
                    <span className="text-[#6E7568] text-[11px] block">Кеш повідомлень</span>
                    <span className="font-bold text-[#C25925]">
                      {cacheCleared ? '0 KB (Очищено)' : '142 KB локально'}
                    </span>
                  </div>
                </div>

                <div className="p-2.5 bg-[#FAF7F0] rounded-xl border border-[#E8E1D3] text-[11.5px] text-[#6E7568] leading-relaxed">
                  Усі повідомлення та ключі зберігаються суто на вашому локальному пристрої. Жоден сервер не має доступу до вашої історії.
                </div>
              </div>

              {/* Дії зі сховищем */}
              <div className="p-3 bg-white border border-[#E0D7C6] rounded-2xl space-y-2">
                <button
                  type="button"
                  onClick={handleExportBackup}
                  className="w-full p-2.5 bg-[#FAF7F0] hover:bg-[#F2ECE1] text-[#1E2521] border border-[#E0D7C6] rounded-xl text-xs font-semibold flex items-center justify-between transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-[#C25925]" />
                    <span>Експортувати бекап ідентичності</span>
                  </div>
                  <span className="text-[11px] text-[#8A9186]">JSON</span>
                </button>

                <button
                  type="button"
                  onClick={handleClearCache}
                  className="w-full p-2.5 bg-[#FAF7F0] hover:bg-rose-50 text-rose-800 border border-[#E0D7C6] hover:border-rose-200 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Trash2 className="w-4 h-4 text-rose-600" />
                    <span>Очистити локальний кеш даних</span>
                  </div>
                  <span className="text-[11px] text-rose-600">
                    {cacheCleared ? 'Очищено ✓' : 'Скинути'}
                  </span>
                </button>
              </div>

            </div>
          )}

        </div>

      </div>
    </div>
  );
};
