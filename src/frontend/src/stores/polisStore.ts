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

/** Розділи верхнього рівня. «Робота» — це вся місія одразу (наказ, хід, план);
 * решта не належить місії й тому винесена з її ряду. */
export type RoomTab = 'work' | 'citizens' | 'keys' | 'world';

/** Старі назви вкладок ще живуть у посиланнях і тестах — усі вони вели у
 * межах місії, тож ведуть у «роботу». */
const LEGACY_TAB: Record<string, RoomTab> = {
  talk: 'work', docs: 'work', graph: 'work', plan: 'work',
};

export const normalizeTab = (t: string): RoomTab =>
  (LEGACY_TAB[t] ?? (['work', 'citizens', 'keys', 'world'].includes(t) ? t : 'work')) as RoomTab;

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
  deleteMission: (id: string) => Promise<void>;
  removeMissionLocal: (id: string) => void;
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
  roomTab: 'work',
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

  setRoomTab: (t) => set({ roomTab: normalizeTab(t) }),

  appendChat: (missionId, msg) =>
    set((st) => {
      const prev = st.chats[missionId] ?? [];
      const last = prev[prev.length - 1];
      // dedupe: REST reply + WS echo of the same message must not double up
      if (last && last.role === msg.role && last.text === msg.text) return {};
      return {
        chats: { ...st.chats, [missionId]: [...prev, msg].slice(-200) },
      };
    }),

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
      // REST reply is authoritative; WS chat_message may also echo it (deduped)
      const { reply } = await polisApi.chat(id, text);
      if (reply && reply.text) get().appendChat(id, reply);
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
      // читалка — накладка над роботою; розділ від цього не міняється
      set({ openDoc: doc });
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

  removeMissionLocal: (id) =>
    set((st) => {
      const missions = st.missions.filter((m) => m.id !== id);
      const chats = { ...st.chats };
      delete chats[id];
      const artifacts = { ...st.artifacts };
      delete artifacts[id];
      return {
        missions,
        chats,
        artifacts,
        gates: st.gates.filter((g) => g.mission_id !== id),
        selectedMissionId:
          st.selectedMissionId === id
            ? (missions[0]?.id ?? null)
            : st.selectedMissionId,
      };
    }),

  deleteMission: async (id) => {
    get().removeMissionLocal(id);
    try {
      await polisApi.deleteMission(id);
    } catch {
      /* server already gone or unreachable — local removal stands */
    }
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

/** Everything the backend broadcasts on the "polis" WS channel. The
 * socket is an untyped boundary; this union is the single cast point. */
interface PolisWsData {
  snapshot: PolisSnapshot;
  node_status: { mission_id: string; node: PolisNode; progress?: number };
  worker_delta: {
    mission_id: string;
    node_id: string;
    delta?: string;
    total_chars?: number;
  };
  chat_message: { mission_id: string; message: PolisChatMessage };
  mission_status: { mission: PolisMission };
  mission_deleted: { mission_id: string };
  gate_opened: { gate: PolisGate };
  gate_closed: { gate_id: string; approved?: boolean };
  key_state: Record<string, unknown>;
  budget_alert: { mission_id: string; pressure: number };
  wave: { mission_id: string; size: number; queued: number };
}

export type PolisWsMessage = {
  [K in keyof PolisWsData]: { type: K; data: PolisWsData[K] };
}[keyof PolisWsData];

/** Wire the "polis" WS channel into the store. Returns unsubscribe. */
export function registerPolisWsHandler(
  on: (
    channel: string,
    cb: (msg: { type: string; data: unknown }) => void,
  ) => () => void,
): () => void {
  return on('polis', (raw) => {
    const msg = raw as PolisWsMessage;
    const st = usePolisStore.getState();
    switch (msg.type) {
      case 'snapshot':
        st.applySnapshot(msg.data);
        break;
      case 'node_status': {
        const { mission_id, node, progress } = msg.data;
        st.applyNodeStatus(mission_id, node, progress ?? 0);
        if (
          mission_id === st.selectedMissionId &&
          (node.status === 'done' || node.status === 'failed')
        ) {
          void st.loadArtifacts(mission_id);
        }
        break;
      }
      case 'worker_delta':
        st.appendDelta(msg.data.mission_id, msg.data.node_id, msg.data.delta ?? '');
        break;
      case 'chat_message':
        if (msg.data.message.role !== 'operator') {
          st.appendChat(msg.data.mission_id, msg.data.message);
        }
        break;
      case 'mission_status':
        st.applyMissionStatus(msg.data.mission);
        break;
      case 'mission_deleted':
        st.removeMissionLocal(msg.data.mission_id);
        break;
      case 'gate_opened':
        st.gateOpened(msg.data.gate);
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
