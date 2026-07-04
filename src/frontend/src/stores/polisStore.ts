import { create } from 'zustand';
import type {
  PolisSnapshot,
  PolisMission,
  PolisNode,
  PolisGate,
  PolisCitizen,
  ManagedKeyPublic,
  PolisGovernorState,
  PolisChatMessage,
  PolisArtifactMeta,
} from '@shared/types';
import { polisApi } from '../services/polisApi';

export type PolisView = 'world' | 'staff' | 'focus';
export type RoomTab = 'talk' | 'docs' | 'graph' | 'plan' | 'world';

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

  /* mission room */
  selectedMissionId: string | null;
  roomTab: RoomTab;
  chats: Record<string, PolisChatMessage[]>;
  transcripts: Record<string, string>; // `${missionId}:${nodeId}`
  artifacts: Record<string, PolisArtifactMeta[]>;
  openDoc: { name: string; content: string } | null;
  inspectorNodeId: string | null;
  chatBusy: boolean;

  setView: (v: PolisView) => void;
  focusMission: (id: string | null) => void;
  hydrate: () => Promise<void>;
  applySnapshot: (s: PolisSnapshot) => void;
  applyNodeStatus: (missionId: string, node: PolisNode, progress: number) => void;
  applyMissionStatus: (mission: PolisMission) => void;
  gateOpened: (gate: PolisGate) => void;
  gateClosed: (gateId: string) => void;
  budgetAlert: (missionId: string, pressure: number) => void;

  selectMission: (id: string | null) => void;
  setRoomTab: (t: RoomTab) => void;
  appendChat: (missionId: string, msg: PolisChatMessage) => void;
  appendDelta: (missionId: string, nodeId: string, delta: string) => void;
  sendChat: (text: string) => Promise<void>;
  loadArtifacts: (missionId: string) => Promise<void>;
  openArtifact: (missionId: string, name: string) => Promise<void>;
  closeArtifact: () => void;
  openInspector: (nodeId: string | null) => void;

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

  selectedMissionId: null,
  roomTab: 'talk',
  chats: {},
  transcripts: {},
  artifacts: {},
  openDoc: null,
  inspectorNodeId: null,
  chatBusy: false,

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

  selectMission: (id) => {
    set({ selectedMissionId: id, openDoc: null, inspectorNodeId: null });
    if (!id) return;
    void polisApi
      .mission(id)
      .then(({ mission, chat }) => {
        get().applyMissionStatus(mission);
        set((st) => ({ chats: { ...st.chats, [id]: chat } }));
      })
      .catch(() => undefined);
    void get().loadArtifacts(id);
  },

  setRoomTab: (t) => set({ roomTab: t }),

  appendChat: (missionId, msg) =>
    set((st) => ({
      chats: {
        ...st.chats,
        [missionId]: [...(st.chats[missionId] ?? []), msg].slice(-200),
      },
    })),

  appendDelta: (missionId, nodeId, delta) =>
    set((st) => {
      const key = `${missionId}:${nodeId}`;
      const next = ((st.transcripts[key] ?? '') + delta).slice(-40_000);
      return { transcripts: { ...st.transcripts, [key]: next } };
    }),

  sendChat: async (text) => {
    const id = get().selectedMissionId;
    if (!id || !text.trim() || get().chatBusy) return;
    set({ chatBusy: true });
    get().appendChat(id, { role: 'operator', text });
    try {
      await polisApi.chat(id, text);
      // phantom reply arrives via WS chat_message; REST response is backup
    } catch {
      get().appendChat(id, {
        role: 'system',
        text: 'Не вдалося достукатись до міста — перевір бекенд.',
      });
    } finally {
      set({ chatBusy: false });
    }
  },

  loadArtifacts: async (missionId) => {
    try {
      const { artifacts } = await polisApi.artifacts(missionId);
      set((st) => ({ artifacts: { ...st.artifacts, [missionId]: artifacts } }));
    } catch {
      /* keep stale */
    }
  },

  openArtifact: async (missionId, name) => {
    try {
      const doc = await polisApi.artifact(missionId, name);
      set({ openDoc: doc, roomTab: 'docs' });
    } catch {
      /* ignore */
    }
  },

  closeArtifact: () => set({ openDoc: null }),

  openInspector: (nodeId) => {
    set({ inspectorNodeId: nodeId });
    const id = get().selectedMissionId;
    if (!id || !nodeId) return;
    void polisApi
      .workerTranscript(id, nodeId)
      .then(({ transcript }) =>
        set((st) => ({
          transcripts: { ...st.transcripts, [`${id}:${nodeId}`]: transcript },
        })),
      )
      .catch(() => undefined);
  },

  createMission: async (brief, pipeline) => {
    const { mission } = await polisApi.createMission(brief, pipeline);
    get().applyMissionStatus(mission);
    get().selectMission(mission.id);
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
      case 'node_status': {
        st.applyNodeStatus(
          msg.data.mission_id,
          msg.data.node as PolisNode,
          msg.data.progress ?? 0,
        );
        const node = msg.data.node as PolisNode;
        if (
          msg.data.mission_id === st.selectedMissionId &&
          (node.status === 'done' || node.status === 'failed')
        ) {
          void st.loadArtifacts(msg.data.mission_id);
        }
        break;
      }
      case 'worker_delta':
        st.appendDelta(msg.data.mission_id, msg.data.node_id, msg.data.delta ?? '');
        break;
      case 'chat_message': {
        const m = msg.data.message as PolisChatMessage;
        if (m.role !== 'operator') st.appendChat(msg.data.mission_id, m);
        break;
      }
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
