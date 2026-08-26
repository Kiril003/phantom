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
import { AcademyHubModal } from './AcademyHubModal';
import { FamilyHubModal } from './FamilyHubModal';
import { CreativeStudioModal } from './CreativeStudioModal';
import { PersonalWellnessModal } from './PersonalWellnessModal';
import { CommunityClubModal } from './CommunityClubModal';
import { DataLifecyclePruningModal } from './DataLifecyclePruningModal';
import { ZeroLeakSecurityModal } from './ZeroLeakSecurityModal';
import { WasmAppSandboxModal } from './WasmAppSandboxModal';
import { P2PComputeSharingModal } from './P2PComputeSharingModal';
import { AmbientContextModal } from './AmbientContextModal';
import { UniversalBridgeModal } from './UniversalBridgeModal';
import { ProtocolDrivenSchemaModal } from './ProtocolDrivenSchemaModal';
import { NeuroErgonomicsModal } from './NeuroErgonomicsModal';
import { LoRaWalkieTalkieModal } from './LoRaWalkieTalkieModal';
import { SemanticBusPipesModal } from './SemanticBusPipesModal';
import { SpatialProjectionsModal } from './SpatialProjectionsModal';
import { ResourceGovernanceModal } from './ResourceGovernanceModal';
import { GitNativeDevOpsModal } from './GitNativeDevOpsModal';
import { AcademicLmsHubModal } from './AcademicLmsHubModal';
import { CorporateHROpsModal } from './CorporateHROpsModal';
import { CommerceMicroAppsModal } from './CommerceMicroAppsModal';
import { HeadlessInfrastructureModal } from './HeadlessInfrastructureModal';
import { LocalErpEscrowModal } from './LocalErpEscrowModal';
import { SecOpsComplianceModal } from './SecOpsComplianceModal';
import { AdvancedResearchMeshModal } from './AdvancedResearchMeshModal';
import { PhantomRuntimeVfsModal } from './PhantomRuntimeVfsModal';
import { DisasterMeshDtnModal } from './DisasterMeshDtnModal';
import { AutonomousOpsWarRoomModal } from './AutonomousOpsWarRoomModal';
import { HumanCentricBioContextModal } from './HumanCentricBioContextModal';
import { InteractiveVisualization3DModal } from './InteractiveVisualization3DModal';
import { CollaborativeWhiteboardPlaygroundModal } from './CollaborativeWhiteboardPlaygroundModal';
import { PlanningPokerGanttWidgetsModal } from './PlanningPokerGanttWidgetsModal';
import { SpatialMultiPaneWorkspaceModal } from './SpatialMultiPaneWorkspaceModal';
import { InteractiveMediaAnnotationModal } from './InteractiveMediaAnnotationModal';
import { SmartBreadcrumbsContextPeekModal } from './SmartBreadcrumbsContextPeekModal';
import { VisualStateMachinePipelineModal } from './VisualStateMachinePipelineModal';
import { CodeDiffMathHexInspectorModal } from './CodeDiffMathHexInspectorModal';
import { CanvasPresentationSpeakerMatrixModal } from './CanvasPresentationSpeakerMatrixModal';
import { LiveSpotlightMicroBountiesModal } from './LiveSpotlightMicroBountiesModal';
import { PhantomArchitectureBlueprintModal } from './PhantomArchitectureBlueprintModal';
import { AgenticWorkspaceVirtualizationModal } from './AgenticWorkspaceVirtualizationModal';
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
  const [isAcademyHubOpen, setIsAcademyHubOpen] = useState(false);
  const [isFamilyHubOpen, setIsFamilyHubOpen] = useState(false);
  const [isCreativeStudioOpen, setIsCreativeStudioOpen] = useState(false);
  const [isPersonalWellnessOpen, setIsPersonalWellnessOpen] = useState(false);
  const [isCommunityClubOpen, setIsCommunityClubOpen] = useState(false);
  const [isDataLifecycleOpen, setIsDataLifecycleOpen] = useState(false);
  const [isZeroLeakSecurityOpen, setIsZeroLeakSecurityOpen] = useState(false);
  const [isWasmSandboxOpen, setIsWasmSandboxOpen] = useState(false);
  const [isP2PComputeOpen, setIsP2PComputeOpen] = useState(false);
  const [isAmbientContextOpen, setIsAmbientContextOpen] = useState(false);
  const [isUniversalBridgeOpen, setIsUniversalBridgeOpen] = useState(false);
  const [isProtocolSchemaOpen, setIsProtocolSchemaOpen] = useState(false);
  const [isNeuroErgonomicsOpen, setIsNeuroErgonomicsOpen] = useState(false);
  const [isLoRaWalkieOpen, setIsLoRaWalkieOpen] = useState(false);
  const [isSemanticBusOpen, setIsSemanticBusOpen] = useState(false);
  const [isSpatialProjectionsOpen, setIsSpatialProjectionsOpen] = useState(false);
  const [isResourceGovernanceOpen, setIsResourceGovernanceOpen] = useState(false);
  const [isGitDevOpsOpen, setIsGitDevOpsOpen] = useState(false);
  const [isAcademicLmsOpen, setIsAcademicLmsOpen] = useState(false);
  const [isCorporateHROpen, setIsCorporateHROpen] = useState(false);
  const [isCommerceMicroAppsOpen, setIsCommerceMicroAppsOpen] = useState(false);
  const [isHeadlessInfraOpen, setIsHeadlessInfraOpen] = useState(false);
  const [isLocalErpEscrowOpen, setIsLocalErpEscrowOpen] = useState(false);
  const [isSecOpsComplianceOpen, setIsSecOpsComplianceOpen] = useState(false);
  const [isAdvancedResearchOpen, setIsAdvancedResearchOpen] = useState(false);
  const [isPhantomRuntimeOpen, setIsPhantomRuntimeOpen] = useState(false);
  const [isDisasterMeshOpen, setIsDisasterMeshOpen] = useState(false);
  const [isAutonomousOpsOpen, setIsAutonomousOpsOpen] = useState(false);
  const [isHumanCentricBioOpen, setIsHumanCentricBioOpen] = useState(false);
  const [isInteractiveVis3DOpen, setIsInteractiveVis3DOpen] = useState(false);
  const [isCollaborativeWhiteboardOpen, setIsCollaborativeWhiteboardOpen] = useState(false);
  const [isPlanningPokerGanttOpen, setIsPlanningPokerGanttOpen] = useState(false);
  const [isSpatialMultiPaneOpen, setIsSpatialMultiPaneOpen] = useState(false);
  const [isMediaAnnotationOpen, setIsMediaAnnotationOpen] = useState(false);
  const [isBreadcrumbsPeekOpen, setIsBreadcrumbsPeekOpen] = useState(false);
  const [isStateMachinePipelineOpen, setIsStateMachinePipelineOpen] = useState(false);
  const [isCodeDiffMathHexOpen, setIsCodeDiffMathHexOpen] = useState(false);
  const [isCanvasPresentationOpen, setIsCanvasPresentationOpen] = useState(false);
  const [isSpotlightBountiesOpen, setIsSpotlightBountiesOpen] = useState(false);
  const [isBlueprintOpen, setIsBlueprintOpen] = useState(false);
  const [isAgenticRuntimeOpen, setIsAgenticRuntimeOpen] = useState(false);
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
    const onOpenAcad = () => setIsAcademyHubOpen(true);
    const onOpenFam = () => setIsFamilyHubOpen(true);
    const onOpenCreat = () => setIsCreativeStudioOpen(true);
    const onOpenPers = () => setIsPersonalWellnessOpen(true);
    const onOpenComm = () => setIsCommunityClubOpen(true);
    const onOpenLife = () => setIsDataLifecycleOpen(true);
    const onOpenLeak = () => setIsZeroLeakSecurityOpen(true);
    const onOpenWasm = () => setIsWasmSandboxOpen(true);
    const onOpenP2PComp = () => setIsP2PComputeOpen(true);
    const onOpenAmb = () => setIsAmbientContextOpen(true);
    const onOpenBridge = () => setIsUniversalBridgeOpen(true);
    const onOpenSchema = () => setIsProtocolSchemaOpen(true);
    const onOpenNeuro = () => setIsNeuroErgonomicsOpen(true);
    const onOpenLoRa = () => setIsLoRaWalkieOpen(true);
    const onOpenBus = () => setIsSemanticBusOpen(true);
    const onOpenProj = () => setIsSpatialProjectionsOpen(true);
    const onOpenGov = () => setIsResourceGovernanceOpen(true);
    const onOpenGit = () => setIsGitDevOpsOpen(true);
    const onOpenLms = () => setIsAcademicLmsOpen(true);
    const onOpenHr = () => setIsCorporateHROpen(true);
    const onOpenCommApp = () => setIsCommerceMicroAppsOpen(true);
    const onOpenHeadless = () => setIsHeadlessInfraOpen(true);
    const onOpenErp = () => setIsLocalErpEscrowOpen(true);
    const onOpenSecOps = () => setIsSecOpsComplianceOpen(true);
    const onOpenResearch = () => setIsAdvancedResearchOpen(true);
    const onOpenVfs = () => setIsPhantomRuntimeOpen(true);
    const onOpenDisaster = () => setIsDisasterMeshOpen(true);
    const onOpenWarRoom = () => setIsAutonomousOpsOpen(true);
    const onOpenBio = () => setIsHumanCentricBioOpen(true);
    const onOpenVis3D = () => setIsInteractiveVis3DOpen(true);
    const onOpenWhiteboard = () => setIsCollaborativeWhiteboardOpen(true);
    const onOpenPoker = () => setIsPlanningPokerGanttOpen(true);
    const onOpenMultiPane = () => setIsSpatialMultiPaneOpen(true);
    const onOpenMediaAnnot = () => setIsMediaAnnotationOpen(true);
    const onOpenBreadcrumbs = () => setIsBreadcrumbsPeekOpen(true);
    const onOpenStateMachine = () => setIsStateMachinePipelineOpen(true);
    const onOpenCodeDiff = () => setIsCodeDiffMathHexOpen(true);
    const onOpenPresentation = () => setIsCanvasPresentationOpen(true);
    const onOpenSpotlight = () => setIsSpotlightBountiesOpen(true);
    const onOpenBlueprint = () => setIsBlueprintOpen(true);
    const onOpenAgentic = () => setIsAgenticRuntimeOpen(true);

    window.addEventListener('phantom:open-automations', onOpenAut);
    window.addEventListener('phantom:open-datagrid', onOpenGrid);
    window.addEventListener('phantom:open-timemachine', onOpenTime);
    window.addEventListener('phantom:open-zerotrace', onOpenZero);
    window.addEventListener('phantom:open-iot', onOpenIoT);
    window.addEventListener('phantom:open-academy', onOpenAcad);
    window.addEventListener('phantom:open-family', onOpenFam);
    window.addEventListener('phantom:open-creative', onOpenCreat);
    window.addEventListener('phantom:open-personal', onOpenPers);
    window.addEventListener('phantom:open-community', onOpenComm);
    window.addEventListener('phantom:open-lifecycle', onOpenLife);
    window.addEventListener('phantom:open-zeroleak', onOpenLeak);
    window.addEventListener('phantom:open-wasm', onOpenWasm);
    window.addEventListener('phantom:open-p2pcompute', onOpenP2PComp);
    window.addEventListener('phantom:open-ambient', onOpenAmb);
    window.addEventListener('phantom:open-bridge', onOpenBridge);
    window.addEventListener('phantom:open-schema', onOpenSchema);
    window.addEventListener('phantom:open-neuro', onOpenNeuro);
    window.addEventListener('phantom:open-lora', onOpenLoRa);
    window.addEventListener('phantom:open-semanticbus', onOpenBus);
    window.addEventListener('phantom:open-projections', onOpenProj);
    window.addEventListener('phantom:open-governance', onOpenGov);
    window.addEventListener('phantom:open-gitdevops', onOpenGit);
    window.addEventListener('phantom:open-academiclms', onOpenLms);
    window.addEventListener('phantom:open-corporatehr', onOpenHr);
    window.addEventListener('phantom:open-commerce', onOpenCommApp);
    window.addEventListener('phantom:open-headless', onOpenHeadless);
    window.addEventListener('phantom:open-erp', onOpenErp);
    window.addEventListener('phantom:open-secops', onOpenSecOps);
    window.addEventListener('phantom:open-research', onOpenResearch);
    window.addEventListener('phantom:open-vfs', onOpenVfs);
    window.addEventListener('phantom:open-disaster', onOpenDisaster);
    window.addEventListener('phantom:open-warroom', onOpenWarRoom);
    window.addEventListener('phantom:open-biocontext', onOpenBio);
    window.addEventListener('phantom:open-vis3d', onOpenVis3D);
    window.addEventListener('phantom:open-whiteboard', onOpenWhiteboard);
    window.addEventListener('phantom:open-poker', onOpenPoker);
    window.addEventListener('phantom:open-multipane', onOpenMultiPane);
    window.addEventListener('phantom:open-mediaannotation', onOpenMediaAnnot);
    window.addEventListener('phantom:open-breadcrumbs', onOpenBreadcrumbs);
    window.addEventListener('phantom:open-statemachine', onOpenStateMachine);
    window.addEventListener('phantom:open-codediff', onOpenCodeDiff);
    window.addEventListener('phantom:open-presentation', onOpenPresentation);
    window.addEventListener('phantom:open-spotlight', onOpenSpotlight);
    window.addEventListener('phantom:open-blueprint', onOpenBlueprint);
    window.addEventListener('phantom:open-agentic', onOpenAgentic);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('phantom:open-automations', onOpenAut);
      window.removeEventListener('phantom:open-datagrid', onOpenGrid);
      window.removeEventListener('phantom:open-timemachine', onOpenTime);
      window.removeEventListener('phantom:open-zerotrace', onOpenZero);
      window.removeEventListener('phantom:open-iot', onOpenIoT);
      window.removeEventListener('phantom:open-academy', onOpenAcad);
      window.removeEventListener('phantom:open-family', onOpenFam);
      window.removeEventListener('phantom:open-creative', onOpenCreat);
      window.removeEventListener('phantom:open-personal', onOpenPers);
      window.removeEventListener('phantom:open-community', onOpenComm);
      window.removeEventListener('phantom:open-lifecycle', onOpenLife);
      window.removeEventListener('phantom:open-zeroleak', onOpenLeak);
      window.removeEventListener('phantom:open-wasm', onOpenWasm);
      window.removeEventListener('phantom:open-p2pcompute', onOpenP2PComp);
      window.removeEventListener('phantom:open-ambient', onOpenAmb);
      window.removeEventListener('phantom:open-bridge', onOpenBridge);
      window.removeEventListener('phantom:open-schema', onOpenSchema);
      window.removeEventListener('phantom:open-neuro', onOpenNeuro);
      window.removeEventListener('phantom:open-lora', onOpenLoRa);
      window.removeEventListener('phantom:open-semanticbus', onOpenBus);
      window.removeEventListener('phantom:open-projections', onOpenProj);
      window.removeEventListener('phantom:open-governance', onOpenGov);
      window.removeEventListener('phantom:open-gitdevops', onOpenGit);
      window.removeEventListener('phantom:open-academiclms', onOpenLms);
      window.removeEventListener('phantom:open-corporatehr', onOpenHr);
      window.removeEventListener('phantom:open-commerce', onOpenCommApp);
      window.removeEventListener('phantom:open-headless', onOpenHeadless);
      window.removeEventListener('phantom:open-erp', onOpenErp);
      window.removeEventListener('phantom:open-secops', onOpenSecOps);
      window.removeEventListener('phantom:open-research', onOpenResearch);
      window.removeEventListener('phantom:open-vfs', onOpenVfs);
      window.removeEventListener('phantom:open-disaster', onOpenDisaster);
      window.removeEventListener('phantom:open-warroom', onOpenWarRoom);
      window.removeEventListener('phantom:open-biocontext', onOpenBio);
      window.removeEventListener('phantom:open-vis3d', onOpenVis3D);
      window.removeEventListener('phantom:open-whiteboard', onOpenWhiteboard);
      window.removeEventListener('phantom:open-poker', onOpenPoker);
      window.removeEventListener('phantom:open-multipane', onOpenMultiPane);
      window.removeEventListener('phantom:open-mediaannotation', onOpenMediaAnnot);
      window.removeEventListener('phantom:open-breadcrumbs', onOpenBreadcrumbs);
      window.removeEventListener('phantom:open-statemachine', onOpenStateMachine);
      window.removeEventListener('phantom:open-codediff', onOpenCodeDiff);
      window.removeEventListener('phantom:open-presentation', onOpenPresentation);
      window.removeEventListener('phantom:open-spotlight', onOpenSpotlight);
      window.removeEventListener('phantom:open-blueprint', onOpenBlueprint);
      window.removeEventListener('phantom:open-agentic', onOpenAgentic);
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

      <AcademyHubModal
        isOpen={isAcademyHubOpen}
        onClose={() => setIsAcademyHubOpen(false)}
        chatTitle={activeChat?.title || 'Академічна група'}
      />

      <FamilyHubModal
        isOpen={isFamilyHubOpen}
        onClose={() => setIsFamilyHubOpen(false)}
        chatTitle={activeChat?.title || 'Родина & Дім'}
      />

      <CreativeStudioModal
        isOpen={isCreativeStudioOpen}
        onClose={() => setIsCreativeStudioOpen(false)}
        chatTitle={activeChat?.title || 'Креативна студія'}
      />

      <PersonalWellnessModal
        isOpen={isPersonalWellnessOpen}
        onClose={() => setIsPersonalWellnessOpen(false)}
        chatTitle={activeChat?.title || 'Особистий простір'}
      />

      <CommunityClubModal
        isOpen={isCommunityClubOpen}
        onClose={() => setIsCommunityClubOpen(false)}
        chatTitle={activeChat?.title || 'Міська спільнота & Клуб'}
      />

      <DataLifecyclePruningModal
        isOpen={isDataLifecycleOpen}
        onClose={() => setIsDataLifecycleOpen(false)}
        chatTitle={activeChat?.title || 'Бесіда'}
      />

      <ZeroLeakSecurityModal
        isOpen={isZeroLeakSecurityOpen}
        onClose={() => setIsZeroLeakSecurityOpen(false)}
        chatTitle={activeChat?.title || 'Бесіда'}
      />

      <WasmAppSandboxModal
        isOpen={isWasmSandboxOpen}
        onClose={() => setIsWasmSandboxOpen(false)}
        chatTitle={activeChat?.title || 'Бесіда'}
      />

      <P2PComputeSharingModal
        isOpen={isP2PComputeOpen}
        onClose={() => setIsP2PComputeOpen(false)}
        chatTitle={activeChat?.title || 'Бесіда'}
      />

      <AmbientContextModal
        isOpen={isAmbientContextOpen}
        onClose={() => setIsAmbientContextOpen(false)}
        chatTitle={activeChat?.title || 'Бесіда'}
      />

      <UniversalBridgeModal
        isOpen={isUniversalBridgeOpen}
        onClose={() => setIsUniversalBridgeOpen(false)}
        chatTitle={activeChat?.title || 'Бесіда'}
      />

      <ProtocolDrivenSchemaModal
        isOpen={isProtocolSchemaOpen}
        onClose={() => setIsProtocolSchemaOpen(false)}
        chatTitle={activeChat?.title || 'Простір'}
      />

      <NeuroErgonomicsModal
        isOpen={isNeuroErgonomicsOpen}
        onClose={() => setIsNeuroErgonomicsOpen(false)}
        chatTitle={activeChat?.title || 'Бесіда'}
      />

      <LoRaWalkieTalkieModal
        isOpen={isLoRaWalkieOpen}
        onClose={() => setIsLoRaWalkieOpen(false)}
        chatTitle={activeChat?.title || 'Бесіда'}
      />

      <SemanticBusPipesModal
        isOpen={isSemanticBusOpen}
        onClose={() => setIsSemanticBusOpen(false)}
        chatTitle={activeChat?.title || 'Простір'}
      />

      <SpatialProjectionsModal
        isOpen={isSpatialProjectionsOpen}
        onClose={() => setIsSpatialProjectionsOpen(false)}
        chatTitle={activeChat?.title || 'Простір'}
      />

      <ResourceGovernanceModal
        isOpen={isResourceGovernanceOpen}
        onClose={() => setIsResourceGovernanceOpen(false)}
        chatTitle={activeChat?.title || 'Система'}
      />

      <GitNativeDevOpsModal
        isOpen={isGitDevOpsOpen}
        onClose={() => setIsGitDevOpsOpen(false)}
        chatTitle={activeChat?.title || 'Інженерний простір'}
      />

      <AcademicLmsHubModal
        isOpen={isAcademicLmsOpen}
        onClose={() => setIsAcademicLmsOpen(false)}
        chatTitle={activeChat?.title || 'Академічна група'}
      />

      <CorporateHROpsModal
        isOpen={isCorporateHROpen}
        onClose={() => setIsCorporateHROpen(false)}
        chatTitle={activeChat?.title || 'Корпоративний простір'}
      />

      <CommerceMicroAppsModal
        isOpen={isCommerceMicroAppsOpen}
        onClose={() => setIsCommerceMicroAppsOpen(false)}
        chatTitle={activeChat?.title || 'Комерційний простір'}
      />

      <HeadlessInfrastructureModal
        isOpen={isHeadlessInfraOpen}
        onClose={() => setIsHeadlessInfraOpen(false)}
        chatTitle={activeChat?.title || 'Інфраструктура'}
      />

      <LocalErpEscrowModal
        isOpen={isLocalErpEscrowOpen}
        onClose={() => setIsLocalErpEscrowOpen(false)}
        chatTitle={activeChat?.title || 'Комерційний простір'}
      />

      <SecOpsComplianceModal
        isOpen={isSecOpsComplianceOpen}
        onClose={() => setIsSecOpsComplianceOpen(false)}
        chatTitle={activeChat?.title || 'Безпека простору'}
      />

      <AdvancedResearchMeshModal
        isOpen={isAdvancedResearchOpen}
        onClose={() => setIsAdvancedResearchOpen(false)}
        chatTitle={activeChat?.title || 'Науково-дослідний простір'}
      />

      <PhantomRuntimeVfsModal
        isOpen={isPhantomRuntimeOpen}
        onClose={() => setIsPhantomRuntimeOpen(false)}
        chatTitle={activeChat?.title || 'Робочий простір'}
      />

      <DisasterMeshDtnModal
        isOpen={isDisasterMeshOpen}
        onClose={() => setIsDisasterMeshOpen(false)}
        chatTitle={activeChat?.title || 'Мережа стійкості'}
      />

      <AutonomousOpsWarRoomModal
        isOpen={isAutonomousOpsOpen}
        onClose={() => setIsAutonomousOpsOpen(false)}
        chatTitle={activeChat?.title || 'Автономний менеджмент'}
      />

      <HumanCentricBioContextModal
        isOpen={isHumanCentricBioOpen}
        onClose={() => setIsHumanCentricBioOpen(false)}
        chatTitle={activeChat?.title || 'Особистий простір'}
      />

      <InteractiveVisualization3DModal
        isOpen={isInteractiveVis3DOpen}
        onClose={() => setIsInteractiveVis3DOpen(false)}
        chatTitle={activeChat?.title || 'Візуалізація даних'}
      />

      <CollaborativeWhiteboardPlaygroundModal
        isOpen={isCollaborativeWhiteboardOpen}
        onClose={() => setIsCollaborativeWhiteboardOpen(false)}
        chatTitle={activeChat?.title || 'Мультиплеєрний простір'}
      />

      <PlanningPokerGanttWidgetsModal
        isOpen={isPlanningPokerGanttOpen}
        onClose={() => setIsPlanningPokerGanttOpen(false)}
        chatTitle={activeChat?.title || 'Командне планування'}
      />

      <SpatialMultiPaneWorkspaceModal
        isOpen={isSpatialMultiPaneOpen}
        onClose={() => setIsSpatialMultiPaneOpen(false)}
        chatTitle={activeChat?.title || 'Робочий простір'}
      />

      <InteractiveMediaAnnotationModal
        isOpen={isMediaAnnotationOpen}
        onClose={() => setIsMediaAnnotationOpen(false)}
        chatTitle={activeChat?.title || 'Інтерактивні медіа'}
      />

      <SmartBreadcrumbsContextPeekModal
        isOpen={isBreadcrumbsPeekOpen}
        onClose={() => setIsBreadcrumbsPeekOpen(false)}
        chatTitle={activeChat?.title || 'Контекстна навігація'}
      />

      <VisualStateMachinePipelineModal
        isOpen={isStateMachinePipelineOpen}
        onClose={() => setIsStateMachinePipelineOpen(false)}
        chatTitle={activeChat?.title || 'Робочий процес'}
      />

      <CodeDiffMathHexInspectorModal
        isOpen={isCodeDiffMathHexOpen}
        onClose={() => setIsCodeDiffMathHexOpen(false)}
        chatTitle={activeChat?.title || 'Код, математика та двійкові дані'}
      />

      <CanvasPresentationSpeakerMatrixModal
        isOpen={isCanvasPresentationOpen}
        onClose={() => setIsCanvasPresentationOpen(false)}
        chatTitle={activeChat?.title || 'Презентація & Аналітика'}
      />

      <LiveSpotlightMicroBountiesModal
        isOpen={isSpotlightBountiesOpen}
        onClose={() => setIsSpotlightBountiesOpen(false)}
        chatTitle={activeChat?.title || 'Інтерактивна взаємодія'}
      />

      <PhantomArchitectureBlueprintModal
        isOpen={isBlueprintOpen}
        onClose={() => setIsBlueprintOpen(false)}
        chatTitle={activeChat?.title || 'Архітектурна специфікація'}
      />

      <AgenticWorkspaceVirtualizationModal
        isOpen={isAgenticRuntimeOpen}
        onClose={() => setIsAgenticRuntimeOpen(false)}
        chatTitle={activeChat?.title || 'Agentic Workspace'}
      />

      <CallOverlay />
    </div>
  );
};
