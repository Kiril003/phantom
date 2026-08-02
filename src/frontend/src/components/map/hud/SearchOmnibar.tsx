import { useState } from 'react';
import { Search, Mic } from 'lucide-react';
import { useMapStore } from '../../../stores/mapStore';

/**
 * Phase 24-D — combined entry: geocode + POI + memory + chat hand-off.
 *
 * The previous "Search" box inside `TacticalMap` only filtered
 * wardriving + intel POIs by name. The omnibar keeps that semantic
 * (it pushes the query into `mapStore.searchQuery` so the existing
 * filtering pipeline still works) and adds:
 *
 *  * a mic affordance — clicking it dispatches a custom DOM event
 *    `phantom:omnibar-mic` that the global voice handler picks up;
 *  * an "ask phantom" hand-off: pressing Enter when the input
 *    starts with `?` or `phantom,` emits `phantom:chat-from-map` so
 *    chat can prepend a viewport reference.
 *
 * Both events are decoupled from this component — tests can spy on
 * `window.dispatchEvent` to assert the contract without dragging in
 * the chat / voice subsystems.
 */

export interface SearchOmnibarProps {
  className?: string;
}

export function SearchOmnibar({ className = '' }: SearchOmnibarProps): JSX.Element {
  const stored = useMapStore((s) => s.searchQuery);
  const setSearchQuery = useMapStore((s) => s.setSearchQuery);
  const [draft, setDraft] = useState<string>(stored);

  const trySubmit = () => {
    const trimmed = draft.trim();
    setSearchQuery(trimmed);
    if (trimmed.startsWith('?') || trimmed.toLowerCase().startsWith('phantom,')) {
      window.dispatchEvent(
        new CustomEvent('phantom:chat-from-map', { detail: { query: trimmed } }),
      );
    }
  };

  return (
    <div
      data-testid="search-omnibar"
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full bg-black/55 backdrop-blur-md border border-white/5 text-[11px] text-white/85 ${className}`}
    >
      <Search size={12} strokeWidth={1.75} className="opacity-65" />
      <input
        data-testid="search-omnibar-input"
        type="text"
        value={draft}
        placeholder="Знайти, спитати, прокласти..."
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') trySubmit();
          if (e.key === 'Escape') {
            setDraft('');
            setSearchQuery('');
          }
        }}
        className="bg-transparent outline-none border-none text-[11px] placeholder:text-white/35 w-[200px]"
      />
      <button
        type="button"
        data-testid="search-omnibar-mic"
        aria-label="Голосовий ввід"
        onClick={() => {
          window.dispatchEvent(new CustomEvent('phantom:omnibar-mic'));
        }}
        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/55 hover:text-white"
      >
        <Mic size={12} strokeWidth={1.75} />
      </button>
    </div>
  );
}
