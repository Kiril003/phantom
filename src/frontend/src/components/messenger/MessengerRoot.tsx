import React, { useEffect, useRef, useState } from 'react';
import { useMessengerStore } from '../../stores/messengerStore';
import { phantomRelayService } from '../../services/phantomRelayService';
import { wsClient } from '../../services/websocket';
import { messengerNetworkEngine } from '../../services/messengerNetworkEngine';
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
import { CallOverlay } from './CallOverlay';
import { RoleScopesModal } from './RoleScopesModal';
import { WorkspaceDriveModal } from './WorkspaceDriveModal';
import { KnowledgeSearchModal } from './KnowledgeSearchModal';
import { P2PFileSwarmModal } from './P2PFileSwarmModal';
import { WebhooksManagerModal } from './WebhooksManagerModal';
import { CommandPaletteModal } from './CommandPaletteModal';
import { LiveTerminalModal } from './LiveTerminalModal';
import { ProjectMemoryGraphModal } from './ProjectMemoryGraphModal';
import { NodeDashboardModal } from './NodeDashboardModal';
import { SpaceVaultModal } from './SpaceVaultModal';
import { AutomationPipelineModal } from './AutomationPipelineModal';
import { RelationalDataGridModal } from './RelationalDataGridModal';
import { TimeMachineSnapshotModal } from './TimeMachineSnapshotModal';
import { ZeroTraceAirGapModal } from './ZeroTraceAirGapModal';
import { IoTEqsTelemetryModal } from './IoTEqsTelemetryModal';
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
  // Work OS Super-App States
  const [isRoleScopesOpen, setIsRoleScopesOpen] = useState(false);
  const [isWorkspaceDriveOpen, setIsWorkspaceDriveOpen] = useState(false);
  const [isKnowledgeSearchOpen, setIsKnowledgeSearchOpen] = useState(false);
  const [isP2PSwarmOpen, setIsP2PSwarmOpen] = useState(false);
  const [isWebhooksOpen, setIsWebhooksOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isLiveTerminalOpen, setIsLiveTerminalOpen] = useState(false);
  const [isMemoryGraphOpen, setIsMemoryGraphOpen] = useState(false);
  const [isNodeDashboardOpen, setIsNodeDashboardOpen] = useState(false);
  const [isSpaceVaultOpen, setIsSpaceVaultOpen] = useState(false);
  const [isAutomationsOpen, setIsAutomationsOpen] = useState(false);
  const [isDataGridOpen, setIsDataGridOpen] = useState(false);
  const [isTimeMachineOpen, setIsTimeMachineOpen] = useState(false);
  const [isZeroTraceOpen, setIsZeroTraceOpen] = useState(false);
  const [isIoTTelemetryOpen, setIsIoTTelemetryOpen] = useState(false);
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

  // Живі повідомлення з вузла: те, що надіслали з телефона, приходить сюди.
  useEffect(() => {
    wsClient.send({ control: 'subscribe', channels: ['messenger', 'call'] });
    const off = wsClient.on('messenger', (msg: any) => {
      if (msg?.type === 'message:new' && msg?.data) store.applyNodeMessage(msg.data);
      // Видалення — не нове повідомлення: бульбашку треба замінити надгробком,
      // а не дописати рядок. Приїхати може і від співрозмовника, і з іншої
      // вкладки власника, тож слухаємо тим самим каналом.
      if (msg?.type === 'message:deleted' && msg?.data) store.applyNodeDelete(msg.data);
    });
    return () => {
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Дзвінки: рушій слухає сигнали вузла, поки месенджер відкритий. Кнопки
  // слухавки в шапці кидають сюди 'phantom:start-call'.
  useEffect(() => {
    const detach = callEngine.attach();
    const onStart = (event: Event) => {
      const detail = (event as CustomEvent).detail ?? {};
      const chat = store.getActiveChat();
      const peerNodeId = detail.peerNodeId ?? chat?.peerNodeId;
      if (!detail.contactId && !peerNodeId) return;
      void callEngine.startCall(
        {
          contactId: detail.contactId,
          peerNodeId,
          displayName: detail.displayName ?? chat?.title ?? 'Співрозмовник',
          // Стан звірки їде разом з імʼям: у дзвінку його вже нема де взяти.
          verified: detail.verified ?? chat?.contactVerified ?? null,
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

  // Заголовок малює канал із живої діагностики рушія, а не з дефолтних пропів.
  const [diagnostics, setDiagnostics] = useState<NetworkDiagnostics | null>(null);
  useEffect(() => {
    const off = messengerNetworkEngine.onDiagnostics(setDiagnostics);
    return () => {
      off();
    };
  }, []);

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      } else if ((e.metaKey || e.ctrlKey) && (e.key === '\\' || e.key === '|')) {
        e.preventDefault();
        setIsSidebarCollapsed((prev) => !prev);
      } else if ((e.metaKey || e.ctrlKey) && e.key === '`') {
        e.preventDefault();
        setIsLiveTerminalOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const onOpenAut = () => setIsAutomationsOpen(true);
    const onOpenGrid = () => setIsDataGridOpen(true);
    const onOpenTime = () => setIsTimeMachineOpen(true);
    const onOpenZero = () => setIsZeroTraceOpen(true);
    const onOpenIoT = () => setIsIoTTelemetryOpen(true);

    window.addEventListener('phantom:open-automations', onOpenAut);
    window.addEventListener('phantom:open-datagrid', onOpenGrid);
    window.addEventListener('phantom:open-timemachine', onOpenTime);
    window.addEventListener('phantom:open-zerotrace', onOpenZero);
    window.addEventListener('phantom:open-iot', onOpenIoT);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('phantom:open-automations', onOpenAut);
      window.removeEventListener('phantom:open-datagrid', onOpenGrid);
      window.removeEventListener('phantom:open-timemachine', onOpenTime);
      window.removeEventListener('phantom:open-zerotrace', onOpenZero);
      window.removeEventListener('phantom:open-iot', onOpenIoT);
    };
  }, []);

  // Вужче за 768 колонка одна: показуємо або список, або відкриту розмову.
  // Пошук завжди повертає до списку — шукають саме в ньому.
  const showList = !activeChat || !!store.searchQuery;

  return (
    <div className={`messenger-scale flex w-full h-full bg-[#F7F5EE] text-[#1E2521] overflow-hidden select-none relative font-sans ${className}`}>
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
            activeTransportStatus={diagnostics?.activeStatus}
            transportMode={diagnostics?.transportMode}
            networkLatencyMs={diagnostics?.latencyMs ?? null}
            currentChat={activeChat}
            currentUser={store.currentUser}
            onOpenDigest={() => store.setDigestModalOpen(true)}
            onOpenActions={() => store.setActionHubOpen(true)}
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
            onOpenKnowledgeSearch={() => setIsKnowledgeSearchOpen(true)}
            onOpenWorkspaceDrive={() => setIsWorkspaceDriveOpen(true)}
            onOpenRoleScopes={() => setIsRoleScopesOpen(true)}
            onOpenP2PSwarm={() => setIsP2PSwarmOpen(true)}
            onOpenWebhooks={() => setIsWebhooksOpen(true)}
            onOpenTerminal={() => setIsLiveTerminalOpen(true)}
            onOpenMemoryGraph={() => setIsMemoryGraphOpen(true)}
            onOpenNodeDashboard={() => setIsNodeDashboardOpen(true)}
            onOpenSpaceVault={() => setIsSpaceVaultOpen(true)}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
            onOpenAutomations={() => setIsAutomationsOpen(true)}
            onOpenDataGrid={() => setIsDataGridOpen(true)}
            onOpenTimeMachine={() => setIsTimeMachineOpen(true)}
            onOpenZeroTrace={() => setIsZeroTraceOpen(true)}
            onOpenIoTTelemetry={() => setIsIoTTelemetryOpen(true)}
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
            onSendVoiceMessage={(dur, transcript) => {
              store.sendVoiceMessage(dur, transcript);
            }}
            onOpenActions={() => store.setActionHubOpen(true)}
            onOpenScheduler={() => store.setScheduleModalOpen(true)}
            onOpenScheduledList={() => store.setScheduledDrawerOpen(true)}
            scheduledCountInCurrentChat={store.getScheduledForActiveChat().length}
            replyingTo={store.replyingTo}
            onCancelReply={() => store.cancelReply()}
            editingMessage={store.editingMessage}
            onCancelEdit={() => store.cancelEdit()}
            onSaveEdit={(msgId, newText) => {
              store.editMessage(msgId, newText);
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
          onAddMember={() => {}}
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
        onExportAllData={() => {}}
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
        onSendNow={(id) => store.sendScheduledNow(id)}
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
            store.forwardMessage(store.activeForwardMessage, targetChatId);
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

      {/* WORK OS MODALS */}
      <RoleScopesModal
        isOpen={isRoleScopesOpen}
        onClose={() => setIsRoleScopesOpen(false)}
        channelTitle={activeChat?.title || 'Простір'}
      />

      <WorkspaceDriveModal
        isOpen={isWorkspaceDriveOpen}
        onClose={() => setIsWorkspaceDriveOpen(false)}
        workspaceTitle={activeChat?.title || 'Простір'}
      />

      <KnowledgeSearchModal
        isOpen={isKnowledgeSearchOpen}
        onClose={() => setIsKnowledgeSearchOpen(false)}
      />

      <P2PFileSwarmModal
        isOpen={isP2PSwarmOpen}
        onClose={() => setIsP2PSwarmOpen(false)}
      />

      <WebhooksManagerModal
        isOpen={isWebhooksOpen}
        onClose={() => setIsWebhooksOpen(false)}
        onSendTestWebhook={(wh) => {
          store.addCustomMessage({
            id: `msg_wh_${Date.now()}`,
            senderId: 'bot_ci',
            senderName: 'CI/CD Bot',
            senderAvatar: 'https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?w=200&auto=format&fit=crop&q=80',
            timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
            type: 'webhook:event',
            isSelf: false,
            webhookEventData: {
              source: wh.source === 'docker' ? 'ci' : wh.source,
              eventType: 'push',
              repository: 'phantom-companion',
              sender: 'github-actions[bot]',
              title: `[${wh.name}] Build & Test Pipeline Succeeded`,
              description: 'Atomic sprint test passed on aarch64 & x86_64 target nodes.',
              status: 'success',
              commitHash: '054253e',
              timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
            },
          });
        }}
      />

      <CommandPaletteModal
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onOpenCanvas={() => {
          window.dispatchEvent(new CustomEvent('phantom:open-canvas'));
        }}
        onOpenTerminal={() => setIsLiveTerminalOpen(true)}
        onOpenNodeDashboard={() => setIsNodeDashboardOpen(true)}
        onOpenSpaceVault={() => setIsSpaceVaultOpen(true)}
      />

      <LiveTerminalModal
        isOpen={isLiveTerminalOpen}
        onClose={() => setIsLiveTerminalOpen(false)}
        chatTitle={activeChat?.title || 'Бесіда'}
        chatId={activeChat?.id}
      />

      <ProjectMemoryGraphModal
        isOpen={isMemoryGraphOpen}
        onClose={() => setIsMemoryGraphOpen(false)}
        chatTitle={activeChat?.title || 'Бесіда'}
      />

      <NodeDashboardModal
        isOpen={isNodeDashboardOpen}
        onClose={() => setIsNodeDashboardOpen(false)}
      />

      <SpaceVaultModal
        isOpen={isSpaceVaultOpen}
        onClose={() => setIsSpaceVaultOpen(false)}
        chatTitle={activeChat?.title || 'Бесіда'}
      />

      <AutomationPipelineModal
        isOpen={isAutomationsOpen}
        onClose={() => setIsAutomationsOpen(false)}
        chatTitle={activeChat?.title || 'Бесіда'}
        chatId={activeChat?.id}
      />

      <RelationalDataGridModal
        isOpen={isDataGridOpen}
        onClose={() => setIsDataGridOpen(false)}
        chatTitle={activeChat?.title || 'Бесіда'}
      />

      <TimeMachineSnapshotModal
        isOpen={isTimeMachineOpen}
        onClose={() => setIsTimeMachineOpen(false)}
        chatTitle={activeChat?.title || 'Бесіда'}
      />

      <ZeroTraceAirGapModal
        isOpen={isZeroTraceOpen}
        onClose={() => setIsZeroTraceOpen(false)}
        chatTitle={activeChat?.title || 'Бесіда'}
      />

      <IoTEqsTelemetryModal
        isOpen={isIoTTelemetryOpen}
        onClose={() => setIsIoTTelemetryOpen(false)}
        chatTitle={activeChat?.title || 'Бесіда'}
      />

      <CallOverlay />
    </div>
  );
};
