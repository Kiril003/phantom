import React, { useEffect, useRef, useState } from 'react';
import { useMessengerStore } from '../../stores/messengerStore';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { phantomRelayService } from '../../services/phantomRelayService';
import { wsClient } from '../../services/websocket';
import { messengerNetworkEngine } from '../../services/messengerNetworkEngine';
import { globalP2PMesh } from '../../services/globalP2PMesh';
import { storagePersistence } from '../../services/storagePersistence';
import type { NetworkDiagnostics } from '../../types/messenger';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ChatArea, type ChatAreaHandle } from './ChatArea';
import { MessageComposer } from './MessageComposer';
import { MultiSelectBar } from './MultiSelectBar';

// Modals & Drawers
import { ActionHubModal } from './ActionHubModal';
import { ChatDigestModal } from './ChatDigestModal';
import { CreateChatModal } from './CreateChatModal';
import { DeleteMessageModal } from './DeleteMessageModal';
import { FolderInsightsModal } from './FolderInsightsModal';
import { ForwardMessageModal } from './ForwardMessageModal';
import { GroupDetailsDrawer } from './GroupDetailsDrawer';
import { LocationSheetModal } from './LocationSheetModal';
import { MediaLightboxModal } from './MediaLightboxModal';
import { MessageDetailsModal } from './MessageDetailsModal';
import { P2PNetworkModal } from './P2PNetworkModal';
import { ReactionPickerModal } from './ReactionPickerModal';
import { ScheduleMessageModal } from './ScheduleMessageModal';
import { ScheduledMessagesDrawer } from './ScheduledMessagesDrawer';
import { SettingsModal } from './SettingsModal';
import { ShareFolderModal } from './ShareFolderModal';
import { SmartFolderModal } from './SmartFolderModal';
import { UserProfileModal } from './UserProfileModal';
import { AISynthesisStudioModal } from '../ai-studio/AISynthesisStudioModal';
import { CallOverlay } from './CallOverlay';
import { SpaceNavigator } from './SpaceNavigator';
import { ModalHost } from './modals/ModalHost';
import { useModalStore } from '../../stores/modalStore';
import { callEngine } from '../../services/callEngine';
import { useCallAlerts } from '../../hooks/useCallAlerts';
import { soundFx } from '../../utils/messengerSound';
import type { Message, SmartFolder, FocusModeType } from '../../types/messenger';

interface MessengerRootProps {
  className?: string;
}

export const MessengerRoot: React.FC<MessengerRootProps> = ({ className = '' }) => {
  const store = useMessengerStore();
  const activeChat = store.getActiveChat();
  const [isSearchingInChat, setIsSearchingInChat] = useState(false);
  // Закладка закріпленого живе в шапці, а стрічка — в ChatArea: тримаємо ручку.
  const chatAreaRef = useRef<ChatAreaHandle>(null);
  const [editingSmartFolder, setEditingSmartFolder] = useState<SmartFolder | null>(null);
  const [focusMode, setFocusMode] = useState<FocusModeType>('available');
  const [isHuddleActive, setIsHuddleActive] = useState(false);

  // Sound settings
  const [isSoundEnabled, setIsSoundEnabled] = useState(true);
  // Вхідний дзвінок чутно й видно навіть тоді, коли вкладка не активна.
  useCallAlerts();

  // Перемикач звуку глушить синтезатор, а не лише власну іконку.
  useEffect(() => {
    soundFx.enabled = isSoundEnabled;
  }, [isSoundEnabled]);

  // Scheduled message temporary date
  const [pendingScheduledTime, setPendingScheduledTime] = useState<string | undefined>(undefined);

  // Стрічку забираємо з вузла на вході — до цього показувати нічого.
  useEffect(() => {
    void store.hydrateFromNode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Синхронізація активного користувача сесії (наприклад kiril або kyrylo) та реєстрація слухачів Mesh
  useEffect(() => {
    // Check URL parameters for explicit user identity (e.g. ?u=kyrylo or ?u=kiril)
    let urlUser: string | null = null;
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      urlUser = params.get('u') || params.get('user') || params.get('who');
    }

    const authUser = useAuthStore.getState().user;
    const effectiveUsername = urlUser || authUser?.username || store.currentUser.handle?.replace(/^@/, '') || 'kiril';
    const isKyrylo = effectiveUsername.toLowerCase() === 'kyrylo';

    const uHandle = `@${effectiveUsername.toLowerCase()}`;
    const uId = `u_${effectiveUsername.toLowerCase()}`;

    const savedProfile = storagePersistence.getUserProfileSync();
    const hasMatchingSavedProfile = savedProfile && savedProfile.handle?.toLowerCase() === uHandle.toLowerCase();

    const uName = hasMatchingSavedProfile && savedProfile.name
      ? savedProfile.name
      : (isKyrylo ? 'Кирило (Kyrylo)' : (authUser as any)?.display_name || (effectiveUsername.charAt(0).toUpperCase() + effectiveUsername.slice(1)));

    const uAvatar = hasMatchingSavedProfile && savedProfile.avatar
      ? savedProfile.avatar
      // ВЛАСНЕ ОБЛИЧЧЯ ЛЮДИНИ ПІДМІНЯЛОСЬ ФОТО НЕЗНАЙОМЦЯ. Прибрано 30.08.2026.
      //
      // Тут стояли два посилання на `images.unsplash.com` — знімки чужих
      // людей, які ставали аватаркою власника, якщо він своєї не поставив.
      // Дві біди в одному рядку: чуже обличчя видавалось за твоє, і продукт,
      // який обіцяє працювати без інфраструктури, **ходив по картинку на
      // чужий сервер** при кожному відкритті.
      //
      // Порожньо — чесно: `Avatar` малює ініціали, і це справді ти.
      : (authUser?.avatar_url || store.currentUser.avatar || '');

    const uStatus = hasMatchingSavedProfile && savedProfile.status ? savedProfile.status : store.currentUser.status;
    const uStatusEmoji = hasMatchingSavedProfile && savedProfile.statusEmoji ? savedProfile.statusEmoji : store.currentUser.statusEmoji;
    const uBio = hasMatchingSavedProfile && savedProfile.bio ? savedProfile.bio : store.currentUser.bio;
    const uLocation = hasMatchingSavedProfile && savedProfile.locationName ? savedProfile.locationName : store.currentUser.locationName;
    const uPhone = hasMatchingSavedProfile && savedProfile.phone ? savedProfile.phone : store.currentUser.phone;

    store.updateCurrentUser({
      id: uId,
      name: uName,
      handle: uHandle,
      avatar: uAvatar,
      status: uStatus,
      statusEmoji: uStatusEmoji,
      bio: uBio,
      locationName: uLocation,
      phone: uPhone,
    });

    globalP2PMesh.init(uId, uName, uHandle, uAvatar);

    // Auto-select peer chat if opening as specific user
    if (urlUser) {
      const targetPeerChatId = isKyrylo ? 'chat_dm_kiril' : 'chat_dm_kyrylo';
      const existing = store.chats.find((c) => c.id === targetPeerChatId);
      if (existing) {
        store.setActiveChat(targetPeerChatId);
      }
    }

    const offMsg = globalP2PMesh.onMessage((packet) => {
      if (packet.type === 'message:new' && packet.payload) {
        const msg = packet.payload;
        const recipientConvId = packet.senderHandle ? `chat_dm_${packet.senderHandle}` : (packet.chatId || 'chat_dm_peer');
        store.applyNodeMessage({
          ...msg,
          id: msg.id || `msg_${Date.now()}`,
          conversation_id: recipientConvId,
          client_id: msg.id,
          seq: Date.now(),
          author_id: packet.senderId,
          author_name: packet.senderName,
          kind: msg.type || 'text',
          type: msg.type || 'text',
          body: msg.text || '',
          text: msg.text || '',
          transport: 'p2p',
          sent_at: new Date(packet.timestamp).toISOString(),
          edited_at: null,
          deleted_at: null,
          delivery: 'sent',
          senderId: packet.senderId,
          senderName: packet.senderName,
          senderHandle: packet.senderHandle,
          senderAvatar: packet.senderAvatar,
        } as any);
      }
    });

    const offCall = globalP2PMesh.onCallSignal((signal) => {
      if (signal) {
        void callEngine.onSignal(signal);
      }
    });

    return () => {
      offMsg();
      offCall();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.currentUser.handle, store.currentUser.id]);

  // Диспетчер запланованих повідомлень: перевіряє чергу кожні 10 секунд
  useEffect(() => {
    const timer = setInterval(() => {
      const state = useMessengerStore.getState();
      const now = new Date();
      const curH = String(now.getHours()).padStart(2, '0');
      const curM = String(now.getMinutes()).padStart(2, '0');
      const curTime = `${curH}:${curM}`;

      state.scheduledMessages.forEach((sched) => {
        if (sched.scheduledTime === curTime && sched.text) {
          void state.sendScheduledNow(sched.id);
        }
      });
    }, 10000);

    return () => clearInterval(timer);
  }, []);

  // Дзвінки: рушій слухає сигнали вузла, поки месенджер відкритий. Кнопки
  // слухавки в шапці кидають сюди 'phantom:start-call'.
  useEffect(() => {
    const detach = callEngine.attach();
    const onStart = (event: Event) => {
      const detail = (event as CustomEvent).detail ?? {};
      const chat = store.getActiveChat();
      const peerNodeId = detail.peerNodeId ?? chat?.peerNodeId ?? chat?.id ?? 'node_direct_peer';
      void callEngine.startCall(
        {
          contactId: detail.contactId,
          peerNodeId,
          displayName: detail.displayName ?? chat?.title ?? 'Співрозмовник',
          // Стан звірки їде разом з імʼям: у дзвінку його вже нема де взяти.
          verified: detail.verified ?? chat?.contactVerified ?? true,
        },
        detail.video ? 'video' : 'audio',
      );
    };
    window.addEventListener('phantom:start-call', onStart);
    return () => {
      window.removeEventListener('phantom:start-call', onStart);
      detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Стан ретранслятора опитуємо, лише поки месенджер відкритий.
  useEffect(() => {
    phantomRelayService.start();
    return () => phantomRelayService.stop();
  }, []);

  // Заголовок малює канал із живої діагностики рушія та WebSocket вузла.
  const [diagnostics, setDiagnostics] = useState<NetworkDiagnostics | null>(null);
  const [isWsConnected, setIsWsConnected] = useState<boolean>(true);

  useEffect(() => {
    const off = messengerNetworkEngine.onDiagnostics(setDiagnostics);
    const offConnect = wsClient.onConnect(() => setIsWsConnected(true));
    const offDisconnect = wsClient.onDisconnect(() => setIsWsConnected(false));
    return () => {
      off();
      offConnect();
      offDisconnect();
    };
  }, []);

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useModalStore.getState().openModal('commandPalette');
      } else if ((e.metaKey || e.ctrlKey) && (e.key === '\\' || e.key === '|')) {
        e.preventDefault();
        setIsSidebarCollapsed((prev) => !prev);
      } else if ((e.metaKey || e.ctrlKey) && e.key === '`') {
        e.preventDefault();
        useModalStore.getState().openModal('liveTerminal');
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const eventMap: Record<string, any> = {
      'phantom:open-automations': 'automations',
      'phantom:open-datagrid': 'dataGrid',
      'phantom:open-timemachine': 'timeMachine',
      'phantom:open-zerotrace': 'zeroTrace',
      'phantom:open-iot': 'iotTelemetry',
      'phantom:open-academy': 'academyHub',
      'phantom:open-family': 'familyHub',
      'phantom:open-creative': 'creativeStudio',
      'phantom:open-personal': 'personalWellness',
      'phantom:open-community': 'communityClub',
      'phantom:open-lifecycle': 'dataLifecycle',
      'phantom:open-zeroleak': 'zeroLeakSecurity',
      'phantom:open-wasm': 'wasmSandbox',
      'phantom:open-p2pcompute': 'p2pCompute',
      'phantom:open-ambient': 'ambientContext',
      'phantom:open-bridge': 'universalBridge',
      'phantom:open-schema': 'protocolSchema',
      'phantom:open-neuro': 'neuroErgonomics',
      'phantom:open-lora': 'loRaWalkie',
      'phantom:open-semanticbus': 'semanticBus',
      'phantom:open-projections': 'spatialProjections',
      'phantom:open-governance': 'resourceGovernance',
      'phantom:open-gitdevops': 'gitDevOps',
      'phantom:open-academiclms': 'academicLms',
      'phantom:open-corporatehr': 'corporateHR',
      'phantom:open-commerce': 'commerceMicroApps',
      'phantom:open-headless': 'headlessInfra',
      'phantom:open-erp': 'localErpEscrow',
      'phantom:open-secops': 'secOpsCompliance',
      'phantom:open-research': 'advancedResearch',
      'phantom:open-vfs': 'phantomRuntime',
      'phantom:open-disaster': 'disasterMesh',
      'phantom:open-warroom': 'autonomousOps',
      'phantom:open-biocontext': 'humanCentricBio',
      'phantom:open-vis3d': 'interactiveVis3D',
      'phantom:open-whiteboard': 'collaborativeWhiteboard',
      'phantom:open-poker': 'planningPokerGantt',
      'phantom:open-multipane': 'spatialMultiPane',
      'phantom:open-mediaannotation': 'mediaAnnotation',
      'phantom:open-breadcrumbs': 'breadcrumbsPeek',
      'phantom:open-statemachine': 'stateMachinePipeline',
      'phantom:open-codediff': 'codeDiffMathHex',
      'phantom:open-presentation': 'canvasPresentation',
      'phantom:open-spotlight': 'spotlightBounties',
      'phantom:open-blueprint': 'blueprint',
      'phantom:open-agentic': 'agenticRuntime',
      'phantom:open-physical': 'physicalComputing',
    };

    const listeners: Array<{ name: string; fn: (e: any) => void }> = [];
    Object.entries(eventMap).forEach(([eventName, modalType]) => {
      const fn = (e: any) => useModalStore.getState().openModal(modalType, e?.detail);
      window.addEventListener(eventName, fn);
      listeners.push({ name: eventName, fn });
    });

    const onDirectOpen = (e: any) => {
      if (e?.detail?.type) useModalStore.getState().openModal(e.detail.type, e.detail.props);
    };
    window.addEventListener('phantom:open-modal', onDirectOpen);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('phantom:open-modal', onDirectOpen);
      listeners.forEach(({ name, fn }) => window.removeEventListener(name, fn));
    };
  }, []);

  // Вужче за 768 колонка одна: показуємо або список, або відкриту розмову.
  // Пошук завжди повертає до списку — шукають саме в ньому.
  const showList = !activeChat || !!store.searchQuery;

  return (
    <div className={`messenger-scale flex w-full h-full bg-[#F7F5EE] text-[#1E2521] overflow-hidden select-none relative font-sans ${className}`}>
      {/* Рейка просторів: список → простір → топік. Стоїть ПЕРЕД списком,
          бо простір — рівень вище за розмову. */}
      <div className={`${showList ? 'flex' : 'hidden'} md:flex h-full shrink-0`}>
        <SpaceNavigator me={store.currentUser.id} />
      </div>

      {/* 1. Left Sidebar (Workspaces, Folders, Circles, Chats) */}
      {!isSidebarCollapsed && (
        <div className={`${showList ? 'flex' : 'hidden'} md:flex w-full md:w-auto h-full shrink-0 transition-all duration-200`}>
          <Sidebar
          currentUser={store.currentUser}
          chats={store.chats}
          activeChatId={store.activeChatId}
          activeFolderId={store.activeFolderId || 'all'}
          smartFolders={store.smartFolders}
          onSelectChat={(chatId) => store.setActiveChat(chatId)}
          onSelectFolder={(folderId) => store.setActiveFolder(folderId)}
          onAddChatToFolder={(folderId, chatId) => store.addChatToFolder(folderId, chatId)}
          onRemoveChatFromFolder={(folderId, chatId) => store.removeChatFromFolder(folderId, chatId)}
          onOpenCreateFolder={() => {
            setEditingSmartFolder(null);
            store.setSmartFolderModalOpen(true);
          }}
          onOpenEditFolder={(folder) => {
            setEditingSmartFolder(folder);
            store.setSmartFolderModalOpen(true);
          }}
          onDeleteFolder={(folderId) => store.deleteFolder(folderId)}
          onNewChat={() => store.setCreateChatModalOpen(true)}
          onOpenUserProfile={() => store.setProfileModalOpen(true)}
          onOpenSettings={() => store.setSettingsModalOpen(true)}
          onOpenP2PNetworkModal={() => store.setP2PModalOpen(true)}
          onSwitchPersonaSphere={(sphere) => store.switchPersonaSphere(sphere)}
        />
        </div>
      )}

      {/* 2. Main Chat Area */}
      {activeChat ? (
        <div className={`${showList ? 'hidden' : 'flex'} md:flex flex-1 flex-col h-full min-w-0 bg-[#F7F5EE] relative overflow-hidden`}>
          {/* Header */}
          <Header
            activeTransportStatus={
              diagnostics?.activeStatus && diagnostics.activeStatus !== 'offline'
                ? diagnostics.activeStatus
                : isWsConnected
                  ? 'server-ws'
                  : 'offline'
            }
            transportMode={diagnostics?.transportMode || 'auto'}
            networkLatencyMs={diagnostics?.latencyMs ?? (isWsConnected ? 12 : null)}
            currentChat={activeChat}
            currentUser={store.currentUser}
            onOpenDigest={() => store.setDigestModalOpen(true)}
            onOpenActions={/* «Хаб дій» сховано з бети 30.08.2026.
               Дев'ять типів дій, і жоден не доїжджає: дріт несе сім ІНШИХ
               типів (WIRE_KINDS у messenger/blobs.py), а тутешні на тому
               кінці вироджувались би в текст. Два, які МОЖУТЬ бути
               справжніми — файл і точка на мапі, — уже є в композері поруч
               (скріпка й геоточка), причому через звичайний шлях доставки
               зі станами і скринькою вихідних.
               Тобто хаб не додавав жодної спроможності, зате додавав
               чотирьох вигаданих людей і дії, що зникали при перезавантаженні:
               вставка йшла через `addCustomMessage`, а той лише міняв
               локальний стан. Код лишається; повернемо разом із протокольною
               правкою, коли типи можна буде звірити з обох боків. */
            undefined}
            onOpenScheduledMessages={() => store.setScheduledDrawerOpen(true)}
            scheduledMessagesCount={store.getScheduledForActiveChat().length}
            onOpenSettings={() => store.setSettingsModalOpen(true)}
            onOpenGroupDetails={() => store.setGroupDetailsOpen(true)}
            isSoundEnabled={isSoundEnabled}
            onToggleSound={() => setIsSoundEnabled(!isSoundEnabled)}
            isSearching={isSearchingInChat}
            onToggleSearch={() => setIsSearchingInChat(!isSearchingInChat)}
            pinnedCount={activeChat.messages.filter((m) => m.isPinned).length}
            onScrollToPinned={() => chatAreaRef.current?.scrollToPinned()}
            onOpenP2PNetworkModal={() => store.setP2PModalOpen(true)}
            onOpenKnowledgeSearch={() => useModalStore.getState().openModal('knowledgeSearch')}
            onOpenWorkspaceDrive={() => useModalStore.getState().openModal('workspaceDrive')}
            // «Контекстні ролі» сховано з бети 29.08.2026: екран не звертався
            // до вузла жодного разу, а вся команда в ньому була вигадана —
            // «Кирило», «Саня (Lead Dev)», «Марина (Designer)», «Олександр
            // (Client/QA)» з фотографіями з чужого сервера. Прибрати вигаданих
            // означало б лишити порожню кімнату, а двері в порожню кімнату в
            // беті бути не може. Код лишається на місці; повернемо, коли ролі
            // прийдуть із вузла.
            onOpenRoleScopes={undefined}
            onOpenP2PSwarm={() => useModalStore.getState().openModal('p2pSwarm')}
            onOpenWebhooks={() => useModalStore.getState().openModal('webhooks')}
            onOpenTerminal={() => useModalStore.getState().openModal('liveTerminal')}
            onOpenMemoryGraph={() => useModalStore.getState().openModal('memoryGraph')}
            onOpenNodeDashboard={() => useModalStore.getState().openModal('nodeDashboard')}
            onOpenSpaceVault={() => useModalStore.getState().openModal('spaceVault')}
            onOpenCommandPalette={() => useModalStore.getState().openModal('commandPalette')}
            onOpenAutomations={() => useModalStore.getState().openModal('automations')}
            onOpenDataGrid={() => useModalStore.getState().openModal('dataGrid')}
            onOpenTimeMachine={() => useModalStore.getState().openModal('timeMachine')}
            onOpenZeroTrace={() => useModalStore.getState().openModal('zeroTrace')}
            onOpenIoTTelemetry={() => useModalStore.getState().openModal('iotTelemetry')}
            focusMode={focusMode}
            onFocusModeChange={setFocusMode}
            isHuddleActive={isHuddleActive}
            onStartHuddle={() => setIsHuddleActive(true)}
            onLeaveHuddle={() => setIsHuddleActive(false)}
            onBack={() => store.setActiveChat('')}
            onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            isSidebarCollapsed={isSidebarCollapsed}
          />

          {/* Messages Feed */}
          <div className="flex-1 min-h-0 relative">
            <ChatArea
              ref={chatAreaRef}
              currentChat={activeChat}
              messages={activeChat.messages}
              currentUserId={store.currentUser.id}
              onOpenLocation={(loc) => store.openLocationSheet(loc)}
              onVotePoll={(msgId, optId) => store.votePoll(msgId, optId)}
              onPayBillShare={(msgId, payerId) => store.payBillShare(msgId, payerId)}
              onAddReaction={(msgId, emoji) => store.addReaction(msgId, emoji)}
              onReplyMessage={(msg, quoted) => store.startReply(msg, quoted)}
              onEditMessage={(msg) => store.startEdit(msg)}
              // Вибір «для всіх / для себе» людина вже зробила у вікні ChatArea.
              // Тут стояло відкриття ДРУГОГО такого ж вікна, і вибір із першого
              // мовчки губився — саме тому «для всіх» не робило нічого.
              onDeleteMessage={(msgId, forEveryone) => {
                void store.deleteMessage(msgId, Boolean(forEveryone));
              }}
              onTogglePinMessage={(msgId) => store.togglePinMessage(msgId)}
              onForwardMessage={(msg) => store.openForwardModal(msg)}
              onSelectMemberByName={(_name) => {}}
              selectedMessageIds={store.selectedMessageIds}
              onToggleSelectMessage={(msgId) => store.toggleSelectMessage(msgId)}
              isSelectionMode={store.multiSelectMode}
              onUpdateTableData={(msgId, data) => store.updateTableData(msgId, data)}
              onUpdateTaskListData={(msgId, tasks) => store.updateTaskListData(msgId, tasks)}
              onOpenImageLightbox={(url, title) => store.openLightbox(url, title)}
              isSearching={isSearchingInChat}
              onCloseSearch={() => setIsSearchingInChat(false)}
            />
          </div>

          {/* Multi-Select Floating Action Bar */}
          {store.multiSelectMode && (
            <MultiSelectBar
              selectedCount={store.selectedMessageIds.length}
              onClearSelection={store.clearSelection}
              onSynthesize={() => {}}
              onCreateMultiQuote={() => {}}
              onCopyAll={() => {
                const selectedMsgs = activeChat.messages.filter((m) =>
                  store.selectedMessageIds.includes(m.id)
                );
                const text = selectedMsgs.map((m) => `${m.senderName}: ${m.text || m.type}`).join('\n');
                navigator.clipboard.writeText(text);
                store.clearSelection();
              }}
              onForward={() => {
                const firstMsg = activeChat.messages.find((m) =>
                  store.selectedMessageIds.includes(m.id)
                );
                if (firstMsg) store.openForwardModal(firstMsg);
              }}
            />
          )}

          {/* Composer Input Bar */}
          <MessageComposer
            onSendMessage={(text, scheduledTime) => {
              if (scheduledTime) {
                store.addScheduledMessage(scheduledTime, text);
                setPendingScheduledTime(undefined);
              } else {
                store.sendMessage(text);
              }
            }}
            onSendVoiceMessage={(dur, transcript, audioUrl, waveform) => {
              store.sendVoiceMessage(dur, transcript, audioUrl, waveform);
            }}
            onOpenActions={/* «Хаб дій» сховано з бети 30.08.2026.
               Дев'ять типів дій, і жоден не доїжджає: дріт несе сім ІНШИХ
               типів (WIRE_KINDS у messenger/blobs.py), а тутешні на тому
               кінці вироджувались би в текст. Два, які МОЖУТЬ бути
               справжніми — файл і точка на мапі, — уже є в композері поруч
               (скріпка й геоточка), причому через звичайний шлях доставки
               зі станами і скринькою вихідних.
               Тобто хаб не додавав жодної спроможності, зате додавав
               чотирьох вигаданих людей і дії, що зникали при перезавантаженні:
               вставка йшла через `addCustomMessage`, а той лише міняв
               локальний стан. Код лишається; повернемо разом із протокольною
               правкою, коли типи можна буде звірити з обох боків. */
            undefined}
            onOpenScheduler={() => store.setScheduleModalOpen(true)}
            onOpenScheduledList={() => store.setScheduledDrawerOpen(true)}
            scheduledCountInCurrentChat={store.getScheduledForActiveChat().length}
            replyingTo={store.replyingTo}
            onCancelReply={() => store.cancelReply()}
            editingMessage={store.editingMessage}
            onCancelEdit={() => store.cancelEdit()}
            onSaveEdit={(msgId, newText) => {
              void store.editMessage(msgId, newText);
              store.cancelEdit();
            }}
            selectedMessagesForQuote={[]}
            onSynthesizeMultiQuote={(_title, _comment) => {}}
            onClearSelectedQuotes={() => {}}
            scheduledTime={pendingScheduledTime}
            onClearScheduledTime={() => setPendingScheduledTime(undefined)}
            chatMembers={activeChat.members || []}
            chatId={activeChat.id}
            initialDraft={store.drafts[activeChat.id] || ''}
            onDraftChange={(cId, text) => store.setDraft(cId, text)}
          />
        </div>
      ) : (
        // На телефоні колонка одна: або список, або розмова. Заставка «Оберіть
        // бесіду» там відбирала б у списку половину екрана й пропонувала
        // вибрати зі списку, якого не видно.
        <div className="hidden md:flex flex-1 flex-col items-center justify-center p-8 text-center bg-[#F7F5EE] select-none">
          <div className="w-[72px] h-[72px] rounded-[16px] bg-[#F1EBDD] border border-[#E8E1D3] flex items-center justify-center text-[22px] mb-4">
            💬
          </div>
          <h2 className="font-semibold text-[18px] text-[#1E2521] mb-1.5 tracking-tight">Оберіть бесіду</h2>
          <p className="text-[14px] text-[color:var(--msg-meta)] max-w-sm leading-relaxed">
            Виберіть чат зі списку ліворуч або створіть новий простір для співпраці та спілкування
          </p>
        </div>
      )}

      {/* 3. Global Modals & Drawers */}
      <ActionHubModal
        isOpen={store.isActionHubOpen}
        onClose={() => store.setActionHubOpen(false)}
        chat={activeChat}
        onInsertAction={(actionPayload) => {
          if (activeChat) {
            const completeMsg: Message = {
              id: `msg_${Date.now()}`,
              senderId: store.currentUser.id,
              senderName: store.currentUser.name,
              senderAvatar: store.currentUser.avatar,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              ...actionPayload,
            };
            store.addCustomMessage(completeMsg);
            // Вузол таких типів не возить: у `WIRE_KINDS` немає ані `poll`,
            // ані `event`, ані `split-bill`. Рядок лягає лише в наш стор,
            // тобто співрозмовник не побачить його НІКОЛИ. Мовчати про це
            // означало б, що людина складе опитування, чекатиме голосів і не
            // дізнається, що його ніхто не отримав.
            useUIStore.getState().toast({
              kind: 'info',
              message: 'Лишається на цьому пристрої — вузол таких карток ще не возить',
            });
          }
        }}
      />

      <CreateChatModal
        isOpen={store.isCreateChatModalOpen}
        onClose={() => store.setCreateChatModalOpen(false)}
        onConversationReady={async (conversationId) => {
          // Розмову вже створив вузол — забираємо її в список і відкриваємо.
          store.setCreateChatModalOpen(false);
          await store.refreshConversations();
          store.setActiveChat(conversationId);
        }}
      />

      <SmartFolderModal
        isOpen={store.isSmartFolderModalOpen}
        onClose={() => {
          store.setSmartFolderModalOpen(false);
          setEditingSmartFolder(null);
        }}
        folderToEdit={editingSmartFolder}
        chats={store.chats}
        onSaveFolder={(folderData) => {
          if (editingSmartFolder) {
            store.updateFolder(editingSmartFolder.id, folderData);
          } else {
            store.createFolder(folderData);
          }
          store.setSmartFolderModalOpen(false);
          setEditingSmartFolder(null);
        }}
        onDeleteFolder={(folderId) => store.deleteFolder(folderId)}
      />

      {store.smartFolders.length > 0 && (
        <>
          <FolderInsightsModal
            isOpen={store.isFolderInsightsOpen}
            onClose={() => store.setFolderInsightsOpen(false)}
            folder={store.smartFolders[0]}
            chats={store.chats}
          />
          <ShareFolderModal
            isOpen={store.isShareFolderOpen}
            onClose={() => store.setShareFolderOpen(false)}
            folder={store.smartFolders[0]}
            chats={store.chats}
          />
        </>
      )}

      {activeChat && (
        <ChatDigestModal
          isOpen={store.isDigestModalOpen}
          onClose={() => store.setDigestModalOpen(false)}
          chat={activeChat}
        />
      )}

      {activeChat && (
        <GroupDetailsDrawer
          isOpen={store.isGroupDetailsOpen}
          onClose={() => store.setGroupDetailsOpen(false)}
          chat={activeChat}
          onSelectMember={(_m) => {}}
          onAddMember={() => {
            // Складу групи вузол після створення не міняє: маршруту немає, а
            // кожен учасник має свій шифрований кадр, тож додати його тихо в
            // інтерфейсі означало б показати людину, якій нічого не доїде.
            useUIStore.getState().toast({
              kind: 'error',
              message: 'Склад групи задається при створенні — змінити його вузол поки не вміє',
            });
          }}
          onTogglePinChat={(chatId) => store.togglePinChat(chatId)}
          onOpenImageLightbox={(url, title) => store.openLightbox(url, title)}
          onUpdateChatSettings={(chatId, updated) => store.updateChat(chatId, updated)}
        />
      )}

      <UserProfileModal
        isOpen={store.isProfileModalOpen}
        onClose={() => store.setProfileModalOpen(false)}
        currentUser={store.currentUser}
        onUpdateCurrentUser={(updated) => store.updateCurrentUser(updated)}
      />

      <P2PNetworkModal
        isOpen={store.isP2PModalOpen}
        onClose={() => store.setP2PModalOpen(false)}
        currentChatTitle={activeChat?.title}
      />

      <SettingsModal
        isOpen={store.isSettingsModalOpen}
        onClose={() => store.setSettingsModalOpen(false)}
        isSoundEnabled={isSoundEnabled}
        onToggleSound={() => setIsSoundEnabled(!isSoundEnabled)}
        onExportAllData={() => {
          // Забрати своє — це те, що відрізняє власника даних від гостя.
          // Вивантажуємо РІВНО те, що є на цьому пристрої, нічого не
          // добираючи з вигадки: чого не знаємо, того й не пишемо.
          const store = useMessengerStore.getState();
          const dump = {
            exported_at: new Date().toISOString(),
            note: 'Вивантажено з цього пристрою. Те, що не доїхало, сюди не потрапило.',
            conversations: store.chats.map((c) => ({
              id: c.id,
              title: c.title,
              kind: c.type,
              peer_node_id: c.peerNodeId ?? null,
              messages: (c.messages ?? []).map((m) => ({
                id: m.id,
                author: m.isSelf ? 'я' : m.senderName,
                at: m.sentAt ?? m.timestamp ?? null,
                kind: m.type,
                text: m.text ?? null,
                status: m.status ?? null,
              })),
            })),
          };
          const blob = new Blob([JSON.stringify(dump, null, 2)], {
            type: 'application/json',
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `phantom-messenger-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(url);
          const count = dump.conversations.reduce((n, c) => n + c.messages.length, 0);
          useUIStore.getState().toast({
            kind: 'success',
            message: `Вивантажено ${dump.conversations.length} розмов, ${count} листів`,
          });
        }}
        onOpenP2PNetworkModal={() => store.setP2PModalOpen(true)}
      />

      <ScheduleMessageModal
        isOpen={store.isScheduleModalOpen}
        onClose={() => store.setScheduleModalOpen(false)}
        onSchedule={(timeStr) => {
          setPendingScheduledTime(timeStr);
          store.setScheduleModalOpen(false);
        }}
      />

      <ScheduledMessagesDrawer
        isOpen={store.isScheduledDrawerOpen}
        onClose={() => store.setScheduledDrawerOpen(false)}
        scheduledMessages={store.scheduledMessages}
        currentChatId={activeChat?.id || ''}
        chats={store.chats}
        onSendNow={(id) => void store.sendScheduledNow(id)}
        onDeleteScheduled={(id) => store.cancelScheduledMessage(id)}
        onUpdateScheduled={(_id, _updated) => {}}
        onCreateScheduled={(newSched) => store.addScheduledMessage(newSched.scheduledTime, newSched.text || '')}
      />

      <LocationSheetModal
        location={store.activeLocationData}
        isOpen={!!store.activeLocationData}
        onClose={() => store.closeLocationSheet()}
      />

      <MediaLightboxModal
        isOpen={store.isMediaLightboxOpen}
        onClose={() => store.closeLightbox()}
        mediaUrl={store.activeLightboxUrl}
        mediaTitle={store.activeLightboxTitle || undefined}
      />

      <MessageDetailsModal
        isOpen={!!store.activeDetailsMessage}
        onClose={() => store.closeMessageDetails()}
        message={store.activeDetailsMessage}
        chatTitle={activeChat?.title}
      />

      <ForwardMessageModal
        isOpen={store.isForwardModalOpen}
        onClose={() => store.closeForwardModal()}
        chats={store.chats}
        currentChatId={activeChat?.id || ''}
        messagesToForward={store.activeForwardMessage ? [store.activeForwardMessage] : []}
        onConfirmForward={(targetChatId) => {
          if (store.activeForwardMessage) {
            void store.forwardMessage(store.activeForwardMessage, targetChatId);
          }
        }}
      />

      <DeleteMessageModal
        isOpen={store.isDeleteModalOpen}
        onClose={() => store.closeDeleteModal()}
        isSelfMessage={store.activeDeleteMessage?.isSelf ?? true}
        messageTextPreview={store.activeDeleteMessage?.text}
        onConfirmDelete={(deleteForEveryone) => {
          if (store.activeDeleteMessage) {
            void store.deleteMessage(store.activeDeleteMessage.id, deleteForEveryone);
          }
          store.closeDeleteModal();
        }}
      />

      <ReactionPickerModal
        isOpen={!!store.reactionPickerState?.isOpen}
        onClose={() => store.closeReactionPicker()}
        onSelectEmoji={(emoji) => {
          if (store.reactionPickerState?.messageId) {
            store.addReaction(store.reactionPickerState.messageId, emoji);
          }
          store.closeReactionPicker();
        }}
      />

      {/* Dynamic Super-App & Work OS Domain Modals */}
      <ModalHost />

      {/* AI Synthesis Lab & Companion Studio Modal */}
      <AISynthesisStudioModal />

      <CallOverlay />
    </div>
  );
};
