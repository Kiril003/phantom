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
  const [activeTab, setActiveTab] = useState<'group' | 'dm' | 'invite'>('group');

  // Group creation form state
  const [groupTitle, setGroupTitle] = useState('');
  const [groupCircle, setGroupCircle] = useState<ChatCircle>('work');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupAvatar, setGroupAvatar] = useState(PRESET_GROUP_AVATARS[0]);

  // DM creation form state
  const [dmName, setDmName] = useState('');
  const [dmCircle, setDmCircle] = useState<ChatCircle>('friends');

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

  // DM submit handler
  const handleCreateDM = async () => {
    if (!dmName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      soundFx.playSend();
      const newChatId = await useMessengerStore
        .getState()
        .createDirectMessage(dmName.trim(), dmCircle);
      reset();
      onConversationReady(newChatId);
    } catch (err: any) {
      setError(err?.message || 'Не вдалося створити діалог');
    } finally {
      setBusy(false);
    }
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
                  : 'Впустити за запрошенням'}
              </h3>
              <p className="text-[12px] text-[#5F6A60] leading-tight mt-0.5">
                {activeTab === 'group'
                  ? 'Спільний простір із Canvas та віджетами'
                  : activeTab === 'dm'
                  ? 'Пряме спілкування з колегою чи контактом'
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
            <span>Нова група</span>
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
            <span>Новий діалог</span>
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

          {/* TAB 2: DIRECT MESSAGE */}
          {activeTab === 'dm' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div>
                <label className="block text-xs font-extrabold text-[#1E2521] mb-1.5">
                  Ім'я співрозмовника <span className="text-[#E87A42]">*</span>
                </label>
                <input
                  type="text"
                  value={dmName}
                  onChange={(e) => setDmName(e.target.value)}
                  placeholder="напр. Олександр або Марія (Frontend Lead)"
                  autoFocus
                  className="w-full px-3.5 py-2.5 text-sm rounded-2xl border border-[#DDD4C4] bg-white focus:outline-none focus:border-[#E87A42] font-semibold"
                />
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
                {busy ? 'Відкриваю діалог…' : 'Почати діалог'}
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
