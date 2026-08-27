import React, { Suspense, lazy } from 'react';
import { useModalStore } from '../../../stores/modalStore';

// Lazy-load domain modals to keep initial bundle compact & modular
const AcademicLmsHubModal = lazy(() => import('../AcademicLmsHubModal').then(m => ({ default: m.AcademicLmsHubModal })));
const AcademyHubModal = lazy(() => import('../AcademyHubModal').then(m => ({ default: m.AcademyHubModal })));
const AdvancedResearchMeshModal = lazy(() => import('../AdvancedResearchMeshModal').then(m => ({ default: m.AdvancedResearchMeshModal })));
const AgenticWorkspaceVirtualizationModal = lazy(() => import('../AgenticWorkspaceVirtualizationModal').then(m => ({ default: m.AgenticWorkspaceVirtualizationModal })));
const AmbientContextModal = lazy(() => import('../AmbientContextModal').then(m => ({ default: m.AmbientContextModal })));
const AutomationPipelineModal = lazy(() => import('../AutomationPipelineModal').then(m => ({ default: m.AutomationPipelineModal })));
const AutonomousOpsWarRoomModal = lazy(() => import('../AutonomousOpsWarRoomModal').then(m => ({ default: m.AutonomousOpsWarRoomModal })));
const CanvasPresentationSpeakerMatrixModal = lazy(() => import('../CanvasPresentationSpeakerMatrixModal').then(m => ({ default: m.CanvasPresentationSpeakerMatrixModal })));
const CodeDiffMathHexInspectorModal = lazy(() => import('../CodeDiffMathHexInspectorModal').then(m => ({ default: m.CodeDiffMathHexInspectorModal })));
const CollaborativeWhiteboardPlaygroundModal = lazy(() => import('../CollaborativeWhiteboardPlaygroundModal').then(m => ({ default: m.CollaborativeWhiteboardPlaygroundModal })));
const CommandPaletteModal = lazy(() => import('../CommandPaletteModal').then(m => ({ default: m.CommandPaletteModal })));
const CommerceMicroAppsModal = lazy(() => import('../CommerceMicroAppsModal').then(m => ({ default: m.CommerceMicroAppsModal })));
const CommunityClubModal = lazy(() => import('../CommunityClubModal').then(m => ({ default: m.CommunityClubModal })));
const CorporateHROpsModal = lazy(() => import('../CorporateHROpsModal').then(m => ({ default: m.CorporateHROpsModal })));
const CreativeStudioModal = lazy(() => import('../CreativeStudioModal').then(m => ({ default: m.CreativeStudioModal })));
const DataLifecyclePruningModal = lazy(() => import('../DataLifecyclePruningModal').then(m => ({ default: m.DataLifecyclePruningModal })));
const DisasterMeshDtnModal = lazy(() => import('../DisasterMeshDtnModal').then(m => ({ default: m.DisasterMeshDtnModal })));
const FamilyHubModal = lazy(() => import('../FamilyHubModal').then(m => ({ default: m.FamilyHubModal })));
const GitNativeDevOpsModal = lazy(() => import('../GitNativeDevOpsModal').then(m => ({ default: m.GitNativeDevOpsModal })));
const HeadlessInfrastructureModal = lazy(() => import('../HeadlessInfrastructureModal').then(m => ({ default: m.HeadlessInfrastructureModal })));
const HumanCentricBioContextModal = lazy(() => import('../HumanCentricBioContextModal').then(m => ({ default: m.HumanCentricBioContextModal })));
const InteractiveMediaAnnotationModal = lazy(() => import('../InteractiveMediaAnnotationModal').then(m => ({ default: m.InteractiveMediaAnnotationModal })));
const InteractiveVisualization3DModal = lazy(() => import('../InteractiveVisualization3DModal').then(m => ({ default: m.InteractiveVisualization3DModal })));
const IoTEqsTelemetryModal = lazy(() => import('../IoTEqsTelemetryModal').then(m => ({ default: m.IoTEqsTelemetryModal })));
const KnowledgeSearchModal = lazy(() => import('../KnowledgeSearchModal').then(m => ({ default: m.KnowledgeSearchModal })));
const LiveSpotlightMicroBountiesModal = lazy(() => import('../LiveSpotlightMicroBountiesModal').then(m => ({ default: m.LiveSpotlightMicroBountiesModal })));
const LiveTerminalModal = lazy(() => import('../LiveTerminalModal').then(m => ({ default: m.LiveTerminalModal })));
const LoRaWalkieTalkieModal = lazy(() => import('../LoRaWalkieTalkieModal').then(m => ({ default: m.LoRaWalkieTalkieModal })));
const LocalErpEscrowModal = lazy(() => import('../LocalErpEscrowModal').then(m => ({ default: m.LocalErpEscrowModal })));
const NeuroErgonomicsModal = lazy(() => import('../NeuroErgonomicsModal').then(m => ({ default: m.NeuroErgonomicsModal })));
const NodeDashboardModal = lazy(() => import('../NodeDashboardModal').then(m => ({ default: m.NodeDashboardModal })));
const P2PComputeSharingModal = lazy(() => import('../P2PComputeSharingModal').then(m => ({ default: m.P2PComputeSharingModal })));
const P2PFileSwarmModal = lazy(() => import('../P2PFileSwarmModal').then(m => ({ default: m.P2PFileSwarmModal })));
const PersonalWellnessModal = lazy(() => import('../PersonalWellnessModal').then(m => ({ default: m.PersonalWellnessModal })));
const PhantomArchitectureBlueprintModal = lazy(() => import('../PhantomArchitectureBlueprintModal').then(m => ({ default: m.PhantomArchitectureBlueprintModal })));
const PhantomRuntimeVfsModal = lazy(() => import('../PhantomRuntimeVfsModal').then(m => ({ default: m.PhantomRuntimeVfsModal })));
const PhysicalComputingGisCanvasModal = lazy(() => import('../PhysicalComputingGisCanvasModal').then(m => ({ default: m.PhysicalComputingGisCanvasModal })));
const PlanningPokerGanttWidgetsModal = lazy(() => import('../PlanningPokerGanttWidgetsModal').then(m => ({ default: m.PlanningPokerGanttWidgetsModal })));
const ProjectMemoryGraphModal = lazy(() => import('../ProjectMemoryGraphModal').then(m => ({ default: m.ProjectMemoryGraphModal })));
const ProtocolDrivenSchemaModal = lazy(() => import('../ProtocolDrivenSchemaModal').then(m => ({ default: m.ProtocolDrivenSchemaModal })));
const RelationalDataGridModal = lazy(() => import('../RelationalDataGridModal').then(m => ({ default: m.RelationalDataGridModal })));
const ResourceGovernanceModal = lazy(() => import('../ResourceGovernanceModal').then(m => ({ default: m.ResourceGovernanceModal })));
const RoleScopesModal = lazy(() => import('../RoleScopesModal').then(m => ({ default: m.RoleScopesModal })));
const SecOpsComplianceModal = lazy(() => import('../SecOpsComplianceModal').then(m => ({ default: m.SecOpsComplianceModal })));
const SemanticBusPipesModal = lazy(() => import('../SemanticBusPipesModal').then(m => ({ default: m.SemanticBusPipesModal })));
const SmartBreadcrumbsContextPeekModal = lazy(() => import('../SmartBreadcrumbsContextPeekModal').then(m => ({ default: m.SmartBreadcrumbsContextPeekModal })));
const SpaceVaultModal = lazy(() => import('../SpaceVaultModal').then(m => ({ default: m.SpaceVaultModal })));
const SpatialMultiPaneWorkspaceModal = lazy(() => import('../SpatialMultiPaneWorkspaceModal').then(m => ({ default: m.SpatialMultiPaneWorkspaceModal })));
const SpatialProjectionsModal = lazy(() => import('../SpatialProjectionsModal').then(m => ({ default: m.SpatialProjectionsModal })));
const TimeMachineSnapshotModal = lazy(() => import('../TimeMachineSnapshotModal').then(m => ({ default: m.TimeMachineSnapshotModal })));
const UniversalBridgeModal = lazy(() => import('../UniversalBridgeModal').then(m => ({ default: m.UniversalBridgeModal })));
const VisualStateMachinePipelineModal = lazy(() => import('../VisualStateMachinePipelineModal').then(m => ({ default: m.VisualStateMachinePipelineModal })));
const WasmAppSandboxModal = lazy(() => import('../WasmAppSandboxModal').then(m => ({ default: m.WasmAppSandboxModal })));
const WebhooksManagerModal = lazy(() => import('../WebhooksManagerModal').then(m => ({ default: m.WebhooksManagerModal })));
const WorkspaceDriveModal = lazy(() => import('../WorkspaceDriveModal').then(m => ({ default: m.WorkspaceDriveModal })));
const ZeroLeakSecurityModal = lazy(() => import('../ZeroLeakSecurityModal').then(m => ({ default: m.ZeroLeakSecurityModal })));
const ZeroTraceAirGapModal = lazy(() => import('../ZeroTraceAirGapModal').then(m => ({ default: m.ZeroTraceAirGapModal })));

export const ModalHost: React.FC = () => {
  const { activeModal, modalProps, closeModal } = useModalStore();

  if (!activeModal) return null;

  return (
    <Suspense fallback={null}>
      {activeModal === 'roleScopes' && (
        <RoleScopesModal
          isOpen={true}
          onClose={closeModal}
          channelTitle={modalProps?.channelTitle || 'Контекстні ролі'}
          {...modalProps}
        />
      )}
      {activeModal === 'workspaceDrive' && (
        <WorkspaceDriveModal
          isOpen={true}
          onClose={closeModal}
          workspaceTitle={modalProps?.workspaceTitle || 'Workspace Drive'}
          {...modalProps}
        />
      )}
      {activeModal === 'knowledgeSearch' && <KnowledgeSearchModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'p2pSwarm' && <P2PFileSwarmModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'webhooks' && <WebhooksManagerModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'commandPalette' && <CommandPaletteModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'liveTerminal' && <LiveTerminalModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'memoryGraph' && <ProjectMemoryGraphModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'nodeDashboard' && <NodeDashboardModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'spaceVault' && <SpaceVaultModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'automations' && <AutomationPipelineModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'dataGrid' && <RelationalDataGridModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'timeMachine' && <TimeMachineSnapshotModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'zeroTrace' && <ZeroTraceAirGapModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'iotTelemetry' && <IoTEqsTelemetryModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'academyHub' && <AcademyHubModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'familyHub' && <FamilyHubModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'creativeStudio' && <CreativeStudioModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'personalWellness' && <PersonalWellnessModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'communityClub' && <CommunityClubModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'dataLifecycle' && <DataLifecyclePruningModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'zeroLeakSecurity' && <ZeroLeakSecurityModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'wasmSandbox' && <WasmAppSandboxModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'p2pCompute' && <P2PComputeSharingModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'ambientContext' && <AmbientContextModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'universalBridge' && <UniversalBridgeModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'protocolSchema' && <ProtocolDrivenSchemaModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'neuroErgonomics' && <NeuroErgonomicsModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'loRaWalkie' && <LoRaWalkieTalkieModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'semanticBus' && <SemanticBusPipesModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'spatialProjections' && <SpatialProjectionsModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'resourceGovernance' && <ResourceGovernanceModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'gitDevOps' && <GitNativeDevOpsModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'academicLms' && <AcademicLmsHubModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'corporateHR' && <CorporateHROpsModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'commerceMicroApps' && <CommerceMicroAppsModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'headlessInfra' && <HeadlessInfrastructureModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'localErpEscrow' && <LocalErpEscrowModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'secOpsCompliance' && <SecOpsComplianceModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'advancedResearch' && <AdvancedResearchMeshModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'phantomRuntime' && <PhantomRuntimeVfsModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'disasterMesh' && <DisasterMeshDtnModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'autonomousOps' && <AutonomousOpsWarRoomModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'humanCentricBio' && <HumanCentricBioContextModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'interactiveVis3D' && <InteractiveVisualization3DModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'collaborativeWhiteboard' && <CollaborativeWhiteboardPlaygroundModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'planningPokerGantt' && <PlanningPokerGanttWidgetsModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'spatialMultiPane' && <SpatialMultiPaneWorkspaceModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'mediaAnnotation' && <InteractiveMediaAnnotationModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'breadcrumbsPeek' && <SmartBreadcrumbsContextPeekModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'stateMachinePipeline' && <VisualStateMachinePipelineModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'codeDiffMathHex' && <CodeDiffMathHexInspectorModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'canvasPresentation' && <CanvasPresentationSpeakerMatrixModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'spotlightBounties' && <LiveSpotlightMicroBountiesModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'blueprint' && <PhantomArchitectureBlueprintModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'agenticRuntime' && <AgenticWorkspaceVirtualizationModal isOpen={true} onClose={closeModal} {...modalProps} />}
      {activeModal === 'physicalComputing' && <PhysicalComputingGisCanvasModal isOpen={true} onClose={closeModal} {...modalProps} />}
    </Suspense>
  );
};
