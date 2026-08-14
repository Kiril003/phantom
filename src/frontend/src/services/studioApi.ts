/**
 * Phase 17b — Agent Studio HTTP client.
 *
 * Mirrors src/backend/api/routes_studio.py.
 */
import type {
  AgentInfoNeed,
  CardCatalog,
  CustomAgent,
  CustomAgentRun,
} from '@shared/types';
import { request as req } from './api';

export interface AgentUpsertPayload {
  id?: string;
  name: string;
  description?: string;
  avatar?: string | null;
  tags?: string[];
  goal_template?: string;
  inputs_schema?: AgentInfoNeed[];
  cards?: CustomAgent['cards'];
  links?: CustomAgent['links'];
  recipients?: CustomAgent['recipients'];
  schedule?: CustomAgent['schedule'];
  enabled?: boolean;
}

export interface BuilderTurnResp {
  draft_id: string;
  step: string;
  info_need: AgentInfoNeed | null;
  finished: boolean;
  saved_agent_id?: string | null;
  summary?: string | null;
}

export const studioApi = {
  catalog: () => req<CardCatalog>('GET', '/studio/cards/catalog'),
  list: (limit = 100) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    return req<{ agents: CustomAgent[] }>('GET', `/studio/agents?${qs.toString()}`);
  },
  get: (id: string) => req<{ agent: CustomAgent }>('GET', `/studio/agents/${id}`),
  create: (payload: AgentUpsertPayload) =>
    req<{ agent: CustomAgent; warnings: Array<{ field: string; message: string }> }>(
      'POST', '/studio/agents', payload,
    ),
  update: (id: string, payload: AgentUpsertPayload) =>
    req<{ agent: CustomAgent; warnings: Array<{ field: string; message: string }> }>(
      'PATCH', `/studio/agents/${id}`, payload,
    ),
  remove: (id: string) =>
    req<{ deleted: boolean }>('DELETE', `/studio/agents/${id}`),
  clone: (id: string) =>
    req<{ agent: CustomAgent }>('POST', `/studio/agents/${id}/clone`),
  run: (id: string, body: { inputs?: Record<string, unknown>; track?: 'foreground' | 'background'; note?: string }) =>
    req<{ task_id: string; run_id: string }>(
      'POST', `/studio/agents/${id}/run`,
      { inputs: body.inputs ?? {}, track: body.track ?? 'foreground', note: body.note ?? null },
    ),
  runs: (id: string, limit = 50) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    return req<{ runs: CustomAgentRun[] }>('GET', `/studio/agents/${id}/runs?${qs.toString()}`);
  },
  runsIndex: (limit = 200) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    return req<{ runs: CustomAgentRun[] }>('GET', `/studio/runs?${qs.toString()}`);
  },
  // Conversational builder.
  builderStart: (initial_intent = '') =>
    req<BuilderTurnResp>('POST', '/studio/builder/start', { initial_intent }),
  builderStep: (draft_id: string, answer: unknown) =>
    req<BuilderTurnResp>('POST', '/studio/builder/step', { draft_id, answer }),
  builderCancel: (draft_id: string) =>
    req<{ cancelled: boolean }>('POST', `/studio/builder/${draft_id}/cancel`),
};
