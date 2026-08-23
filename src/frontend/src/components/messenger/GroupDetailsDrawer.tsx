import React, { useState } from 'react';
import {
  X,
  Users,
  Image as ImageIcon,
  Link2,
  Pin,
  Bell,
  BellOff,
  UserPlus,
  Shield,
  FileSpreadsheet,
  ExternalLink,
  ChevronRight,
  Search,
  Check,
  Clock,
  Lock,
  Globe,
  Flame,
  UserCheck,
  UserX,
  Copy,
  Plus
} from 'lucide-react';
import { Chat, ChatMember, GroupInviteLink, GroupPermissions, PendingJoinRequest } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';
import { useEscapeClose } from '../../hooks/useEscapeClose';

interface GroupDetailsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  chat: Chat;
  onSelectMember: (member: ChatMember) => void;
  onAddMember: () => void;
  onTogglePinChat: (chatId: string) => void;
  onOpenImageLightbox?: (imgUrl: string, title?: string) => void;
  onUpdateChatSettings?: (chatId: string, updatedSettings: Partial<Chat>) => void;
}

export const GroupDetailsDrawer: React.FC<GroupDetailsDrawerProps> = ({
  isOpen,
  onClose,
  chat,
  onSelectMember,
  onAddMember,
  onTogglePinChat,
  onOpenImageLightbox,
  onUpdateChatSettings,
}) => {
  const [activeTab, setActiveTab] = useState<
    'members' | 'permissions' | 'invites' | 'media' | 'logs'
  >('members');
  const [activeMediaSubTab, setActiveMediaSubTab] = useState<'photos' | 'files' | 'links' | 'tables'>('photos');
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);

  // Local editable permissions & settings state
  const [localPermissions, setLocalPermissions] = useState<GroupPermissions>(
    chat.permissions || {
      sendMessages: true,
      sendMedia: true,
      sendStickersAndGifs: true,
      sendPolls: true,
      embedLinks: true,
      addMembers: true,
      pinMessages: true,
      changeChatInfo: false,
    }
  );
  const [slowMode, setSlowMode] = useState<number>(chat.slowModeSeconds || 0);
  const [autoDelete, setAutoDelete] = useState<number>(chat.autoDeleteSeconds || 0);

  // Pending join requests local state
  const [pendingRequests, setPendingRequests] = useState<PendingJoinRequest[]>(
    chat.pendingJoinRequests || []
  );

  // Посилань-запрошень немає. Раніше тут підставлялося t.me/+<id> — адреса,
  // що належить Telegram і нікуди звідси не веде, зі «використано: 4», яке
  // просто дорівнювало кількості учасників.
  const [inviteLinks, setInviteLinks] = useState<GroupInviteLink[]>(chat.inviteLinks || []);

  // Escape виводить із шару так само, як хрестик.
  useEscapeClose(isOpen, onClose);

  if (!isOpen || !chat) return null;

  const messagesList = chat.messages || [];

  // Extract shared media
  const sharedTables = messagesList
    .filter((m) => m.type === 'table' && m.tableData)
    .map((m) => m.tableData!);

  const sharedImages = messagesList
    .filter((m) => m.type === 'image' && m.imageData)
    .map((m) => m.imageData!);

  const sharedFiles = messagesList
    .filter((m) => m.type === 'file' && m.fileData)
    .map((m) => m.fileData!);

  const chatTitle = chat.title || 'Бесіда';
  const chatAvatar = chat.avatar || 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=200&auto=format&fit=crop&q=80';
  const chatCircle = chat.circle || 'work';
  const members = chat.members || [];

  const filteredMembers = members.filter((m) =>
    m.name.toLowerCase().includes(memberSearchQuery.toLowerCase()) ||
    m.handle.toLowerCase().includes(memberSearchQuery.toLowerCase()) ||
    (m.customTitle && m.customTitle.toLowerCase().includes(memberSearchQuery.toLowerCase()))
  );

  const onlineMembersCount = members.filter((m) => m.isOnline).length;

  const handleTogglePermission = (key: keyof GroupPermissions) => {
    soundFx.playTap();
    const updated = {
      ...localPermissions,
      [key]: !localPermissions[key],
    };
    setLocalPermissions(updated);
    onUpdateChatSettings?.(chat.id, { permissions: updated });
  };

  const handleSetSlowMode = (seconds: number) => {
    soundFx.playTap();
    setSlowMode(seconds);
    onUpdateChatSettings?.(chat.id, { slowModeSeconds: seconds });
  };

  const handleSetAutoDelete = (seconds: number) => {
    soundFx.playTap();
    setAutoDelete(seconds);
    onUpdateChatSettings?.(chat.id, { autoDeleteSeconds: seconds });
  };

  const handleApproveRequest = (reqId: string) => {
    soundFx.playSend();
    const updated = pendingRequests.filter((r) => r.id !== reqId);
    setPendingRequests(updated);
    onUpdateChatSettings?.(chat.id, { pendingJoinRequests: updated });
  };

  const handleRejectRequest = (reqId: string) => {
    soundFx.playTap();
    const updated = pendingRequests.filter((r) => r.id !== reqId);
    setPendingRequests(updated);
    onUpdateChatSettings?.(chat.id, { pendingJoinRequests: updated });
  };

  const handleCopyLink = (link: GroupInviteLink) => {
    soundFx.playTap();
    navigator.clipboard.writeText(link.code);
    setCopiedLinkId(link.id);
    setTimeout(() => setCopiedLinkId(null), 2000);
  };

  return (
    <>
      {/* Mobile Backdrop */}
      <div 
        onClick={() => {
          soundFx.playTap();
          onClose();
        }}
        className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40 sm:hidden animate-in fade-in duration-150"
      />

      <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-[#FDFCF9] border-l border-[#DDD4C4] shadow-2xl flex flex-col select-none animate-in slide-in-from-right duration-200 pb-[var(--sab)] sm:pb-0 text-[#1E2521]">
        {/* 1. Header Bar */}
        <div className="px-4 py-3.5 pt-[calc(var(--sat)+0.75rem)] sm:pt-4 border-b border-[#E6DFD3] flex items-center justify-between bg-[#FDFCF9] shrink-0">
          <div className="flex items-center gap-2">
            <h3 className="font-extrabold text-sm text-[#1E2521]">Керування простором</h3>
            <span className="px-2 py-0.5 bg-[#F9F7F1] text-[#E87A42] text-[10px] font-extrabold rounded-md uppercase border border-[#DDD4C4]">
              {chatCircle}
            </span>
          </div>
          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="p-1.5 text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3] rounded-xl transition-colors"
          >
            <X className="w-5 h-5" strokeWidth={1.75} />
          </button>
        </div>

      {/* 2. Chat Overview Profile Hero */}
      <div className="p-4 border-b border-[#E6DFD3] bg-[#FDFCF9] shrink-0 space-y-3">
        <div className="flex items-start gap-3.5">
          <div className="relative shrink-0">
            <img
              src={chatAvatar}
              alt={chatTitle}
              className="w-16 h-16 rounded-2xl object-cover ring-2 ring-[#E6DFD3] shadow-sm"
            />
            {chat.isOnline !== undefined && (
              <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-[#E87A42] rounded-full ring-2 ring-[#FDFCF9]" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-extrabold text-base text-[#1E2521] truncate">{chatTitle}</h2>
              {chat.isPublic ? (
                <span title="Публічна група"><Globe className="w-3.5 h-3.5 text-[#E87A42] shrink-0" strokeWidth={1.75} /></span>
              ) : (
                <span title="Приватна група"><Lock className="w-3.5 h-3.5 text-[#5F6A60] shrink-0" strokeWidth={1.75} /></span>
              )}
            </div>

            <p className="text-xs text-[#5F6A60] mt-0.5">
              {chat.members ? `${members.length} учасників` : 'Особистий контакт'}
              {onlineMembersCount > 0 && (
                <span className="text-[#E87A42] font-semibold"> · {onlineMembersCount} онлайн</span>
              )}
            </p>

            {chat.publicHandle && (
              <p className="text-xs text-[#E87A42] font-semibold mt-0.5">{chat.publicHandle}</p>
            )}
          </div>
        </div>

        {chat.description && (
          <p className="text-xs text-[#5F6A60] leading-relaxed bg-[#F7F5EE] p-2.5 rounded-xl border border-[#E6DFD3]">
            {chat.description}
          </p>
        )}

        {/* Quick Group Controls */}
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => {
              soundFx.playTap();
              setIsMuted(!isMuted);
            }}
            className={`p-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all ${
              isMuted
                ? 'bg-[#F9F7F1] text-[#E87A42] border-[#DDD4C4]'
                : 'bg-[#FDFCF9] hover:bg-[#F9F7F1] text-[#5F6A60] hover:text-[#1E2521] border-[#E6DFD3]'
            }`}
          >
            {isMuted ? <BellOff className="w-3.5 h-3.5 text-[#E87A42]" strokeWidth={1.75} /> : <Bell className="w-3.5 h-3.5" strokeWidth={1.75} />}
            <span>{isMuted ? 'Без звуку' : 'Звук увімк'}</span>
          </button>

          <button
            onClick={() => {
              soundFx.playTap();
              onTogglePinChat(chat.id);
            }}
            className={`p-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all ${
              chat.pinned
                ? 'bg-[#F9F7F1] text-[#E87A42] border-[#DDD4C4]'
                : 'bg-[#FDFCF9] hover:bg-[#F9F7F1] text-[#5F6A60] hover:text-[#1E2521] border-[#E6DFD3]'
            }`}
          >
            <Pin className={`w-3.5 h-3.5 ${chat.pinned ? 'fill-current text-[#E87A42]' : ''}`} strokeWidth={1.75} />
            <span>{chat.pinned ? 'Закріплено' : 'Закріпити'}</span>
          </button>

          <button
            onClick={() => {
              soundFx.playTap();
              onAddMember();
            }}
            className="p-2 bg-[#E87A42] hover:bg-[#C25925] text-[#F7F5EE] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>Додати</span>
          </button>
        </div>
      </div>

      {/* 3. Navigation Tabs */}
      <div className="px-3 py-1.5 bg-[#F7F5EE] border-b border-[#E6DFD3] flex items-center gap-1 overflow-x-auto no-scrollbar shrink-0">
        {[
          { id: 'members', label: `Учасники (${members.length})`, icon: Users },
          { id: 'permissions', label: 'Дозволи', icon: Shield },
          { id: 'invites', label: `Запрошення ${pendingRequests.length ? `(${pendingRequests.length})` : ''}`, icon: Link2 },
          { id: 'media', label: 'Медіа & Файли', icon: ImageIcon },
          { id: 'logs', label: 'Журнал дій', icon: Clock },
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
              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition-all ${
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

      {/* 4. Tab Body Scrollable */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* TAB 1: MEMBERS */}
        {activeTab === 'members' && (
          <div className="space-y-3">
            {/* Member Search Bar */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#7A8479]" strokeWidth={1.75} />
              <input
                type="text"
                placeholder="Пошук серед учасників..."
                value={memberSearchQuery}
                onChange={(e) => setMemberSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-[#DFD6C5] rounded-xl text-xs focus:outline-none focus:border-[#E87A42]"
              />
            </div>

            {/* Members List */}
            <div className="space-y-1.5">
              {filteredMembers.map((member) => (
                <div
                  key={member.id}
                  onClick={() => {
                    soundFx.playTap();
                    onSelectMember(member);
                  }}
                  className="p-2.5 bg-white hover:bg-[#FDFCF9] border border-[#DFD6C5] rounded-2xl flex items-center justify-between gap-2.5 cursor-pointer transition-colors shadow-2xs group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative shrink-0">
                      <img
                        src={member.avatar}
                        alt={member.name}
                        className="w-9 h-9 rounded-xl object-cover"
                      />
                      {member.isOnline && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-[#528A4B] rounded-full ring-2 ring-white" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-xs text-[#1E2521] truncate">
                          {member.name}
                        </span>
                        {member.role === 'owner' && (
                          <span className="px-1.5 py-0.2 bg-[#FCE7D8] text-[#8C461A] text-[9px] font-extrabold rounded uppercase">
                            Власник
                          </span>
                        )}
                        {member.role === 'admin' && (
                          <span className="px-1.5 py-0.2 bg-[#E3EFE1] text-[#2E6B27] text-[9px] font-extrabold rounded uppercase">
                            Адмін
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#7A8479] truncate">
                        {member.customTitle || member.handle}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 text-[#8C988E] group-hover:text-[#1E2521]">
                    <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Вкладка «Теми & Гілки» жила тут з кнопкою, що показувала alert
            «Створення нової гілки форуму» — форумів у продукті немає, тож і
            вкладки більше немає. */}

        {/* TAB 2: PERMISSIONS & SLOW MODE */}
        {activeTab === 'permissions' && (
          <div className="space-y-4">
            {/* Перемикачі нижче нічого не стережуть: вузол про них не знає,
                і жоден із них не спиняє повідомлення. Кажемо це вголос. */}
            <div className="p-3 bg-[#FDF6EC] border border-[#EBD9BE] rounded-2xl">
              <span className="text-[11px] text-[#8C5A1A] leading-relaxed">
                Ці перемикачі поки нічого не обмежують: вузол про них не знає, а
                надсилання вони не спиняють. Лишаються як чернетка налаштувань.
              </span>
            </div>

            {/* Telegram-style Permissions Matrix */}
            <div className="p-3.5 bg-white border border-[#DFD6C5] rounded-3xl space-y-2.5 shadow-2xs">
              <h4 className="font-extrabold text-xs text-[#7A8479] uppercase tracking-wide">
                Права звичайних учасників
              </h4>

              <div className="space-y-2">
                {[
                  { key: 'sendMessages', label: 'Надсилання повідомлень' },
                  { key: 'sendMedia', label: 'Надсилання фото, аудіо та відео' },
                  { key: 'sendPolls', label: 'Створення опитувань та чеків' },
                  { key: 'embedLinks', label: 'Передперегляд посилань (Embeds)' },
                  { key: 'addMembers', label: 'Запрошення нових учасників' },
                  { key: 'pinMessages', label: 'Закріплення повідомлень' },
                  { key: 'changeChatInfo', label: 'Зміна назви та аватару' },
                ].map((item) => {
                  const isChecked = (localPermissions as any)[item.key];
                  return (
                    <label
                      key={item.key}
                      className="flex items-center justify-between p-2 bg-[#FDFCF9] hover:bg-[#F4EEE2] rounded-xl cursor-pointer transition-colors"
                    >
                      <span className="text-xs font-semibold text-[#1E2521]">{item.label}</span>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleTogglePermission(item.key as any)}
                        className="w-4 h-4 accent-[#E87A42] rounded"
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Slow Mode */}
            <div className="p-3.5 bg-white border border-[#DFD6C5] rounded-3xl space-y-2 shadow-2xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#E87A42]" strokeWidth={1.75} />
                  <span className="font-extrabold text-xs text-[#1E2521]">Повільний режим</span>
                </div>
                <span className="text-xs font-bold text-[#8C461A]">
                  {slowMode === 0 ? 'Вимкнено' : `${slowMode}с`}
                </span>
              </div>
              <p className="text-[11px] text-[#7A8479]">
                Обмежує частоту надсилання повідомлень учасниками
              </p>

              <div className="grid grid-cols-5 gap-1 pt-1">
                {[0, 10, 30, 60, 300].map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSetSlowMode(s)}
                    className={`py-1.5 rounded-xl border text-xs font-bold transition-all ${
                      slowMode === s
                        ? 'bg-[#E6DFD3] text-[#1E2521] border-[#E6DFD3]'
                        : 'bg-[#FDFCF9] border-[#DFD6C5] text-[#7A8479]'
                    }`}
                  >
                    {s === 0 ? 'Вимк' : `${s < 60 ? `${s}с` : `${s / 60}хв`}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Auto Delete */}
            <div className="p-3.5 bg-white border border-[#DFD6C5] rounded-3xl space-y-2 shadow-2xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-[#8C461A]" strokeWidth={1.75} />
                  <span className="font-extrabold text-xs text-[#1E2521]">Автовидалення повідомлень</span>
                </div>
                <span className="text-xs font-bold text-[#8C461A]">
                  {autoDelete === 0 ? 'Вимкнено' : autoDelete === 86400 ? '24 години' : '7 днів'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5 pt-1">
                {[
                  { s: 0, label: 'Вимкнено' },
                  { s: 86400, label: '24 години' },
                  { s: 604800, label: '7 днів' },
                ].map((item) => (
                  <button
                    key={item.s}
                    onClick={() => handleSetAutoDelete(item.s)}
                    className={`py-1.5 rounded-xl border text-xs font-bold transition-all ${
                      autoDelete === item.s
                        ? 'bg-[#E6DFD3] text-[#1E2521] border-[#E6DFD3]'
                        : 'bg-[#FDFCF9] border-[#DFD6C5] text-[#7A8479]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: INVITES & APPROVAL QUEUE */}
        {activeTab === 'invites' && (
          <div className="space-y-4">
            {/* Pending Requests Queue */}
            {pendingRequests.length > 0 && (
              <div className="p-3.5 bg-[#FAF3E8] border border-[#EADBCC] rounded-3xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="font-extrabold text-xs text-[#8C461A] uppercase tracking-wide">
                    Заявки на вступ ({pendingRequests.length})
                  </h4>
                  <span className="text-[10px] text-[#7A8479]">Потрібне схвалення</span>
                </div>

                <div className="space-y-2">
                  {pendingRequests.map((req) => (
                    <div
                      key={req.id}
                      className="p-3 bg-white rounded-2xl border border-[#DFD6C5] space-y-2 shadow-2xs"
                    >
                      <div className="flex items-start gap-2.5">
                        <img src={req.userAvatar} alt={req.userName} className="w-9 h-9 rounded-xl object-cover" />
                        <div className="min-w-0 flex-1">
                          <h5 className="font-bold text-xs text-[#1E2521]">{req.userName}</h5>
                          <p className="text-[11px] text-[#7A8479]">{req.requestedAt}</p>
                          {req.userBio && (
                            <p className="text-xs text-[#7A8479] mt-1 leading-tight">{req.userBio}</p>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#F0EAE0]">
                        <button
                          onClick={() => handleRejectRequest(req.id)}
                          className="py-1.5 bg-[#FDFCF9] hover:bg-[#F3EDE2] text-[#7A8479] rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-colors"
                        >
                          <UserX className="w-3.5 h-3.5" strokeWidth={1.75} />
                          <span>Відхилити</span>
                        </button>
                        <button
                          onClick={() => handleApproveRequest(req.id)}
                          className="py-1.5 bg-[#2E6B27] hover:bg-[#F1EDE3] text-[#1E2521] rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-colors"
                        >
                          <UserCheck className="w-3.5 h-3.5" strokeWidth={1.75} />
                          <span>Схвалити</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Invite Links List */}
            <div className="p-3.5 bg-white border border-[#DFD6C5] rounded-3xl space-y-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <h4 className="font-extrabold text-xs text-[#7A8479] uppercase tracking-wide">
                  Посилання для запрошення
                </h4>
                <button
                  onClick={() => {
                    soundFx.playTap();
                    const newLink: GroupInviteLink = {
                      id: `inv_${Date.now()}`,
                      code: '',
                      label: 'Нове тимчасове посилання',
                      creatorName: 'Кирило Милосердов',
                      createdAt: 'Щойно',
                      usageCount: 0,
                      usageLimit: 10,
                      requireAdminApproval: true,
                    };
                    const updated = [...inviteLinks, newLink];
                    setInviteLinks(updated);
                    onUpdateChatSettings?.(chat.id, { inviteLinks: updated });
                  }}
                  className="px-2 py-1 bg-[#FDFCF9] hover:bg-[#F3EDE2] border border-[#DFD6C5] rounded-lg text-xs font-bold text-[#1E2521] flex items-center gap-1 transition-colors"
                >
                  <Plus className="w-3 h-3" strokeWidth={1.75} />
                  <span>Створити</span>
                </button>
              </div>

              <div className="space-y-2">
                {inviteLinks.map((link) => (
                  <div
                    key={link.id}
                    className="p-3 bg-[#FDFCF9] rounded-2xl border border-[#DFD6C5] flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-[#1E2521] truncate">{link.label}</span>
                        {link.isPrimary && (
                          <span className="px-1.5 py-0.2 bg-[#E3EFE1] text-[#2E6B27] text-[9px] font-bold rounded">
                            Головне
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#E87A42] font-semibold truncate mt-0.5">{link.code}</p>
                      <p className="text-[10px] text-[#7A8479] mt-0.5">
                        Використано: {link.usageCount} {link.usageLimit ? `/ ${link.usageLimit}` : ''}
                      </p>
                    </div>

                    <button
                      onClick={() => handleCopyLink(link)}
                      className="p-2 bg-white hover:bg-[#F3EDE2] border border-[#DFD6C5] rounded-xl text-xs font-bold text-[#1E2521] flex items-center gap-1 shrink-0 transition-colors shadow-2xs"
                    >
                      {copiedLinkId === link.id ? (
                        <Check className="w-3.5 h-3.5 text-green-600" strokeWidth={1.75} />
                      ) : (
                        <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
                      )}
                      <span>{copiedLinkId === link.id ? 'Скопійовано' : 'Копія'}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: MEDIA & FILES */}
        {activeTab === 'media' && (
          <div className="space-y-3">
            {/* Sub-tabs */}
            <div className="grid grid-cols-4 gap-1 p-1 bg-[#F0EAE0] rounded-xl text-xs font-bold text-[#8A9186]">
              {[
                { id: 'photos', label: `Фото (${sharedImages.length})` },
                { id: 'files', label: `Файли (${sharedFiles.length})` },
                { id: 'links', label: `Лінки (${chat.sharedLinks?.length || 0})` },
                { id: 'tables', label: `Таблиці (${sharedTables.length})` },
              ].map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => {
                    soundFx.playTap();
                    setActiveMediaSubTab(sub.id as any);
                  }}
                  className={`py-1.5 rounded-lg text-center transition-all ${
                    activeMediaSubTab === sub.id
                      ? 'bg-white text-[#1E2521] shadow-2xs'
                      : 'hover:text-[#1E2521]'
                  }`}
                >
                  {sub.label}
                </button>
              ))}
            </div>

            {/* Gallery Photos */}
            {activeMediaSubTab === 'photos' && (
              <div className="grid grid-cols-3 gap-2">
                {sharedImages.map((img, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      soundFx.playTap();
                      onOpenImageLightbox?.(img.url, img.caption);
                    }}
                    className="aspect-square rounded-2xl overflow-hidden cursor-pointer group relative border border-[#DFD6C5]"
                  >
                    <img
                      src={img.url}
                      alt="shared"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Files */}
            {activeMediaSubTab === 'files' && (
              <div className="space-y-2">
                {sharedFiles.map((file, i) => (
                  <div
                    key={i}
                    className="p-3 bg-white rounded-2xl border border-[#DFD6C5] flex items-center justify-between shadow-2xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="p-2 bg-[#FAF3E8] text-[#E87A42] rounded-xl font-extrabold text-[10px]">
                        {file.extension.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h5 className="font-bold text-xs text-[#1E2521] truncate">{file.name}</h5>
                        <p className="text-[10px] text-[#7A8479]">{file.size}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Links */}
            {activeMediaSubTab === 'links' && (
              <div className="space-y-2">
                {chat.sharedLinks?.map((link) => (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-3 bg-white rounded-2xl border border-[#DFD6C5] flex items-center justify-between shadow-2xs hover:border-[#E6DFD3] transition-colors group"
                  >
                    <div className="min-w-0 flex-1">
                      <h5 className="font-bold text-xs text-[#1E2521] truncate">{link.title}</h5>
                      <p className="text-[11px] text-[#E87A42] truncate mt-0.5">{link.domain}</p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-[#8C988E] group-hover:text-[#1E2521] shrink-0" strokeWidth={1.75} />
                  </a>
                ))}
              </div>
            )}

            {/* Tables */}
            {activeMediaSubTab === 'tables' && (
              <div className="space-y-2">
                {sharedTables.map((tbl, i) => (
                  <div
                    key={i}
                    className="p-3 bg-white rounded-2xl border border-[#DFD6C5] space-y-1 shadow-2xs"
                  >
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-[#528A4B]" strokeWidth={1.75} />
                      <h5 className="font-bold text-xs text-[#1E2521] truncate">{tbl.title}</h5>
                    </div>
                    <p className="text-[11px] text-[#7A8479]">
                      {tbl.rows?.length || 0} рядків · {tbl.columns?.length || 0} стовпців
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 6: AUDIT LOGS */}
        {activeTab === 'logs' && (
          <div className="space-y-2">
            <h4 className="font-extrabold text-xs text-[#7A8479] uppercase tracking-wide mb-2">
              Нещодавні дії в просторі
            </h4>

            {(chat.auditLogs || [
              {
                id: 'al_1',
                actorName: 'Кирило Милосердов',
                actorAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
                action: 'Створено нове посилання для запрошення',
                detail: '',
                timestamp: '11:45',
              },
              {
                id: 'al_2',
                actorName: 'Олексій Коваленко',
                actorAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
                action: 'Закріплено повідомлення',
                detail: 'Дорожня карта релізу v2.4',
                timestamp: '10:30',
              },
            ]).map((log) => (
              <div
                key={log.id}
                className="p-3 bg-white rounded-2xl border border-[#DFD6C5] flex items-start gap-2.5 shadow-2xs text-xs"
              >
                <img src={log.actorAvatar} alt={log.actorName} className="w-8 h-8 rounded-xl object-cover shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#1E2521]">{log.actorName}</span>
                    <span className="text-[10px] text-[#7A8479]">{log.timestamp}</span>
                  </div>
                  <p className="text-[#7A8479] font-semibold mt-0.5">{log.action}</p>
                  <p className="text-[11px] text-[#7A8479] mt-0.5 truncate">{log.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    </>
  );
};
