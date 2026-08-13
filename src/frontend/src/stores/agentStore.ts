import { create } from 'zustand';
import type {
  AgentCouncilDecision,
  AgentEmotionVector,
  AgentEvent,
  AgentInfoNeed,
  AgentObservation,
  AgentPlanStep,
  AgentProgressSnapshot,
  AgentProgressUpdate,
  AgentReflectionResult,
  AgentRoleStatement,
  AgentSubGoal,
  AgentSubstate,
  AgentTaskDetail,
  AgentTaskReport,
  AgentTaskStatus,
  AgentTaskSummary,
  AgentThoughtBudget,
  HorizonGoal,
} from '@shared/types';
import { agentApi, type AgentResumeAsConversationResponse } from '../services/agentApi';

export interface AgentChatMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: string | null;
}

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
  // Phase 9.2.2 (F-05) — resume-from-checkpoint caveats (browser session lost, etc.)
  resumeCaveat: { kind: string; lastKnownUrl?: string } | null;
  // Phase 9.3a — live emotion vector from the backend.
  emotion: AgentEmotionVector | null;
  // Phase 9.3b — proactive loop heartbeat (breathing indicator in StatusBar).
  proactive: {
    enabled: boolean;
    lastCycleAt: string | null;
    hasTriggers: boolean;
  };
  // Audit B-18 — surfaces backoff / pending-action / fired / checkpoint
  // events that the BE was emitting on agent.stream but had no FE
  // handler. Each has its own slot so a panel can render the most
  // recent value without having to scrape the events array.
  quotaBackoff: {
    consecutiveFailures: number;
    nextIntervalS: number;
    at: string;
  } | null;
  pendingProactiveAction: {
    actionGoal: string;
    reason: string;
    priority: number;
    expiresInS: number;
    at: string;
  } | null;
  lastCheckpoint: {
    taskId: string;
    checkpointId: string | number;
    reason: string;
    at: string;
  } | null;
  // Phase 16 — final report screen (deferred OPERATOR exit).
  reportPending: AgentTaskReport | null;
  reportLoading: boolean;
  reportError: string | null;
  // Phase 17a.5 — typed prompt awaiting an operator answer.
  currentInfoNeed: AgentInfoNeed | null;
  infoNeedBusy: boolean;
  infoNeedError: string | null;
  // Phase 17a — Council deliberation.
  councilActive: boolean;
  councilSituationKind: string | null;
  councilSituationSummary: string | null;
  councilStatements: AgentRoleStatement[];
  councilDecision: AgentCouncilDecision | null;
  // Phase 17a.6 — Quality Gate live state, so the operator can watch the
  // agent revising a draft instead of staring at a frozen "thinking…"
  // pill. Lifecycle:
  //   revision_started → revision_completed (× n) →
  //     either: regenerated (passed with rewrite) OR blocked (strike).
  // Cleared on the next task termination event.
  qualityGate: {
    active: boolean;
    round: number;
    maxRounds: number;
    blockers: string[];
    warningsCount: number;
    draftExcerpt: string | null;
    regenerated: boolean;
    strike: number;
    maxStrikes: number;
    artefactKind: string | null;
    intent: string | null;
    at: string;
  } | null;
  // Phase 16 — chat seed payload returned by /resume-as-conversation. Cleared
  // by the chat layer after consuming it (see chatStore.consumeAgentSeed).
  conversationSeed: AgentResumeAsConversationResponse | null;
  // Phase 16 — past-task index.
  historyTasks: AgentTaskSummary[];
  historyLoading: boolean;
  historyError: string | null;
  // Phase 18-COMPLETE — long-running task progress heartbeats.
  progressByTaskId: Record<string, AgentProgressUpdate[]>;
  progressEtaByTaskId: Record<string, number | null>;
  promotedToBackgroundAt: Record<string, number>;
  bgTaskGoals: Record<string, string>;
  progressLoading: Record<string, boolean>;

  // Phase 29 — 7-Horizon Planner
  horizons: HorizonGoal[];
  horizonsLoading: boolean;
  horizonsError: string | null;

  // Phase 30 — Org-Chart.
  orgChart: import('@shared/types').OrgChart | null;
  orgChartLoading: boolean;

  // V2 Agent Chat — persistent thread that survives drawer close/remount.
  agentChat: {
    threadId: string | null;
    messages: AgentChatMessage[];
    streaming: boolean;
  };

  // Day-NN "no-leash" — operator-controlled safety override.
  //   unsafeMode        — current state of the active task (synced via WS
  //                       `task.safety_changed`). False when no task active.
  //   unsafeModeIntent  — operator's chosen mode for the *next* task. Persists
  //                       through localStorage so a deliberate "off the leash"
  //                       choice survives reloads. Defaults false.
  unsafeMode: boolean;
  unsafeModeIntent: boolean;

  // Setters
  setWSConnected: (connected: boolean) => void;
  setPromptToUser: (prompt: string | null) => void;
  setConversationSeed: (seed: AgentResumeAsConversationResponse | null) => void;

  // Day-NN "no-leash" — flip the safety toggle. When a task is active,
  // pushes to backend (POST /agent/task/{id}/safety) so the running
  // task picks up the new mode at its next step; otherwise just stores
  // the operator's intent for the next startTask call.
  setUnsafeMode: (enabled: boolean) => Promise<void>;

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
  // Phase 16 — report lifecycle.
  fetchReport: (taskId: string, preferLLM?: boolean) => Promise<AgentTaskReport | null>;
  acknowledgeReport: () => Promise<void>;
  resumeAsConversation: () => Promise<AgentResumeAsConversationResponse | null>;
  // Phase 17a.5 — InfoNeed lifecycle.
  respondToInfoNeed: (answer: unknown) => Promise<void>;
  dismissInfoNeed: () => void;
  // Phase 17a — Council manual trigger.
  runCouncilRound: (
    summary: string,
    options?: {
      kind?:
        | 'strategic_revise'
        | 'before_destructive'
        | 'low_confidence'
        | 'info_need'
        | 'quality_gate'
        | 'user_invoked';
      proposed_action?: Record<string, unknown>;
      monologue_confidence?: number;
      include_aesthete?: boolean;
    },
  ) => Promise<AgentCouncilDecision | null>;
  dismissCouncil: () => void;

  // Phase 30 — Org-Chart
  loadOrgChart: () => Promise<void>;
  updateRoleOrders: (roleId: string, orders: string) => Promise<void>;
  // Phase 16 — past-run browsing.
  loadHistory: (status?: string, limit?: number) => Promise<void>;
  clearHistory: () => void;
  // Phase 18-COMPLETE — progress hydration (REST replay after WS reconnect).
  loadProgress: (taskId: string) => Promise<AgentProgressSnapshot | null>;
  clearProgress: (taskId: string) => void;

  // Phase 29 — 7-Horizon Planner actions
  loadHorizons: () => Promise<void>;
  createHorizonGoal: (description: string, level: number, parentId?: string) => Promise<void>;

  // V2 Agent Chat actions.
  sendAgentMessage: (message: string) => Promise<void>;
  loadAgentThread: (taskId?: string) => Promise<void>;
  clearAgentChat: () => void;

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
  resumeCaveat: null,
  emotion: null,
  proactive: { enabled: false, lastCycleAt: null, hasTriggers: false },
  quotaBackoff: null,
  pendingProactiveAction: null,
  lastCheckpoint: null,
  reportPending: null,
  reportLoading: false,
  reportError: null,
  currentInfoNeed: null,
  infoNeedBusy: false,
  infoNeedError: null,
  councilActive: false,
  councilSituationKind: null,
  councilSituationSummary: null,
  councilStatements: [],
  councilDecision: null,
  qualityGate: null,
  conversationSeed: null,
  historyTasks: [],
  historyLoading: false,
  historyError: null,
  progressByTaskId: {},
  progressEtaByTaskId: {},
  promotedToBackgroundAt: {},
  bgTaskGoals: {},
  progressLoading: {},

  // Phase 29
  horizons: [],
  horizonsLoading: false,
  horizonsError: null,

  // Phase 30 — Org-Chart
  orgChart: null,
  orgChartLoading: false,

  agentChat: { threadId: null, messages: [], streaming: false },

  // Day-NN "no-leash" — restore persisted operator intent (boolean
  // stored under "phantom_unsafe_mode_intent"). Defaults false so the
  // safe-by-default contract holds for first-run + cleared state.
  unsafeMode: false,
  unsafeModeIntent:
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('phantom_unsafe_mode_intent') === '1',

  setWSConnected: (connected) => set({ wsConnected: connected }),
  setPromptToUser: (prompt) => set({ promptToUser: prompt }),
  setConversationSeed: (seed) => set({ conversationSeed: seed }),

  setUnsafeMode: async (enabled) => {
    // Persist intent — survives reloads, applies to the next task.
    try {
      if (enabled) localStorage.setItem('phantom_unsafe_mode_intent', '1');
      else localStorage.removeItem('phantom_unsafe_mode_intent');
    } catch {
      /* SSR / restricted storage: ignore */
    }
    // Optimistic local flip so the UI reacts instantly.
    set({ unsafeModeIntent: enabled, unsafeMode: enabled });
    // If a task is currently running, push the toggle so the runtime
    // bypasses (or re-engages) guards on the next step. We *do not*
    // throw on 404 — the task may have just finished, and the intent
    // is still preserved for the next startTask.
    const taskId = get().currentTask?.task.id;
    if (taskId) {
      try {
        await agentApi.setSafety(taskId, enabled);
      } catch (err) {
        // Roll back the live flag (intent stays) so the UI reflects
        // backend reality. The toggle widget surfaces the error.
        set({ unsafeMode: !enabled });
        throw err;
      }
    }
  },

  startTask: async (goal) => {
    set({ connectionStatus: 'starting', promptToUser: null });
    try {
      const intent = get().unsafeModeIntent;
      const resp = await agentApi.startTask(goal, { unsafe_mode: intent });
      if (!resp.started) {
        // 409 — task already running, refresh state instead
        await get().refreshTask(resp.task_id);
      } else {
        set({
          status: 'running',
          connectionStatus: 'running',
          // Seed live state from the intent — backend echoes it back
          // on the start response so we don't have to wait for WS.
          unsafeMode: !!resp.unsafe_mode || intent,
        });
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

  // ── Phase 16 — report + history ──────────────────────────────────────────

  fetchReport: async (taskId, preferLLM = true) => {
    set({ reportLoading: true, reportError: null });
    try {
      const resp = await agentApi.getReport(taskId, preferLLM);
      set({ reportPending: resp.report, reportLoading: false });
      return resp.report;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed to fetch report';
      set({ reportLoading: false, reportError: msg });
      return null;
    }
  },

  acknowledgeReport: async () => {
    const pending = get().reportPending;
    const taskId = pending?.task_id ?? get().currentTask?.task.id;
    if (!taskId) {
      set({ reportPending: null });
      return;
    }
    try {
      await agentApi.dismissReport(taskId);
    } catch (err) {
      // Best-effort — clear locally even if the BE call failed (the slot is
      // already free, the worst case is the server-side state machine
      // auto-times-out the OPERATOR transition).
      console.warn('agent acknowledgeReport network failed', err);
    }
    set({ reportPending: null });
  },

  resumeAsConversation: async () => {
    const pending = get().reportPending;
    const taskId = pending?.task_id ?? get().currentTask?.task.id;
    if (!taskId) return null;
    try {
      const seed = await agentApi.resumeAsConversation(taskId);
      // Server already acknowledged; clear local mirror so OperatorLayout
      // can swap to DialogueLayout without prompting again.
      set({ reportPending: null, conversationSeed: seed });
      return seed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed to resume as conversation';
      set({ reportError: msg });
      return null;
    }
  },

  loadHistory: async (status, limit = 50) => {
    set({ historyLoading: true, historyError: null });
    try {
      const resp = await agentApi.listTasks(status, limit);
      set({ historyTasks: resp.tasks, historyLoading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed to load history';
      set({ historyLoading: false, historyError: msg });
    }
  },

  clearHistory: () => set({ historyTasks: [], historyError: null }),

  // Phase 18-COMPLETE — pull the in-memory progress snapshot for a long-
  // running task, to hydrate after WS reconnect.
  loadProgress: async (taskId) => {
    set({
      progressLoading: { ...get().progressLoading, [taskId]: true },
    });
    try {
      const snap = await agentApi.getProgress(taskId);
      const baseUpdates: AgentProgressUpdate[] = (snap.checkpoints || []).map(
        (c) => ({
          task_id: snap.task_id,
          kind: 'checkpoint',
          label: c.label,
          percent: c.percent ?? null,
          at: c.at,
          extra: (c.extra as AgentProgressUpdate['extra']) ?? {},
        }),
      );
      set({
        progressByTaskId: {
          ...get().progressByTaskId,
          [taskId]: baseUpdates,
        },
        progressEtaByTaskId: {
          ...get().progressEtaByTaskId,
          [taskId]: snap.eta_remaining_s ?? null,
        },
        promotedToBackgroundAt: snap.promoted_to_background_at
          ? {
              ...get().promotedToBackgroundAt,
              [taskId]: snap.promoted_to_background_at,
            }
          : get().promotedToBackgroundAt,
        progressLoading: { ...get().progressLoading, [taskId]: false },
      });
      return snap;
    } catch (err) {
      console.warn('agent loadProgress failed', err);
      set({
        progressLoading: { ...get().progressLoading, [taskId]: false },
      });
      return null;
    }
  },
  clearProgress: (taskId) => {
    const {
      progressByTaskId,
      progressEtaByTaskId,
      promotedToBackgroundAt,
      bgTaskGoals,
      progressLoading,
    } = get();
    const drop = <T extends Record<string, unknown>>(o: T): T => {
      if (!(taskId in o)) return o;
      const { [taskId]: _omit, ...rest } = o;
      return rest as T;
    };
    set({
      progressByTaskId: drop(progressByTaskId),
      progressEtaByTaskId: drop(progressEtaByTaskId),
      promotedToBackgroundAt: drop(promotedToBackgroundAt),
      bgTaskGoals: drop(bgTaskGoals),
      progressLoading: drop(progressLoading),
    });
  },

  loadHorizons: async () => {
    set({ horizonsLoading: true, horizonsError: null });
    try {
      const resp = await agentApi.getHorizons();
      set({ horizons: resp.tree, horizonsLoading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed to load horizons';
      set({ horizonsLoading: false, horizonsError: msg });
    }
  },

  createHorizonGoal: async (description, level, parentId) => {
    try {
      await agentApi.createHorizonGoal({ description, horizon_level: level, parent_id: parentId });
      await get().loadHorizons();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed to create horizon goal';
      set({ horizonsError: msg });
      throw err;
    }
  },

  // ── V2 Agent Chat ────────────────────────────────────────────────────────

  sendAgentMessage: async (message) => {
    const { agentChat, currentTask } = get();
    const threadId = agentChat.threadId ?? currentTask?.task.id ?? null;
    const userMsg: AgentChatMessage = { role: 'user', content: message, created_at: new Date().toISOString() };
    set({
      agentChat: {
        threadId,
        messages: [...agentChat.messages, userMsg],
        streaming: true,
      },
    });
    try {
      const resp = await agentApi.parallelChat(message, threadId ?? undefined);
      const assistantMsg: AgentChatMessage = {
        role: 'assistant',
        content: resp.reply,
        created_at: new Date().toISOString(),
      };
      set((s) => ({
        agentChat: {
          threadId: resp.task_id,
          messages: [...s.agentChat.messages, assistantMsg],
          streaming: false,
        },
      }));
    } catch (err) {
      set((s) => ({ agentChat: { ...s.agentChat, streaming: false } }));
      throw err;
    }
  },

  loadAgentThread: async (taskId) => {
    try {
      const resp = await agentApi.getChatThread(taskId);
      const messages: AgentChatMessage[] = resp.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        created_at: m.created_at,
      }));
      set({ agentChat: { threadId: resp.task_id, messages, streaming: false } });
    } catch (err) {
      console.warn('loadAgentThread failed', err);
    }
  },

  clearAgentChat: () =>
    set({ agentChat: { threadId: null, messages: [], streaming: false } }),

  // ── Phase 17a.5 — InfoNeed ───────────────────────────────────────────────

  respondToInfoNeed: async (answer) => {
    const need = get().currentInfoNeed;
    if (!need) return;
    set({ infoNeedBusy: true, infoNeedError: null });
    try {
      await agentApi.submitInfoResponse(need.task_id, need.id, answer);
      set({ currentInfoNeed: null, infoNeedBusy: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed to submit info response';
      set({ infoNeedBusy: false, infoNeedError: msg });
    }
  },

  dismissInfoNeed: () => set({ currentInfoNeed: null, infoNeedError: null }),

  // ── Phase 17a — Council ─────────────────────────────────────────────────

  runCouncilRound: async (summary, options) => {
    const taskId = get().currentTask?.task.id;
    if (!taskId) return null;
    set({
      councilActive: true,
      councilSituationKind: options?.kind ?? 'user_invoked',
      councilSituationSummary: summary,
      councilStatements: [],
      councilDecision: null,
    });
    try {
      const resp = await agentApi.runCouncilRound(taskId, {
        summary,
        kind: options?.kind ?? 'user_invoked',
        proposed_action: options?.proposed_action,
        monologue_confidence: options?.monologue_confidence,
        include_aesthete: options?.include_aesthete,
      });
      set({ councilDecision: resp.decision });
      return resp.decision;
    } catch (err) {
      console.warn('council round failed', err);
      set({ councilActive: false });
      return null;
    }
  },

  dismissCouncil: () =>
    set({
      councilActive: false,
      councilSituationKind: null,
      councilSituationSummary: null,
      councilStatements: [],
      councilDecision: null,
    }),

  handleEvent: (e) => {
    const events = [...get().events, e];
    if (events.length > EVENT_CAP) events.splice(0, events.length - EVENT_CAP);

    const patch: Partial<AgentState> = { events };
    const taskId = (e.payload?.task_id as string | undefined) ?? get().currentTask?.task.id ?? '';

    switch (e.type) {
      case 'task.started': {
        // Phase 16 — operator started a new task; any prior pending report
        // is implicitly dismissed (the new run "owns" the OPERATOR layout
        // now). Conversation seed is also cleared so it doesn't bleed into
        // the new run's narrative.
        patch.reportPending = null;
        patch.conversationSeed = null;
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
        // Phase 32-TERMINAL — preserve history for the terminal-style activity stream.
        // We only clear the sub-goals since they are task-specific and rendered in a separate panel.
        // observations, recentActions, and reflections are cumulative.
        patch.thoughtBudget = EMPTY_BUDGET;
        patch.llmCallsUsed = 0;
        patch.llmCallsCap = 50;
        patch.emotion = sm?.emotion ?? null;
        patch.status = 'running';
        patch.connectionStatus = 'running';
        patch.promptToUser = null;
        // Phase 17a.6 — fresh task → wipe quality gate state from any
        // previous run so the pulse-lane doesn't show stale "polishing"
        // chips on the new task's hero.
        patch.qualityGate = null;
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
        // Phase 18-COMPLETE — drop the long-running mirror for this task.
        const tid = String(e.payload.task_id ?? '');
        if (tid) setTimeout(() => get().clearProgress(tid), 0);
        break;
      }
      case 'task.stopped': {
        patch.status = 'stopped';
        patch.substate = 'idle';
        patch.connectionStatus = 'idle';
        const tid = String(e.payload.task_id ?? '');
        if (tid) setTimeout(() => get().clearProgress(tid), 0);
        break;
      }
      case 'task.failed': {
        patch.status = 'failed';
        patch.substate = 'idle';
        patch.connectionStatus = 'idle';
        const tid = String(e.payload.task_id ?? '');
        if (tid) setTimeout(() => get().clearProgress(tid), 0);
        break;
      }
      case 'task.progress': {
        // Phase 18-COMPLETE — heartbeat from a long-running action's
        // ProgressTracker. Append to the per-task ring (cap 240 to match
        // backend) and refresh the ETA mirror.
        const taskId = String(e.payload.task_id ?? '');
        if (!taskId) break;
        const update: AgentProgressUpdate = {
          task_id: taskId,
          kind: (e.payload.kind as 'checkpoint' | 'eta_update') ?? 'checkpoint',
          label: String(e.payload.label ?? ''),
          percent: (e.payload.percent as number | null | undefined) ?? null,
          at: Number(e.payload.at ?? Date.now() / 1000),
          extra: (e.payload.extra as AgentProgressUpdate['extra']) ?? {},
        };
        const existing = get().progressByTaskId[taskId] ?? [];
        const next = [...existing, update].slice(-240);
        const eta = update.extra?.eta_remaining_s;
        patch.progressByTaskId = {
          ...get().progressByTaskId,
          [taskId]: next,
        };
        patch.progressEtaByTaskId = {
          ...get().progressEtaByTaskId,
          [taskId]: typeof eta === 'number' ? eta : (get().progressEtaByTaskId[taskId] ?? null),
        };
        break;
      }
      case 'task.promoted_to_background': {
        // Phase 18-COMPLETE — runtime flipped this task fg→bg because its
        // current action declared a long_running_spec. Mirror the timestamp
        // so the UI can show "moved at HH:MM, freed foreground" without
        // polling /status.
        const taskId = String(e.payload.task_id ?? '');
        const at = Number(e.payload.promoted_at ?? Date.now() / 1000);
        if (taskId) {
          patch.promotedToBackgroundAt = {
            ...get().promotedToBackgroundAt,
            [taskId]: at,
          };
          // Goal preferentially comes from the BE event payload; fall back
          // to the in-memory currentTask if the FE was already tracking
          // this id as foreground.
          const goalFromEvent = e.payload.goal ? String(e.payload.goal) : '';
          const goalFromState = get().currentTask?.task?.id === taskId
            ? get().currentTask?.task?.goal ?? ''
            : '';
          patch.bgTaskGoals = {
            ...get().bgTaskGoals,
            [taskId]: goalFromEvent || goalFromState || taskId,
          };
        }
        break;
      }
      case 'task.report_ready': {
        // Phase 16 — backend just composed a TaskReport for the finished
        // task. Surface it through reportPending; do NOT exit OPERATOR —
        // that waits for the operator's explicit acknowledge /
        // continue-as-conversation.
        const report = e.payload.report as AgentTaskReport | undefined;
        if (report) patch.reportPending = report;
        break;
      }
      case 'agent.info_need': {
        // Phase 17a.5 — agent typed-prompt; show InfoNeedDialog.
        const need = e.payload.info_need as AgentInfoNeed | undefined;
        if (need) {
          patch.currentInfoNeed = need;
          patch.infoNeedError = null;
        }
        break;
      }
      case 'agent.info_need_resolved': {
        // BE confirms a matching info_need was answered (locally or via
        // mobile companion etc.). Clear local mirror if the IDs match.
        const id = String(e.payload.info_need_id ?? '');
        if (id && get().currentInfoNeed?.id === id) {
          patch.currentInfoNeed = null;
        }
        break;
      }
      case 'council.round_started': {
        patch.councilActive = true;
        patch.councilSituationKind = String(e.payload.kind ?? 'user_invoked');
        patch.councilSituationSummary = String(e.payload.summary ?? '');
        patch.councilStatements = [];
        patch.councilDecision = null;
        break;
      }
      case 'council.role_spoke': {
        const stmt = e.payload.statement as AgentRoleStatement | undefined;
        if (stmt) {
          patch.councilStatements = [...get().councilStatements, stmt].slice(-30);
        }
        break;
      }
      case 'council.consensus_reached': {
        const decision = e.payload.decision as AgentCouncilDecision | undefined;
        if (decision) {
          patch.councilDecision = decision;
          patch.councilStatements = decision.statements;
        }
        // Stays "active" until explicit dismissCouncil so the UI can show
        // the verdict + statements; user closes it when ready.
        break;
      }
      // ── Phase 17a.6 — Quality Gate revision lifecycle ──────────────────
      case 'quality_gate.revision_started': {
        patch.qualityGate = {
          active: true,
          round: 0,
          maxRounds: 3,
          blockers: [],
          warningsCount: 0,
          draftExcerpt: null,
          regenerated: false,
          strike: get().qualityGate?.strike ?? 0,
          maxStrikes: get().qualityGate?.maxStrikes ?? 2,
          artefactKind: get().qualityGate?.artefactKind ?? null,
          intent: String(e.payload.intent ?? '') || null,
          at: new Date(e.ts).toISOString(),
        };
        break;
      }
      case 'quality_gate.revision_completed': {
        const round = Number(e.payload.round ?? 0);
        const blockers = (e.payload.blockers as string[] | undefined) ?? [];
        const warningsCount = Number(e.payload.warnings_count ?? 0);
        const excerpt = String(e.payload.draft_excerpt ?? '') || null;
        const prev = get().qualityGate;
        patch.qualityGate = {
          active: true,
          round,
          maxRounds: prev?.maxRounds ?? 3,
          blockers,
          warningsCount,
          draftExcerpt: excerpt,
          regenerated: prev?.regenerated ?? false,
          strike: prev?.strike ?? 0,
          maxStrikes: prev?.maxStrikes ?? 2,
          artefactKind: prev?.artefactKind ?? null,
          intent: prev?.intent ?? null,
          at: new Date(e.ts).toISOString(),
        };
        break;
      }
      case 'quality_gate.blocked': {
        const blockers = (e.payload.blockers as string[] | undefined) ?? [];
        const strike = Number(e.payload.strike ?? 1);
        const maxStrikes = Number(e.payload.max_strikes ?? 2);
        const prev = get().qualityGate;
        patch.qualityGate = {
          active: true,
          round: prev?.round ?? 0,
          maxRounds: prev?.maxRounds ?? 3,
          blockers,
          warningsCount: prev?.warningsCount ?? 0,
          draftExcerpt: prev?.draftExcerpt ?? null,
          regenerated: false,
          strike,
          maxStrikes,
          artefactKind: prev?.artefactKind ?? null,
          intent: prev?.intent ?? null,
          at: new Date(e.ts).toISOString(),
        };
        break;
      }
      case 'quality_gate.regenerated': {
        const rounds = Number(e.payload.rounds ?? 0);
        const excerpt = String(e.payload.excerpt ?? '') || null;
        const artefactKind = String(e.payload.artefact_kind ?? '') || null;
        const prev = get().qualityGate;
        patch.qualityGate = {
          active: true,
          round: rounds,
          maxRounds: prev?.maxRounds ?? 3,
          blockers: [],
          warningsCount: prev?.warningsCount ?? 0,
          draftExcerpt: excerpt,
          regenerated: true,
          strike: prev?.strike ?? 0,
          maxStrikes: prev?.maxStrikes ?? 2,
          artefactKind,
          intent: prev?.intent ?? null,
          at: new Date(e.ts).toISOString(),
        };
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
      // Audit B-18 — runtime.py:584 fires this once the recovery probe
      // has back-to-back failed N times. Surface the next retry window
      // so the UI can render a "next attempt in Xs" countdown.
      case 'task.blocked_quota_backoff': {
        patch.quotaBackoff = {
          consecutiveFailures: Number(e.payload.consecutive_failures ?? 0),
          nextIntervalS: Number(e.payload.next_interval_s ?? 60),
          at: new Date(e.ts).toISOString(),
        };
        break;
      }
      // Audit B-18 — proactive.py:372 emits when the cycle wants the
      // operator to confirm an action before it fires (priority gates).
      case 'proactive.pending_action': {
        patch.pendingProactiveAction = {
          actionGoal: String(e.payload.action_goal ?? ''),
          reason: String(e.payload.reason ?? ''),
          priority: Number(e.payload.priority ?? 0),
          expiresInS: Number(e.payload.expires_in_s ?? 0),
          at: new Date(e.ts).toISOString(),
        };
        break;
      }
      // Audit B-18 — proactive.py:407 emits after a confirmed/auto
      // action has been spawned on the background track. Clear the
      // pending slot and surface a toast-friendly notification.
      case 'proactive.action_fired': {
        patch.pendingProactiveAction = null;
        patch.notification = {
          title: 'Proactive action fired',
          message: String(e.payload.action_goal ?? ''),
          urgency: 'normal',
        };
        break;
      }
      // Audit B-18 — runtime.py:666 + loop.py:125 broadcast each time a
      // checkpoint is written. Used by ResumeFromCheckpoint UX (B-9).
      case 'checkpoint.created': {
        patch.lastCheckpoint = {
          taskId: String(e.payload.task_id ?? ''),
          checkpointId: (e.payload.checkpoint_id as string | number) ?? '',
          reason: String(e.payload.reason ?? 'manual'),
          at: new Date(e.ts).toISOString(),
        };
        break;
      }
      case 'agent.budget.warning': {
        patch.llmCallsUsed = Number(e.payload.llm_calls_used ?? 0);
        patch.llmCallsCap = Number(e.payload.cap_at ?? 50);
        break;
      }
      case 'agent.resumed_with_caveat': {
        // Phase 9.2.2 (F-05) — resume restored task state but warned that
        // some external resource (browser, etc.) was not preserved.
        patch.resumeCaveat = {
          kind: String(e.payload.caveat ?? 'unknown'),
          lastKnownUrl: e.payload.last_known_url
            ? String(e.payload.last_known_url)
            : undefined,
        };
        break;
      }
      case 'emotion.updated': {
        const emo = e.payload.emotion as AgentEmotionVector | undefined;
        if (emo) patch.emotion = emo;
        break;
      }
      case 'proactive.cycle': {
        patch.proactive = {
          enabled: Boolean(e.payload.enabled ?? true),
          lastCycleAt: String(e.payload.at ?? new Date(e.ts).toISOString()),
          hasTriggers: Boolean(e.payload.has_triggers ?? false),
        };
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
      case 'task.safety_changed': {
        // Day-NN "no-leash" — backend echoed a per-task safety flip.
        // Mirror it so the shield widget shows the authoritative state,
        // even if the operator never touched the local toggle (e.g.
        // another paired surface flipped it).
        patch.unsafeMode = Boolean(e.payload.unsafe_mode);
        break;
      }
      case 'agent.chat.user_message': {
        const content = String(e.payload.content ?? '');
        const threadIdWs = String(e.payload.task_id ?? '');
        if (content) {
          const msg: AgentChatMessage = { role: 'user', content, created_at: new Date(e.ts).toISOString() };
          const prev = get().agentChat;
          patch.agentChat = {
            threadId: threadIdWs || prev.threadId,
            messages: [...prev.messages, msg],
            streaming: prev.streaming,
          };
        }
        break;
      }
      case 'agent.chat.reply': {
        const content = String(e.payload.content ?? '');
        const threadIdWs = String(e.payload.task_id ?? '');
        if (content) {
          const msg: AgentChatMessage = { role: 'assistant', content, created_at: new Date(e.ts).toISOString() };
          const prev = get().agentChat;
          patch.agentChat = {
            threadId: threadIdWs || prev.threadId,
            messages: [...prev.messages, msg],
            streaming: false,
          };
        }
        break;
      }
      default:
        break;
    }

    set(patch as AgentState);
  },

  loadOrgChart: async () => {
    try {
      set({ orgChartLoading: true });
      const data = await agentApi.getOrgChart();
      set({ orgChart: data });
    } catch (err) {
      console.error('agentStore.loadOrgChart failed:', err);
    } finally {
      set({ orgChartLoading: false });
    }
  },

  updateRoleOrders: async (roleId: string, orders: string) => {
    try {
      await agentApi.updateRoleOrders({ role_id: roleId, orders });
      set((state) => {
        if (!state.orgChart) return {};
        const newRoles = state.orgChart.roles.map((r) => 
          r.id === roleId ? { ...r, standing_orders: orders } : r
        );
        return { orgChart: { ...state.orgChart, roles: newRoles } };
      });
    } catch (err) {
      console.error('agentStore.updateRoleOrders failed:', err);
      throw err;
    }
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
    resumeCaveat: null,
    emotion: null,
    proactive: { enabled: false, lastCycleAt: null, hasTriggers: false },
    reflections: [],
    observations: [],
    recentActions: [],
    subGoals: [],
    promptToUser: null,
    notification: null,
    // Phase 16 — clear deferred-OPERATOR + history surfaces too.
    reportPending: null,
    reportLoading: false,
    reportError: null,
    conversationSeed: null,
    qualityGate: null,
    historyTasks: [],
    historyLoading: false,
    historyError: null,
    // Phase 17a.5 — drop any stale info-need state on reset.
    currentInfoNeed: null,
    infoNeedBusy: false,
    infoNeedError: null,
    // Phase 17a — clear council state on reset.
    councilActive: false,
    councilSituationKind: null,
    councilSituationSummary: null,
    councilStatements: [],
    councilDecision: null,
    // Phase 18-COMPLETE — drop progress maps on reset.
    progressByTaskId: {},
    progressEtaByTaskId: {},
    promotedToBackgroundAt: {},
    bgTaskGoals: {},
    progressLoading: {},
    // V2 Agent Chat — clear thread on reset.
    agentChat: { threadId: null, messages: [], streaming: false },
    // Phase 30 — Org-Chart
    orgChart: null,
    orgChartLoading: false,
  }),
}));
