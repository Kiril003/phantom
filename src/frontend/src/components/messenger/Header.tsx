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
  'w-[32px] h-[32px] min-w-0 min-h-0 rounded-full flex items-center justify-center shrink-0 transition-colors';
const ICON_BTN_IDLE = 'text-[#6E7568] hover:text-[#21261F] hover:bg-[#F1EBDD]';
// Рядок випадного меню: фіксовані 36px, іконка + один рядок тексту.
const MENU_ITEM =
  'w-full h-[36px] min-h-0 px-2.5 rounded-[10px] text-left text-[13px] font-medium text-[#21261F] flex items-center gap-2.5 hover:bg-[#F1EBDD] transition-colors';

// Стан каналу живе в статусному рядку разом зі звіркою, а не окремою пігулкою:
// це та сама відповідь на питання «наскільки цій розмові можна вірити».
const TRANSPORT_LABEL: Record<string, string> = {
  'p2p-direct': 'прямий канал',
  'server-ws': 'вузол',
  'relay-node': 'ретранслятор',
  connecting: 'з’єднання…',
  'fallback-server': 'з’єднання…',
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
    <header ref={headerRef} className="h-[60px] px-3 sm:px-5 bg-[#FDFCF9]/95 backdrop-blur-xl border-b border-[#E8E1D3] flex items-center justify-between gap-2 sm:gap-3 select-none shrink-0 z-30">
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
            <ChevronLeft className="w-[18px] h-[18px]" strokeWidth={1.75} />
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
            <Avatar src={currentChat.avatar} name={currentChat.title} className="w-9 h-9" />
            {currentChat.isOnline && (
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-[#4C8A55] rounded-full ring-2 ring-[#FDFCF9]" />
            )}
          </div>

          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-[15px] text-[#21261F] truncate">
                {currentChat.title}
              </h2>
              {circleLabel && (
                <span className="hidden phantom:inline-block text-[11.5px] text-[#98A092] shrink-0">
                  {circleLabel}
                </span>
              )}
            </div>

            {/* Один статусний рядок: звірка, канал, тема. Крапка замість
                значка — попередження не мусить кричати, щоб його прочитали. */}
            <div className="flex items-center gap-2.5 min-w-0 mt-0.5 text-[11.5px] text-[#6E7568]">
              {currentChat.contactVerified === false && (
                <span
                  className="inline-flex items-center gap-1.5 shrink-0"
                  title="Звірте число безпеки в налаштуваннях, розділ «Мережа & P2P»"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#C98A2E] shrink-0" />
                  Не звірено
                </span>
              )}
              {currentChat.contactVerified === true && (
                <span className="inline-flex items-center gap-1.5 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4C8A55] shrink-0" />
                  Звірено
                </span>
              )}

              {/* Показуємо тільки те, що виміряно: жодного замка, поки
                  наскрізного шифрування немає, і жодних мілісекунд без пінга. */}
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
                  <span className="w-1.5 h-1.5 rounded-full bg-[#98A092] shrink-0" />
                  <span className="truncate max-w-[130px]">
                    {TRANSPORT_LABEL[activeTransportStatus] || 'каналу немає'}
                  </span>
                  {typeof networkLatencyMs === 'number' && (
                    <span className="text-[#98A092]">{networkLatencyMs} мс</span>
                  )}
                </button>
              )}

              {subtitle && <p className="truncate">{subtitle}</p>}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Right Action Controls */}
      <div className="flex items-center gap-0.5 shrink-0">
        {/* Thread / Digest Comments */}
        <button
          onClick={() => {
            soundFx.playChime();
            onOpenDigest();
          }}
          className={`hidden sm:flex ${ICON_BTN} ${ICON_BTN_IDLE}`}
          title="Підсумок та коментарі бесіди"
        >
          <MessageSquare className="w-[18px] h-[18px]" strokeWidth={1.75} />
        </button>

        {/* Pinned Messages shortcut */}
        <button
          onClick={() => {
            soundFx.playTap();
            if (onScrollToPinned) onScrollToPinned();
          }}
          className={`relative ${ICON_BTN} ${
            pinnedCount > 0 ? 'text-[#21261F] hover:bg-[#F1EBDD]' : ICON_BTN_IDLE
          }`}
          title={pinnedCount > 0 ? `Закріплених повідомлень: ${pinnedCount}` : 'Немає закріплених'}
        >
          <Bookmark className="w-[18px] h-[18px]" strokeWidth={1.75} />
          {pinnedCount > 0 && (
            <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-[#D96C35] rounded-full ring-2 ring-[#FDFCF9]" />
          )}
        </button>

        {/* Audio / Video Huddle Quick Toggle */}
        <button
          onClick={() => {
            soundFx.playTap();
            onToggleHuddle();
          }}
          className={`${ICON_BTN} ${
            isHuddleActive ? 'bg-[#D96C35] text-[#FDFCF9]' : ICON_BTN_IDLE
          }`}
          title={isHuddleActive ? 'Залишити кімнату дзвінка' : 'Запустити зв\'язок (аудіо/відео)'}
          aria-label={isHuddleActive ? 'В ефірі' : 'Дзвінок'}
        >
          <Phone className="w-[18px] h-[18px]" strokeWidth={1.75} />
        </button>

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
                  <VolumeX className="w-4 h-4 text-[#98A092] shrink-0" strokeWidth={1.75} />
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
    </header>
  );
};
