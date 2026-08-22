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
  Bookmark,
  MessageSquare,
  MoreVertical,
  Radio,
  Globe,
  ArrowDownUp,
  ShieldCheck,
  AlertTriangle,
  WifiOff,
  ChevronLeft
} from 'lucide-react';
import { Chat, UserProfile, ActiveTransportStatus, TransportProtocol } from '../../types/messenger';
import { Avatar } from './Avatar';
import { soundFx } from '../../utils/messengerSound';

interface HeaderProps {
  currentChat: Chat;
  currentUser: UserProfile;
  onOpenDigest: () => void;
  onOpenActions: () => void;
  onOpenScheduledMessages?: () => void;
  scheduledMessagesCount?: number;
  onOpenSettings: () => void;
  onOpenGroupDetails: () => void;
  isHuddleActive: boolean;
  onToggleHuddle: () => void;
  isSoundEnabled: boolean;
  onToggleSound: () => void;
  onToggleSearch: () => void;
  isSearching: boolean;
  pinnedCount?: number;
  onScrollToPinned?: () => void;
  onOpenP2PNetworkModal?: () => void;
  onBack?: () => void;
  activeTransportStatus?: ActiveTransportStatus;
  transportMode?: TransportProtocol;
  networkLatencyMs?: number | null;
}

// Кругла кнопка-іконка — єдина форма для всієї правої групи шапки.
const ICON_BTN =
  'w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors active:scale-95';
const ICON_BTN_IDLE = 'text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3]';
// Рядок випадного меню: фіксовані 36px, іконка + один рядок тексту.
const MENU_ITEM =
  'w-full h-9 px-2.5 rounded-xl text-left text-[13px] font-semibold flex items-center gap-2.5 hover:bg-[#F1EDE3] transition-colors';

export const Header: React.FC<HeaderProps> = ({
  currentChat,
  currentUser: _currentUser,
  onOpenDigest,
  onOpenActions,
  onOpenScheduledMessages,
  scheduledMessagesCount = 0,
  onOpenSettings,
  onOpenGroupDetails,
  isHuddleActive,
  onToggleHuddle,
  isSoundEnabled,
  onToggleSound,
  onToggleSearch,
  isSearching,
  pinnedCount = 0,
  onScrollToPinned,
  onOpenP2PNetworkModal,
  onBack,
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

  const toggleMoreMenu = () => {
    soundFx.playTap();
    if (menuAnchor) {
      closeMenu();
      return;
    }
    const btn = moreBtnRef.current?.getBoundingClientRect();
    const bar = headerRef.current?.getBoundingClientRect();
    if (!btn || !bar) return;
    // Вертикаль беремо від нижньої межі шапки, а не від кнопки: інакше меню
    // наповзає на власну шапку.
    setMenuAnchor({ top: bar.bottom + 6, right: Math.max(8, window.innerWidth - btn.right) });
  };

  // Прив'язка порахована один раз — при зміні розмірів вікна вона стає брехнею.
  useEffect(() => {
    if (!menuAnchor) return;
    window.addEventListener('resize', closeMenu);
    return () => window.removeEventListener('resize', closeMenu);
  }, [menuAnchor, closeMenu]);

  const subtitle = currentChat.topic || currentChat.customVibe || currentChat.description || '';
  // «all» — це не коло, а вся стрічка: чіп із написом ALL нічого не повідомляє.
  const circleLabel = currentChat.circle && currentChat.circle !== 'all' ? currentChat.circle : null;

  return (
    <header ref={headerRef} className="h-[60px] px-3 sm:px-5 bg-[#FDFCF9]/95 backdrop-blur-xl border-b border-[#E6DFD3] flex items-center justify-between gap-2 sm:gap-3 select-none shrink-0 z-30 shadow-sm">
      {/* 1. Left Chat Identity & Mobile Back Button */}
      <div className="flex items-center gap-1 sm:gap-2 min-w-0 flex-1">
        {onBack && (
          <button
            onClick={() => {
              soundFx.playTap();
              onBack();
            }}
            className={`md:hidden -ml-1.5 ${ICON_BTN} ${ICON_BTN_IDLE}`}
            title="Назад до списку бесід"
            aria-label="Назад"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        <div
          onClick={() => {
            soundFx.playTap();
            onOpenGroupDetails();
          }}
          className="flex items-center gap-2.5 min-w-0 cursor-pointer group flex-1"
          title="Переглянути деталі бесіди, учасників та медіа"
        >
          <div className="relative shrink-0">
            <Avatar
              src={currentChat.avatar}
              name={currentChat.title}
              className="w-9 h-9 group-hover:scale-105 transition-transform"
            />
            {currentChat.isOnline && (
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-[#10B981] rounded-full ring-2 ring-[#FDFCF9]" />
            )}
          </div>

          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-center gap-1.5">
              <h2 className="font-bold text-[15px] sm:text-base text-[#1E2521] truncate group-hover:text-[#E87A42] transition-colors">
                {currentChat.title}
              </h2>
              {circleLabel && (
                <span className="hidden phantom:inline-block px-1.5 py-px bg-[#F1EDE3] text-[#C25925] text-[10px] font-bold rounded uppercase border border-[#DDD4C4] shrink-0">
                  {circleLabel}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 min-w-0 mt-0.5">
              {currentChat.contactVerified === false && (
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#C25925] shrink-0"
                  title="Звірте число безпеки в налаштуваннях, розділ «Мережа & P2P»"
                >
                  <AlertTriangle className="w-3 h-3" />
                  Не звірено
                </span>
              )}
              {currentChat.contactVerified === true && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#528A4B] shrink-0">
                  <ShieldCheck className="w-3 h-3" />
                  Звірено
                </span>
              )}
              {subtitle && <p className="text-xs text-[#7A8479] truncate">{subtitle}</p>}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Right Action Controls */}
      <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
        {/* Стан каналу. Показуємо тільки те, що виміряно: жодного замка,
            поки наскрізного шифрування немає, і жодних мілісекунд без пінга. */}
        {onOpenP2PNetworkModal && (
          <button
            onClick={() => {
              soundFx.playTap();
              onOpenP2PNetworkModal();
            }}
            className={`hidden phantom:flex items-center gap-1 mr-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold border transition-colors ${
              activeTransportStatus === 'p2p-direct'
                ? 'bg-[#F1EDE3] hover:bg-[#E6DFD3] text-[#C25925] border-[#DDD4C4]'
                : activeTransportStatus === 'server-ws' || activeTransportStatus === 'relay-node'
                ? 'bg-[#F9F7F1] hover:bg-[#F1EDE3] text-[#5F6A60] border-[#E6DFD3]'
                : activeTransportStatus === 'connecting'
                ? 'bg-[#F9F7F1] hover:bg-[#F1EDE3] text-[#8C5A1A] border-[#E6DFD3]'
                : 'bg-[#F9F7F1] hover:bg-[#F1EDE3] text-[#7A8479] border-[#E6DFD3]'
            }`}
            title="Стан каналу — натисніть для діагностики мережі"
          >
            {activeTransportStatus === 'p2p-direct' ? (
              <>
                <ArrowDownUp className="w-3 h-3" />
                <span className="truncate max-w-[110px]">Прямий канал · DTLS</span>
              </>
            ) : activeTransportStatus === 'server-ws' ? (
              <>
                <Globe className="w-3 h-3" />
                <span className="truncate max-w-[110px]">Вузол</span>
              </>
            ) : activeTransportStatus === 'relay-node' ? (
              <>
                <Radio className="w-3 h-3" />
                <span className="truncate max-w-[110px]">Ретранслятор</span>
              </>
            ) : activeTransportStatus === 'connecting' || activeTransportStatus === 'fallback-server' ? (
              <>
                <Radio className="w-3 h-3" />
                <span>З'єднання…</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3" />
                <span>Каналу немає</span>
              </>
            )}
            {typeof networkLatencyMs === 'number' && (
              <span className="text-[10px] opacity-75 font-mono">{networkLatencyMs}ms</span>
            )}
          </button>
        )}

        {/* Thread / Digest Comments */}
        <button
          onClick={() => {
            soundFx.playChime();
            onOpenDigest();
          }}
          className={`hidden sm:flex ${ICON_BTN} ${ICON_BTN_IDLE}`}
          title="Підсумок та коментарі бесіди"
        >
          <MessageSquare className="w-4 h-4" />
        </button>

        {/* Pinned Messages shortcut */}
        <button
          onClick={() => {
            soundFx.playTap();
            if (onScrollToPinned) onScrollToPinned();
          }}
          className={`relative ${ICON_BTN} ${
            pinnedCount > 0 ? 'text-[#C25925] hover:bg-[#F1EDE3]' : ICON_BTN_IDLE
          }`}
          title={pinnedCount > 0 ? `Закріплених повідомлень: ${pinnedCount}` : 'Немає закріплених'}
        >
          <Bookmark className="w-4 h-4" />
          {pinnedCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#E87A42] rounded-full ring-2 ring-[#FDFCF9]" />
          )}
        </button>

        {/* Audio / Video Huddle Quick Toggle */}
        <button
          onClick={() => {
            soundFx.playTap();
            onToggleHuddle();
          }}
          className={`${ICON_BTN} ${
            isHuddleActive
              ? 'bg-[#E87A42] text-[#FDFCF9] animate-pulse'
              : 'text-[#E87A42] hover:bg-[#F1EDE3]'
          }`}
          title={isHuddleActive ? 'Залишити кімнату дзвінка' : 'Запустити зв\'язок (аудіо/відео)'}
          aria-label={isHuddleActive ? 'В ефірі' : 'Дзвінок'}
        >
          <Phone className="w-4 h-4" />
        </button>

        {/* In-Chat Search Trigger */}
        <button
          onClick={() => {
            soundFx.playTap();
            onToggleSearch();
          }}
          className={`${ICON_BTN} ${
            isSearching ? 'bg-[#E87A42] text-[#FDFCF9]' : ICON_BTN_IDLE
          }`}
          title="Пошук у поточній бесіді"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* More Actions Menu Button */}
        <button
          ref={moreBtnRef}
          onClick={toggleMoreMenu}
          className={`${ICON_BTN} ${menuAnchor ? 'bg-[#F1EDE3] text-[#1E2521]' : ICON_BTN_IDLE}`}
          title="Більше дій"
          aria-haspopup="menu"
          aria-expanded={!!menuAnchor}
        >
          <MoreVertical className="w-4 h-4" />
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
              <button
                onClick={() => {
                  closeMenu();
                  onOpenDigest();
                }}
                className={`sm:hidden ${MENU_ITEM}`}
              >
                <MessageSquare className="w-4 h-4 text-[#C25925] shrink-0" />
                <span className="truncate">Конспект бесіди</span>
              </button>

              {onOpenP2PNetworkModal && (
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenP2PNetworkModal();
                  }}
                  className={MENU_ITEM}
                >
                  <Radio className="w-4 h-4 text-[#E87A42] shrink-0" />
                  <span className="truncate">Мережевий зв'язок</span>
                </button>
              )}

              <button
                onClick={() => {
                  closeMenu();
                  onOpenActions();
                }}
                className={MENU_ITEM}
              >
                <Zap className="w-4 h-4 text-[#C25925] shrink-0" />
                <span className="truncate">Студія карток</span>
              </button>

              {onOpenScheduledMessages && (
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenScheduledMessages();
                  }}
                  className={MENU_ITEM}
                >
                  <Clock className="w-4 h-4 text-[#C25925] shrink-0" />
                  <span className="truncate flex-1">Відкладені повідомлення</span>
                  {scheduledMessagesCount > 0 && (
                    <span className="px-1.5 bg-[#E87A42] text-[#FDFCF9] rounded-full text-[10px] font-bold shrink-0">
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
                  <Volume2 className="w-4 h-4 text-[#E87A42] shrink-0" />
                ) : (
                  <VolumeX className="w-4 h-4 text-[#7A8479] shrink-0" />
                )}
                <span className="truncate">{isSoundEnabled ? 'Звук увімкнено' : 'Звук вимкнено'}</span>
              </button>

              <div className="pt-1 mt-1 border-t border-[#F1EDE3]">
                <button
                  onClick={() => {
                    closeMenu();
                    onOpenSettings();
                  }}
                  className={`${MENU_ITEM} text-[#5F6A60] hover:text-[#1E2521]`}
                >
                  <SlidersHorizontal className="w-4 h-4 text-[#5F6A60] shrink-0" />
                  <span className="truncate">Налаштування месенджера</span>
                </button>
              </div>
            </div>
          </>,
          document.body
        )}
    </header>
  );
};
