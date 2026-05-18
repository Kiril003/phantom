/**
 * V11 — "What does PHANTOM know about me?" overview card.
 *
 * Renders in the Operator/Shadow layout sidebar.
 * Shows a compact count summary (facts · vault · lessons · memory).
 * Clicking opens the IntelligenceHub overlay.
 * Polls GET /api/v1/intelligence-hub every 5 minutes via TanStack Query
 * (same pattern as WillPanel — refetchInterval only while the document is
 * visible; background tabs don't burn request budget).
 */
import { useQuery } from '@tanstack/react-query';
import { Brain, ChevronRight, Eye, BookOpen, Database } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { intelligenceApi, type IntelligenceHubSnapshot } from '../../services/intelligenceApi';

const POLL_MS = 5 * 60 * 1000; // 5 minutes

// ── Pill ─────────────────────────────────────────────────────────────────────

interface PillProps {
  icon: React.ReactNode;
  label: string;
  value: number;
}

function CountPill({ icon, label, value }: PillProps) {
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/5"
      title={label}
    >
      <span className="text-ink-muted" style={{ fontSize: 13 }}>{icon}</span>
      <span className="text-[11px] font-mono font-medium text-ink-primary tabular-nums">
        {value}
      </span>
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

export function KnowsAboutMeCard() {
  const openHub = useUIStore((s) => s.setIntelligenceHubOpen);

  const { data, isLoading, error } = useQuery<IntelligenceHubSnapshot>({
    queryKey: ['intelligence-hub-sidebar'],
    queryFn: () => intelligenceApi.getHub(),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    staleTime: POLL_MS,
    retry: 1,
  });

  const counts = data?.counts ?? {};
  const factsCount   = (counts['user_facts']      as number | undefined) ?? 0;
  const vaultCount   = (counts['vault_cards']     as number | undefined) ?? 0;
  const lessonCount  = (counts['lessons']         as number | undefined) ?? 0;
  const memoryCount  = (counts['memory_facts']    as number | undefined) ?? 0;

  return (
    <button
      onClick={() => openHub(true)}
      className="w-full flex flex-col gap-3 p-4 rounded-2xl bg-white/40 border border-white/20
                 hover:bg-white/60 active:scale-[0.98] transition-all duration-150
                 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      style={{ minHeight: 44 }}
      aria-label="Open Intelligence Hub"
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-600">
            <Brain size={16} />
          </div>
          <span className="text-[13px] font-semibold text-ink-primary">
            Що PHANTOM знає про мене
          </span>
        </div>
        <ChevronRight size={14} className="text-ink-muted flex-shrink-0" />
      </div>

      {/* Count pills */}
      {isLoading && (
        <div className="flex gap-1.5">
          {[60, 48, 52, 44].map((w, i) => (
            <div
              key={i}
              className="h-6 rounded-full bg-black/5 animate-pulse"
              style={{ width: w }}
            />
          ))}
        </div>
      )}

      {error && !isLoading && (
        <p className="text-[10px] text-red-400 font-mono">
          Не вдалося завантажити
        </p>
      )}

      {data && !isLoading && (
        <div className="flex flex-wrap gap-1.5">
          <CountPill
            icon={<Eye size={11} />}
            label={`${factsCount} personal facts`}
            value={factsCount}
          />
          <CountPill
            icon={<Database size={11} />}
            label={`${vaultCount} vault cards`}
            value={vaultCount}
          />
          <CountPill
            icon={<BookOpen size={11} />}
            label={`${lessonCount} lessons`}
            value={lessonCount}
          />
          <CountPill
            icon={<Brain size={11} />}
            label={`${memoryCount} memories`}
            value={memoryCount}
          />
        </div>
      )}

      {/* Footer hint */}
      <p className="text-[10px] text-ink-muted font-mono">
        Натисни, щоб переглянути · оновлюється кожні 5 хв
      </p>
    </button>
  );
}
