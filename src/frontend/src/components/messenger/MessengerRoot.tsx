import React, { useEffect, useState } from 'react';
import { useMessengerStore } from '../../stores/messengerStore';
import { phantomRelayService } from '../../services/phantomRelayService';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ChatArea } from './ChatArea';
import { MessageComposer } from './MessageComposer';
import { MultiSelectBar } from './MultiSelectBar';
import { AudioHuddleBar } from './AudioHuddleBar';

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
import { VideoCallModal } from './VideoCallModal';
import type { Message, SmartFolder, ChatCircle } from '../../types/messenger';

interface MessengerRootProps {
  className?: string;
}

export const MessengerRoot: React.FC<MessengerRootProps> = ({ className = '' }) => {
  const store = useMessengerStore();
  const activeChat = store.getActiveChat();
  const [isSearchingInChat, setIsSearchingInChat] = useState(false);
  const [editingSmartFolder, setEditingSmartFolder] = useState<SmartFolder | null>(null);
  const [activeFolderInsights, setActiveFolderInsights] = useState<SmartFolder | null>(null);
  const [activeShareFolder, setActiveShareFolder] = useState<SmartFolder | null>(null);

  // Sound settings
  const [isSoundEnabled, setIsSoundEnabled] = useState(true);

  // Scheduled message temporary date
  const [pendingScheduledTime, setPendingScheduledTime] = useState<string | undefined>(undefined);

  // Стан ретранслятора опитуємо, лише поки месенджер відкритий.
  useEffect(() => {
    phantomRelayService.start();
    return () => phantomRelayService.stop();
  }, []);

  const meParticipant = store.huddleState.participants.find((p) => p.id === store.currentUser.id);

  return (
    <div className={`flex w-full h-full bg-[#0C110D] text-[#E4EDE7] overflow-hidden select-none relative font-sans ${className}`}>
      {/* 1. Left Sidebar (Workspaces, Folders, Circles, Chats) */}
      <div className={`${activeChat && !store.searchQuery ? 'hidden md:flex' : 'flex'} w-full md:w-auto h-full shrink-0`}>
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

      {/* 2. Main Chat Area */}
      {activeChat ? (
        <div className="flex-1 flex flex-col h-full min-w-0 bg-[#0C110D] relative overflow-hidden">
          {/* Header */}
          <Header
            currentChat={activeChat}
            currentUser={store.currentUser}
            onOpenDigest={() => store.setDigestModalOpen(true)}
            onOpenActions={() => store.setActionHubOpen(true)}
            onOpenScheduledMessages={() => store.setScheduledDrawerOpen(true)}
            scheduledMessagesCount={store.getScheduledForActiveChat().length}
            onOpenSettings={() => store.setSettingsModalOpen(true)}
            onOpenGroupDetails={() => store.setGroupDetailsOpen(true)}
            isHuddleActive={store.huddleState.active}
            onToggleHuddle={() => {
              if (store.huddleState.active) {
                store.leaveHuddle();
              } else {
                store.startHuddle(activeChat.id, activeChat.title);
              }
            }}
            isSoundEnabled={isSoundEnabled}
            onToggleSound={() => setIsSoundEnabled(!isSoundEnabled)}
            isSearching={isSearchingInChat}
            onToggleSearch={() => setIsSearchingInChat(!isSearchingInChat)}
            pinnedCount={activeChat.messages.filter((m) => m.isPinned).length}
            onOpenP2PNetworkModal={() => store.setP2PModalOpen(true)}
            onBack={() => store.setActiveChat('')}
          />

          {/* Audio Huddle Live Strip */}
          {store.huddleState.active && (
            <AudioHuddleBar
              huddleState={store.huddleState}
              onToggleMute={store.toggleHuddleMute}
              isMuted={meParticipant?.isMuted ?? false}
              onRaiseHand={store.toggleHuddleHand}
              hasRaisedHand={meParticipant?.hasRaisedHand ?? false}
              onOpenVideoModal={() => store.setVideoModalOpen(true)}
              onLeaveHuddle={store.leaveHuddle}
            />
          )}

          {/* Messages Feed */}
          <div className="flex-1 min-h-0 relative">
            <ChatArea
              currentChat={activeChat}
              messages={activeChat.messages}
              currentUserId={store.currentUser.id}
              onOpenLocation={(loc) => store.openLocationSheet(loc)}
              onVotePoll={(msgId, optId) => store.votePoll(msgId, optId)}
              onPayBillShare={(msgId, payerId) => store.payBillShare(msgId, payerId)}
              onAddReaction={(msgId, emoji) => store.addReaction(msgId, emoji)}
              onReplyMessage={(_msg) => {}}
              onEditMessage={(_msg) => {}}
              onDeleteMessage={(msgId) => {
                const m = activeChat.messages.find((x) => x.id === msgId);
                if (m) store.openDeleteModal(m);
              }}
              onTogglePinMessage={(msgId) => store.togglePinMessage(msgId)}
              onForwardMessage={(msg) => store.openForwardModal(msg)}
              onSelectMemberByName={(_name) => {}}
              selectedMessageIds={store.selectedMessageIds}
              onToggleSelectMessage={(msgId) => store.toggleSelectMessage(msgId)}
              isSelectionMode={store.multiSelectMode}
              onUpdateTableData={(msgId, data) => store.updateTableData(msgId, data)}
              onUpdateTaskListData={(msgId, tasks) => store.updateTaskListData(msgId, tasks)}
              onOpenImageLightbox={(url) => store.openLightbox(url)}
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
            replyingTo={null}
            onCancelReply={() => {}}
            editingMessage={null}
            onCancelEdit={() => {}}
            onSaveEdit={(msgId, newText) => store.editMessage(msgId, newText)}
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
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#0C110D] select-none">
          <div className="w-18 h-18 rounded-3xl bg-[#55C778]/10 border border-[#55C778]/20 flex items-center justify-center text-3xl mb-4 text-[#55C778] shadow-[0_0_30px_rgba(85,199,120,0.15)]">
            💬
          </div>
          <h2 className="font-extrabold text-xl text-white mb-2 tracking-tight">Оберіть бесіду</h2>
          <p className="text-sm text-[#8EA093] max-w-sm leading-relaxed">
            Виберіть чат зі списку ліворуч або створіть новий простір для співпраці та E2EE-спілкування
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
        onCreateChat={(data) => {
          store.createChat({
            title: data.title,
            type: data.type,
            circle: data.circle as ChatCircle,
            description: data.description,
            topic: data.topic,
            avatar: data.avatar,
            isPublic: data.isPublic,
            publicHandle: data.publicHandle,
          });
          store.setCreateChatModalOpen(false);
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

      {activeFolderInsights && (
        <FolderInsightsModal
          isOpen={store.isFolderInsightsOpen}
          onClose={() => {
            store.setFolderInsightsOpen(false);
            setActiveFolderInsights(null);
          }}
          folder={activeFolderInsights}
          chats={store.chats}
        />
      )}

      {activeShareFolder && (
        <ShareFolderModal
          isOpen={store.isShareFolderOpen}
          onClose={() => {
            store.setShareFolderOpen(false);
            setActiveShareFolder(null);
          }}
          folder={activeShareFolder}
          chats={store.chats}
        />
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
          onOpenImageLightbox={(url) => store.openLightbox(url)}
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
        onConfirmDelete={(_deleteForEveryone) => {
          if (store.activeDeleteMessage) {
            store.deleteMessage(store.activeDeleteMessage.id);
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
      <VideoCallModal
        isOpen={store.huddleState.active && (store.huddleState.isVideoModalOpen ?? false)}
        onClose={() => store.setVideoModalOpen(false)}
        huddleState={store.huddleState}
        currentUserId={store.currentUser.id}
        onToggleMute={store.toggleHuddleMute}
        isMuted={meParticipant?.isMuted ?? false}
        onToggleVideo={store.toggleHuddleVideo}
        isVideoOn={meParticipant?.isVideoOn ?? false}
        onToggleScreenShare={store.toggleHuddleScreenShare}
        isScreenSharing={store.huddleState.isScreenSharing ?? false}
        onToggleHand={store.toggleHuddleHand}
        hasRaisedHand={meParticipant?.hasRaisedHand ?? false}
        onToggleRecording={store.toggleHuddleRecording}
        isRecording={store.huddleState.isRecording ?? false}
        onLeaveHuddle={store.leaveHuddle}
      />
    </div>
  );
};
