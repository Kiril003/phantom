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

export interface DtnPacket {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  payload: any;
  ttlSeconds: number;
  hops: number;
  queuedAt: string;
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

export interface LoRaTelemetry {
  frequencyMhz: number;
  snrDb: number;
  rssiDbm: number;
  packetsSent: number;
  packetsReceived: number;
}

interface MeshState {
  nodes: MeshNodeInfo[];
  computeTasks: ComputeTask[];
  swarmFiles: SwarmFile[];
  dtnQueue: DtnPacket[];
  isLoRaBridgeActive: boolean;
  loraTelemetry: LoRaTelemetry;

  addComputeTask: (task: Omit<ComputeTask, 'id' | 'status' | 'createdAt'>) => ComputeTask;
  runComputeTask: (taskId: string) => Promise<void>;
  addSwarmFile: (file: Omit<SwarmFile, 'id'>) => SwarmFile;
  seedSwarmFile: (name: string, sizeBytes: number) => SwarmFile;
  toggleSeeding: (fileId: string) => void;
  enqueueDtnPacket: (packet: Omit<DtnPacket, 'id' | 'hops' | 'queuedAt'>) => void;
  flushDtnQueue: () => void;
  broadcastLoraPacket: (payload: string) => { id: string; timestamp: string };
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
        {
          id: 'task_c2',
          name: 'Neural Embeddings Quantization',
          type: 'nlp_embed',
          status: 'queued',
          assignedNodeId: 'node_alpha_radxa',
          createdAt: new Date().toISOString(),
        },
      ],

      swarmFiles: [
        {
          id: 'sw_1',
          name: 'phantom_os_radxa_rootfs_v2.img.xz',
          sizeBytes: 1024 * 1024 * 650,
          hashSha256: '4f8b9e1c2d3a4b5c6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d',
          seedersCount: 4,
          leechersCount: 1,
          chunksTotal: 100,
          chunksAvailable: 100,
          isSeeding: true,
        },
        {
          id: 'sw_2',
          name: 'style_tts2_ukrainian_voice_model.onnx',
          sizeBytes: 1024 * 1024 * 85,
          hashSha256: '7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d',
          seedersCount: 6,
          leechersCount: 0,
          chunksTotal: 85,
          chunksAvailable: 85,
          isSeeding: true,
        },
      ],

      dtnQueue: [
        {
          id: 'dtn_1',
          sourceNodeId: 'node_alpha_radxa',
          targetNodeId: 'node_beta_mobile',
          payload: { type: 'vault_sync', block: 1042 },
          ttlSeconds: 86400,
          hops: 1,
          queuedAt: new Date().toISOString(),
        },
      ],

      isLoRaBridgeActive: true,

      loraTelemetry: {
        frequencyMhz: 868.1,
        snrDb: 9.2,
        rssiDbm: -74,
        packetsSent: 38,
        packetsReceived: 142,
      },

      addComputeTask: (task) => {
        const newTask: ComputeTask = {
          id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          status: 'queued',
          createdAt: new Date().toISOString(),
          ...task,
        };
        set((state) => ({ computeTasks: [newTask, ...state.computeTasks] }));
        return newTask;
      },

      runComputeTask: async (taskId) => {
        set((state) => ({
          computeTasks: state.computeTasks.map((t) =>
            t.id === taskId ? { ...t, status: 'running' } : t
          ),
        }));

        const startTime = performance.now();

        // Run real in-browser math matrix workload
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            const size = 150;
            const a = new Float64Array(size * size);
            const b = new Float64Array(size * size);
            const c = new Float64Array(size * size);

            for (let i = 0; i < a.length; i++) {
              a[i] = Math.random();
              b[i] = Math.random();
            }

            for (let i = 0; i < size; i++) {
              for (let j = 0; j < size; j++) {
                let sum = 0;
                for (let k = 0; k < size; k++) {
                  sum += a[i * size + k] * b[k * size + j];
                }
                c[i * size + j] = sum;
              }
            }

            resolve();
          }, 300);
        });

        const durationMs = Math.round(performance.now() - startTime);

        set((state) => ({
          computeTasks: state.computeTasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  status: 'completed',
                  durationMs,
                  resultSummary: `150x150 Float64 Matrix Mult completed in ${durationMs}ms`,
                }
              : t
          ),
        }));
      },

      addSwarmFile: (file) => {
        const newFile: SwarmFile = {
          id: `swarm_${Date.now()}`,
          ...file,
        };
        set((state) => ({ swarmFiles: [newFile, ...state.swarmFiles] }));
        return newFile;
      },

      seedSwarmFile: (name, sizeBytes) => {
        const newFile: SwarmFile = {
          id: `swarm_${Date.now()}`,
          name,
          sizeBytes,
          hashSha256: Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
          seedersCount: 1,
          leechersCount: 0,
          chunksTotal: Math.ceil(sizeBytes / (1024 * 1024)),
          chunksAvailable: Math.ceil(sizeBytes / (1024 * 1024)),
          isSeeding: true,
        };
        set((state) => ({ swarmFiles: [newFile, ...state.swarmFiles] }));
        return newFile;
      },

      toggleSeeding: (fileId) => {
        set((state) => ({
          swarmFiles: state.swarmFiles.map((f) =>
            f.id === fileId ? { ...f, isSeeding: !f.isSeeding } : f
          ),
        }));
      },

      enqueueDtnPacket: (packet) => {
        const newPacket: DtnPacket = {
          id: `dtn_${Date.now()}`,
          hops: 0,
          queuedAt: new Date().toISOString(),
          ...packet,
        };
        set((state) => ({ dtnQueue: [newPacket, ...state.dtnQueue] }));
      },

      flushDtnQueue: () => {
        set({ dtnQueue: [] });
      },

      broadcastLoraPacket: (_payload) => {
        const id = `lora_pkt_${Date.now()}`;
        const timestamp = new Date().toISOString();
        set((state) => ({
          loraTelemetry: {
            ...state.loraTelemetry,
            packetsSent: state.loraTelemetry.packetsSent + 1,
          },
        }));
        return { id, timestamp };
      },

      toggleLoRaBridge: () => {
        set((state) => ({ isLoRaBridgeActive: !state.isLoRaBridgeActive }));
      },
    }),
    {
      name: 'phantom_mesh_store',
    }
  )
);
