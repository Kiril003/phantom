import React, { useState } from 'react';
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
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  return (
    <header className="min-h-[3.75rem] pt-[var(--sat)] px-3 sm:px-6 bg-[#121A15]/95 backdrop-blur-xl border-b border-[#1F2B22] flex items-center justify-between gap-2 sm:gap-3 select-none shrink-0 z-20 shadow-sm">
      {/* 1. Left Chat Identity & Mobile Back Button */}
      <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 flex-1 py-2">
        {/* Mobile Back Button */}
        {onBack && (
          <button
            onClick={() => {
              soundFx.playTap();
              onBack();
            }}
            className="md:hidden w-10 h-10 -ml-1.5 text-[#8EA093] hover:text-white hover:bg-[#1A251E] rounded-full transition-colors shrink-0 active:scale-90 flex items-center justify-center"
            title="Назад до списку бесід"
            aria-label="Назад"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        <div
          onClick={() => {
            soundFx.playTap();
            onOpenGroupDetails();
          }}
          className="flex items-center gap-2.5 sm:gap-3 min-w-0 cursor-pointer group flex-1"
          title="Переглянути деталі бесіди, учасників та медіа"
        >
          <div className="relative shrink-0">
            <img
              src={currentChat.avatar}
              alt={currentChat.title}
              className="w-10 h-10 rounded-2xl object-cover ring-1 ring-white/10 shadow-sm group-hover:scale-105 transition-transform"
            />
            {currentChat.isOnline && (
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 sm:w-3 sm:h-3 bg-[#10B981] rounded-full ring-2 ring-[#121A15]" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <h2 className="font-extrabold text-sm sm:text-base text-white truncate group-hover:text-[#55C778] transition-colors">
                {currentChat.title}
              </h2>
              <span className="hidden xs:inline-block px-2 py-0.5 bg-[#1B271F] text-[#55C778] text-[10px] font-bold rounded-md uppercase border border-[#2B3E31] shrink-0">
                {currentChat.circle?.toUpperCase() || 'CORE'}
              </span>
            </div>

            {currentChat.contactVerified === false && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-bold text-[#F4AF25]"
                title="Звірте число безпеки в налаштуваннях, розділ «Мережа & P2P»"
              >
                <AlertTriangle className="w-3 h-3" />
                Співрозмовника не звірено
              </span>
            )}
            {currentChat.contactVerified === true && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#55C778]">
                <ShieldCheck className="w-3 h-3" />
                Звірено
              </span>
            )}
            <p className="text-[11px] sm:text-xs text-[#8EA093] truncate">
              {currentChat.topic || currentChat.customVibe || currentChat.description || ''}
            </p>
          </div>
        </div>
      </div>

      {/* 2. Right Action Controls */}
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 relative">
        
        {/* Стан каналу. Показуємо тільки те, що виміряно: жодного замка,
            поки наскрізного шифрування немає, і жодних мілісекунд без пінга. */}
        {onOpenP2PNetworkModal && (
          <button
            onClick={() => {
              soundFx.playTap();
              onOpenP2PNetworkModal();
            }}
            className={`hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold border transition-all active:scale-95 shadow-sm ${
              activeTransportStatus === 'p2p-direct'
                ? 'bg-[#18261D] hover:bg-[#203327] text-[#55C778] border-[#294231]'
                : activeTransportStatus === 'server-ws' || activeTransportStatus === 'relay-node'
                ? 'bg-[#152332] hover:bg-[#1C2F44] text-[#60A5FA] border-[#243E5E]'
                : activeTransportStatus === 'connecting'
                ? 'bg-[#2A2013] hover:bg-[#382B1A] text-[#FBBF24] border-[#4D3A1F]'
                : 'bg-[#2A1A1A] hover:bg-[#3A2323] text-[#F87171] border-[#4D2727]'
            }`}
            title="Стан каналу — натисніть для діагностики мережі"
          >
            {activeTransportStatus === 'p2p-direct' ? (
              <>
                <ArrowDownUp className="w-3 h-3 text-[#55C778]" />
                <span className="truncate max-w-[110px]">Прямий канал · DTLS</span>
              </>
            ) : activeTransportStatus === 'server-ws' ? (
              <>
                <Globe className="w-3 h-3 text-[#60A5FA]" />
                <span className="truncate max-w-[110px]">Вузол</span>
              </>
            ) : activeTransportStatus === 'relay-node' ? (
              <>
                <Radio className="w-3 h-3 text-[#60A5FA]" />
                <span className="truncate max-w-[110px]">Ретранслятор</span>
              </>
            ) : activeTransportStatus === 'connecting' || activeTransportStatus === 'fallback-server' ? (
              <>
                <Radio className="w-3 h-3 text-[#F4AF25] animate-pulse" />
                <span>З'єднання…</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 text-[#F87171]" />
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
          className="hidden sm:flex p-2 text-[#8EA093] hover:text-white hover:bg-[#1A251E] rounded-xl transition-colors"
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
          className={`p-2 rounded-xl transition-colors relative ${
            pinnedCount > 0
              ? 'text-[#F4AF25] hover:bg-[#2A2214]'
              : 'text-[#8EA093] hover:text-white hover:bg-[#1A251E]'
          }`}
          title={pinnedCount > 0 ? `Закріплених повідомлень: ${pinnedCount}` : 'Немає закріплених'}
        >
          <Bookmark className="w-4 h-4" />
          {pinnedCount > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-[#F4AF25] rounded-full ring-2 ring-[#121A15]" />
          )}
        </button>

        {/* Audio / Video Huddle Quick Toggle */}
        <button
          onClick={() => {
            soundFx.playTap();
            onToggleHuddle();
          }}
          className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm active:scale-95 ${
            isHuddleActive
              ? 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse'
              : 'bg-[#55C778] hover:bg-[#46AF68] text-[#0C120E] shadow-[0_0_15px_rgba(85,199,120,0.25)]'
          }`}
          title={isHuddleActive ? 'Залишити кімнату дзвінка' : 'Запустити студійний зв\'язок (Аудіо/Відео)'}
        >
          <Phone className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{isHuddleActive ? 'В ефірі' : 'Дзвінок'}</span>
        </button>

        {/* In-Chat Search Trigger */}
        <button
          onClick={() => {
            soundFx.playTap();
            onToggleSearch();
          }}
          className={`p-2 rounded-xl transition-colors ${
            isSearching
              ? 'bg-[#55C778] text-[#0C120E]'
              : 'text-[#8EA093] hover:text-white hover:bg-[#1A251E]'
          }`}
          title="Пошук у поточній бесіді"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* More Actions Menu Button */}
        <button
          onClick={() => {
            soundFx.playTap();
            setShowMoreMenu(!showMoreMenu);
          }}
          className="p-2 text-[#8EA093] hover:text-white hover:bg-[#1A251E] rounded-xl transition-colors"
          title="Більше дій"
        >
          <MoreVertical className="w-4 h-4" />
        </button>

        {/* Dropdown Popover Menu (Dark Obsidian Glass) */}
        {showMoreMenu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowMoreMenu(false)}
            />
            <div className="absolute right-0 top-12 w-64 bg-[#141C16]/98 backdrop-blur-2xl border border-[#2B3C30] rounded-2xl shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150 space-y-0.5 text-[#E4EDE7]">
              
              <button
                onClick={() => {
                  setShowMoreMenu(false);
                  onOpenDigest();
                }}
                className="sm:hidden w-full p-2 rounded-xl text-left text-xs font-semibold flex items-center gap-2 hover:bg-[#1E2A21] text-[#E4EDE7] transition-colors"
              >
                <MessageSquare className="w-4 h-4 text-[#F4AF25]" />
                <span>AI Конспект & Підсумок</span>
              </button>

              {onOpenP2PNetworkModal && (
                <button
                  onClick={() => {
                    setShowMoreMenu(false);
                    onOpenP2PNetworkModal();
                  }}
                  className="w-full p-2 rounded-xl text-left text-xs font-semibold flex items-center gap-2 hover:bg-[#1E2A21] text-[#E4EDE7] transition-colors"
                >
                  <Radio className="w-4 h-4 text-[#55C778]" />
                  <div className="flex-1">
                    <span>Мережевий зв'язок</span>
                    <span className="block text-[10px] text-[#8EA093] font-normal">Транспорт: WebRTC та вузол</span>
                  </div>
                </button>
              )}

              <button
                onClick={() => {
                  setShowMoreMenu(false);
                  onOpenActions();
                }}
                className="w-full p-2 rounded-xl text-left text-xs font-semibold flex items-center gap-2 hover:bg-[#1E2A21] text-[#E4EDE7] transition-colors"
              >
                <Zap className="w-4 h-4 text-[#F4AF25]" />
                <span>Студія карток (таблиці, опитування)</span>
              </button>

              {onOpenScheduledMessages && (
                <button
                  onClick={() => {
                    setShowMoreMenu(false);
                    onOpenScheduledMessages();
                  }}
                  className="w-full p-2 rounded-xl text-left text-xs font-semibold flex items-center justify-between hover:bg-[#1E2A21] text-[#E4EDE7] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[#F4AF25]" />
                    <span>Відкладені повідомлення</span>
                  </div>
                  {scheduledMessagesCount > 0 && (
                    <span className="px-1.5 py-0.2 bg-[#F4AF25] text-[#0C120E] rounded-full text-[10px] font-bold">
                      {scheduledMessagesCount}
                    </span>
                  )}
                </button>
              )}

              <button
                onClick={() => {
                  setShowMoreMenu(false);
                  onToggleSound();
                }}
                className="w-full p-2 rounded-xl text-left text-xs font-semibold flex items-center gap-2 hover:bg-[#1E2A21] text-[#E4EDE7] transition-colors"
              >
                {isSoundEnabled ? <Volume2 className="w-4 h-4 text-[#55C778]" /> : <VolumeX className="w-4 h-4 text-[#8EA093]" />}
                <span>{isSoundEnabled ? 'Звук увімкнено' : 'Звук вимкнено'}</span>
              </button>

              <div className="pt-1 border-t border-[#233127]">
                <button
                  onClick={() => {
                    setShowMoreMenu(false);
                    onOpenSettings();
                  }}
                  className="w-full p-2 rounded-xl text-left text-xs font-semibold flex items-center gap-2 hover:bg-[#1E2A21] text-[#8EA093] hover:text-white transition-colors"
                >
                  <SlidersHorizontal className="w-4 h-4 text-[#8EA093]" />
                  <span>Налаштування месенджера</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  );
};

