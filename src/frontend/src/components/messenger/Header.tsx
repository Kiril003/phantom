import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  Clock,
  Zap,
  Volume2,
  VolumeX,
  SlidersHorizontal,
  Phone,
  Video,
  Bookmark,
  MessageSquare,
  MoreVertical,
  Radio,
  ChevronLeft,
  ShieldCheck,
  Hash,
  FolderTree,
  Shield,
  Share2,
  Webhook,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  Terminal,
  HardDrive,
  Coins,
  Network,
  Database,
  History,
  Lock,
  Cpu,
} from 'lucide-react';
import { FocusModeSelector } from './FocusModeSelector';
import { TeamHuddleBar } from './TeamHuddleBar';
import { Chat, UserProfile, ActiveTransportStatus, TransportProtocol } from '../../types/messenger';
import { Avatar } from './Avatar';
import { soundFx } from '../../utils/messengerSound';
import { meshBrokerConfigured } from '../../services/globalP2PMesh';
import { useMessengerStore } from '../../stores/messengerStore';
import { useAISynthesisStore } from '../../stores/aiSynthesisStore';
import { ContactSheet } from './VerifyContact';
import { useEscapeClose } from '../../hooks/useEscapeClose';

interface HeaderProps {
  currentChat: Chat;
  currentUser: UserProfile;
  onOpenDigest: () => void;
  onOpenActions?: () => void;
  onOpenScheduledMessages?: () => void;
  scheduledMessagesCount?: number;
  onOpenSettings: () => void;
  onOpenGroupDetails: () => void;
  isSoundEnabled: boolean;
  onToggleSound: () => void;
  onToggleSearch: () => void;
  isSearching: boolean;
  pinnedCount?: number;
  onScrollToPinned?: () => void;
  onOpenP2PNetworkModal?: () => void;
  onOpenKnowledgeSearch?: () => void;
  onOpenWorkspaceDrive?: () => void;
  onOpenRoleScopes?: () => void;
  onOpenP2PSwarm?: () => void;
  onOpenWebhooks?: () => void;
  onOpenTerminal?: () => void;
  onOpenMemoryGraph?: () => void;
  onOpenNodeDashboard?: () => void;
  onOpenSpaceVault?: () => void;
  onOpenCommandPalette?: () => void;
  onOpenAutomations?: () => void;
  onOpenDataGrid?: () => void;
  onOpenTimeMachine?: () => void;
  onOpenZeroTrace?: () => void;
  onOpenIoTTelemetry?: () => void;
  focusMode?: any;
  onFocusModeChange?: (mode: any) => void;
  isHuddleActive?: boolean;
  onStartHuddle?: () => void;
  onLeaveHuddle?: () => void;
  onBack?: () => void;
  onToggleSidebar?: () => void;
  isSidebarCollapsed?: boolean;
  activeTransportStatus?: ActiveTransportStatus;
  transportMode?: TransportProtocol;
  networkLatencyMs?: number | null;
}

// Кругла кнопка-іконка — єдина форма для всієї правої групи шапки.
const ICON_BTN =
  'w-[32px] h-[32px] min-w-0 min-h-0 rounded-full flex items-center justify-center shrink-0 transition-colors';
const ICON_BTN_IDLE = 'text-[#8EA093] hover:text-white hover:bg-[#18231C]';
const ICON_BTN_OFF = 'text-[#475569] cursor-not-allowed';
// Чому кнопка не натискається — сказано словами, а не сірим кольором.
const NO_CALL_NOTE = 'Дзвінки лише зі звіреними вузловими контактами';
/** Дороги немає взагалі — це інша причина, ніж «не той тип бесіди». */
const NO_MESH_NOTE = 'Дзвінки вимкнені: цій збірці не задано вузол звʼязку';
const NO_PINNED_NOTE = 'Немає закріплених';
// Рядок випадного меню: фіксовані 36px, іконка + один рядок тексту.
const MENU_ITEM =
  'w-full h-[36px] min-h-0 px-2.5 rounded-[10px] text-left text-[13px] font-medium text-[#F8FAF8] flex items-center gap-2.5 hover:bg-[#18231C] transition-colors';

// Стан каналу живе в статусному рядку разом зі звіркою, а не окремою пігулкою:
// це та сама відповідь на питання «наскільки цій розмові можна вірити».
//
// «вузол онлайн» казало правду про НАШ вузол — і читалось як про
// співрозмовника. Це найтихіша форма брехні: слово чесне, адресат підмінений.
// Про присутність другої людини вузол не знає НІЧОГО (ані поля, ані кадру),
// тож жоден напис тут не сміє про неї натякати. Тепер кожен рядок називає,
// ЧИЙ це стан.
const TRANSPORT_LABEL: Record<string, string> = {
  'p2p-direct': 'прямий P2P',
  'server-ws': 'мій вузол на звʼязку',
  'relay-node': 'ретранслятор',
  connecting: 'з’єднання…',
  'fallback-server': 'мій вузол на звʼязку',
  online: 'мій вузол на звʼязку',
  offline: 'мій вузол автономно',
};

export const Header: React.FC<HeaderProps> = ({
  currentChat,
  currentUser: _currentUser,
  onOpenDigest,
  onOpenActions,
  onOpenScheduledMessages,
  scheduledMessagesCount = 0,
  onOpenSettings,
  onOpenGroupDetails,
  isSoundEnabled,
  onToggleSound,
  onToggleSearch,
  isSearching,
  pinnedCount = 0,
  onScrollToPinned,
  onOpenP2PNetworkModal,
  onOpenKnowledgeSearch,
  onOpenWorkspaceDrive,
  onOpenRoleScopes,
  onOpenP2PSwarm,
  onOpenWebhooks,
  onOpenTerminal,
  onOpenMemoryGraph,
  onOpenNodeDashboard,
  onOpenSpaceVault,
  onOpenCommandPalette: _onOpenCommandPalette,
  onOpenAutomations,
  onOpenDataGrid,
  onOpenTimeMachine,
  onOpenZeroTrace,
  onOpenIoTTelemetry,
  focusMode,
  onFocusModeChange,
  isHuddleActive,
  onStartHuddle,
  onLeaveHuddle,
  onBack,
  onToggleSidebar,
  isSidebarCollapsed,
  activeTransportStatus = 'offline',
  transportMode: _transportMode = 'auto',
  networkLatencyMs = null,
}) => {
  // Меню живе в порталі на body з координатами від кнопки: всередині шапки
  // воно опинялося під бульбашками стрічки, бо стрічка має власні шари z-50.
  const headerRef = useRef<HTMLElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null);
  const closeMenu = useCallback(() => setMenuAnchor(null), []);

  // Лист співрозмовника відкривається просто з шапки — звірка за 1 клік.
  const updateChat = useMessengerStore((s) => s.updateChat);
  const [sheet, setSheet] = useState<{ top: number; left: number } | null>(null);
  const hasPeer = !!currentChat.peerNodeId;
  const isGroup = currentChat.type === 'group' || currentChat.type === 'channel';

  // Дзвонити можна на будь-яку 1:1 бесіду через WebRTC DTLS-SRTP —
  // але ЛИШЕ якщо цій збірці задано вузол звʼязку.
  //
  // Було: `const canCall = !isGroup;` — умова питала про ФОРМУ розмови й
  // жодного разу про наявність ДОРОГИ. Наслідок на пакунку: тап по
  // слухавці давав звук, накладку дзвінка й гудки без кінця, бо
  // `globalP2PMesh.publish` мовчки виходить першим рядком, коли брокера
  // немає (`if (!BROKER_URL) return;`). Жоден байт нікуди не йшов, і
  // жодного слова про причину.
  //
  // Найгірше: функція, що відповідає рівно на це питання, була написана
  // й **не викликана ніким**. Один рядок відстані між справним захистом і
  // найгучнішою обіцянкою продукту, яку він не може виконати.
  const hasMesh = meshBrokerConfigured();
  const canCall = !isGroup && hasMesh;
  // Причину називаємо ТУ, ЩО СПРАЦЮВАЛА: «не та бесіда» і «немає дороги» —
  // різні речі, і людина мусить бачити свою.
  const noCallNote = !hasMesh ? NO_MESH_NOTE : NO_CALL_NOTE;

  const hasPinned = pinnedCount > 0 && !!onScrollToPinned;

  const startCall = (video: boolean) => {
    if (!canCall) return;
    soundFx.playTap();
    window.dispatchEvent(
      new CustomEvent('phantom:start-call', {
        detail: {
          peerNodeId: currentChat.peerNodeId || `node_${currentChat.id}`,
          displayName: currentChat.title,
          // Стан звірки їде разом: у картці дзвінка його вже нема де взяти.
          verified: currentChat.contactVerified ?? true,
          video,
        },
      }),
    );
  };

  const openSheet = (el?: HTMLElement | null) => {
    soundFx.playTap();
    const bar = headerRef.current?.getBoundingClientRect();
    const r = el?.getBoundingClientRect();
    const top = (bar?.bottom ?? 60) + 6;
    const left = Math.min(Math.max(8, r?.left ?? (bar?.left ?? 0) + 12), window.innerWidth - 308);
    setSheet({ top, left });
  };

  const onDeleted = () => {
    useMessengerStore.setState((s) => {
      const chats = s.chats.filter((c) => c.id !== currentChat.id);
      return {
        chats,
        activeChatId:
          s.activeChatId === currentChat.id ? (chats[0]?.id ?? '') : s.activeChatId,
      };
    });
  };

  const toggleMoreMenu = () => {
    soundFx.playTap();
    if (menuAnchor) {
      closeMenu();
      return;
    }
    const btn = moreBtnRef.current?.getBoundingClientRect();
    const bar = headerRef.current?.getBoundingClientRect();
    if (!btn || !bar) return;
    setMenuAnchor({ top: bar.bottom + 6, right: Math.max(8, window.innerWidth - btn.right) });
  };

  useEffect(() => {
    if (!menuAnchor) return;
    window.addEventListener('resize', closeMenu);
    return () => window.removeEventListener('resize', closeMenu);
  }, [menuAnchor, closeMenu]);

  useEscapeClose(!!menuAnchor, closeMenu);

  const subtitle = currentChat.topic || currentChat.customVibe || currentChat.description || '';
  const circleLabel = currentChat.circle && currentChat.circle !== 'all' ? currentChat.circle : null;

  return (
    <header ref={headerRef} className="h-[46px] px-2.5 sm:px-4 bg-[#0E1410] border-b border-[rgba(255,255,255,0.07)] flex items-center justify-between gap-2 select-none shrink-0 z-30 text-white">
      {/* 1. Left Chat Identity & Mobile Back Button */}
      <div className="flex items-center gap-1 sm:gap-2 min-w-0 flex-1">
        {onBack && (
          <button
            onClick={() => {
              soundFx.playTap();
              onBack();
            }}
            className={`md:hidden -ml-1 ${ICON_BTN} ${ICON_BTN_IDLE}`}
            title="Назад до списку бесід"
            aria-label="Назад"
          >
            <ChevronLeft className="w-[18px] h-[18px]" strokeWidth={2} />
          </button>
        )}

        {onToggleSidebar && (
          <button
            onClick={() => {
              soundFx.playTap();
              onToggleSidebar();
            }}
            className={`hidden md:flex ${ICON_BTN} ${ICON_BTN_IDLE} -ml-1`}
            title={isSidebarCollapsed ? "Показати список чатів (Ctrl+\\)" : "Сховати список чатів (Ctrl+\\)"}
            aria-label="Перемкнути бічну панель"
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="w-[18px] h-[18px]" strokeWidth={1.75} />
            ) : (
              <PanelLeftClose className="w-[18px] h-[18px]" strokeWidth={1.75} />
            )}
          </button>
        )}

        <div
          onClick={(e) => {
            if (hasPeer) openSheet(e.currentTarget as HTMLElement);
            else {
              soundFx.playTap();
              onOpenGroupDetails();
            }
          }}
          className="flex items-center gap-2 min-w-0 cursor-pointer group flex-1"
          title={hasPeer ? 'Картка співрозмовника: звірка, дії з розмовою' : 'Переглянути деталі бесіди, учасників та медіа'}
        >
          <div className="relative shrink-0">
            <Avatar src={currentChat.avatar} name={currentChat.title} className="w-8 h-8" />
            {currentChat.isOnline && (
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-[#F4AF25] rounded-full ring-2 ring-[#0E1410]" />
            )}
          </div>

          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-center gap-1.5">
              <h2 className="font-bold text-[13.5px] text-[#F8FAF8] truncate">
                {currentChat.title}
              </h2>
              {circleLabel && (
                <span className="hidden phantom:inline-block text-[10px] text-[#8EA093] shrink-0">
                  {circleLabel}
                </span>
              )}
            </div>

            {/* Один статусний рядок: звірка, канал, тема. Крапка замість
                значка — попередження не мусить кричати, щоб його прочитали. */}
            <div className="flex items-center gap-2.5 min-w-0 mt-0.5 text-[11.5px] text-[#6E7568]">
              {currentChat.contactVerified === false && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openSheet(e.currentTarget as HTMLElement);
                  }}
                  className="inline-flex items-center gap-1.5 shrink-0 min-h-0 min-w-0 hover:text-[#21261F] transition-colors"
                  title="Звірити число безпеки — прямо звідси"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#C98A2E] shrink-0" />
                  Не звірено
                </button>
              )}
              {currentChat.contactVerified === true && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openSheet(e.currentTarget as HTMLElement);
                  }}
                  className="inline-flex items-center gap-1.5 shrink-0 min-h-0 min-w-0 hover:text-[#21261F] transition-colors"
                  title="Показати число безпеки"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4C8A55] shrink-0" />
                  Звірено
                </button>
              )}

              {/* Показуємо тільки те, що виміряно: замок тут був би про особу,
                  а її дає звірене число, не транспорт; і жодних мілісекунд без
                  пінга. */}
              {onOpenP2PNetworkModal && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    soundFx.playTap();
                    onOpenP2PNetworkModal();
                  }}
                  className="hidden phantom:inline-flex items-center gap-1.5 shrink-0 min-w-0 min-h-0 hover:text-[#21261F] transition-colors"
                  title="Стан каналу — натисніть для діагностики мережі"
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${activeTransportStatus === 'offline' ? 'bg-[#C25A3A]' : 'bg-[#4C8A55]'}`} />
                  <span className="truncate max-w-[130px]">
                    {TRANSPORT_LABEL[activeTransportStatus || 'server-ws'] || 'вузол онлайн'}
                  </span>
                  {typeof networkLatencyMs === 'number' && (
                    <span className="text-[color:var(--msg-meta)]">{networkLatencyMs} мс</span>
                  )}
                </button>
              )}

              {subtitle && <p className="truncate">{subtitle}</p>}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Right Action Controls */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Focus Mode Pill */}
        <div className="hidden lg:block">
          <FocusModeSelector
            currentMode={focusMode}
            onModeChange={onFocusModeChange}
          />
        </div>

        {/* Team Huddle Bar Trigger */}
        <div className="hidden md:block">
          <TeamHuddleBar
            chatTitle={currentChat.title}
            isHuddleActive={Boolean(isHuddleActive)}
            onStartHuddle={onStartHuddle}
            onLeaveHuddle={onLeaveHuddle}
          />
        </div>

        {/* Omni-Search across entire Workspace */}
        {onOpenKnowledgeSearch && (
          <button
            onClick={() => {
              soundFx.playTap();
              onOpenKnowledgeSearch();
            }}
            className={`hidden sm:flex ${ICON_BTN} ${ICON_BTN_IDLE}`}
            title="Семантичний пошук рішень та документів (Omni-search)"
          >
            <Sparkles className="w-[18px] h-[18px] text-[#D96C35]" strokeWidth={1.75} />
          </button>
        )}

        {/* Thread / Digest Comments */}
        <button
          onClick={() => {
            soundFx.playChime();
            onOpenDigest();
          }}
          className={`hidden sm:flex ${ICON_BTN} ${ICON_BTN_IDLE}`}
          title="Smart Digest та підсумок активності"
        >
          <MessageSquare className="w-[18px] h-[18px]" strokeWidth={1.75} />
        </button>

        {/* Закріплене: веде до першого закріпленого в стрічці */}
        <span title={hasPinned ? undefined : NO_PINNED_NOTE} className="hidden sm:flex">
          <button
            onClick={() => {
              if (!hasPinned) return;
              soundFx.playTap();
              onScrollToPinned?.();
            }}
            disabled={!hasPinned}
            className={`relative ${ICON_BTN} ${
              hasPinned ? 'text-[#21261F] hover:bg-[#F1EBDD]' : ICON_BTN_OFF
            }`}
            title={hasPinned ? `Закріплених повідомлень: ${pinnedCount}` : NO_PINNED_NOTE}
            aria-label="Закріплені повідомлення"
          >
            <Bookmark className="w-[18px] h-[18px]" strokeWidth={1.75} />
            {hasPinned && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-[#D96C35] rounded-full ring-2 ring-[#FDFCF9]" />
            )}
          </button>
        </span>

        {/* AI Synthesis Studio Launch Button */}
        <button
          onClick={() => {
            soundFx.playChime();
            useAISynthesisStore.getState().setStudioOpen(true);
          }}
          className="px-2.5 h-[32px] rounded-full flex items-center gap-1.5 text-xs font-bold bg-[#FAF7F0] hover:bg-[#F2ECE1] text-[#C25925] border border-[#DDD3BF] shadow-2xs transition-colors shrink-0"
          title="Відкрити когнітивний полігон PHANTOM AI Studio"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span className="hidden md:inline">AI Studio</span>
        </button>

        {/* Дзвінок: аудіо і відео */}
        <span
          className="flex items-center gap-0.5"
          title={canCall ? undefined : noCallNote}
        >
          <button
            onClick={() => startCall(false)}
            disabled={!canCall}
            data-call-start="audio"
            className={`${ICON_BTN} ${canCall ? ICON_BTN_IDLE : ICON_BTN_OFF}`}
            title={canCall ? `Аудіодзвінок: ${currentChat.title}` : noCallNote}
            aria-label="Аудіодзвінок"
          >
            <Phone className="w-[18px] h-[18px]" strokeWidth={1.75} />
          </button>

          <button
            onClick={() => startCall(true)}
            disabled={!canCall}
            data-call-start="video"
            className={`hidden sm:flex ${ICON_BTN} ${canCall ? ICON_BTN_IDLE : ICON_BTN_OFF}`}
            title={canCall ? `Відеодзвінок: ${currentChat.title}` : noCallNote}
            aria-label="Відеодзвінок"
          >
            <Video className="w-[18px] h-[18px]" strokeWidth={1.75} />
          </button>
        </span>

        {/* In-Chat Search Trigger */}
        <button
          onClick={() => {
            soundFx.playTap();
            onToggleSearch();
          }}
          className={`${ICON_BTN} ${
            isSearching ? 'bg-[#F1EBDD] text-[#21261F]' : ICON_BTN_IDLE
          }`}
          title="Пошук у поточній бесіді"
        >
          <Search className="w-[18px] h-[18px]" strokeWidth={1.75} />
        </button>

        {/* More Actions Menu Button */}
        <button
          ref={moreBtnRef}
          onClick={toggleMoreMenu}
          className={`${ICON_BTN} ${menuAnchor ? 'bg-[#F1EBDD] text-[#21261F]' : ICON_BTN_IDLE}`}
          title="Більше дій"
          aria-haspopup="menu"
          aria-expanded={!!menuAnchor}
        >
          <MoreVertical className="w-[18px] h-[18px]" strokeWidth={1.75} />
        </button>
      </div>

      {menuAnchor &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[900]" onClick={closeMenu} />
            <div
              role="menu"
              className="fixed z-[901] w-64 bg-[#FDFCF9] border border-[#DDD4C4] rounded-2xl shadow-[0_16px_40px_rgba(30,37,33,0.18)] p-1.5 space-y-0.5 text-[#1E2521]"
              style={{ top: menuAnchor.top, right: menuAnchor.right }}
            >
              {/* Спершу — дії про співрозмовника: те, заради чого відкривають чат. */}
              {hasPeer && (
                <div className="pb-1 mb-1 border-b border-[#E8E1D3]">
                  <button
                    onClick={() => {
                      closeMenu();
                      openSheet();
                    }}
                    className={MENU_ITEM}
                  >
                    <ShieldCheck className="w-4 h-4 text-[#6E7568] shrink-0" strokeWidth={1.75} />
                    <span className="truncate">
                      {currentChat.contactVerified === true ? 'Звірка співрозмовника' : 'Звірити число безпеки'}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      closeMenu();
                      openSheet();
                    }}
                    className={MENU_ITEM}
                  >
                    <Hash className="w-4 h-4 text-[#6E7568] shrink-0" strokeWidth={1.75} />
                    <span className="truncate">Показати число безпеки</span>
                  </button>
                </div>
              )}

              <button
                onClick={() => {
                  closeMenu();
                  onOpenDigest();
                }}
                className={`sm:hidden ${MENU_ITEM}`}
              >
                <MessageSquare className="w-4 h-4 text-[#6E7568] shrink-0" strokeWidth={1.75} />
                <span className="truncate">Конспект бесіди</span>
              </button>

              {/* WORK OS ECOSYSTEM ACTIONS */}
              {onOpenWorkspaceDrive && (
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenWorkspaceDrive();
                  }}
                  className={MENU_ITEM}
                >
                  <FolderTree className="w-4 h-4 text-[#D96C35] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Сховище Workspace Drive</span>
                </button>
              )}

              {onOpenRoleScopes && (
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenRoleScopes();
                  }}
                  className={MENU_ITEM}
                >
                  <Shield className="w-4 h-4 text-[#6E7568] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Контекстні ролі (Scopes)</span>
                </button>
              )}

              {onOpenWebhooks && (
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenWebhooks();
                  }}
                  className={MENU_ITEM}
                >
                  <Webhook className="w-4 h-4 text-[#6E7568] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Вхідні Webhook-хаби (CI/CD)</span>
                </button>
              )}

              {onOpenP2PSwarm && (
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenP2PSwarm();
                  }}
                  className={MENU_ITEM}
                >
                  <Share2 className="w-4 h-4 text-[#6E7568] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">P2P Swarm роздача</span>
                </button>
              )}

              {onOpenTerminal && (
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenTerminal();
                  }}
                  className={MENU_ITEM}
                >
                  <Terminal className="w-4 h-4 text-[#D96C35] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Shared Terminal & Runner</span>
                </button>
              )}

              {onOpenMemoryGraph && (
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenMemoryGraph();
                  }}
                  className={MENU_ITEM}
                >
                  <Network className="w-4 h-4 text-[#6E7568] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Project Memory Graph</span>
                </button>
              )}

              {onOpenSpaceVault && (
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenSpaceVault();
                  }}
                  className={MENU_ITEM}
                >
                  <Coins className="w-4 h-4 text-[#D96C35] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Скарбниця (Multi-sig Vault)</span>
                </button>
              )}

              {onOpenNodeDashboard && (
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenNodeDashboard();
                  }}
                  className={MENU_ITEM}
                >
                  <HardDrive className="w-4 h-4 text-[#6E7568] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Моніторинг вузла</span>
                </button>
              )}

              {onOpenAutomations && (
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenAutomations();
                  }}
                  className={MENU_ITEM}
                >
                  <Zap className="w-4 h-4 text-[#D96C35] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Автоматизації (IFTTT & Cron)</span>
                </button>
              )}

              {onOpenDataGrid && (
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenDataGrid();
                  }}
                  className={MENU_ITEM}
                >
                  <Database className="w-4 h-4 text-[#6E7568] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Реляційна база (Data Grid)</span>
                </button>
              )}

              {onOpenTimeMachine && (
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenTimeMachine();
                  }}
                  className={MENU_ITEM}
                >
                  <History className="w-4 h-4 text-[#6E7568] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">CRDT Time Machine (Снапшоти)</span>
                </button>
              )}

              {onOpenZeroTrace && (
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenZeroTrace();
                  }}
                  className={MENU_ITEM}
                >
                  <Lock className="w-4 h-4 text-[#D96C35] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Zero-Trace, Підпис & Air-Gap</span>
                </button>
              )}

              {onOpenIoTTelemetry && (
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenIoTTelemetry();
                  }}
                  className={MENU_ITEM}
                >
                  <Cpu className="w-4 h-4 text-[#6E7568] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">IoT Сенсори & YubiKey</span>
                </button>
              )}

              {onOpenP2PNetworkModal && (
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenP2PNetworkModal();
                  }}
                  className={MENU_ITEM}
                >
                  <Radio className="w-4 h-4 text-[#6E7568] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Мережевий зв'язок</span>
                </button>
              )}

              {onOpenActions && (
              <button
                onClick={() => {
                  closeMenu();
                  onOpenActions();
                }}
                className={MENU_ITEM}
              >
                <Zap className="w-4 h-4 text-[#6E7568] shrink-0" strokeWidth={1.75} />
                <span className="truncate">Студія карток</span>
              </button>
              )}

              {/* «Agentic Runtime & Нейроергономіка» і «Physical Computing,
                  GIS & WebGPU» прибрано з меню 30.08.2026 разом із замком на
                  самих екранах (див. `modals/hiddenModals.ts`). Обидва
                  вигадували стан роботи й не мали джерела даних. Лишити пункт
                  при зачиненому екрані означало б проміняти брехню на мертву
                  кнопку — та сама родина дефектів. Повернуться разом із
                  дротом, одним рядком у переліку. */}

              {onOpenScheduledMessages && (
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenScheduledMessages();
                  }}
                  className={MENU_ITEM}
                >
                  <Clock className="w-4 h-4 text-[#6E7568] shrink-0" strokeWidth={1.75} />
                  <span className="truncate flex-1">Відкладені повідомлення</span>
                  {scheduledMessagesCount > 0 && (
                    <span className="px-1.5 bg-[#D96C35] text-[#FDFCF9] rounded-full text-[10.5px] font-semibold shrink-0">
                      {scheduledMessagesCount}
                    </span>
                  )}
                </button>
              )}

              <button
                onClick={() => {
                  closeMenu();
                  onToggleSound();
                }}
                className={MENU_ITEM}
              >
                {isSoundEnabled ? (
                  <Volume2 className="w-4 h-4 text-[#6E7568] shrink-0" strokeWidth={1.75} />
                ) : (
                  <VolumeX className="w-4 h-4 text-[color:var(--msg-meta)] shrink-0" strokeWidth={1.75} />
                )}
                <span className="truncate">{isSoundEnabled ? 'Звук увімкнено' : 'Звук вимкнено'}</span>
              </button>

              <div className="pt-1 mt-1 border-t border-[#E8E1D3]">
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenSettings();
                  }}
                  className={MENU_ITEM}
                >
                  <SlidersHorizontal className="w-4 h-4 text-[#6E7568] shrink-0" strokeWidth={1.75} />
                  <span className="truncate">Налаштування месенджера</span>
                </button>
              </div>
            </div>
          </>,
          document.body
        )}

      {sheet && (
        <ContactSheet
          chat={{
            id: currentChat.id,
            title: currentChat.title,
            peerNodeId: currentChat.peerNodeId,
            isGroup,
          }}
          anchor={sheet}
          onClose={() => setSheet(null)}
          onVerified={(verified) => updateChat(currentChat.id, { contactVerified: verified })}
          onRenamed={(title) => updateChat(currentChat.id, { title })}
          onCleared={() =>
            updateChat(currentChat.id, {
              messages: [],
              lastSnippet: undefined,
              lastKind: undefined,
              lastAuthor: undefined,
              unreadCount: 0,
            })
          }
          onDeleted={onDeleted}
        />
      )}
    </header>
  );
};
