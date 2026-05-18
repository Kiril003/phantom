import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMissionStore } from '../stores/missionStore';
import { missionApi, type StartMissionResponse } from '../services/missionApi';
import type { AgentEvent } from '@shared/types';
import type { MissionSummary, MissionPhase } from '@shared/types/mission';

vi.mock('../services/missionApi', () => ({
  missionApi: {
    start: vi.fn(),
    list: vi.fn(),
    detail: vi.fn(),
    compose: vi.fn(),
    export: vi.fn(),
    assets: vi.fn(),
  },
}));

describe('missionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMissionStore.setState({
      missions: [],
      currentMission: null,
      currentReport: null,
      error: null,
      loading: {
        list: false,
        detail: false,
        report: false,
        export: false,
      },
    });
  });

  it('starts a mission and refreshes the list', async () => {
    const mockResp: StartMissionResponse = { mission_id: 'M1', task_id: 'T1', started: true };
    vi.mocked(missionApi.start).mockResolvedValue(mockResp);
    
    const mockSummary: MissionSummary = { 
      id: 'M1', 
      brief: 'Test', 
      status: 'planning', 
      phase_count: 5, 
      phases_done: 0, 
      created_at: new Date().toISOString(),
      finished_at: null,
      ledger_path: '/tmp/m1.ledger'
    };
    vi.mocked(missionApi.list).mockResolvedValue({ missions: [mockSummary] });

    const store = useMissionStore.getState();
    const res = await store.startMission({ brief: 'Test', unsafe_mode: false, budget_constraints: null });

    expect(res).toEqual(mockResp);
    expect(missionApi.start).toHaveBeenCalledWith({ brief: 'Test', unsafe_mode: false, budget_constraints: null });
    
    // Wait for the background loadMissions call
    await new Promise(r => setTimeout(r, 10));
    expect(useMissionStore.getState().missions.length).toBe(1);
  });

  it('handles mission.phase_started event', () => {
    const p1: MissionPhase = { 
      id: 'P1', 
      mission_id: 'M1',
      idx: 0, 
      description: 'P1', 
      rationale: 'R1',
      success_criteria: 'S1',
      expected_duration_h: 1,
      status: 'planning',
      artifacts_json: [],
      started_at: null,
      finished_at: null
    };
    const p2: MissionPhase = { 
      id: 'P2', 
      mission_id: 'M1',
      idx: 1, 
      description: 'P2', 
      rationale: 'R2',
      success_criteria: 'S2',
      expected_duration_h: 1,
      status: 'planning',
      artifacts_json: [],
      started_at: null,
      finished_at: null
    };

    useMissionStore.setState({
      currentMission: {
        id: 'M1',
        brief: 'Test',
        status: 'running',
        phase_count: 2,
        phases_done: 0,
        phases: [p1, p2],
        ledger_text: '',
        ledger_path: '',
        created_at: '',
        finished_at: null,
        quality_bar: null,
        deadline_at: null,
        budget_constraints_json: null,
        success_criteria: 'Global Success',
      },
    });

    const event: AgentEvent = {
      type: 'mission.phase_started',
      ts: Date.now(),
      payload: { mission_id: 'M1', phase_id: 'P1' },
    };

    useMissionStore.getState().handleEvent(event);

    const mission = useMissionStore.getState().currentMission;
    expect(mission?.phases[0].status).toBe('running');
    expect(mission?.phases[1].status).toBe('planning');
  });

  it('handles mission.phase_completed event and updates phases_done', () => {
    const p1: MissionPhase = { 
      id: 'P1', 
      mission_id: 'M1',
      idx: 0, 
      description: 'P1', 
      rationale: 'R1',
      success_criteria: 'S1',
      expected_duration_h: 1,
      status: 'running',
      artifacts_json: [],
      started_at: null,
      finished_at: null
    };
    const p2: MissionPhase = { 
      id: 'P2', 
      mission_id: 'M1',
      idx: 1, 
      description: 'P2', 
      rationale: 'R2',
      success_criteria: 'S2',
      expected_duration_h: 1,
      status: 'planning',
      artifacts_json: [],
      started_at: null,
      finished_at: null
    };

    useMissionStore.setState({
      currentMission: {
        id: 'M1',
        brief: 'Test',
        status: 'running',
        phase_count: 2,
        phases_done: 0,
        phases: [p1, p2],
        ledger_text: '',
        ledger_path: '',
        created_at: '',
        finished_at: null,
        quality_bar: null,
        deadline_at: null,
        budget_constraints_json: null,
        success_criteria: 'Global Success',
      },
    });

    const event: AgentEvent = {
      type: 'mission.phase_completed',
      ts: Date.now(),
      payload: { mission_id: 'M1', phase_id: 'P1', idx: 0 },
    };

    useMissionStore.getState().handleEvent(event);

    const mission = useMissionStore.getState().currentMission;
    expect(mission?.phases[0].status).toBe('done');
    expect(mission?.phases_done).toBe(1);
  });
});
