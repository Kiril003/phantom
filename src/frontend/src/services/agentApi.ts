import type {
  AgentSelfModel,
  AgentSubstate,
  AgentTaskDetail,
  AgentTaskSummary,
  AgentAuditEntry,
} from '@shared/types';

const BASE = '/api/v1';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = localStorage.getItem('phantom_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    const message =
      parsed && typeof parsed === 'object' && 'detail' in parsed
        ? String((parsed as { detail: unknown }).detail)
        : `agent api error ${res.status}`;
    const err = new Error(message) as Error & { status?: number; payload?: unknown };
    err.status = res.status;
    err.payload = parsed;
    throw err;
  }
  return parsed as T;
}

export interface StartTaskResponse {
  task_id: string;
  started: boolean;
  detail?: string;
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

export const agentApi = {
  startTask: (goal: string) => req<StartTaskResponse>('POST', '/agent/task', { goal }),
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
};
