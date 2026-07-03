import { create } from 'zustand';
import type {
  PolisSnapshot,
  PolisMission,
  PolisNode,
  PolisGate,
  PolisCitizen,
  ManagedKeyPublic,
  PolisGovernorState,
} from '@shared/types';
import { polisApi } from '../services/polisApi';

export type PolisView = 'world' | 'staff' | 'focus';

interface PolisState {
  loaded: boolean;
  view: PolisView;
  focusMissionId: string | null;
  missions: PolisMission[];
  citizens: PolisCitizen[];
  keys: ManagedKeyPublic[];
  gates: PolisGate[];
  governor: PolisGovernorState;
  budgetAlerts: Record<string, number>;

  setView: (v: PolisView) => void;
  focusMission: (id: string | null) => void;
  hydrate: () => Promise<void>;
  applySnapshot: (s: PolisSnapshot) => void;
  applyNodeStatus: (missionId: string, node: PolisNode, progress: number) => void;
  applyMissionStatus: (mission: PolisMission) => void;
  gateOpened: (gate: PolisGate) => void;
  gateClosed: (gateId: string) => void;
  budgetAlert: (missionId: string, pressure: number) => void;

  createMission: (brief: string, pipeline: string) => Promise<void>;
  resolveGate: (gateId: string, approved: boolean) => Promise<void>;
  pauseMission: (id: string) => Promise<void>;
  resumeMission: (id: string) => Promise<void>;
  killMission: (id: string) => Promise<void>;
  refreshKeys: () => Promise<void>;
}

const EMPTY_GOVERNOR: PolisGovernorState = {
  wave_size: 0,
  max_wave: 4,
  running_nodes: 0,
  queued_nodes: 0,
  night_mode: false,
};

export const usePolisStore = create<PolisState>((set, get) => ({
  loaded: false,
  view: 'world',
  focusMissionId: null,
  missions: [],
  citizens: [],
  keys: [],
  gates: [],
  governor: EMPTY_GOVERNOR,
  budgetAlerts: {},

  setView: (v) => set({ view: v }),
  focusMission: (id) =>
    set({ focusMissionId: id, view: id ? 'focus' : get().view }),

  hydrate: async () => {
    try {
      const snap = await polisApi.state();
      get().applySnapshot(snap);
    } catch {
      set({ loaded: true });
    }
  },

  applySnapshot: (s) =>
    set({
      loaded: true,
      missions: s.missions,
      citizens: s.citizens,
      keys: s.keys,
      gates: s.gates,
      governor: s.governor,
    }),

  applyNodeStatus: (missionId, node, progress) =>
    set((st) => ({
      missions: st.missions.map((m) =>
        m.id !== missionId
          ? m
          : {
              ...m,
              progress,
              nodes: m.nodes.some((n) => n.id === node.id)
                ? m.nodes.map((n) => (n.id === node.id ? node : n))
                : [...m.nodes, node],
            },
      ),
    })),

  applyMissionStatus: (mission) =>
    set((st) => ({
      missions: st.missions.some((m) => m.id === mission.id)
        ? st.missions.map((m) => (m.id === mission.id ? mission : m))
        : [...st.missions, mission],
    })),

  gateOpened: (gate) =>
    set((st) => ({
      gates: st.gates.some((g) => g.id === gate.id)
        ? st.gates
        : [...st.gates, gate],
    })),

  gateClosed: (gateId) =>
    set((st) => ({ gates: st.gates.filter((g) => g.id !== gateId) })),

  budgetAlert: (missionId, pressure) =>
    set((st) => ({
      budgetAlerts: { ...st.budgetAlerts, [missionId]: pressure },
    })),

  createMission: async (brief, pipeline) => {
    const { mission } = await polisApi.createMission(brief, pipeline);
    get().applyMissionStatus(mission);
  },

  resolveGate: async (gateId, approved) => {
    await polisApi.resolveGate(gateId, approved);
    get().gateClosed(gateId);
  },

  pauseMission: async (id) => {
    await polisApi.pause(id);
    set((st) => ({
      missions: st.missions.map((m) =>
        m.id === id ? { ...m, status: 'paused' } : m,
      ),
    }));
  },

  resumeMission: async (id) => {
    await polisApi.resume(id);
    set((st) => ({
      missions: st.missions.map((m) =>
        m.id === id ? { ...m, status: 'running' } : m,
      ),
    }));
  },

  killMission: async (id) => {
    await polisApi.kill(id);
    set((st) => ({
      missions: st.missions.map((m) =>
        m.id === id ? { ...m, status: 'killed' } : m,
      ),
    }));
  },

  refreshKeys: async () => {
    try {
      const { keys } = await polisApi.keys();
      set({ keys });
    } catch {
      /* keep stale */
    }
  },
}));

/** Wire the "polis" WS channel into the store. Returns unsubscribe. */
export function registerPolisWsHandler(
  on: (channel: string, cb: (msg: { type: string; data: any }) => void) => () => void,
): () => void {
  return on('polis', (msg) => {
    const st = usePolisStore.getState();
    switch (msg.type) {
      case 'snapshot':
        st.applySnapshot(msg.data as PolisSnapshot);
        break;
      case 'node_status':
        st.applyNodeStatus(
          msg.data.mission_id,
          msg.data.node as PolisNode,
          msg.data.progress ?? 0,
        );
        break;
      case 'mission_status':
        st.applyMissionStatus(msg.data.mission as PolisMission);
        break;
      case 'gate_opened':
        st.gateOpened(msg.data.gate as PolisGate);
        break;
      case 'gate_closed':
        st.gateClosed(msg.data.gate_id);
        break;
      case 'key_state':
        void st.refreshKeys();
        break;
      case 'budget_alert':
        st.budgetAlert(msg.data.mission_id, msg.data.pressure);
        break;
      default:
        break;
    }
  });
}
