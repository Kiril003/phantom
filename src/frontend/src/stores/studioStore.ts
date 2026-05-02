/**
 * Phase 17b — Agent Studio store.
 *
 * Holds the saved-agents library, the editing draft (the AgentBuilder UI
 * binds to this), the card catalog, and selected card id within the editor.
 * Also tracks the conversational BuilderSession turn so chat-driven creation
 * can flow through InfoNeedDialog.
 */
import { create } from 'zustand';
import type {
  AgentCard,
  AgentCardKind,
  AgentInfoNeed,
  CardCatalogEntry,
  CustomAgent,
  CustomAgentRun,
} from '@shared/types';
import { studioApi, type BuilderTurnResp } from '../services/studioApi';

interface StudioState {
  // Library list.
  agents: CustomAgent[];
  loadingAgents: boolean;
  agentsError: string | null;

  // Editor.
  draft: CustomAgent | null;
  selectedCardId: string | null;
  saveBusy: boolean;
  saveError: string | null;

  // Catalog (loaded once per session).
  catalog: CardCatalogEntry[];
  catalogLoaded: boolean;

  // Per-agent runs cache (keyed by agent_id).
  runsByAgent: Record<string, CustomAgentRun[]>;

  // Conversational builder.
  builderDraftId: string | null;
  builderStep: string | null;
  builderInfoNeed: AgentInfoNeed | null;
  builderFinished: boolean;
  builderSummary: string | null;
  builderSavedAgentId: string | null;

  // Lifecycle.
  loadAgents: () => Promise<void>;
  loadCatalog: () => Promise<void>;
  loadRuns: (agentId: string) => Promise<void>;

  startNewDraft: () => void;
  loadDraftFromAgent: (agent: CustomAgent) => void;
  setDraft: (patch: Partial<CustomAgent>) => void;
  selectCard: (cardId: string | null) => void;
  addCard: (kind: AgentCardKind) => void;
  updateCard: (cardId: string, patch: Partial<AgentCard>) => void;
  removeCard: (cardId: string) => void;

  saveDraft: () => Promise<CustomAgent | null>;
  removeAgent: (id: string) => Promise<void>;
  cloneAgent: (id: string) => Promise<CustomAgent | null>;

  runAgent: (
    id: string,
    inputs?: Record<string, unknown>,
  ) => Promise<{ task_id: string; run_id: string } | null>;

  // Conversational builder.
  builderStart: (initial_intent?: string) => Promise<void>;
  builderRespond: (answer: unknown) => Promise<void>;
  builderCancel: () => Promise<void>;
}

const newId = () => Math.random().toString(36).slice(2, 11);

const blankAgent = (): CustomAgent => ({
  id: '',
  owner_user_id: '',
  name: 'Новий агент',
  description: '',
  avatar: null,
  tags: [],
  goal_template: '',
  inputs_schema: [],
  cards: [],
  links: [],
  recipients: [],
  schedule: {
    kind: 'manual',
    interval_s: null,
    cron_expr: null,
    condition: null,
    fire_at: null,
    enabled: true,
    timezone: 'Europe/Kyiv',
  },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  last_run_at: null,
  run_count: 0,
  success_count: 0,
  enabled: true,
});

export const useStudioStore = create<StudioState>((set, get) => ({
  agents: [],
  loadingAgents: false,
  agentsError: null,
  draft: null,
  selectedCardId: null,
  saveBusy: false,
  saveError: null,
  catalog: [],
  catalogLoaded: false,
  runsByAgent: {},
  builderDraftId: null,
  builderStep: null,
  builderInfoNeed: null,
  builderFinished: false,
  builderSummary: null,
  builderSavedAgentId: null,

  loadAgents: async () => {
    set({ loadingAgents: true, agentsError: null });
    try {
      const resp = await studioApi.list();
      set({ agents: resp.agents, loadingAgents: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed to load agents';
      set({ loadingAgents: false, agentsError: msg });
    }
  },

  loadCatalog: async () => {
    if (get().catalogLoaded) return;
    try {
      const resp = await studioApi.catalog();
      set({ catalog: resp.entries, catalogLoaded: true });
    } catch (err) {
      console.warn('studio catalog load failed', err);
    }
  },

  loadRuns: async (agentId) => {
    try {
      const resp = await studioApi.runs(agentId);
      set((s) => ({ runsByAgent: { ...s.runsByAgent, [agentId]: resp.runs } }));
    } catch (err) {
      console.warn('studio runs load failed', err);
    }
  },

  startNewDraft: () => set({ draft: blankAgent(), selectedCardId: null }),

  loadDraftFromAgent: (agent) =>
    set({ draft: { ...agent }, selectedCardId: null }),

  setDraft: (patch) => {
    const draft = get().draft;
    if (!draft) return;
    set({ draft: { ...draft, ...patch } });
  },

  selectCard: (cardId) => set({ selectedCardId: cardId }),

  addCard: (kind) => {
    const draft = get().draft;
    const catalog = get().catalog;
    if (!draft) return;
    const entry = catalog.find((c) => c.kind === kind);
    if (!entry) return;
    const card: AgentCard = {
      id: newId(),
      kind,
      category: entry.category,
      title: entry.title,
      description: entry.description,
      config: { ...entry.default_config },
      x: 0,
      y: 0,
      info_needs: [],
    };
    set({
      draft: { ...draft, cards: [...draft.cards, card] },
      selectedCardId: card.id,
    });
  },

  updateCard: (cardId, patch) => {
    const draft = get().draft;
    if (!draft) return;
    set({
      draft: {
        ...draft,
        cards: draft.cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c)),
      },
    });
  },

  removeCard: (cardId) => {
    const draft = get().draft;
    if (!draft) return;
    set({
      draft: {
        ...draft,
        cards: draft.cards.filter((c) => c.id !== cardId),
        links: draft.links.filter(
          (l) => l.from_card_id !== cardId && l.to_card_id !== cardId,
        ),
      },
      selectedCardId: get().selectedCardId === cardId ? null : get().selectedCardId,
    });
  },

  saveDraft: async () => {
    const draft = get().draft;
    if (!draft) return null;
    set({ saveBusy: true, saveError: null });
    try {
      const payload = {
        id: draft.id || undefined,
        name: draft.name,
        description: draft.description,
        avatar: draft.avatar,
        tags: draft.tags,
        goal_template: draft.goal_template,
        inputs_schema: draft.inputs_schema,
        cards: draft.cards,
        links: draft.links,
        recipients: draft.recipients,
        schedule: draft.schedule,
        enabled: draft.enabled,
      };
      const resp = draft.id
        ? await studioApi.update(draft.id, payload)
        : await studioApi.create(payload);
      // Refresh library + reload draft from server.
      set({ draft: resp.agent, saveBusy: false });
      void get().loadAgents();
      return resp.agent;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed to save agent';
      set({ saveBusy: false, saveError: msg });
      return null;
    }
  },

  removeAgent: async (id) => {
    try {
      await studioApi.remove(id);
      set((s) => ({ agents: s.agents.filter((a) => a.id !== id) }));
    } catch (err) {
      console.warn('studio remove failed', err);
    }
  },

  cloneAgent: async (id) => {
    try {
      const resp = await studioApi.clone(id);
      void get().loadAgents();
      return resp.agent;
    } catch (err) {
      console.warn('studio clone failed', err);
      return null;
    }
  },

  runAgent: async (id, inputs = {}) => {
    try {
      return await studioApi.run(id, { inputs });
    } catch (err) {
      console.warn('studio run failed', err);
      return null;
    }
  },

  // ── Conversational builder ─────────────────────────────────────────────

  builderStart: async (initial_intent = '') => {
    try {
      const resp: BuilderTurnResp = await studioApi.builderStart(initial_intent);
      set({
        builderDraftId: resp.draft_id,
        builderStep: resp.step,
        builderInfoNeed: resp.info_need,
        builderFinished: resp.finished,
        builderSummary: resp.summary ?? null,
        builderSavedAgentId: resp.saved_agent_id ?? null,
      });
    } catch (err) {
      console.warn('builderStart failed', err);
    }
  },

  builderRespond: async (answer) => {
    const draftId = get().builderDraftId;
    if (!draftId) return;
    try {
      const resp: BuilderTurnResp = await studioApi.builderStep(draftId, answer);
      set({
        builderStep: resp.step,
        builderInfoNeed: resp.info_need,
        builderFinished: resp.finished,
        builderSummary: resp.summary ?? null,
        builderSavedAgentId: resp.saved_agent_id ?? null,
      });
      if (resp.finished) {
        // Library may have a new agent — refresh.
        void get().loadAgents();
      }
    } catch (err) {
      console.warn('builderRespond failed', err);
    }
  },

  builderCancel: async () => {
    const draftId = get().builderDraftId;
    if (!draftId) return;
    try {
      await studioApi.builderCancel(draftId);
    } catch (err) {
      console.warn('builderCancel failed', err);
    }
    set({
      builderDraftId: null,
      builderStep: null,
      builderInfoNeed: null,
      builderFinished: true,
      builderSummary: 'скасовано',
      builderSavedAgentId: null,
    });
  },
}));
