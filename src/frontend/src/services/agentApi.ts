import type {
  AgentCouncilDecision,
  AgentSelfModel,
  AgentSubstate,
  AgentTaskDetail,
  AgentTaskReport,
  AgentTaskSummary,
  AgentAuditEntry,
} from '@shared/types';

import { request as req } from './api';

export interface StartTaskResponse {
  task_id: string;
  started: boolean;
  detail?: string;
  unsafe_mode?: boolean;
}

export interface RouterStateSnapshot {
  primary: string;
  fallback: string;
  active: string;
  cooling: Record<string, { until_utc: string; reason: string }>;
  quota_exhausted: Record<string, { until_utc: string }>;
  last_calls: Record<string, { at: string; success: boolean; tool?: string; kind?: string }>;
}

/** Phase 9.4a — multi-track runtime snapshot. */
export interface AgentTrackSlotView {
  active: boolean;
  task_id: string | null;
  substate: string;
  goal: string | null;
  origin: string | null;
  status?: string;
  queue_size: number;
}

export interface AgentStatusSnapshot {
  foreground: AgentTrackSlotView;
  background: AgentTrackSlotView;
}

/** Phase 16 — POST /task/{id}/resume-as-conversation response shape. */
export interface AgentResumeAsConversationResponse {
  task_id: string;
  seed_summary: string;
  suggested_starter: string;
  follow_ups: string[];
}

export const agentApi = {
  startTask: (goal: string, opts?: { unsafe_mode?: boolean }) =>
    req<StartTaskResponse>('POST', '/agent/task', {
      goal,
      unsafe_mode: !!opts?.unsafe_mode,
    }),
  setSafety: (id: string, enabled: boolean) =>
    req<{ task_id: string; unsafe_mode: boolean }>(
      'POST', `/agent/task/${id}/safety`, { enabled },
    ),
  pause: (id: string) => req<{ paused: boolean }>('POST', `/agent/task/${id}/pause`),
  resume: (id: string) => req<{ resumed: boolean }>('POST', `/agent/task/${id}/resume`),
  intervene: (id: string, instruction: string) =>
    req<{ queued: boolean }>('POST', `/agent/task/${id}/intervene`, { instruction }),
  cancelStep: (id: string) => req<{ cancelled: boolean }>('POST', `/agent/task/${id}/cancel_step`),
  stop: (id?: string) => req<{ stopped: boolean }>('POST', '/agent/stop', { task_id: id ?? null }),
  checkpoint: (id: string) => req<{ checkpoint_id: number }>('POST', `/agent/task/${id}/checkpoint`),
  resumeFromCheckpoint: (id: string, checkpoint_id: number) =>
    req<{ resumed: boolean }>('POST', `/agent/task/${id}/resume_from_checkpoint`, { checkpoint_id }),
  listTasks: (status?: string, limit = 50) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    qs.set('limit', String(limit));
    return req<{ tasks: AgentTaskSummary[] }>('GET', `/agent/tasks?${qs.toString()}`);
  },
  getTask: (id: string) => req<AgentTaskDetail>('GET', `/agent/task/${id}`),
  audit: (taskId?: string, limit = 50) => {
    const qs = new URLSearchParams();
    if (taskId) qs.set('task_id', taskId);
    qs.set('limit', String(limit));
    return req<{ audit: AgentAuditEntry[] }>('GET', `/agent/audit?${qs.toString()}`);
  },
  selfModel: () => req<{ self_model: AgentSelfModel; substate: AgentSubstate }>('GET', '/agent/self_model'),
  routerState: () => req<RouterStateSnapshot>('GET', '/agent/router_state'),
  status: () => req<AgentStatusSnapshot>('GET', '/agent/status'),
  feedback: (audit_entry_id: number, rating: 'up' | 'down' | 'comment', comment?: string) =>
    req<{ id: number }>('POST', '/agent/feedback', { audit_entry_id, rating, comment: comment ?? null }),
  parallelChat: (message: string, taskId?: string) =>
    req<{ reply: string; task_id: string }>('POST', '/agent/chat', {
      message,
      ...(taskId ? { task_id: taskId } : {}),
    }),
  getChatThread: (taskId?: string, limit = 40) => {
    const qs = new URLSearchParams();
    if (taskId) qs.set('task_id', taskId);
    qs.set('limit', String(limit));
    return req<{ task_id: string; messages: Array<{ role: string; content: string; created_at: string | null }> }>(
      'GET', `/agent/chat/thread?${qs.toString()}`,
    );
  },
  // Phase 16 — task report endpoints.
  getReport: (id: string, preferLLM = true) => {
    const qs = new URLSearchParams();
    qs.set('prefer_llm', String(preferLLM));
    return req<{ report: AgentTaskReport; from_cache: boolean }>(
      'GET', `/agent/task/${id}/report?${qs.toString()}`,
    );
  },
  dismissReport: (id: string) =>
    req<{ dismissed: boolean }>('POST', `/agent/task/${id}/dismiss-report`),
  resumeAsConversation: (id: string) =>
    req<AgentResumeAsConversationResponse>(
      'POST', `/agent/task/${id}/resume-as-conversation`,
    ),
  // Phase 17a.5 — InfoNeed prompt resolution.
  submitInfoResponse: (taskId: string, infoNeedId: string, answer: unknown) =>
    req<{ resolved: boolean; info_need_id: string }>(
      'POST', `/agent/task/${taskId}/info-response`,
      { info_need_id: infoNeedId, answer },
    ),
  // Phase 17a — Live Plan Editor.
  injectSubgoal: (
    taskId: string,
    body: {
      description: string;
      rationale?: string;
      position?: number;
      expected_actions?: number;
      acceptance_criteria?: string;
    },
  ) =>
    req<{ sub_goal: import('@shared/types').AgentSubGoal; position: number }>(
      'POST', `/agent/task/${taskId}/inject-subgoal`, body,
    ),
  deleteSubgoal: (taskId: string, subGoalId: string, skipOnly = false) => {
    const qs = new URLSearchParams();
    qs.set('skip_only', String(skipOnly));
    return req<{ removed: boolean; skip_only?: boolean; reason?: string }>(
      'DELETE', `/agent/task/${taskId}/subgoals/${subGoalId}?${qs.toString()}`,
    );
  },
  patchPlan: (
    taskId: string,
    diffs: Array<{
      op: 'edit' | 'skip' | 'delete' | 'reorder' | 'inject';
      id?: string;
      ids?: string[];
      description?: string;
      rationale?: string;
      expected_actions?: number;
      acceptance_criteria?: string;
      position?: number;
    }>,
  ) =>
    req<{
      applied: Array<{ op: string; id?: string; count?: number }>;
      sub_goals: import('@shared/types').AgentSubGoal[];
    }>('PATCH', `/agent/task/${taskId}/plan`, { diffs }),
  // Phase 18 — Screen capture + OCR HTTP wrappers (no task spawn needed).
  screenCapture: (region?: { x: number; y: number; w: number; h: number }) => {
    const qs = new URLSearchParams();
    qs.set('return_base64', 'true');
    if (region) {
      qs.set('x', String(region.x));
      qs.set('y', String(region.y));
      qs.set('w', String(region.w));
      qs.set('h', String(region.h));
    }
    return req<{
      ok: boolean;
      width: number;
      height: number;
      strategy: string;
      png_base64: string;
      size_bytes: number;
      captured_at: number;
    }>('GET', `/agent/screen/capture?${qs.toString()}`);
  },
  screenOcr: (
    region?: { x: number; y: number; w: number; h: number },
    languages = 'ukr+eng',
  ) => {
    const qs = new URLSearchParams();
    qs.set('languages', languages);
    if (region) {
      qs.set('x', String(region.x));
      qs.set('y', String(region.y));
      qs.set('w', String(region.w));
      qs.set('h', String(region.h));
    }
    return req<{
      ok: boolean;
      lines: Array<{ text: string; x: number; y: number; w: number; h: number; confidence: number }>;
      image_width: number;
      image_height: number;
      languages: string;
    }>('GET', `/agent/screen/ocr?${qs.toString()}`);
  },
  // Phase 17a — Council manual trigger.
  runCouncilRound: (
    taskId: string,
    body: {
      summary: string;
      kind?:
        | 'strategic_revise'
        | 'before_destructive'
        | 'low_confidence'
        | 'info_need'
        | 'quality_gate'
        | 'user_invoked';
      proposed_action?: Record<string, unknown>;
      context?: Record<string, unknown>;
      monologue_confidence?: number;
      include_aesthete?: boolean;
    },
  ) =>
    req<{ decision: AgentCouncilDecision }>(
      'POST', `/agent/task/${taskId}/council/round`, body,
    ),
  // Phase 18-COMPLETE — long-running task progress hydration.
  getProgress: (taskId: string) =>
    req<import('@shared/types').AgentProgressSnapshot>(
      'GET', `/agent/task/${taskId}/progress`,
    ),

  // Phase 29 — 7-Horizon Planner.
  getHorizons: () => req<{ tree: import('@shared/types').HorizonGoal[] }>('GET', '/agent/will/horizons'),
  createHorizonGoal: (body: { description: string; horizon_level: number; parent_id?: string; deadline?: string }) =>
    req<{ id: string }>('POST', '/agent/will/horizons', body),

  // Phase 30 — Org-Chart.
  getOrgChart: () => req<import('@shared/types').OrgChart>('GET', '/agent/org-chart'),
  updateRoleOrders: (body: { role_id: string; orders: string }) =>
    req<{ status: string }>('POST', '/agent/org-chart/orders', body),
};
