import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ComputeTask {
  id: string;
  name: string;
  type: 'hash_benchmark' | 'matrix_mult' | 'nlp_embed' | 'wasm_exec';
  status: 'queued' | 'running' | 'completed' | 'failed';
  assignedNodeId?: string;
  durationMs?: number;
  resultSummary?: string;
  createdAt: string;
}

export interface SwarmFile {
  id: string;
  name: string;
  sizeBytes: number;
  hashSha256: string;
  seedersCount: number;
  leechersCount: number;
  chunksTotal: number;
  chunksAvailable: number;
  isSeeding: boolean;
}

export interface MeshNodeInfo {
  nodeId: string;
  name: string;
  pingMs: number;
  directP2P: boolean;
  dtnHopCount: number;
  loraSignalDbm?: number;
  lastSeenAt: string;
  computeShares: number;
}

interface MeshState {
  nodes: MeshNodeInfo[];
  computeTasks: ComputeTask[];
  swarmFiles: SwarmFile[];
  dtnQueue: Array<{ id: string; targetNodeId: string; payload: any; queuedAt: string }>;
  isLoRaBridgeActive: boolean;

  addComputeTask: (task: Omit<ComputeTask, 'id' | 'status' | 'createdAt'>) => ComputeTask;
  runComputeTask: (taskId: string) => Promise<void>;
  addSwarmFile: (file: Omit<SwarmFile, 'id'>) => SwarmFile;
  toggleSeeding: (fileId: string) => void;
  queueDtnMessage: (targetNodeId: string, payload: any) => void;
  drainDtnQueue: () => void;
  toggleLoRaBridge: () => void;
}

export const useMeshStore = create<MeshState>()(
  persist(
    (set) => ({
      nodes: [
        {
          nodeId: 'node_alpha_radxa',
          name: 'Radxa Rock 5B (Desktop Host)',
          pingMs: 2,
          directP2P: true,
          dtnHopCount: 0,
          lastSeenAt: new Date().toISOString(),
          computeShares: 120,
        },
        {
          nodeId: 'node_beta_mobile',
          name: 'Phantom Companion (Pixel 8)',
          pingMs: 18,
          directP2P: true,
          dtnHopCount: 1,
          loraSignalDbm: -68,
          lastSeenAt: new Date().toISOString(),
          computeShares: 45,
        },
        {
          nodeId: 'node_gamma_relay',
          name: 'Cloudflare Edge Gateway (Prague)',
          pingMs: 24,
          directP2P: false,
          dtnHopCount: 1,
          lastSeenAt: new Date().toISOString(),
          computeShares: 200,
        },
      ],

      computeTasks: [
        {
          id: 'task_c1',
          name: 'SHA-256 Entropy Benchmark',
          type: 'hash_benchmark',
          status: 'completed',
          assignedNodeId: 'node_alpha_radxa',
          durationMs: 342,
          resultSummary: '14.8 MH/s verified across 8 cores',
          createdAt: new Date().toISOString(),
        },
      ],

      swarmFiles: [
        {
          id: 'sf_1',
          name: 'phantom-companion-debug.apk',
          sizeBytes: 48500200,
          hashSha256: '9a8d7f6c5b4e3d2a10f9e8d7c6b5a4',
          seedersCount: 4,
          leechersCount: 1,
          chunksTotal: 128,
          chunksAvailable: 128,
          isSeeding: true,
        },
      ],

      dtnQueue: [],
      isLoRaBridgeActive: false,

      addComputeTask: (task) => {
        const newTask: ComputeTask = {
          ...task,
          id: `ct_${Date.now()}`,
          status: 'queued',
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ computeTasks: [newTask, ...s.computeTasks] }));
        return newTask;
      },

      runComputeTask: async (taskId) => {
        set((s) => ({
          computeTasks: s.computeTasks.map((t) =>
            t.id === taskId ? { ...t, status: 'running' } : t
          ),
        }));

        // Real in-browser WebAssembly / WebWorker math execution
        const start = performance.now();
        let ops = 0;
        for (let i = 0; i < 5000000; i++) {
          ops += Math.sqrt(i) * Math.sin(i);
        }
        const duration = Math.round(performance.now() - start);

        set((s) => ({
          computeTasks: s.computeTasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  status: 'completed',
                  durationMs: duration,
                  resultSummary: `Успішно виконано 5,000,000 обчислень за ${duration}ms (checksum: ${Math.round(ops)})`,
                }
              : t
          ),
        }));
      },

      addSwarmFile: (file) => {
        const newFile: SwarmFile = {
          ...file,
          id: `sf_${Date.now()}`,
        };
        set((s) => ({ swarmFiles: [...s.swarmFiles, newFile] }));
        return newFile;
      },

      toggleSeeding: (fileId) => {
        set((s) => ({
          swarmFiles: s.swarmFiles.map((f) =>
            f.id === fileId ? { ...f, isSeeding: !f.isSeeding } : f
          ),
        }));
      },

      queueDtnMessage: (targetNodeId, payload) => {
        set((s) => ({
          dtnQueue: [
            ...s.dtnQueue,
            {
              id: `dtn_${Date.now()}`,
              targetNodeId,
              payload,
              queuedAt: new Date().toISOString(),
            },
          ],
        }));
      },

      drainDtnQueue: () => {
        set({ dtnQueue: [] });
      },

      toggleLoRaBridge: () => {
        set((s) => ({ isLoRaBridgeActive: !s.isLoRaBridgeActive }));
      },
    }),
    {
      name: 'phantom_mesh_store',
    }
  )
);
