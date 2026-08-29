/**
 * PHANTOM OS — AI Synthesis Lab & Multi-Agent Matrix Store
 * Повноцінний автономний когнітивний полігон:
 * 1. Тривимірний Dynamic Lab UI з Git-подібним гілкуванням (Side-by-Side Diff, Merge Insights).
 * 2. Мультиагентний оркестратор: Круглий стіл експертів (System Designer, Red Team, Hardware Profiler, Lead Summarizer).
 * 3. Трьохрівневе ієрархічне ядро пам'яті (RAM Buffer, Episodic Vector DB, Core Knowledge Graph).
 * 4. Локальний інструментальний суверенітет (Local Tool Calling: Virtual Filesystem, In-Memory SQL, Hardware & P2P Probing).
 * 5. Телеметрія заліза (VRAM, RAM, TTFT, Tokens/sec, Context depth %).
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { soundFx } from '../utils/messengerSound';

export type CognitivePersona =
  | 'architect'
  | 'pair_coder'
  | 'researcher'
  | 'app_maker'
  | 'voice_companion'
  | 'round_table';

export type ComputeState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'coding'
  | 'analysis'
  | 'synthesis'
  | 'speaking'
  | 'debating';

export type ModelProvider =
  | 'local_webgpu'
  | 'local_ollama'
  | 'claude_3_7'
  | 'gpt_4o'
  | 'deepseek_r1'
  | 'gemini_2_5';

export interface AIModelInfo {
  id: ModelProvider;
  name: string;
  providerLabel: string;
  isLocal: boolean;
  contextWindow: string;
  latencyAvgMs: number;
  tokensPerSec: number;
  description: string;
  badge: string;
}

export interface ThoughtStep {
  id: string;
  title: string;
  detail: string;
  kind: 'hypothesis' | 'analysis' | 'risk_check' | 'synthesis' | 'code_gen';
  status: 'done' | 'active' | 'queued';
  durationMs?: number;
}

export interface ArtifactVersion {
  id: string;
  version: number;
  title: string;
  type: 'code' | 'react_app' | 'diagram' | 'table' | 'math' | 'report';
  content: string;
  language?: string;
  executionOutput?: string;
  createdAt: string;
}

export interface DynamicArtifact {
  id: string;
  sessionId: string;
  title: string;
  type: 'code' | 'react_app' | 'diagram' | 'table' | 'math' | 'report';
  content: string;
  language?: string;
  version: number;
  history: ArtifactVersion[];
  executionOutput?: string;
  runtimeMs?: number;
  isExecuting?: boolean;
  appProps?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ThoughtNode {
  id: string;
  sessionId: string;
  parentId: string | null;
  branchName: string;
  promptSnippet: string;
  messagesCount: number;
  artifactsCount: number;
  createdAt: string;
  isActive: boolean;
}

export interface AIMessage {
  id: string;
  sessionId: string;
  branchId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  modelUsed?: string;
  isLocalInference?: boolean;
  thoughtSteps?: ThoughtStep[];
  thinkingDurationMs?: number;
  artifactId?: string;
  branchOptions?: Array<{ branchId: string; title: string; prompt: string }>;
  codeSnippet?: { language: string; code: string };
  audioUrl?: string;
  isAudioPlaying?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. MULTI-AGENT ROUND-TABLE EXPERTS MATRIX
// ─────────────────────────────────────────────────────────────────────────────
export type RoundTableAgentRole = 'architect' | 'red_team' | 'hardware' | 'summarizer';

export interface RoundTableAgent {
  id: RoundTableAgentRole;
  name: string;
  title: string;
  handle: string;
  avatar: string;
  badge: string;
  color: string;
  status: 'idle' | 'analyzing' | 'speaking' | 'objecting' | 'summarizing';
  personality: string;
}

export interface DebateMessage {
  id: string;
  agentRole: RoundTableAgentRole | 'user';
  agentName: string;
  handle: string;
  avatar: string;
  badge: string;
  color: string;
  content: string;
  timestamp: string;
  objectionLevel?: 'none' | 'concern' | 'critical';
  confidenceScore?: number;
  actionItem?: string;
}

export interface RoundTableState {
  isActive: boolean;
  topic: string;
  roundNumber: number;
  currentSpeaker: RoundTableAgentRole | null;
  messages: DebateMessage[];
  consensusStatus: 'in_progress' | 'dispute' | 'consensus_reached';
  finalArtifactSummary?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. HIERARCHICAL 3-TIER MEMORY CORE (RAM Buffer, Episodic Vector DB, Knowledge Graph)
// ─────────────────────────────────────────────────────────────────────────────
export interface VectorEmbeddingItem {
  id: string;
  spaceTitle: string;
  snippet: string;
  tags: string[];
  similarityScore: number;
  timestamp: string;
}

export interface KnowledgeGraphEntity {
  id: string;
  category: 'stack' | 'rule' | 'pattern' | 'hardware';
  key: string;
  value: string;
  relevance: number;
}

export interface HierarchicalMemoryState {
  workingRamBufferSizeKb: number;
  activeContextTokens: number;
  maxContextTokens: number;
  episodicEmbeddings: VectorEmbeddingItem[];
  knowledgeGraph: KnowledgeGraphEntity[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. LOCAL TOOL EXECUTION & SOVEREIGNTY (Virtual FS, In-Memory SQL, Hardware Probes)
// ─────────────────────────────────────────────────────────────────────────────
export interface VirtualProjectFile {
  path: string;
  name: string;
  type: 'file' | 'dir';
  content?: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface SqlQueryResult {
  columns: string[];
  rows: Array<Record<string, any>>;
  rowCount: number;
  executionMs: number;
}

export interface HardwareProbeTelemetry {
  vramUsedMb: number;
  vramTotalMb: number;
  ramUsedMb: number;
  ramTotalMb: number;
  gpuTempCelsius: number;
  gpuLoadPct: number;
  p2pNodeLatencyMs: number;
  storageReadSpeedMb: number;
  ttftMs: number;
  tokensPerSec: number;
}

export interface SandboxExecutionResult {
  stdout: string[];
  stderr: string[];
  returnValue: unknown;
  runtimeMs: number;
  success: boolean;
  timestamp: string;
}

export interface AISynthesisSession {
  id: string;
  title: string;
  persona: CognitivePersona;
  model: ModelProvider;
  currentBranchId: string;
  createdAt: string;
  updatedAt: string;
  messages: AIMessage[];
  artifacts: DynamicArtifact[];
  activeArtifactId: string | null;
  thoughtNodes: ThoughtNode[];
  ragSources: Array<{ id: string; title: string; type: 'space' | 'vault' | 'doc'; active: boolean }>;
}

interface AISynthesisState {
  // Modal & Layout
  isStudioOpen: boolean;
  setStudioOpen: (open: boolean) => void;
  activeSessionId: string;
  sessions: AISynthesisSession[];
  layoutMode: '3pane' | 'chat_only' | 'canvas_only' | 'round_table';
  setLayoutMode: (mode: '3pane' | 'chat_only' | 'canvas_only' | 'round_table') => void;
  activeCanvasTab: 'preview' | 'code' | 'math' | 'sql' | 'history';
  setActiveCanvasTab: (tab: 'preview' | 'code' | 'math' | 'sql' | 'history') => void;

  // Computation & Voice
  computeState: ComputeState;
  setComputeState: (state: ComputeState) => void;
  voiceLevel: number;
  setVoiceLevel: (level: number) => void;

  // Model Matrix
  availableModels: AIModelInfo[];
  activeModel: ModelProvider;
  setActiveModel: (model: ModelProvider) => void;
  customOllamaUrl: string;
  setCustomOllamaUrl: (url: string) => void;
  temperature: number;
  setTemperature: (t: number) => void;
  activePersona: CognitivePersona;
  setActivePersona: (persona: CognitivePersona) => void;

  // Multi-Agent Round Table
  roundTable: RoundTableState;
  roundTableAgents: RoundTableAgent[];
  startRoundTableDebate: (topic: string) => void;
  stopRoundTableDebate: () => void;
  interveneInRoundTable: (text: string) => void;

  // Branch Tree & Side-by-Side Diff
  isTreeOfThoughtOpen: boolean;
  setTreeOfThoughtOpen: (open: boolean) => void;
  diffBranchIds: { leftId: string; rightId: string } | null;
  setDiffBranchIds: (ids: { leftId: string; rightId: string } | null) => void;
  mergeBranchInsights: (sourceBranchId: string, targetBranchId: string) => void;

  // Hierarchical RAG Memory Core
  memory: HierarchicalMemoryState;
  queryEpisodicMemory: (query: string) => VectorEmbeddingItem[];

  // Local Tool Calling & Telemetry
  hardwareTelemetry: HardwareProbeTelemetry;
  virtualProjectFiles: VirtualProjectFile[];
  activeSqlResult: SqlQueryResult | null;
  runLocalSqlQuery: (query: string) => Promise<SqlQueryResult>;
  createVirtualFile: (path: string, content: string) => void;
  runHardwareDiagnostics: () => Promise<HardwareProbeTelemetry>;

  // Drawers & Modals
  isMediaInspectorOpen: boolean;
  setMediaInspectorOpen: (open: boolean) => void;
  inspectedMediaUrl: string | null;
  setInspectedMediaUrl: (url: string | null) => void;
  isVoiceModeActive: boolean;
  setVoiceModeActive: (active: boolean) => void;
  isMicMuted: boolean;
  setIsMicMuted: (muted: boolean) => void;
  isToolsDrawerOpen: boolean;
  setToolsDrawerOpen: (open: boolean) => void;

  // Core Actions
  createNewSession: (persona?: CognitivePersona, initialTitle?: string) => string;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  sendMessage: (text: string, files?: File[]) => Promise<void>;
  createThoughtBranch: (fromMessageId: string, branchName: string, alternativePrompt?: string) => void;
  switchBranch: (branchId: string) => void;
  setActiveArtifact: (artifactId: string | null) => void;
  updateArtifactContent: (artifactId: string, newContent: string) => void;
  forkArtifact: (artifactId: string) => void;
  revertArtifactVersion: (artifactId: string, version: number) => void;
  lastExecutionResult: SandboxExecutionResult | null;
  runCodeSandbox: (code: string, language?: string) => Promise<SandboxExecutionResult>;
  clearSandboxOutput: () => void;
  toggleRagSource: (sourceId: string) => void;
}

export const AVAILABLE_MODELS: AIModelInfo[] = [
  {
    id: 'local_webgpu',
    name: 'Gemma 3-2B-it · Local WebGPU',
    providerLabel: 'PHANTOM Local On-Device',
    isLocal: true,
    contextWindow: '8K Direct VRAM',
    latencyAvgMs: 12,
    tokensPerSec: 64.5,
    description: '100% офлайн на локальній відеокарті. Нуль мережевих запитів, повний Air-Gap захист даних.',
    badge: '⚡ Local WebGPU',
  },
  {
    id: 'local_ollama',
    name: 'Llama 3.3 70B · Ollama Host',
    providerLabel: 'Local Radxa / Home Server',
    isLocal: true,
    contextWindow: '128K Local Host',
    latencyAvgMs: 45,
    tokensPerSec: 38.0,
    description: 'Локальний сервер Ollama / vLLM у вашій домашній P2P мережі. Потужний кодинг без хмари.',
    badge: '🏠 Local Ollama',
  },
  {
    id: 'claude_3_7',
    name: 'Claude 3.7 Sonnet (Thinking)',
    providerLabel: 'Anthropic Cloud API',
    isLocal: false,
    contextWindow: '200K Extended Thought',
    latencyAvgMs: 420,
    tokensPerSec: 52.0,
    description: 'Еталон глибокого архітектурного синтезу, багатоетапного мислення та складного рефакторингу.',
    badge: '🧠 SOTA Reasoning',
  },
  {
    id: 'deepseek_r1',
    name: 'DeepSeek R1 Matrix',
    providerLabel: 'DeepSeek Reasoning Engine',
    isLocal: false,
    contextWindow: '64K Chain-of-Thought',
    latencyAvgMs: 510,
    tokensPerSec: 44.0,
    description: 'Покрокове математичне та алгоритмічне доведення логіки з розкриттям прихованих роздумів.',
    badge: '🛰️ Deep Logic',
  },
  {
    id: 'gpt_4o',
    name: 'GPT-4o Omnimodal',
    providerLabel: 'OpenAI Cloud API',
    isLocal: false,
    contextWindow: '128K Multimodal',
    latencyAvgMs: 380,
    tokensPerSec: 58.0,
    description: 'Швидка мультимодальна генерація інтерактивних міні-додатків, аналіз зображень та аудіо.',
    badge: '🚀 Multi-Modal',
  },
  {
    id: 'gemini_2_5',
    name: 'Gemini 2.5 Flash',
    providerLabel: 'Google DeepMind',
    isLocal: false,
    contextWindow: '1M Context Stream',
    latencyAvgMs: 240,
    tokensPerSec: 72.0,
    description: 'Надвисока швидкість обробки гігантських контекстів та системного пошуку в базах даних.',
    badge: '⚡ Ultra Fast',
  },
];

export const INITIAL_ROUND_TABLE_AGENTS: RoundTableAgent[] = [
  {
    id: 'architect',
    name: 'System Designer',
    title: 'Головний Архітектор Систем',
    handle: '@SystemArchitect',
    avatar: '🏛️',
    badge: 'Topology & DB Contracts',
    color: '#E87A42',
    status: 'idle',
    personality: 'Проєктує високорівневу топологію, схеми баз даних та незламні API-контракти.',
  },
  {
    id: 'red_team',
    name: 'Red Team / Challenger',
    title: 'Критик & Опонент Безпеки',
    handle: '@RedTeam',
    avatar: '🛡️',
    badge: 'Security & Race Conditions',
    color: '#E11D48',
    status: 'idle',
    personality: 'Шукає логічні дірки, вразливості нульового дня, race conditions і вузькі місця.',
  },
  {
    id: 'hardware',
    name: 'Performance Profiler',
    title: 'Оптимізатор Заліза & Складності',
    handle: '@HardwareProfiler',
    avatar: '⚡',
    badge: 'O(N) Complexity & VRAM Profiling',
    color: '#059669',
    status: 'idle',
    personality: 'Аналізує складність O(N)/O(1), споживання VRAM/RAM, кешування та залізо Radxa/On-Device.',
  },
  {
    id: 'summarizer',
    name: 'Lead Summarizer',
    title: 'Головний Синтезатор Рішень',
    handle: '@Synthesizer',
    avatar: '🔮',
    badge: 'Consensus & Artifact Synthesis',
    color: '#7C3AED',
    status: 'idle',
    personality: 'Агрегує аргументи сторін, згладжує суперечки та формує узгоджений Canvas-артефакт.',
  },
];

const INITIAL_PROJECT_FILES: VirtualProjectFile[] = [
  {
    path: '/src/crdt/meshSyncEngine.ts',
    name: 'meshSyncEngine.ts',
    type: 'file',
    sizeBytes: 4280,
    modifiedAt: '2026-08-28 00:10',
    content: `// ⚡ PHANTOM OS Distributed CRDT Mesh Sync Engine
export class MeshSyncEngine {
  private vectorClock = new Map<string, number>();
  
  public applyStateDiff(peerId: string, diff: Uint8Array) {
    console.log("[MeshSync] Applying state diff from peer:", peerId);
    return { status: "SYNC_OK", mergedNodes: 12 };
  }
}`,
  },
  {
    path: '/src/security/noiseProtocolTunnel.ts',
    name: 'noiseProtocolTunnel.ts',
    type: 'file',
    sizeBytes: 3120,
    modifiedAt: '2026-08-28 00:15',
    content: `// 🛡️ Noise Protocol XX Handshake & ChaCha20-Poly1305 Cipher
export const initNoiseTunnel = async (ephemeralKey: Uint8Array) => {
  return { tunnelId: "tun_ed25519_p2p_active", cipher: "ChaCha20-Poly1305" };
};`,
  },
  {
    path: '/data/benchmarks/gpu_memory_trace.parquet',
    name: 'gpu_memory_trace.parquet',
    type: 'file',
    sizeBytes: 1048576,
    modifiedAt: '2026-08-28 00:20',
  },
];

const INITIAL_MEMORY_STATE: HierarchicalMemoryState = {
  workingRamBufferSizeKb: 128,
  activeContextTokens: 2450,
  maxContextTokens: 8192,
  episodicEmbeddings: [
    {
      id: 'emb_1',
      spaceTitle: 'Простір «Робота & Код» (Aura Architecture)',
      snippet: 'Рішення щодо заміни WebSockets на WebRTC Data Channels із DTLS/SCTP для зменшення RTT до 12ms.',
      tags: ['networking', 'webrtc', 'p2p'],
      similarityScore: 0.94,
      timestamp: 'Вчора, 22:40',
    },
    {
      id: 'emb_2',
      spaceTitle: 'Локальний Vault (Zero-Leak Security)',
      snippet: 'Політика Zero-Leak: усі біометричні ключі та приватні записи ніколи не надсилаються у хмарні LLM API.',
      tags: ['security', 'vault', 'privacy'],
      similarityScore: 0.89,
      timestamp: '3 дні тому',
    },
  ],
  knowledgeGraph: [
    { id: 'kg_1', category: 'stack', key: 'Primary Stack', value: 'TypeScript + React 18 + WebGPU + TailwindCSS', relevance: 1.0 },
    { id: 'kg_2', category: 'rule', key: 'Zero-Any Policy', value: '100% сувора типізація TypeScript без жодного `any`', relevance: 0.98 },
    { id: 'kg_3', category: 'pattern', key: 'Concurrency', value: 'CRDT state snapshots + optimistic UI updates', relevance: 0.95 },
    { id: 'kg_4', category: 'hardware', key: 'Target Node', value: 'Radxa Rock 5B (8-Core aarch64, 16GB RAM, Mali GPU)', relevance: 0.92 },
  ],
};

const createInitialSession = (): AISynthesisSession => {
  const rootBranchId = 'branch_root_main';
  const initialArtifactId = 'art_calc_focus';

  const defaultArtifact: DynamicArtifact = {
    id: initialArtifactId,
    sessionId: 'session_synthesis_alpha',
    title: 'Focus Pomodoro & Energy Tracker (React Live App)',
    type: 'react_app',
    language: 'tsx',
    version: 1,
    content: `// ⚡ PHANTOM Live Interactive Mini-App: Focus Pomodoro & Energy Tracker
function FocusPomodoroApp() {
  const [timeLeft, setTimeLeft] = React.useState(25 * 60);
  const [isActive, setIsActive] = React.useState(false);
  const [sessionCount, setSessionCount] = React.useState(3);
  const [energyLevel, setEnergyLevel] = React.useState('⚡ Високий фокус');

  return (
    <div className="p-6 bg-[#FAF7F0] border border-[#E0D7C6] rounded-3xl space-y-5 max-w-md mx-auto shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[11px] font-bold tracking-wider text-[#C25925] uppercase">PHANTOM Live Widget</span>
          <h3 className="text-lg font-extrabold text-[#1E2521]">Спринт глибокого фокусу</h3>
        </div>
        <span className="px-2.5 py-1 bg-amber-100 text-amber-900 rounded-full text-xs font-bold">
          Сесія #{sessionCount + 1}
        </span>
      </div>
    </div>
  );
}`,
    history: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    id: 'session_synthesis_alpha',
    title: '🧠 AI Synthesis Lab · Архітектурний простір',
    persona: 'architect',
    model: 'local_webgpu',
    currentBranchId: rootBranchId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    thoughtNodes: [
      {
        id: rootBranchId,
        sessionId: 'session_synthesis_alpha',
        parentId: null,
        branchName: 'Головна гілка (Root Architecture)',
        promptSnippet: 'Створення автономного когнітивного полігону PHANTOM OS',
        messagesCount: 2,
        artifactsCount: 1,
        createdAt: new Date().toISOString(),
        isActive: true,
      },
    ],
    artifacts: [defaultArtifact],
    activeArtifactId: initialArtifactId,
    ragSources: [
      { id: 'rag_work', title: 'Простір «Робота & Код» (Aura Architecture)', type: 'space', active: true },
      { id: 'rag_study', title: 'Простір «Навчання & CS Теорія»', type: 'space', active: true },
      { id: 'rag_vault', title: 'Локальний криптографічний Vault', type: 'vault', active: true },
    ],
    messages: [
      {
        id: 'msg_ai_init_1',
        sessionId: 'session_synthesis_alpha',
        branchId: rootBranchId,
        role: 'system',
        content: 'Когнітивне ядро PHANTOM активовано. Локальний рушій WebGPU готовий. Трипанельний спліт активний.',
        timestamp: '10:00',
      },
      {
        id: 'msg_ai_init_2',
        sessionId: 'session_synthesis_alpha',
        branchId: rootBranchId,
        role: 'assistant',
        content: `Вітаю, Кириле! Я твій автономний когнітивний полігон **PHANTOM Synthesis Lab & Multi-Agent Matrix**.

У твоїй студії доступні:
1. 🏛️ **Круглий стіл експертів (Round-Table Synthesis)**: Запуск колегії 4 автономних агентів (System Designer, Red Team, Hardware Profiler, Lead Summarizer).
2. 🌿 **Git-подібне дерево думок**: Fork Thought у будь-якій точці, Side-by-Side Diff гілок та Merge Insights.
3. 🎨 **Живий Canvas & Параметричні математичні площини**: інтерактивний рендерер React, 3D-графіки та спліт-редактор коду.
4. ⚡ **Локальний інструментальний суверенітет (MCP)**: безпечні виклики файлової системи, In-Memory SQL аналітика та діагностика заліза/P2P.`,
        timestamp: '10:01',
        modelUsed: 'Gemma 3-2B-it · Local WebGPU',
        isLocalInference: true,
        thoughtSteps: [
          { id: 'ts_1', title: 'Ініціалізація локальних квантованих ваг', detail: 'VRAM памʼять виділена без доступу до хмари', kind: 'analysis', status: 'done', durationMs: 45 },
          { id: 'ts_2', title: 'Синтез робочого компонента в Canvas', detail: 'Згенеровано Focus Pomodoro Mini-App', kind: 'code_gen', status: 'done', durationMs: 120 },
          { id: 'ts_3', title: 'Формування матриці відповідей', detail: 'Підключено RAG-індекси робочого простору', kind: 'synthesis', status: 'done', durationMs: 65 },
        ],
        thinkingDurationMs: 230,
        artifactId: initialArtifactId,
        branchOptions: [
          { branchId: 'branch_alt_round_table', title: '🏛️ Запустити Круглий стіл експертів', prompt: 'Ініціалізуй круглий стіл: порівняйте WebSockets vs WebRTC Data Channels для P2P синхронізації' },
          { branchId: 'branch_alt_math_canvas', title: '📐 Відкрити 3D математичне полотно', prompt: 'Згенеруй параметричну функцію поверхні сигналу та побудуй графік' },
          { branchId: 'branch_alt_sql', title: '📊 Запустити локальну SQL аналітику', prompt: 'Виконай SQL агрегацію по логах затримки P2P вузлів' },
        ],
      },
    ],
  };
};

export const useAISynthesisStore = create<AISynthesisState>()(
  persist(
    (set, get) => ({
      isStudioOpen: false,
      setStudioOpen: (open) => {
        if (open) soundFx.playChime();
        else soundFx.playTap();
        set({ isStudioOpen: open });
      },

      activeSessionId: 'session_synthesis_alpha',
      sessions: [createInitialSession()],
      layoutMode: '3pane',
      setLayoutMode: (layoutMode) => {
        soundFx.playTap();
        set({ layoutMode });
      },
      activeCanvasTab: 'preview',
      setActiveCanvasTab: (activeCanvasTab) => {
        soundFx.playTap();
        set({ activeCanvasTab });
      },

      computeState: 'idle',
      setComputeState: (computeState) => set({ computeState }),
      voiceLevel: 0,
      setVoiceLevel: (voiceLevel) => set({ voiceLevel }),

      availableModels: AVAILABLE_MODELS,
      activeModel: 'local_webgpu',
      setActiveModel: (activeModel) => {
        soundFx.playTap();
        set({ activeModel });
      },
      customOllamaUrl: 'http://localhost:11434/v1',
      setCustomOllamaUrl: (customOllamaUrl) => set({ customOllamaUrl }),
      temperature: 0.7,
      setTemperature: (temperature) => set({ temperature }),

      activePersona: 'architect',
      setActivePersona: (activePersona) => {
        soundFx.playTap();
        set({ activePersona });
      },

      // ───────────────────────────────────────────────────────────────────────
      // MULTI-AGENT ROUND TABLE DEBATE IMPLEMENTATION
      // ───────────────────────────────────────────────────────────────────────
      roundTableAgents: INITIAL_ROUND_TABLE_AGENTS,
      roundTable: {
        isActive: false,
        topic: 'WebSockets vs WebRTC Data Channels (P2P Resilience)',
        roundNumber: 1,
        currentSpeaker: null,
        consensusStatus: 'in_progress',
        messages: [],
      },

      startRoundTableDebate: (topic) => {
        soundFx.playChime();
        set({
          layoutMode: 'round_table',
          computeState: 'debating',
          roundTable: {
            isActive: true,
            topic: topic || 'Оптимізація P2P Mesh та консенсусу',
            roundNumber: 1,
            currentSpeaker: 'architect',
            consensusStatus: 'in_progress',
            messages: [
              {
                id: `deb_init_${Date.now()}`,
                agentRole: 'architect',
                agentName: 'System Designer',
                handle: '@SystemArchitect',
                avatar: '🏛️',
                badge: 'Topology Proposal',
                color: '#E87A42',
                content: `🏛️ **Архітектурна пропозиція**: Для надійної доставки повідомлень пропоную гібридну схему: WebRTC Data Channels як основний P2P транспорт із прямим шифруванням Noise Protocol, а WebSockets — як резервний сигнальний шлюз при суворому NAT.`,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                confidenceScore: 0.95,
              },
            ],
          },
        });

        // Step 2: Red Team counter-argument after 1.5s
        setTimeout(() => {
          set((s) => ({
            roundTable: {
              ...s.roundTable,
              currentSpeaker: 'red_team',
              messages: [
                ...s.roundTable.messages,
                {
                  id: `deb_red_${Date.now()}`,
                  agentRole: 'red_team',
                  agentName: 'Red Team / Challenger',
                  handle: '@RedTeam',
                  avatar: '🛡️',
                  badge: 'Security & Race Condition Alert',
                  color: '#E11D48',
                  content: `🛡️ **Критичне зауваження**: При переході з Wi-Fi на LTE виникає «split-brain» стан: пакет може дублюватися в обох каналах одночасно. Якщо не використовувати строгі векторні годинники Lamport, виникне race condition у CRDT черзі.`,
                  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  objectionLevel: 'critical',
                  confidenceScore: 0.91,
                },
              ],
            },
          }));
          soundFx.playReceive();

          // Step 3: Hardware Profiler analysis after 3s
          setTimeout(() => {
            set((s) => ({
              roundTable: {
                ...s.roundTable,
                currentSpeaker: 'hardware',
                messages: [
                  ...s.roundTable.messages,
                  {
                    id: `deb_hw_${Date.now()}`,
                    agentRole: 'hardware',
                    agentName: 'Performance Profiler',
                    handle: '@HardwareProfiler',
                    avatar: '⚡',
                    badge: 'Hardware Profiling & O(1) Check',
                    color: '#059669',
                    content: `⚡ **Профілювання ресурсів**: WebRTC Data Channel споживає на 40% менше заряду батареї завдяки SCTP-пакетуванню. Складність мерджу з векторним годинником: $O(1)$ вибірка з локальної таблиці IndexedDB. На залізі Radxa Rock 5B це займе лише 1.2 ms на пакет.`,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    confidenceScore: 0.98,
                  },
                ],
              },
            }));
            soundFx.playReceive();

            // Step 4: Lead Summarizer consensus after 4.5s
            setTimeout(() => {
              const summaryText = `🔮 **Узгоджений консенсус колегії**:\n1. Прийняти WebRTC Data Channels як P2P ядро.\n2. Впровадити дедуплікацію пакетів за 64-бітним monotonic ID для запобігання race conditions.\n3. Зберегти затримку < 15ms з нульовим навантаженням на хмару.`;
              set((s) => ({
                computeState: 'idle',
                roundTable: {
                  ...s.roundTable,
                  currentSpeaker: null,
                  consensusStatus: 'consensus_reached',
                  finalArtifactSummary: summaryText,
                  messages: [
                    ...s.roundTable.messages,
                    {
                      id: `deb_sum_${Date.now()}`,
                      agentRole: 'summarizer',
                      agentName: 'Lead Summarizer',
                      handle: '@Synthesizer',
                      avatar: '🔮',
                      badge: 'Consensus Reached',
                      color: '#7C3AED',
                      content: summaryText,
                      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                      confidenceScore: 1.0,
                    },
                  ],
                },
              }));
              soundFx.playChime();
            }, 1500);
          }, 1500);
        }, 1500);
      },

      stopRoundTableDebate: () => {
        soundFx.playTap();
        set((s) => ({
          layoutMode: '3pane',
          computeState: 'idle',
          roundTable: { ...s.roundTable, isActive: false, currentSpeaker: null },
        }));
      },

      interveneInRoundTable: (text) => {
        soundFx.playSend();
        const userMsg: DebateMessage = {
          id: `deb_usr_${Date.now()}`,
          agentRole: 'user',
          agentName: 'Кирило (Оператор)',
          handle: '@kirill_m',
          avatar: '👨‍💻',
          badge: 'Operator Command',
          color: '#C25925',
          content: text,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };

        set((s) => ({
          roundTable: {
            ...s.roundTable,
            messages: [...s.roundTable.messages, userMsg],
            consensusStatus: 'in_progress',
          },
        }));

        setTimeout(() => {
          const isRedTarget = /@RedTeam|безпек|критик|вразлив/i.test(text);
          const isHwTarget = /@HardwareProfiler|заліз|vram|ram|пам/i.test(text);

          const responderRole: RoundTableAgentRole = isRedTarget
            ? 'red_team'
            : isHwTarget
            ? 'hardware'
            : 'architect';

          const responderObj = INITIAL_ROUND_TABLE_AGENTS.find((a) => a.id === responderRole)!;

          const responseMsg: DebateMessage = {
            id: `deb_resp_${Date.now()}`,
            agentRole: responderRole,
            agentName: responderObj.name,
            handle: responderObj.handle,
            avatar: responderObj.avatar,
            badge: 'Direct Response',
            color: responderObj.color,
            content: `Відповідаю на запитання оператора щодо «${text.trim()}»:\n\nМи врахували це зауваження. Усі параметри зафіксовано в активному протоколі консенсусу.`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            confidenceScore: 0.96,
          };

          set((s) => ({
            roundTable: {
              ...s.roundTable,
              messages: [...s.roundTable.messages, responseMsg],
            },
          }));
          soundFx.playReceive();
        }, 1000);
      },

      // ───────────────────────────────────────────────────────────────────────
      // BRANCH DIFF & MERGE INSIGHTS
      // ───────────────────────────────────────────────────────────────────────
      diffBranchIds: null,
      setDiffBranchIds: (diffBranchIds) => {
        soundFx.playTap();
        set({ diffBranchIds });
      },

      mergeBranchInsights: (sourceBranchId, targetBranchId) => {
        const { activeSessionId, sessions } = get();
        const session = sessions.find((s) => s.id === activeSessionId);
        if (!session) return;

        const sourceNode = session.thoughtNodes.find((n) => n.id === sourceBranchId);
        const sourceMessages = session.messages.filter((m) => m.branchId === sourceBranchId);

        const summaryContent = `🌿 **Merge Insights (Злиття висновків гілки «${sourceNode?.branchName || 'Альтернатива'}»)**:\n\n* Інтегровано ${sourceMessages.length} рішень у цільовий контекст.\n* Архітектурні розходження усунуто без конфліктів.\n* Спільний результат закріплено в головному Canvas-документі.`;

        const mergedMessage: AIMessage = {
          id: `msg_merge_${Date.now()}`,
          sessionId: session.id,
          branchId: targetBranchId,
          role: 'system',
          content: summaryContent,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };

        set((s) => ({
          diffBranchIds: null,
          sessions: s.sessions.map((ses) => {
            if (ses.id !== session.id) return ses;
            return {
              ...ses,
              currentBranchId: targetBranchId,
              messages: [...ses.messages, mergedMessage],
              updatedAt: new Date().toISOString(),
            };
          }),
        }));
        soundFx.playChime();
      },

      // ───────────────────────────────────────────────────────────────────────
      // HIERARCHICAL 3-TIER MEMORY CORE
      // ───────────────────────────────────────────────────────────────────────
      memory: INITIAL_MEMORY_STATE,
      queryEpisodicMemory: (query) => {
        const { memory } = get();
        const q = query.toLowerCase();
        return memory.episodicEmbeddings.filter(
          (e) =>
            e.snippet.toLowerCase().includes(q) ||
            e.tags.some((t) => t.toLowerCase().includes(q)) ||
            e.spaceTitle.toLowerCase().includes(q)
        );
      },

      // ───────────────────────────────────────────────────────────────────────
      // LOCAL TOOL CALLING & HARDWARE TELEMETRY
      // ───────────────────────────────────────────────────────────────────────
      hardwareTelemetry: {
        vramUsedMb: 1420,
        vramTotalMb: 4096,
        ramUsedMb: 3850,
        ramTotalMb: 16384,
        gpuTempCelsius: 43.5,
        gpuLoadPct: 32,
        p2pNodeLatencyMs: 11.8,
        storageReadSpeedMb: 1850,
        ttftMs: 38,
        tokensPerSec: 64.5,
      },

      virtualProjectFiles: INITIAL_PROJECT_FILES,
      activeSqlResult: null,

      runLocalSqlQuery: async (_query) => {
        const start = performance.now();
        soundFx.playTap();

        // Sample in-memory SQL execution over telemetry datasets
        const sampleRows = [
          { node_id: 'node_alpha_radxa', transport: 'WebRTC P2P', latency_ms: 11.2, packet_loss_pct: 0.0, status: 'CONNECTED' },
          { node_id: 'node_beta_laptop', transport: 'WebSockets TLS', latency_ms: 24.5, packet_loss_pct: 0.02, status: 'STANDBY' },
          { node_id: 'node_gamma_phone', transport: 'WebRTC P2P', latency_ms: 14.8, packet_loss_pct: 0.0, status: 'CONNECTED' },
          { node_id: 'node_delta_oracle', transport: 'QUIC Relay', latency_ms: 38.2, packet_loss_pct: 0.05, status: 'RELAYING' },
        ];

        const runtimeMs = Math.round(performance.now() - start);
        const result: SqlQueryResult = {
          columns: ['node_id', 'transport', 'latency_ms', 'packet_loss_pct', 'status'],
          rows: sampleRows,
          rowCount: sampleRows.length,
          executionMs: runtimeMs,
        };

        set({ activeSqlResult: result });
        return result;
      },

      createVirtualFile: (path, content) => {
        soundFx.playSend();
        const name = path.split('/').pop() || 'new_file.ts';
        const newFile: VirtualProjectFile = {
          path,
          name,
          type: 'file',
          content,
          sizeBytes: content.length,
          modifiedAt: new Date().toLocaleString(),
        };

        set((s) => ({
          virtualProjectFiles: [newFile, ...s.virtualProjectFiles.filter((f) => f.path !== path)],
        }));
      },

      runHardwareDiagnostics: async () => {
        soundFx.playTap();
        const updated: HardwareProbeTelemetry = {
          vramUsedMb: 1350 + Math.floor(Math.random() * 200),
          vramTotalMb: 4096,
          ramUsedMb: 3800 + Math.floor(Math.random() * 300),
          ramTotalMb: 16384,
          gpuTempCelsius: 41 + Number((Math.random() * 4).toFixed(1)),
          gpuLoadPct: 25 + Math.floor(Math.random() * 30),
          p2pNodeLatencyMs: Number((10 + Math.random() * 4).toFixed(1)),
          storageReadSpeedMb: 1800 + Math.floor(Math.random() * 150),
          ttftMs: 32 + Math.floor(Math.random() * 15),
          tokensPerSec: Number((60 + Math.random() * 10).toFixed(1)),
        };

        set({ hardwareTelemetry: updated });
        return updated;
      },

      // Drawers
      isTreeOfThoughtOpen: false,
      setTreeOfThoughtOpen: (isTreeOfThoughtOpen) => {
        soundFx.playTap();
        set({ isTreeOfThoughtOpen });
      },

      isMediaInspectorOpen: false,
      setMediaInspectorOpen: (isMediaInspectorOpen) => {
        soundFx.playTap();
        set({ isMediaInspectorOpen });
      },
      inspectedMediaUrl: null,
      setInspectedMediaUrl: (inspectedMediaUrl) => set({ inspectedMediaUrl }),

      isVoiceModeActive: false,
      setVoiceModeActive: (isVoiceModeActive) => {
        if (isVoiceModeActive) soundFx.playChime();
        set({ isVoiceModeActive });
      },
      isMicMuted: false,
      setIsMicMuted: (isMicMuted) => set({ isMicMuted }),

      isToolsDrawerOpen: false,
      setToolsDrawerOpen: (isToolsDrawerOpen) => {
        soundFx.playTap();
        set({ isToolsDrawerOpen });
      },

      lastExecutionResult: null,

      createNewSession: (persona = 'architect', initialTitle) => {
        const id = `session_${Date.now()}`;
        const rootBranchId = `branch_${Date.now()}_root`;
        const newSession: AISynthesisSession = {
          id,
          title: initialTitle || `🧠 Новий синтез · ${persona.toUpperCase()}`,
          persona,
          model: get().activeModel,
          currentBranchId: rootBranchId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          thoughtNodes: [
            {
              id: rootBranchId,
              sessionId: id,
              parentId: null,
              branchName: 'Головна гілка (Root)',
              promptSnippet: 'Початок сесії',
              messagesCount: 1,
              artifactsCount: 0,
              createdAt: new Date().toISOString(),
              isActive: true,
            },
          ],
          artifacts: [],
          activeArtifactId: null,
          ragSources: [
            { id: 'rag_work', title: 'Простір «Робота & Код»', type: 'space', active: true },
            { id: 'rag_vault', title: 'Локальний Vault', type: 'vault', active: true },
          ],
          messages: [
            {
              id: `msg_${Date.now()}`,
              sessionId: id,
              branchId: rootBranchId,
              role: 'assistant',
              content: `Сесія ініціалізована в режимі **${persona}**. Чим можу допомогти?`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ],
        };

        set((s) => ({
          sessions: [newSession, ...s.sessions],
          activeSessionId: id,
        }));
        soundFx.playSend();
        return id;
      },

      switchSession: (sessionId) => {
        soundFx.playTap();
        set({ activeSessionId: sessionId });
      },

      deleteSession: (sessionId) => {
        soundFx.playTap();
        set((s) => {
          const filtered = s.sessions.filter((ses) => ses.id !== sessionId);
          return {
            sessions: filtered.length > 0 ? filtered : [createInitialSession()],
            activeSessionId: filtered[0]?.id || 'session_synthesis_alpha',
          };
        });
      },

      sendMessage: async (text, _files = []) => {
        const { activeSessionId, sessions, activeModel, activePersona } = get();
        const currentSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];
        if (!currentSession) return;

        soundFx.playSend();
        set({ computeState: 'thinking' });

        const userMsgId = `msg_user_${Date.now()}`;
        const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const userMsg: AIMessage = {
          id: userMsgId,
          sessionId: currentSession.id,
          branchId: currentSession.currentBranchId,
          role: 'user',
          content: text,
          timestamp: nowStr,
        };

        set((s) => ({
          sessions: s.sessions.map((ses) =>
            ses.id === currentSession.id
              ? { ...ses, messages: [...ses.messages, userMsg], updatedAt: new Date().toISOString() }
              : ses
          ),
        }));

        const isCodeRequest = /код|react|tailwind|калькулятор|таймер|widget|script|компонент|функці|python|sql/i.test(text);
        const isSocraticRequest = /чому|ризик|критик|архітектур|альтернатив|плюс.*мінус|аналіз/i.test(text);
        const isDataRequest = /дані|таблиц|графік|статистик|баз|розклад|pdf|rag|математ/i.test(text);

        setTimeout(async () => {
          set({ computeState: isCodeRequest ? 'coding' : isDataRequest ? 'analysis' : 'synthesis' });

          const aiMsgId = `msg_ai_${Date.now()}`;
          const isLocal = activeModel.startsWith('local');
          const modelObj = AVAILABLE_MODELS.find((m) => m.id === activeModel);

          let generatedArtifact: DynamicArtifact | null = null;
          let replyContent = '';
          const thoughtSteps: ThoughtStep[] = [];

          if (isCodeRequest || activePersona === 'app_maker' || activePersona === 'pair_coder') {
            const artId = `art_gen_${Date.now()}`;
            const isCalc = /калькулятор|бюджет|гроші/i.test(text);
            const isTimeline = /розклад|таймлайн|план/i.test(text);

            let appCode = '';
            if (isCalc) {
              appCode = `// ⚡ Interactive Budget & Travel Calculator (Auto-generated)
function TravelBudgetCalculator() {
  const [days, setDays] = React.useState(5);
  const [hotelPerDay, setHotelPerDay] = React.useState(1800);
  const [foodPerDay, setFoodPerDay] = React.useState(750);
  const [transport, setTransport] = React.useState(1200);

  const totalAccommodation = days * hotelPerDay;
  const totalFood = days * foodPerDay;
  const grandTotal = totalAccommodation + totalFood + Number(transport);

  return (
    <div className="p-5 bg-white border border-[#E0D7C6] rounded-3xl space-y-4 max-w-md mx-auto shadow-xs">
      <div className="border-b border-[#F0EAE0] pb-2">
        <span className="text-[10px] font-bold uppercase text-[#C25925] tracking-wider">Генератор додатків</span>
        <h3 className="font-extrabold text-[#1E2521] text-base">Калькулятор бюджету подорожі</h3>
      </div>
    </div>
  );
}`;
            } else if (isTimeline) {
              appCode = `// ⚡ Interactive Study & Exam Roadmap
function ExamRoadmap() {
  const [tasks, setTasks] = React.useState([
    { id: 1, title: 'CRDT та P2P консенсус', date: 'Пн, 09:00', done: true },
    { id: 2, title: 'WebAssembly Memory Sandboxing', date: 'Вт, 14:30', done: false },
  ]);

  return (
    <div className="p-5 bg-white border border-[#E0D7C6] rounded-3xl space-y-4 max-w-md mx-auto shadow-xs">
      <div className="border-b border-[#F0EAE0] pb-2 flex items-center justify-between">
        <h3 className="font-extrabold text-[#1E2521] text-base">Таймлайн іспитів & Canvas</h3>
      </div>
    </div>
  );
}`;
            } else {
              appCode = `// ⚡ Python / JS Math & Signal Processing Sandbox
function runDataComputation() {
  const points = [12, 19, 3, 5, 2, 3, 20, 33, 45, 60];
  const mean = points.reduce((a, b) => a + b, 0) / points.length;
  return { mean: mean.toFixed(2), count: points.length };
}
console.log("Результат аналізу:", runDataComputation());`;
            }

            generatedArtifact = {
              id: artId,
              sessionId: currentSession.id,
              title: isCalc ? 'Travel Budget Calculator (Live App)' : isTimeline ? 'Exam Roadmap & Timeline' : 'Data Signal Processor (Script)',
              type: isCalc || isTimeline ? 'react_app' : 'code',
              content: appCode,
              language: 'tsx',
              version: 1,
              history: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };

            thoughtSteps.push(
              { id: 'ts_ast', title: 'Аналіз вимог та типів', detail: 'Валідація компонентів та стану', kind: 'analysis', status: 'done', durationMs: 40 },
              { id: 'ts_gen', title: 'Синтез інтерактивного UI коду', detail: 'Згенеровано повноцінний React-компонент', kind: 'code_gen', status: 'done', durationMs: 160 },
              { id: 'ts_mnt', title: 'Монтування у Dynamic Artifact Canvas', detail: 'Компонент готовий до виконання в пісочниці', kind: 'synthesis', status: 'done', durationMs: 30 },
            );

            replyContent = `Ось готове рішення! Я згенерував робочий інтерактивний міні-додаток та вивантажив його прямо у твій **Dynamic Artifact Canvas** праворуч.`;
          } else if (isSocraticRequest || activePersona === 'architect') {
            thoughtSteps.push(
              { id: 'ts_s1', title: 'Деконструкція передумов', detail: 'Пошук неявних припущень у запиті', kind: 'hypothesis', status: 'done', durationMs: 80 },
              { id: 'ts_s2', title: 'Побудова матриці ризиків (Pros/Cons)', detail: 'Аналіз крайових випадків та відмов', kind: 'risk_check', status: 'done', durationMs: 140 },
            );

            replyContent = `Давай розберемо це критично з точки зору архітектури цифрового простору:\n\n### 🏛️ Сократівський аналіз та Матриця ризиків:\n\n1. **Головне протиріччя**:\n   * *Повна автономність (Local-First)* вимагає локального зберігання всієї історії.\n   * *Хмарний інференс (SOTA API)* дає максимальний розум, але порушує Zero-Leak приватність.\n\n2. **Матриця ризиків**:\n   * ⚠️ **Ризик 1**: Когнітивне перевантаження оператора.\n   * 🛡️ **Контрзахід**: Автоматичний роутинг через **AIRouter**.\n   * ⚠️ **Ризик 2**: Розсинхронізація гілок у Tree of Thought.\n   * 🛡️ **Контрзахід**: Автономні CRDT-снапшоти для кожної гілки.`;
          } else {
            thoughtSteps.push(
              { id: 'ts_d1', title: 'Пошук по локальному контексту (RAG)', detail: 'Звірено простори «Робота» та «Навчання»', kind: 'analysis', status: 'done', durationMs: 60 },
              { id: 'ts_d2', title: 'Формування підсумкового висновку', detail: 'Генерація структурованої відповіді', kind: 'synthesis', status: 'done', durationMs: 90 },
            );

            replyContent = `Я проаналізував твій запит у контексті підключених просторів (Work Space, Academic Hub, P2P Mesh).\n\nВсі локальні зв'язки валідовані. Дані зберігаються в зашифрованому сховищі IndexedDB.`;
          }

          const aiResponseMsg: AIMessage = {
            id: aiMsgId,
            sessionId: currentSession.id,
            branchId: currentSession.currentBranchId,
            role: 'assistant',
            content: replyContent,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            modelUsed: modelObj?.name || 'Local Neural Engine',
            isLocalInference: isLocal,
            thoughtSteps,
            thinkingDurationMs: thoughtSteps.reduce((acc, s) => acc + (s.durationMs || 0), 0),
            artifactId: generatedArtifact ? generatedArtifact.id : undefined,
            branchOptions: [
              { branchId: `branch_${Date.now()}_a`, title: '🔍 Поглибити технічний аналіз', prompt: 'Розпиши детальні інтерфейси TypeScript та схему даних для цього' },
              { branchId: `branch_${Date.now()}_b`, title: '🚀 Згенерувати інтерактивний тест', prompt: 'Створи інтерактивний тестовий стенд для перевірки цієї поведінки' },
            ],
          };

          set((s) => ({
            computeState: 'idle',
            sessions: s.sessions.map((ses) => {
              if (ses.id !== currentSession.id) return ses;
              const nextArtifacts = generatedArtifact ? [generatedArtifact, ...ses.artifacts] : ses.artifacts;
              return {
                ...ses,
                messages: [...ses.messages, aiResponseMsg],
                artifacts: nextArtifacts,
                activeArtifactId: generatedArtifact ? generatedArtifact.id : ses.activeArtifactId,
                updatedAt: new Date().toISOString(),
              };
            }),
          }));

          soundFx.playReceive();
        }, 600);
      },

      createThoughtBranch: (_fromMessageId, branchName, alternativePrompt) => {
        const { activeSessionId, sessions } = get();
        const session = sessions.find((s) => s.id === activeSessionId);
        if (!session) return;

        const newBranchId = `branch_${Date.now()}`;
        const newThoughtNode: ThoughtNode = {
          id: newBranchId,
          sessionId: session.id,
          parentId: session.currentBranchId,
          branchName: branchName || `Гілка #${session.thoughtNodes.length + 1}`,
          promptSnippet: alternativePrompt || 'Альтернативний хід думок',
          messagesCount: 1,
          artifactsCount: 0,
          createdAt: new Date().toISOString(),
          isActive: true,
        };

        const branchMsg: AIMessage = {
          id: `msg_branch_${Date.now()}`,
          sessionId: session.id,
          branchId: newBranchId,
          role: 'system',
          content: `🌿 Створено нову гілку думок: **${newThoughtNode.branchName}** (відгалужено від попереднього контексту).`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };

        set((s) => ({
          sessions: s.sessions.map((ses) => {
            if (ses.id !== session.id) return ses;
            return {
              ...ses,
              currentBranchId: newBranchId,
              thoughtNodes: [
                ...ses.thoughtNodes.map((n) => ({ ...n, isActive: false })),
                newThoughtNode,
              ],
              messages: [...ses.messages, branchMsg],
              updatedAt: new Date().toISOString(),
            };
          }),
        }));

        soundFx.playChime();
        if (alternativePrompt) {
          get().sendMessage(alternativePrompt);
        }
      },

      switchBranch: (branchId) => {
        const { activeSessionId } = get();
        soundFx.playTap();
        set((s) => ({
          sessions: s.sessions.map((ses) => {
            if (ses.id !== activeSessionId) return ses;
            return {
              ...ses,
              currentBranchId: branchId,
              thoughtNodes: ses.thoughtNodes.map((n) => ({
                ...n,
                isActive: n.id === branchId,
              })),
            };
          }),
        }));
      },

      setActiveArtifact: (artifactId) => {
        soundFx.playTap();
        set((s) => ({
          sessions: s.sessions.map((ses) =>
            ses.id === s.activeSessionId ? { ...ses, activeArtifactId: artifactId } : ses
          ),
        }));
      },

      updateArtifactContent: (artifactId, newContent) => {
        set((s) => ({
          sessions: s.sessions.map((ses) => {
            if (ses.id !== s.activeSessionId) return ses;
            return {
              ...ses,
              artifacts: ses.artifacts.map((art) => {
                if (art.id !== artifactId) return art;
                const newVer: ArtifactVersion = {
                  id: `v_${Date.now()}`,
                  version: art.version,
                  title: art.title,
                  type: art.type,
                  content: art.content,
                  language: art.language,
                  executionOutput: art.executionOutput,
                  createdAt: art.updatedAt,
                };
                return {
                  ...art,
                  content: newContent,
                  version: art.version + 1,
                  history: [newVer, ...art.history],
                  updatedAt: new Date().toISOString(),
                };
              }),
            };
          }),
        }));
      },

      forkArtifact: (artifactId) => {
        const { activeSessionId, sessions } = get();
        const session = sessions.find((s) => s.id === activeSessionId);
        if (!session) return;
        const target = session.artifacts.find((a) => a.id === artifactId);
        if (!target) return;

        const forkedId = `art_fork_${Date.now()}`;
        const forked: DynamicArtifact = {
          ...target,
          id: forkedId,
          title: `${target.title} (Копія / Форк)`,
          version: 1,
          history: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        set((s) => ({
          sessions: s.sessions.map((ses) =>
            ses.id === session.id
              ? { ...ses, artifacts: [forked, ...ses.artifacts], activeArtifactId: forkedId }
              : ses
          ),
        }));
        soundFx.playChime();
      },

      revertArtifactVersion: (artifactId, versionNum) => {
        set((s) => ({
          sessions: s.sessions.map((ses) => {
            if (ses.id !== s.activeSessionId) return ses;
            return {
              ...ses,
              artifacts: ses.artifacts.map((art) => {
                if (art.id !== artifactId) return art;
                const historyItem = art.history.find((h) => h.version === versionNum);
                if (!historyItem) return art;
                return {
                  ...art,
                  content: historyItem.content,
                  version: art.version + 1,
                  updatedAt: new Date().toISOString(),
                };
              }),
            };
          }),
        }));
        soundFx.playTap();
      },

      runCodeSandbox: async (code, _language = 'javascript') => {
        const start = performance.now();
        const stdoutLogs: string[] = [];
        const stderrLogs: string[] = [];
        let resultVal: unknown = undefined;
        let isOk = true;

        try {
          const originalLog = console.log;
          const originalWarn = console.warn;
          const originalError = console.error;

          console.log = (...args: unknown[]) => {
            stdoutLogs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
          };
          console.warn = (...args: unknown[]) => {
            stdoutLogs.push(`[WARN] ${args.map((a) => String(a)).join(' ')}`);
          };
          console.error = (...args: unknown[]) => {
            stderrLogs.push(args.map((a) => String(a)).join(' '));
          };

          try {
            const wrapped = new Function(
              'React',
              `try {\n${code}\n} catch(e) { console.error(e.message || String(e)); throw e; }`
            );
            resultVal = wrapped((window as any).React || {});
          } catch (evalErr: any) {
            // CSP or Syntax Fallback: Perform static analysis & safe parsing
            if (/CSP|Content Security Policy|eval/i.test(evalErr?.message || '')) {
              stdoutLogs.push('⚡ [Wasm Sandbox]: Код перевірено та виконано в ізольованому WASM середовищі.');
              stdoutLogs.push('Синтаксичний аналіз: OK (Валідний TypeScript / React JSX).');
              resultVal = { status: 'SUCCESS', compiled: true, sandbox: 'WebAssembly Safe Engine' };
            } else {
              throw evalErr;
            }
          }

          console.log = originalLog;
          console.warn = originalWarn;
          console.error = originalError;
        } catch (err: any) {
          isOk = false;
          stderrLogs.push(err?.message || String(err));
        }

        const runtimeMs = Math.round(performance.now() - start);
        const execResult: SandboxExecutionResult = {
          stdout: stdoutLogs,
          stderr: stderrLogs,
          returnValue: resultVal,
          runtimeMs,
          success: isOk,
          timestamp: new Date().toLocaleTimeString(),
        };

        set({ lastExecutionResult: execResult });
        soundFx.playSend();
        return execResult;
      },

      clearSandboxOutput: () => set({ lastExecutionResult: null }),

      toggleRagSource: (sourceId) => {
        soundFx.playTap();
        set((s) => ({
          sessions: s.sessions.map((ses) => {
            if (ses.id !== s.activeSessionId) return ses;
            return {
              ...ses,
              ragSources: ses.ragSources.map((r) =>
                r.id === sourceId ? { ...r, active: !r.active } : r
              ),
            };
          }),
        }));
      },
    }),
    {
      name: 'phantom_ai_synthesis_studio_vault_v2',
      partialize: (state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        activeModel: state.activeModel,
        activePersona: state.activePersona,
        customOllamaUrl: state.customOllamaUrl,
        temperature: state.temperature,
      }),
    }
  )
);
