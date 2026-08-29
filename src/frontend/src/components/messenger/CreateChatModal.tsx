import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClipboardPaste,
  QrCode,
  UserPlus,
  Users,
  X,
  Briefcase,
  User as UserIcon,
  Heart,
  BookOpen,
  Globe,
  Layers,
} from 'lucide-react';
import { QrScanner } from './QrScanner';
import { InviteCard } from './InviteCard';
import { messengerApi } from '../../services/messengerApi';
import { soundFx } from '../../utils/messengerSound';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { useMessengerStore } from '../../stores/messengerStore';
import type { ChatCircle } from '../../types/messenger';
import {
  InviteTooNew,
  inviteInClipboard,
  nodeIdOf,
  parseInvite,
} from '../../utils/messengerInvite';
import type { ParsedInvite } from '../../utils/messengerInvite';

interface CreateChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConversationReady: (conversationId: string) => void;
}

const PRESET_GROUP_AVATARS = [
  'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=200&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=200&auto=format&fit=crop&q=80',
];

export const CreateChatModal: React.FC<CreateChatModalProps> = ({
  isOpen,
  onClose,
  onConversationReady,
}) => {
  const [activeTab, setActiveTab] = useState<'group' | 'dm' | 'invite' | 'network'>('group');

  // Group creation form state
  const [groupTitle, setGroupTitle] = useState('');
  const [groupCircle, setGroupCircle] = useState<ChatCircle>('work');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupAvatar, setGroupAvatar] = useState(PRESET_GROUP_AVATARS[0]);

  // DM creation form state & Directory users
  const [dmName, setDmName] = useState('');
  const [dmCircle, setDmCircle] = useState<ChatCircle>('friends');
  const [directoryUsers, setDirectoryUsers] = useState<
    Array<{
      id: string;
      username: string;
      display_name: string;
      role: string;
      avatar?: string;
      is_online: boolean;
    }>
  >([]);
  const [loadingDirectory, setLoadingDirectory] = useState(false);

  // Network & Direct Address connection state
  const [directAddress, setDirectAddress] = useState('');
  const [directPeerName, setDirectPeerName] = useState('');

  // P2P Invite state
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedInvite | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [address, setAddress] = useState('');
  const [clipboardInvite, setClipboardInvite] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  useEscapeClose(isOpen, onClose);

  const reset = useCallback(() => {
    setGroupTitle('');
    setGroupCircle('work');
    setGroupDescription('');
    setDmName('');
    setDmCircle('friends');
    setDirectAddress('');
    setDirectPeerName('');
    setText('');
    setParsed(null);
    setNodeId(null);
    setName('');
    setNameTouched(false);
    setAddress('');
    setClipboardInvite(null);
    setInviting(false);
    setScanning(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    setLoadingDirectory(true);
    messengerApi
      .listDirectoryUsers()
      .then((users) => {
        if (alive) setDirectoryUsers(users);
      })
      .catch(() => {
        // Fallback default users if offline
        if (alive) {
          setDirectoryUsers([
            { id: 'u_kiril', username: 'kiril', display_name: 'Kiril (Lead)', role: 'ROOT', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80', is_online: true },
            { id: 'u_alex', username: 'alex', display_name: 'Alex (Backend)', role: 'OPERATOR', avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80', is_online: true },
            { id: 'u_kyrylo', username: 'kyrylo', display_name: 'Kyrylo', role: 'OPERATOR', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80', is_online: true },
            { id: 'u_maryna', username: 'maryna', display_name: 'Maryna (QA)', role: 'OPERATOR', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80', is_online: true },
            { id: 'u_phantom', username: 'phantom', display_name: 'PHANTOM Autonomous Node', role: 'ROOT', avatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=80', is_online: true },
          ]);
        }
      })
      .finally(() => {
        if (alive) setLoadingDirectory(false);
      });

    void inviteInClipboard().then((found) => {
      if (alive && found) setClipboardInvite(found);
    });
    return () => {
      alive = false;
    };
  }, [isOpen]);

  useEffect(() => {
    const raw = text.trim();
    if (!raw) {
      setParsed(null);
      setNodeId(null);
      return;
    }
    let found: ParsedInvite | null = null;
    try {
      found = parseInvite(raw);
      setError(null);
    } catch (err) {
      setParsed(null);
      setNodeId(null);
      setError(
        err instanceof InviteTooNew
          ? 'Це запрошення новішої версії — оновіть вузол, інакше ключ не прочитати.'
          : 'Це не схоже на запрошення.',
      );
      return;
    }
    setParsed(found);
    if (!found) {
      setNodeId(null);
      return;
    }
    if (found.kind === 'invite') {
      if (found.address) setAddress(found.address);
      if (!nameTouched) setName(found.name);
    }
    const compact = found.kind === 'bundle' ? null : found.compact;
    if (!compact) {
      setNodeId(null);
      return;
    }
    let alive = true;
    void nodeIdOf(compact).then((id) => {
      if (alive) setNodeId(id);
    });
    return () => {
      alive = false;
    };
  }, [text, nameTouched]);

  if (!isOpen) return null;

  const close = () => {
    soundFx.playTap();
    reset();
    onClose();
  };

  const pasteFromClipboard = () => {
    if (!clipboardInvite) return;
    soundFx.playTap();
    setText(clipboardInvite);
    setClipboardInvite(null);
  };

  // Group submit handler
  const handleCreateGroup = async () => {
    if (!groupTitle.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      soundFx.playSend();
      const newChatId = await useMessengerStore
        .getState()
        .createGroup(groupTitle.trim(), groupCircle, groupAvatar, groupDescription.trim());
      reset();
      onConversationReady(newChatId);
    } catch (err: any) {
      setError(err?.message || 'Не вдалося створити групу');
    } finally {
      setBusy(false);
    }
  };

  // DM submit handler (by username or directory user)
  const handleStartChatWithUser = async (username: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      soundFx.playSend();
      const conv = await messengerApi.startChatByUsername(username, dmCircle);
      await useMessengerStore.getState().refreshConversations();
      reset();
      onConversationReady(conv.id);
    } catch {
      // Local fallback for standalone web / offline mode
      const clean = username.replace(/^@/, '');
      const existing = useMessengerStore
        .getState()
        .chats.find(
          (c) =>
            c.handle?.toLowerCase() === `@${clean.toLowerCase()}` ||
            c.id === `chat_dm_${clean.toLowerCase()}` ||
            c.title.toLowerCase() === clean.toLowerCase(),
        );

      if (existing) {
        reset();
        onConversationReady(existing.id);
        return;
      }

      const newChatId = `chat_dm_${clean.toLowerCase()}`;
      const newChat = {
        id: newChatId,
        title: clean.charAt(0).toUpperCase() + clean.slice(1),
        handle: `@${clean.toLowerCase()}`,
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
        type: 'dm' as const,
        circle: dmCircle,
        isOnline: true,
        peerNodeId: `node_${clean.toLowerCase()}`,
        unreadCount: 0,
        messages: [],
      };

      useMessengerStore.setState((s) => ({
        chats: [newChat, ...s.chats],
        activeChatId: newChatId,
      }));

      reset();
      onConversationReady(newChatId);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateDM = async () => {
    const raw = dmName.trim();
    if (!raw || busy) return;
    const cleanUsername = raw.replace(/^@/, '');
    await handleStartChatWithUser(cleanUsername);
  };

  // P2P Invite submit handler
  const openConversation = async () => {
    if (!parsed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const display = name.trim() || (nodeId ? `Вузол ${nodeId.slice(0, 8)}` : 'Без імені');
      const key =
        parsed.kind === 'bundle' ? { bundle: parsed.bundle } : { compact: parsed.compact };
      const contact = await messengerApi.addContact(display, key, address.trim());
      const existing = (await messengerApi.listConversations()).find(
        (c) => c.contact_id === contact.id,
      );
      let conversation =
        existing ??
        (await messengerApi.createConversation({
          title: contact.display_name,
          kind: 'dm',
          circle: 'all',
          contact_id: contact.id,
        }));
      if (name.trim() && conversation.title !== name.trim()) {
        try {
          conversation = await messengerApi.renameConversation(conversation.id, name.trim());
        } catch {
          /* ignore */
        }
      }
      soundFx.playSend();
      reset();
      onConversationReady(conversation.id);
    } catch {
      setError('Вузол не прийняв ключ — підпис не збігається або вузол не відповів.');
    } finally {
      setBusy(false);
    }
  };

  // Direct Address & Cloud Mesh connection handler
  const handleConnectDirectAddress = async () => {
    const rawAddr = directAddress.trim();
    if (!rawAddr || busy) return;
    setBusy(true);
    setError(null);
    try {
      soundFx.playSend();
      const displayName = directPeerName.trim() || `Вузол (${rawAddr.replace(/^https?:\/\//, '')})`;
      
      // Створюємо прямий контакт та розмову
      const contact = await messengerApi.addContact(
        displayName,
        { compact: `peer:${Date.now()}:${rawAddr}` },
        rawAddr,
      ).catch(() => null);

      const conversation = await messengerApi.createConversation({
        title: displayName,
        kind: 'dm',
        circle: 'work',
        contact_id: contact?.id,
      });

      reset();
      onConversationReady(conversation.id);
    } catch (err: any) {
      setError(err?.message || 'Не вдалося встановити звʼязок із вузлом');
    } finally {
      setBusy(false);
    }
  };

  const claimedName = parsed?.kind === 'invite' ? parsed.name.trim() : '';
  const nodeLabel = nodeId ? `Вузол ${nodeId.slice(0, 8)}…` : 'Вузол назветься, щойно відкриємо розмову';

  return (
    <div className="fixed inset-0 z-50 phantom-scrim flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-[#FDFCF9] border-t sm:border border-[#DDD4C4] rounded-t-3xl sm:rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden select-none animate-in slide-in-from-bottom sm:zoom-in-95 duration-150 flex flex-col max-h-[92dvh] sm:max-h-[88vh] pb-[var(--sab)] sm:pb-0 text-[#1E2521]">
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center bg-[#FDFCF9]">
          <div className="w-12 h-1 bg-[#F1EDE3] rounded-full" />
        </div>

        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E6DFD3] flex items-center justify-between bg-[#FDFCF9] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-[#F9F7F1] text-[#E87A42] border border-[#DDD4C4] flex items-center justify-center shrink-0">
              {activeTab === 'group' ? (
                <Users className="w-5 h-5" strokeWidth={1.75} />
              ) : activeTab === 'dm' ? (
                <UserIcon className="w-5 h-5" strokeWidth={1.75} />
              ) : activeTab === 'network' ? (
                <Globe className="w-5 h-5" strokeWidth={1.75} />
              ) : (
                <UserPlus className="w-5 h-5" strokeWidth={1.75} />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="font-extrabold text-base text-[#1E2521] leading-tight">
                {activeTab === 'group'
                  ? 'Створити групу / Простір'
                  : activeTab === 'dm'
                  ? 'Новий діалог'
                  : activeTab === 'network'
                  ? 'Мережа & Хмари (Oracle / R2 / Supabase)'
                  : 'Впустити за запрошенням'}
              </h3>
              <p className="text-[12px] text-[#5F6A60] leading-tight mt-0.5">
                {activeTab === 'group'
                  ? 'Спільний простір із Canvas та віджетами'
                  : activeTab === 'dm'
                  ? 'Пряме спілкування з колегою чи контактом'
                  : activeTab === 'network'
                  ? 'Пряме підключення за IP/доменом та хмарні бекапи'
                  : 'Введіть рядок запрошення або скануйте QR'}
              </p>
            </div>
          </div>

          <button
            onClick={close}
            className="p-1.5 text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3] rounded-xl transition-colors shrink-0"
            aria-label="Закрити"
          >
            <X className="w-5 h-5" strokeWidth={1.75} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center px-4 pt-3 pb-1 gap-1 border-b border-[#E6DFD3] bg-[#FAF8F4]">
          <button
            onClick={() => {
              soundFx.playTap();
              setActiveTab('group');
            }}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'group'
                ? 'bg-[#E87A42] text-white shadow-sm'
                : 'text-[#6E7568] hover:text-[#1E2521] hover:bg-[#F1EBDD]'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Група</span>
          </button>
          <button
            onClick={() => {
              soundFx.playTap();
              setActiveTab('dm');
            }}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'dm'
                ? 'bg-[#E87A42] text-white shadow-sm'
                : 'text-[#6E7568] hover:text-[#1E2521] hover:bg-[#F1EBDD]'
            }`}
          >
            <UserIcon className="w-3.5 h-3.5" />
            <span>Діалог</span>
          </button>
          <button
            onClick={() => {
              soundFx.playTap();
              setActiveTab('network');
            }}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'network'
                ? 'bg-[#E87A42] text-white shadow-sm'
                : 'text-[#6E7568] hover:text-[#1E2521] hover:bg-[#F1EBDD]'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Мережа</span>
          </button>
          <button
            onClick={() => {
              soundFx.playTap();
              setActiveTab('invite');
            }}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'invite'
                ? 'bg-[#E87A42] text-white shadow-sm'
                : 'text-[#6E7568] hover:text-[#1E2521] hover:bg-[#F1EBDD]'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>P2P Ключ</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* TAB 1: GROUP CREATION */}
          {activeTab === 'group' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div>
                <label className="block text-xs font-extrabold text-[#1E2521] mb-1.5">
                  Назва групи / простору <span className="text-[#E87A42]">*</span>
                </label>
                <input
                  type="text"
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                  placeholder="напр. Розробка Work OS або Спринт 14"
                  autoFocus
                  className="w-full px-3.5 py-2.5 text-sm rounded-2xl border border-[#DDD4C4] bg-white focus:outline-none focus:border-[#E87A42] font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-extrabold text-[#1E2521] mb-1.5">
                  Коло довіри (Категорія)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'work', label: 'Робота (Work)', icon: Briefcase, color: 'text-amber-600' },
                    { id: 'communities', label: 'Спільнота', icon: Globe, color: 'text-blue-600' },
                    { id: 'friends', label: 'Друзі / Команда', icon: UserIcon, color: 'text-emerald-600' },
                    { id: 'family', label: 'Сімʼя / Приватне', icon: Heart, color: 'text-rose-600' },
                  ].map(({ id, label, icon: Icon, color }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setGroupCircle(id as ChatCircle)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                        groupCircle === id
                          ? 'border-[#E87A42] bg-[#FDF6EC] text-[#8C5A1A] shadow-sm'
                          : 'border-[#E6DFD3] bg-white text-[#5F6A60] hover:bg-[#F9F7F1]'
                      }`}
                    >
                      <Icon className={`w-3.5 h-3.5 ${color}`} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-extrabold text-[#1E2521] mb-1.5">
                  Опис простору (необов'язково)
                </label>
                <input
                  type="text"
                  value={groupDescription}
                  onChange={(e) => setGroupDescription(e.target.value)}
                  placeholder="Короткий фокус обговорення та цілі..."
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#DDD4C4] bg-white focus:outline-none focus:border-[#E87A42]"
                />
              </div>

              <div>
                <label className="block text-xs font-extrabold text-[#1E2521] mb-1.5">
                  Аватар простору
                </label>
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {PRESET_GROUP_AVATARS.map((url, idx) => (
                    <img
                      key={idx}
                      src={url}
                      alt="Avatar preset"
                      onClick={() => setGroupAvatar(url)}
                      className={`w-10 h-10 rounded-2xl object-cover cursor-pointer border-2 transition-transform hover:scale-105 ${
                        groupAvatar === url ? 'border-[#E87A42] shadow-md scale-105' : 'border-transparent opacity-70'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="p-3 bg-[#FDF6EC] rounded-2xl border border-[#EBD9BE] flex items-center gap-2 text-xs text-[#8C5A1A]">
                <Layers className="w-4 h-4 text-[#C25925] shrink-0" />
                <span>Група автоматично отримує <b>Живий Canvas</b> та підтримку <b>мікро-віджетів</b>.</span>
              </div>

              <button
                type="button"
                onClick={handleCreateGroup}
                disabled={!groupTitle.trim() || busy}
                className="w-full py-3 rounded-2xl bg-[#E87A42] hover:bg-[#C25925] disabled:bg-[#EADFD0] disabled:text-[#A8A99C] text-white text-sm font-extrabold transition-all shadow-md active:scale-98"
              >
                {busy ? 'Створюю групу…' : '✨ Створити групу'}
              </button>
            </div>
          )}

          {/* TAB 2: DIRECT MESSAGE & DIRECTORY USERS */}
          {activeTab === 'dm' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div>
                <label className="block text-xs font-extrabold text-[#1E2521] mb-1.5">
                  Пошук за нікнеймом (@username) або імʼям <span className="text-[#E87A42]">*</span>
                </label>
                <input
                  type="text"
                  value={dmName}
                  onChange={(e) => setDmName(e.target.value)}
                  placeholder="напр. @kiril, @alex, @kyrylo, @maryna..."
                  autoFocus
                  className="w-full px-3.5 py-2.5 text-sm rounded-2xl border border-[#DDD4C4] bg-white focus:outline-none focus:border-[#E87A42] font-semibold"
                />
              </div>

              {/* Список зареєстрованих користувачів */}
              <div className="space-y-1.5">
                <span className="text-[11.5px] font-extrabold text-[#6E7568] uppercase tracking-wider block">
                  Користувачі вузла ({directoryUsers.length})
                </span>

                {loadingDirectory ? (
                  <div className="p-4 text-center text-xs text-[#5F6A60]">Завантаження списку…</div>
                ) : (
                  <div className="max-h-[180px] overflow-y-auto space-y-1.5 pr-1">
                    {directoryUsers
                      .filter((u) => {
                        if (!dmName.trim()) return true;
                        const q = dmName.trim().toLowerCase().replace(/^@/, '');
                        return (
                          u.username.toLowerCase().includes(q) ||
                          u.display_name.toLowerCase().includes(q)
                        );
                      })
                      .map((u) => (
                        <div
                          key={u.id}
                          onClick={() => handleStartChatWithUser(u.username)}
                          className="p-2.5 rounded-2xl bg-white border border-[#E6DFD3] hover:border-[#E87A42] hover:bg-[#FAF8F4] flex items-center justify-between cursor-pointer transition-all group"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="relative shrink-0">
                              <img
                                src={u.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${u.username}`}
                                alt={u.username}
                                className="w-8 h-8 rounded-full object-cover border border-[#DDD4C4]"
                              />
                              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-[#4C8A55] rounded-full ring-2 ring-white" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-[13px] text-[#1E2521] group-hover:text-[#E87A42] transition-colors truncate">
                                  {u.display_name}
                                </span>
                                <span className="text-[11px] font-mono text-[#8C5A1A] bg-[#FDF6EC] px-1.5 py-0.2 rounded-md">
                                  @{u.username}
                                </span>
                              </div>
                              <span className="text-[11px] text-[#5F6A60] block truncate">
                                {u.role === 'ROOT' ? '👑 Власник вузла' : '👤 Оператор вузла'}
                              </span>
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={busy}
                            className="px-3 py-1 rounded-xl bg-[#FAF6EE] group-hover:bg-[#E87A42] text-[#8C5A1A] group-hover:text-white text-xs font-bold transition-all shrink-0"
                          >
                            Почати чат
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-extrabold text-[#1E2521] mb-1.5">
                  Категорія контакту
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'work', label: 'Робочий', icon: Briefcase },
                    { id: 'friends', label: 'Друзі / Команда', icon: UserIcon },
                    { id: 'study', label: 'Навчання', icon: BookOpen },
                    { id: 'communities', label: 'Спільнота', icon: Globe },
                  ].map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setDmCircle(id as ChatCircle)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                        dmCircle === id
                          ? 'border-[#E87A42] bg-[#FDF6EC] text-[#8C5A1A]'
                          : 'border-[#E6DFD3] bg-white text-[#5F6A60]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleCreateDM}
                disabled={!dmName.trim() || busy}
                className="w-full py-3 rounded-2xl bg-[#E87A42] hover:bg-[#C25925] disabled:bg-[#EADFD0] disabled:text-[#A8A99C] text-white text-sm font-extrabold transition-all shadow-md active:scale-98"
              >
                {busy ? 'Відкриваю діалог…' : `Почати діалог ${dmName.trim() ? `з ${dmName.trim().startsWith('@') ? dmName.trim() : `@${dmName.trim()}`}` : ''}`}
              </button>
            </div>
          )}

          {/* TAB 3: P2P INVITE / QR KEY */}
          {activeTab === 'invite' && (
            <div className="p-3.5 bg-[#F9F7F1] rounded-3xl border border-[#E6DFD3] space-y-2.5 animate-in fade-in duration-150">
              <span className="text-[13px] font-extrabold text-[#1E2521] block">
                Вам надіслали запрошення
              </span>

              {clipboardInvite && !text.trim() && (
                <button
                  type="button"
                  onClick={pasteFromClipboard}
                  className="w-full px-3 py-2.5 rounded-2xl bg-[#FDF6EC] border border-[#EBD9BE] flex items-center gap-2 text-left hover:bg-[#FBEFDC] transition-colors"
                >
                  <ClipboardPaste className="w-4 h-4 text-[#C25925] shrink-0" strokeWidth={2} />
                  <span className="text-[12.5px] text-[#8C5A1A] font-bold flex-1">
                    У буфері лежить запрошення — вставити?
                  </span>
                </button>
              )}

              {scanning ? (
                <QrScanner
                  onFound={(found) => {
                    setText(found);
                    setScanning(false);
                    soundFx.playChime();
                  }}
                  onCancel={() => setScanning(false)}
                />
              ) : (
                <textarea
                  ref={fieldRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Вставте сюди запрошення — цілий рядок, як прийшов"
                  rows={3}
                  className="w-full px-3 py-2 text-[12px] font-mono rounded-xl border border-[#E6DFD3] bg-white focus:outline-none focus:border-[#E87A42] resize-none"
                />
              )}

              {parsed && (
                <div className="p-3 bg-white rounded-2xl border border-[#DDD4C4] space-y-2">
                  <span className="text-[14px] font-extrabold text-[#1E2521] block leading-snug">
                    {claimedName ? (
                      <>
                        {nodeLabel} каже, що це{' '}
                        <span className="text-[#C25925]">{claimedName}</span>
                      </>
                    ) : (
                      nodeLabel
                    )}
                  </span>

                  <label className="block">
                    <span className="text-[11.5px] font-bold text-[#6E7568]">Записати як</span>
                    <input
                      value={name}
                      onChange={(e) => {
                        setNameTouched(true);
                        setName(e.target.value);
                      }}
                      placeholder="Імʼя у вашому списку"
                      className="mt-1 w-full px-3 py-2 text-[13px] rounded-xl border border-[#E6DFD3] bg-white focus:outline-none focus:border-[#E87A42]"
                    />
                  </label>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openConversation}
                  disabled={!parsed || busy}
                  className="flex-1 py-2.5 rounded-2xl bg-[#E87A42] hover:bg-[#C25925] disabled:bg-[#EADFD0] disabled:text-[#A8A99C] text-[#FFF8F2] text-[13px] font-extrabold transition-colors active:scale-98"
                >
                  {busy ? 'Зводжу сесію…' : 'Відкрити розмову'}
                </button>
                {!scanning && (
                  <button
                    type="button"
                    onClick={() => {
                      soundFx.playTap();
                      setScanning(true);
                    }}
                    className="px-3.5 py-2.5 rounded-2xl bg-white border border-[#DDD4C4] text-[#C25925] text-[13px] font-extrabold flex items-center gap-1.5 hover:bg-[#FAF6EE] transition-colors"
                  >
                    <QrCode className="w-4 h-4" strokeWidth={2} />
                    <span>QR</span>
                  </button>
                )}
              </div>

              {inviting ? (
                <InviteCard onClose={() => setInviting(false)} />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    soundFx.playTap();
                    setInviting(true);
                  }}
                  className="w-full px-3.5 py-3 rounded-3xl bg-[#FDFCF9] border border-[#DDD4C4] flex items-center gap-2.5 text-left hover:bg-[#FAF6EE] transition-colors"
                >
                  <UserPlus className="w-4.5 h-4.5 text-[#C25925] shrink-0" strokeWidth={2} />
                  <span className="flex-1 min-w-0">
                    <span className="text-[13px] font-extrabold text-[#1E2521] block leading-tight">
                      Запросити людину
                    </span>
                    <span className="text-[12px] text-[#5F6A60] block leading-tight mt-0.5">
                      Зробимо рядок, який можна просто переслати
                    </span>
                  </span>
                </button>
              )}
            </div>
          )}

          {/* TAB 3: NETWORK & CLOUD DATABASES */}
          {activeTab === 'network' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="p-3.5 bg-[#FAF8F4] rounded-2xl border border-[#DDD4C4] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-[#E87A42]" />
                    <span className="text-[13px] font-extrabold text-[#1E2521]">
                      Пряме підключення до вузла
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E8F5E9] text-[#2E7D32] border border-[#C8E6C9]">
                    P2P / WebRTC
                  </span>
                </div>

                <div>
                  <label className="block text-[11.5px] font-bold text-[#6E7568] mb-1">
                    Мережева адреса / IP / Домен вузла <span className="text-[#E87A42]">*</span>
                  </label>
                  <input
                    type="text"
                    value={directAddress}
                    onChange={(e) => setDirectAddress(e.target.value)}
                    placeholder="напр. https://try.phantom-os.dev або 192.168.1.50:8000"
                    className="w-full px-3 py-2 text-[13px] font-mono rounded-xl border border-[#E6DFD3] bg-white focus:outline-none focus:border-[#E87A42]"
                  />
                </div>

                <div>
                  <label className="block text-[11.5px] font-bold text-[#6E7568] mb-1">
                    Імʼя або псевдонім співрозмовника
                  </label>
                  <input
                    type="text"
                    value={directPeerName}
                    onChange={(e) => setDirectPeerName(e.target.value)}
                    placeholder="напр. Кирило Милосердов або Вузол 2"
                    className="w-full px-3 py-2 text-[13px] rounded-xl border border-[#E6DFD3] bg-white focus:outline-none focus:border-[#E87A42]"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleConnectDirectAddress}
                  disabled={!directAddress.trim() || busy}
                  className="w-full py-2.5 rounded-2xl bg-[#E87A42] hover:bg-[#C25925] disabled:bg-[#EADFD0] disabled:text-[#A8A99C] text-[#FFF8F2] text-[13px] font-extrabold transition-colors flex items-center justify-center gap-1.5"
                >
                  <Globe className="w-4 h-4" />
                  <span>{busy ? 'Встановлюю звʼязок…' : 'Підключити вузол та відкрити чат'}</span>
                </button>
              </div>

              {/* Хмарні інтеграції та сховища */}
              <div className="p-3.5 bg-white rounded-2xl border border-[#DDD4C4] space-y-2.5">
                <span className="text-[12.5px] font-extrabold text-[#1E2521] block">
                  Стан баз даних та ретрансляторів
                </span>
                
                <div className="space-y-2 text-[11.5px]">
                  <div className="flex items-center justify-between p-2 rounded-xl bg-[#FAF8F4] border border-[#EBE3D5]">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#4C8A55]" />
                      <span className="font-bold text-[#21261F]">Oracle Cloud & SQLite</span>
                    </div>
                    <span className="text-[#5F6A60]">try.phantom-os.dev (онлайн)</span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-xl bg-[#FAF8F4] border border-[#EBE3D5]">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#4C8A55]" />
                      <span className="font-bold text-[#21261F]">Supabase Mailbox Relay</span>
                    </div>
                    <span className="text-[#5F6A60]">Асинхронний бекап & NAT traversal</span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-xl bg-[#FAF8F4] border border-[#EBE3D5]">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#4C8A55]" />
                      <span className="font-bold text-[#21261F]">Cloudflare R2 Storage</span>
                    </div>
                    <span className="text-[#5F6A60]">Сховище медіа та великих вкладень</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-[#FDF6EC] rounded-xl border border-[#EBD9BE] text-xs text-[#8C5A1A]">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
