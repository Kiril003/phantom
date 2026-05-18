/**
 * Vertical V11 — Intelligence Hub Zustand store.
 *
 * Holds the hub snapshot and search state for the IntelligenceHub overlay.
 * Polling (5-minute interval) is handled in KnowsAboutMeCard via TanStack
 * Query — this store is the shared write surface for the overlay UI.
 */
import { create } from 'zustand';
import {
  intelligenceApi,
  type IntelligenceHubSnapshot,
  type SearchHit,
} from '../services/intelligenceApi';

interface IntelligenceState {
  snapshot: IntelligenceHubSnapshot | null;
  searchResults: SearchHit[];
  loading: boolean;
  searchLoading: boolean;
  error: string | null;
  searchQuery: string;

  /** Load (or refresh) the full hub snapshot. */
  loadHub: () => Promise<void>;

  /** Run a cross-corpus search and store results. */
  runSearch: (query: string, sources?: string[], topK?: number) => Promise<void>;

  /** Optimistically toggle exclude_from_prompts and persist via API. */
  toggleExclude: (factId: string, currentValue: boolean) => Promise<void>;

  clearSearch: () => void;
}

export const useIntelligenceStore = create<IntelligenceState>((set, _get) => ({
  snapshot: null,
  searchResults: [],
  loading: false,
  searchLoading: false,
  error: null,
  searchQuery: '',

  loadHub: async () => {
    set({ loading: true, error: null });
    try {
      const snapshot = await intelligenceApi.getHub();
      set({ snapshot, loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load intelligence hub';
      set({ loading: false, error: msg });
    }
  },

  runSearch: async (query, sources, topK = 10) => {
    if (!query || query.length < 2) {
      set({ searchResults: [], searchQuery: query });
      return;
    }
    set({ searchLoading: true, searchQuery: query });
    try {
      const resp = await intelligenceApi.search(query, sources, topK);
      set({ searchResults: resp.hits, searchLoading: false });
    } catch (err) {
      set({ searchLoading: false, searchResults: [] });
    }
  },

  toggleExclude: async (factId, currentValue) => {
    const newValue = !currentValue;
    // Optimistic update
    set((state) => {
      if (!state.snapshot) return {};
      return {
        snapshot: {
          ...state.snapshot,
          user_facts: state.snapshot.user_facts.map((f) =>
            f.id === factId ? { ...f, exclude_from_prompts: newValue } : f,
          ),
        },
      };
    });
    try {
      await intelligenceApi.excludeFact(factId, newValue);
    } catch {
      // Roll back on failure
      set((state) => {
        if (!state.snapshot) return {};
        return {
          snapshot: {
            ...state.snapshot,
            user_facts: state.snapshot.user_facts.map((f) =>
              f.id === factId ? { ...f, exclude_from_prompts: currentValue } : f,
            ),
          },
        };
      });
    }
  },

  clearSearch: () => set({ searchResults: [], searchQuery: '' }),
}));
