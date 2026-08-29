/**
 * Vertical V11 — Intelligence Hub API client.
 *
 * Thin wrappers around the two Intelligence Hub endpoints:
 *   GET  /api/v1/intelligence-hub
 *   POST /api/v1/intelligence-hub/search
 * Plus a helper to toggle exclude_from_prompts via the agent action surface.
 */

import { readToken } from './tokenStore';

const BASE = '/api/v1';

function _authHeader(): Record<string, string> {
  const token = readToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function _handleResp<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`[${resp.status}] ${text}`);
  }
  return resp.json() as Promise<T>;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface VaultCardMeta {
  id: string;
  kind: string;
  title: string;
  redacted_summary: string;
  secret_count: number;
  plain_count: number;
  updated_at: string;
  last_accessed_at: string | null;
  tags: string[];
}

export interface UserFactView {
  id: string;
  category: string;
  label: string | null;
  text: string;
  source: string;
  captured_at: string;
  exclude_from_prompts: boolean;
}

export interface LessonView {
  lesson_id: string;
  task_id: string | null;
  what_worked: string;
  what_avoid: string;
  applicability: string;
  times_helped: number;
  created_at: string | null;
}

export interface MemoryFactView {
  fact_id: string;
  content: string;
  category: string;
  importance: number;
  created_at: string | null;
}

export interface DecisionView {
  id: number;
  task_id: string;
  step_idx: number;
  action_name: string;
  intent: string | null;
  ok: boolean;
  elapsed_ms: number;
  timestamp: string;
}

export interface IntelligenceHubSnapshot {
  user_id: string;
  composed_at: string;
  counts: Record<string, number>;
  vault_cards: VaultCardMeta[];
  user_facts: UserFactView[];
  behavioural_model: Record<string, unknown>;
  lessons: LessonView[];
  memory_facts: MemoryFactView[];
  recent_decisions: DecisionView[];
}

export interface SearchHit {
  source: string;
  object_id: string;
  snippet: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface SearchResponse {
  hits: SearchHit[];
  query: string;
  elapsed_ms: number;
}

// ── API calls ────────────────────────────────────────────────────────────────

export const intelligenceApi = {
  /** Fetch the full intelligence hub snapshot for the authenticated user. */
  async getHub(): Promise<IntelligenceHubSnapshot> {
    const resp = await fetch(`${BASE}/intelligence-hub`, {
      headers: { ..._authHeader() },
    });
    return _handleResp<IntelligenceHubSnapshot>(resp);
  },

  /**
   * Cross-corpus semantic search.
   * @param query    Search string (2-400 chars)
   * @param sources  Optional subset: vault | facts | lessons | memory | decisions
   * @param topK     Maximum results (1-50, default 10)
   */
  async search(
    query: string,
    sources?: string[],
    topK = 10,
  ): Promise<SearchResponse> {
    const body: Record<string, unknown> = { query, top_k: topK };
    if (sources && sources.length > 0) body.sources = sources;
    const resp = await fetch(`${BASE}/intelligence-hub/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeader() },
      body: JSON.stringify(body),
    });
    return _handleResp<SearchResponse>(resp);
  },

  /**
   * Toggle the exclude_from_prompts flag on a UserFact.
   * Uses the agent action surface via POST /api/v1/agent/action/run.
   * Falls back to a best-effort no-op on error.
   */
  async excludeFact(
    factId: string,
    exclude: boolean,
    reason = 'operator_request',
  ): Promise<void> {
    const resp = await fetch(`${BASE}/agent/action/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeader() },
      body: JSON.stringify({
        action: 'intelligence.exclude_fact',
        args: { fact_id: factId, exclude, reason },
      }),
    });
    if (!resp.ok) {
      // Non-fatal — the UI checkbox has already toggled optimistically.
      // The backend will reconcile on next hub refresh.
      console.warn(`[intelligenceApi.excludeFact] ${resp.status}: ${await resp.text().catch(() => '')}`);
    }
  },
};
