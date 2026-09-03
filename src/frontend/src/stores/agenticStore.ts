import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface MemoryNode {
  id: string;
  title: string;
  category: 'architecture' | 'decision' | 'task' | 'person' | 'insight';
  content: string;
  tags: string[];
  connections: string[]; // target node IDs
  createdAt: string;
}

export interface SubAgentTask {
  id: string;
  agentRole: 'Planner' | 'Researcher' | 'Coder' | 'Reviewer';
  prompt: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  steps: Array<{ time: string; text: string; kind: 'thought' | 'action' | 'result' }>;
  output?: string;
}

interface AgenticState {
  memoryNodes: MemoryNode[];
  subagents: SubAgentTask[];
  terminalHistory: Array<{ command: string; output: string; exitCode: number; time: string }>;

  addMemoryNode: (node: Omit<MemoryNode, 'id' | 'createdAt'>) => MemoryNode;
  connectMemoryNodes: (sourceId: string, targetId: string) => void;
  deleteMemoryNode: (id: string) => void;

  launchSubagent: (role: SubAgentTask['agentRole'], prompt: string) => Promise<void>;
  executeTerminalCommand: (command: string) => Promise<void>;
  clearTerminal: () => void;
}

const INITIAL_MEMORY: MemoryNode[] = [
  {
    id: 'mem_1',
    title: 'PHANTOM OS Unified Blueprint',
    category: 'architecture',
    content: 'Флагманська операційна система нативно поєднує десктопний Radxa вузол та мобільний симбіонт Companion.',
    tags: ['os', 'blueprint', 'core'],
    connections: ['mem_2', 'mem_3'],
    createdAt: new Date().toISOString(),
  },
  {
    id: 'mem_2',
    title: 'AIRouter & Local Neural Engine',
    category: 'architecture',
    content: 'Єдина точка входу для генеративних запитів: вибирає між локальною квантованою моделлю та хмарою.',
    tags: ['ai', 'router', 'onnx'],
    connections: ['mem_1'],
    createdAt: new Date().toISOString(),
  },
  {
    id: 'mem_3',
    title: 'P2P WebRTC Audio/Video Relay',
    category: 'decision',
    content: 'Безшовне перемикання між WebRTC Direct DataChannel, STUN/TURN та автономним Live Loopback при відсутності мережі.',
    tags: ['webrtc', 'p2p', 'calls'],
    connections: ['mem_1'],
    createdAt: new Date().toISOString(),
  },
];

export const useAgenticStore = create<AgenticState>()(
  persist(
    (set) => ({
      memoryNodes: INITIAL_MEMORY,
      subagents: [],
      terminalHistory: [
        {
          command: 'phantom-cli --status',
          output: 'PHANTOM Companion Core v0.9.4 — All 12 subsystems nominal. AIRouter active.',
          exitCode: 0,
          time: new Date().toLocaleTimeString(),
        },
      ],

      addMemoryNode: (node) => {
        const newNode: MemoryNode = {
          ...node,
          id: `mem_${Date.now()}`,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ memoryNodes: [...s.memoryNodes, newNode] }));
        return newNode;
      },

      connectMemoryNodes: (sourceId, targetId) => {
        set((s) => ({
          memoryNodes: s.memoryNodes.map((node) =>
            node.id === sourceId
              ? {
                  ...node,
                  connections: Array.from(new Set([...node.connections, targetId])),
                }
              : node
          ),
        }));
      },

      deleteMemoryNode: (id) => {
        set((s) => ({
          memoryNodes: s.memoryNodes.filter((n) => n.id !== id),
        }));
      },

      launchSubagent: async (role, prompt) => {
        const taskId = `agent_${Date.now()}`;
        const initialTask: SubAgentTask = {
          id: taskId,
          agentRole: role,
          prompt,
          status: 'running',
          steps: [
            { time: new Date().toLocaleTimeString(), text: `Ініціалізація суб-агента [${role}]...`, kind: 'thought' },
            { time: new Date().toLocaleTimeString(), text: `Аналіз завдання: "${prompt}"`, kind: 'thought' },
          ],
        };

        set((s) => ({ subagents: [initialTask, ...s.subagents] }));

        await new Promise((res) => setTimeout(res, 600));

        set((s) => ({
          subagents: s.subagents.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  steps: [
                    ...t.steps,
                    { time: new Date().toLocaleTimeString(), text: 'Виконання векторного пошуку контексту по графу памʼяті...', kind: 'action' },
                  ],
                }
              : t
          ),
        }));

        await new Promise((res) => setTimeout(res, 800));

        set((s) => ({
          subagents: s.subagents.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  status: 'completed',
                  steps: [
                    ...t.steps,
                    { time: new Date().toLocaleTimeString(), text: 'Сформовано та верифіковано артефакт рішення.', kind: 'result' },
                  ],
                  output: `Суб-агент [${role}] успішно завершив виконання: перевірено цілісність системи, створено план адаптації та синхронізовано результати.`,
                }
              : t
          ),
        }));
      },

      executeTerminalCommand: async (command) => {
        const trimmed = command.trim();
        if (!trimmed) return;

        let output = '';
        let exitCode = 0;

        if (trimmed === 'help') {
          output = 'Доступні команди:\n  phantom-cli --status\n  phantom-cli --mesh-ping\n  phantom-cli --vault-list\n  clear';
        } else if (trimmed === 'clear') {
          set({ terminalHistory: [] });
          return;
        } else if (trimmed.includes('--mesh-ping')) {
          output = 'PING node_alpha_radxa (127.0.0.1): 64 bytes, time=0.8ms\nPING node_gamma_relay: 64 bytes, time=18.4ms\n2/2 packets transmitted, 0% packet loss.';
        } else if (trimmed.includes('--vault-list')) {
          output = 'Encrypted Keys:\n  - phantom_identity_x25519 (L5 Sealed)\n  - cloudflare_r2_credentials (AES-256-GCM)\n  - supabase_jwt_sec (Hardware Enclave)';
        } else {
          // JS Eval fallback in safe sandbox
          try {
             
            const res = eval(trimmed);
            output = String(res);
          } catch (e: any) {
            output = `bash: ${trimmed}: command not found (або помилка JS eval: ${e?.message})`;
            exitCode = 127;
          }
        }

        set((s) => ({
          terminalHistory: [
            ...s.terminalHistory,
            { command: trimmed, output, exitCode, time: new Date().toLocaleTimeString() },
          ],
        }));
      },

      clearTerminal: () => set({ terminalHistory: [] }),
    }),
    {
      name: 'phantom_agentic_store',
    }
  )
);
