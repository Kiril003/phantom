import { create } from 'zustand';

export type ModalType =
  | 'roleScopes'
  | 'workspaceDrive'
  | 'knowledgeSearch'
  | 'p2pSwarm'
  | 'webhooks'
  | 'commandPalette'
  | 'liveTerminal'
  | 'memoryGraph'
  | 'nodeDashboard'
  | 'spaceVault'
  | 'automations'
  | 'dataGrid'
  | 'timeMachine'
  | 'zeroTrace'
  | 'iotTelemetry'
  | 'academyHub'
  | 'familyHub'
  | 'creativeStudio'
  | 'personalWellness'
  | 'communityClub'
  | 'dataLifecycle'
  | 'zeroLeakSecurity'
  | 'wasmSandbox'
  | 'p2pCompute'
  | 'ambientContext'
  | 'universalBridge'
  | 'protocolSchema'
  | 'neuroErgonomics'
  | 'loRaWalkie'
  | 'semanticBus'
  | 'spatialProjections'
  | 'resourceGovernance'
  | 'gitDevOps'
  | 'academicLms'
  | 'corporateHR'
  | 'commerceMicroApps'
  | 'headlessInfra'
  | 'localErpEscrow'
  | 'secOpsCompliance'
  | 'advancedResearch'
  | 'phantomRuntime'
  | 'disasterMesh'
  | 'autonomousOps'
  | 'humanCentricBio'
  | 'interactiveVis3D'
  | 'collaborativeWhiteboard'
  | 'planningPokerGantt'
  | 'spatialMultiPane'
  | 'mediaAnnotation'
  | 'breadcrumbsPeek'
  | 'stateMachinePipeline'
  | 'codeDiffMathHex'
  | 'canvasPresentation'
  | 'spotlightBounties'
  | 'blueprint'
  | 'agenticRuntime'
  | 'physicalComputing';

interface ModalState {
  activeModal: ModalType | null;
  modalProps: Record<string, any>;
  openModal: (type: ModalType, props?: Record<string, any>) => void;
  closeModal: () => void;
  isOpen: (type: ModalType) => boolean;
}

export const useModalStore = create<ModalState>((set, get) => ({
  activeModal: null,
  modalProps: {},
  openModal: (type, props = {}) => {
    set({ activeModal: type, modalProps: props });
  },
  closeModal: () => {
    set({ activeModal: null, modalProps: {} });
  },
  isOpen: (type) => get().activeModal === type,
}));
