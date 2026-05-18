import { create } from 'zustand';
import type { AgentEvent } from '@shared/types';
import type {
  MissionBrief,
  MissionDetail,
  MissionReport,
  MissionSummary,
} from '@shared/types/mission';
import {
  missionApi,
  type ExportMissionRequest,
  type ExportMissionResponse,
  type MissionAssetView,
  type StartMissionResponse,
} from '../services/missionApi';

interface MissionLoading {
  list: boolean;
  detail: boolean;
  report: boolean;
  export: boolean;
}

interface MissionState {
  missions: MissionSummary[];
  currentMission: MissionDetail | null;
  currentReport: MissionReport | null;
  loading: MissionLoading;
  error: string | null;

  // Actions
  startMission: (brief: MissionBrief) => Promise<StartMissionResponse>;
  loadMissions: (status?: string) => Promise<void>;
  loadMission: (id: string) => Promise<MissionDetail>;
  composeReport: (id: string, preferLLM?: boolean) => Promise<MissionReport>;
  exportMission: (id: string, body: ExportMissionRequest) => Promise<ExportMissionResponse>;
  loadAssets: (id: string) => Promise<MissionAssetView[]>;
  handleEvent: (e: AgentEvent) => void;
  clearCurrent: () => void;
}

export const useMissionStore = create<MissionState>((set, get) => ({
  missions: [],
  currentMission: null,
  currentReport: null,
  loading: { list: false, detail: false, report: false, export: false },
  error: null,

  startMission: async (brief) => {
    set({ error: null });
    const resp = await missionApi.start(brief);
    // Refresh list in background so the roster shows the new entry
    get().loadMissions().catch(() => undefined);
    return resp;
  },

  loadMissions: async (status) => {
    set((s) => ({ loading: { ...s.loading, list: true }, error: null }));
    try {
      const resp = await missionApi.list(status);
      set((s) => ({
        missions: resp.missions,
        loading: { ...s.loading, list: false },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load missions';
      set((s) => ({ loading: { ...s.loading, list: false }, error: msg }));
    }
  },

  loadMission: async (id) => {
    set((s) => ({ loading: { ...s.loading, detail: true }, error: null }));
    try {
      const detail = await missionApi.detail(id);
      set((s) => ({
        currentMission: detail,
        loading: { ...s.loading, detail: false },
      }));
      return detail;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load mission';
      set((s) => ({ loading: { ...s.loading, detail: false }, error: msg }));
      throw err;
    }
  },

  composeReport: async (id, preferLLM = true) => {
    set((s) => ({ loading: { ...s.loading, report: true }, error: null }));
    try {
      const report = await missionApi.compose(id, preferLLM);
      set((s) => ({
        currentReport: report,
        loading: { ...s.loading, report: false },
      }));
      return report;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to compose report';
      set((s) => ({ loading: { ...s.loading, report: false }, error: msg }));
      throw err;
    }
  },

  exportMission: async (id, body) => {
    set((s) => ({ loading: { ...s.loading, export: true }, error: null }));
    try {
      const result = await missionApi.export(id, body);
      set((s) => ({ loading: { ...s.loading, export: false } }));
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to export mission';
      set((s) => ({ loading: { ...s.loading, export: false }, error: msg }));
      throw err;
    }
  },

  loadAssets: async (id) => {
    const resp = await missionApi.assets(id);
    return resp.assets;
  },

  handleEvent: (e) => {
    const { currentMission } = get();

    switch (e.type) {
      case 'mission.started': {
        const missionId = String(e.payload.mission_id ?? '');
        // Reload list so the new mission appears in the roster
        get().loadMissions().catch(() => undefined);
        // If we already have the detail for this mission, re-fetch it
        if (currentMission?.id === missionId) {
          get().loadMission(missionId).catch(() => undefined);
        }
        break;
      }

      case 'mission.phase_started': {
        const missionId = String(e.payload.mission_id ?? '');
        const phaseId = String(e.payload.phase_id ?? '');
        if (currentMission?.id === missionId) {
          set((s) => {
            if (!s.currentMission) return s;
            return {
              currentMission: {
                ...s.currentMission,
                phases: s.currentMission.phases.map((p) =>
                  p.id === phaseId ? { ...p, status: 'running' as const } : p,
                ),
              },
            };
          });
        }
        break;
      }

      case 'mission.phase_completed': {
        const missionId = String(e.payload.mission_id ?? '');
        const phaseId = String(e.payload.phase_id ?? '');
        if (currentMission?.id === missionId) {
          set((s) => {
            if (!s.currentMission) return s;
            return {
              currentMission: {
                ...s.currentMission,
                phases: s.currentMission.phases.map((p) =>
                  p.id === phaseId ? { ...p, status: 'done' as const } : p,
                ),
                phases_done: s.currentMission.phases.filter(
                  (p) => p.id === phaseId || p.status === 'done',
                ).length,
              },
            };
          });
        }
        // Also bump summary list entry
        const idx = String(e.payload.idx ?? '');
        set((s) => ({
          missions: s.missions.map((m) =>
            m.id === missionId
              ? { ...m, phases_done: Number(idx) + 1 }
              : m,
          ),
        }));
        break;
      }

      case 'mission.completed': {
        const missionId = String(e.payload.mission_id ?? '');
        // Re-fetch the authoritative detail from REST
        if (currentMission?.id === missionId) {
          get().loadMission(missionId).catch(() => undefined);
        }
        // Update summary list
        set((s) => ({
          missions: s.missions.map((m) =>
            m.id === missionId
              ? { ...m, status: 'done', finished_at: new Date().toISOString() }
              : m,
          ),
        }));
        break;
      }

      case 'mission.failed': {
        const missionId = String(e.payload.mission_id ?? '');
        if (currentMission?.id === missionId) {
          get().loadMission(missionId).catch(() => undefined);
        }
        set((s) => ({
          missions: s.missions.map((m) =>
            m.id === missionId
              ? { ...m, status: 'failed', finished_at: new Date().toISOString() }
              : m,
          ),
        }));
        break;
      }

      default:
        break;
    }
  },

  clearCurrent: () =>
    set({ currentMission: null, currentReport: null, error: null }),
}));
