import { create } from 'zustand';
import type {
  AgentEvent,
  AgentObservation,
  AgentPlanStep,
  AgentReflectionResult,
  AgentSubGoal,
  AgentSubstate,
  AgentTaskDetail,
  AgentTaskStatus,
  AgentThoughtBudget,
} from '@shared/types';
import { agentApi } from '../services/agentApi';

const EVENT_CAP = 500;

export type ConnectionStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'resuming'
  | 'stopping';

interface RecentAction extends AgentPlanStep {
  result?: { ok: boolean; error?: string | null; elapsed_ms?: number };
  audit_entry_id?: number;
}

interface AgentState {
  currentTask: AgentTaskDetail | null;
  events: AgentEvent[];
  substate: AgentSubstate;
  status: AgentTaskStatus | 'idle';
  connectionStatus: ConnectionStatus;
  thoughtBudget: AgentThoughtBudget;
  reflections: AgentReflectionResult[];
  observations: AgentObservation[];
  recentActions: RecentAction[];
  subGoals: AgentSubGoal[];
  promptToUser: string | null;
  notification: { title: string; message: string; urgency: string } | null;
  wsConnected: boolean;
  // Phase 9.2.1 — per-task LLM call budget surfacing
  llmCallsUsed: number;
  llmCallsCap: number;

  // Setters
  setWSConnected: (connected: boolean) => void;
  setPromptToUser: (prompt: string | null) => void;

  // Async actions
  startTask: (goal: string) => Promise<void>;
  pauseTask: () => Promise<void>;
  resumeTask: () => Promise<void>;
  intervene: (instruction: string) => Promise<void>;
  cancelStep: () => Promise<void>;
  stopTask: () => Promise<void>;
  refreshTask: (taskId: string) => Promise<void>;
  submitFeedback: (
    auditId: number,
    rating: 'up' | 'down' | 'comment',
    comment?: string,
  ) => Promise<void>;

  // Event surface
  handleEvent: (e: AgentEvent) => void;
  reset: () => void;
}

const EMPTY_BUDGET: AgentThoughtBudget = {
  estimated_actions: 0,
  actions_used: 0,
  force_reflect_ratio: 2,
  reflections_done: 0,
};

export const useAgentStore = create<AgentState>((set, get) => ({
  currentTask: null,
  events: [],
  substate: 'idle',
  status: 'idle',
  connectionStatus: 'idle',
  thoughtBudget: EMPTY_BUDGET,
  reflections: [],
  observations: [],
  recentActions: [],
  subGoals: [],
  promptToUser: null,
  notification: null,
  wsConnected: false,
  llmCallsUsed: 0,
  llmCallsCap: 50,

  setWSConnected: (connected) => set({ wsConnected: connected }),
  setPromptToUser: (prompt) => set({ promptToUser: prompt }),

  startTask: async (goal) => {
    set({ connectionStatus: 'starting', promptToUser: null });
    try {
      const resp = await agentApi.startTask(goal);
      if (!resp.started) {
        // 409 — task already running, refresh state instead
        await get().refreshTask(resp.task_id);
      } else {
        set({ status: 'running', connectionStatus: 'running' });
      }
    } catch (err) {
      set({ connectionStatus: 'idle' });
      throw err;
    }
  },

  pauseTask: async () => {
    const taskId = get().currentTask?.task.id;
    if (!taskId) return;
    set({ connectionStatus: 'pausing' });
    await agentApi.pause(taskId);
  },

  resumeTask: async () => {
    const taskId = get().currentTask?.task.id;
    if (!taskId) return;
    set({ connectionStatus: 'resuming' });
    await agentApi.resume(taskId);
  },

  intervene: async (instruction) => {
    const taskId = get().currentTask?.task.id;
    if (!taskId) return;
    await agentApi.intervene(taskId, instruction);
  },

  cancelStep: async () => {
    const taskId = get().currentTask?.task.id;
    if (!taskId) return;
    await agentApi.cancelStep(taskId);
  },

  stopTask: async () => {
    const taskId = get().currentTask?.task.id;
    set({ connectionStatus: 'stopping' });
    await agentApi.stop(taskId);
  },

  refreshTask: async (taskId) => {
    try {
      const detail = await agentApi.getTask(taskId);
      set({
        currentTask: detail,
        subGoals: detail.sub_goals,
        observations: detail.observations,
        thoughtBudget: detail.thought_budget ?? EMPTY_BUDGET,
        status: detail.task.status,
        connectionStatus: detail.task.status === 'paused' ? 'paused' : 'running',
      });
    } catch (err) {
      console.warn('agent refreshTask failed', err);
    }
  },

  submitFeedback: async (auditId, rating, comment) => {
    await agentApi.feedback(auditId, rating, comment);
  },

  handleEvent: (e) => {
    const events = [...get().events, e];
    if (events.length > EVENT_CAP) events.splice(0, events.length - EVENT_CAP);

    const patch: Partial<AgentState> = { events };
    const taskId = (e.payload?.task_id as string | undefined) ?? get().currentTask?.task.id ?? '';

    switch (e.type) {
      case 'task.started': {
        const sm = e.payload.self_model as AgentTaskDetail['self_model'];
        patch.currentTask = {
          task: {
            id: taskId,
            goal: String(e.payload.goal ?? ''),
            status: 'running',
            track: 'foreground',
            paused_reason: null,
            error: null,
            created_at: new Date(e.ts).toISOString(),
            finished_at: null,
          },
          sub_goals: [],
          self_model: sm ?? null,
          observations: [],
          thought_budget: EMPTY_BUDGET,
          last_audit: [],
        };
        patch.subGoals = [];
        patch.observations = [];
        patch.recentActions = [];
        patch.reflections = [];
        patch.thoughtBudget = EMPTY_BUDGET;
        patch.llmCallsUsed = 0;
        patch.llmCallsCap = 50;
        patch.status = 'running';
        patch.connectionStatus = 'running';
        patch.promptToUser = null;
        break;
      }
      case 'strategic_plan.created': {
        const subGoals = (e.payload.sub_goals as AgentSubGoal[]) ?? [];
        patch.subGoals = subGoals;
        const total = Number(e.payload.estimated_total_actions ?? 0);
        patch.thoughtBudget = {
          estimated_actions: total,
          actions_used: get().thoughtBudget.actions_used,
          force_reflect_ratio: get().thoughtBudget.force_reflect_ratio,
          reflections_done: get().thoughtBudget.reflections_done,
        };
        break;
      }
      case 'sub_goal.started': {
        const id = String(e.payload.sub_goal_id ?? '');
        patch.subGoals = get().subGoals.map((sg) =>
          sg.id === id ? { ...sg, status: 'active' } : sg,
        );
        break;
      }
      case 'sub_goal.done': {
        const id = String(e.payload.sub_goal_id ?? '');
        patch.subGoals = get().subGoals.map((sg) =>
          sg.id === id ? { ...sg, status: 'done' } : sg,
        );
        break;
      }
      case 'plan.step_created': {
        const step = e.payload.step as AgentPlanStep;
        if (step) {
          const recent = [...get().recentActions, step].slice(-50);
          patch.recentActions = recent;
        }
        break;
      }
      case 'action.completed':
      case 'action.failed': {
        const stepIdx = Number(e.payload.step_idx ?? -1);
        const result = e.payload.result as RecentAction['result'];
        patch.recentActions = get().recentActions.map((a) =>
          a.step_idx === stepIdx ? { ...a, result } : a,
        );
        const used = get().thoughtBudget.actions_used + 1;
        patch.thoughtBudget = { ...get().thoughtBudget, actions_used: used };
        break;
      }
      case 'observation.added': {
        const obs = e.payload.observation as AgentObservation;
        if (obs) patch.observations = [...get().observations, obs].slice(-200);
        break;
      }
      case 'reflection.completed': {
        const ref: AgentReflectionResult = {
          verdict: (e.payload.verdict as AgentReflectionResult['verdict']) ?? 'continue',
          summary: String(e.payload.summary ?? ''),
          progress_assessment: '',
          recurring_errors: [],
          recommendations: '',
          new_confidence: Number(e.payload.new_confidence ?? 0.5),
        };
        patch.reflections = [...get().reflections, ref].slice(-20);
        patch.thoughtBudget = {
          ...get().thoughtBudget,
          reflections_done: get().thoughtBudget.reflections_done + 1,
        };
        break;
      }
      case 'substate.changed': {
        patch.substate = (e.payload.substate as AgentSubstate) ?? 'idle';
        break;
      }
      case 'task.paused': {
        patch.status = 'paused';
        patch.connectionStatus = 'paused';
        break;
      }
      case 'task.resumed': {
        patch.status = 'running';
        patch.connectionStatus = 'running';
        break;
      }
      case 'task.waiting_user': {
        patch.status = 'awaiting_user';
        patch.promptToUser = String(e.payload.prompt_to_user ?? '');
        break;
      }
      case 'task.intervention_received': {
        patch.promptToUser = null;
        break;
      }
      case 'task.completed': {
        patch.status = 'done';
        patch.substate = 'idle';
        patch.connectionStatus = 'idle';
        break;
      }
      case 'task.stopped': {
        patch.status = 'stopped';
        patch.substate = 'idle';
        patch.connectionStatus = 'idle';
        break;
      }
      case 'task.failed': {
        patch.status = 'failed';
        patch.substate = 'idle';
        patch.connectionStatus = 'idle';
        break;
      }
      case 'task.blocked_quota': {
        patch.status = 'blocked_quota';
        patch.promptToUser = String(
          e.payload.reason ??
            'AI provider quota exhausted — waiting for recovery probe.',
        );
        break;
      }
      case 'agent.budget.warning': {
        patch.llmCallsUsed = Number(e.payload.llm_calls_used ?? 0);
        patch.llmCallsCap = Number(e.payload.cap_at ?? 50);
        break;
      }
      case 'notification': {
        patch.notification = {
          title: String(e.payload.title ?? ''),
          message: String(e.payload.message ?? ''),
          urgency: String(e.payload.urgency ?? 'normal'),
        };
        break;
      }
      default:
        break;
    }

    set(patch as AgentState);
  },

  reset: () => set({
    currentTask: null,
    events: [],
    substate: 'idle',
    status: 'idle',
    connectionStatus: 'idle',
    thoughtBudget: EMPTY_BUDGET,
    llmCallsUsed: 0,
    llmCallsCap: 50,
    reflections: [],
    observations: [],
    recentActions: [],
    subGoals: [],
    promptToUser: null,
    notification: null,
  }),
}));
