/**
 * Vertical V11 — Intelligence Hub overlay.
 *
 * Single scrollable column showing everything PHANTOM knows about the operator:
 *   1. Header + counts
 *   2. Cross-corpus search bar
 *   3. Vault cards (metadata only)
 *   4. Personal facts (with exclude_from_prompts toggle)
 *   5. Lessons
 *   6. Behavioural model (collapsible JSON)
 *   7. Recent decisions
 *   8. Strategic memory facts
 *
 * Styling: Tailwind + CSS vars, no new design tokens.
 * Touch targets: min 44×44 px per CLAUDE.md rule.
 * Width: 1024 px max, single scroll column.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Loader2, Eye, EyeOff, ChevronDown, ChevronUp } from 'lucide-react';
import { useIntelligenceStore } from '../../stores/intelligenceStore';
import type {
  VaultCardMeta,
  UserFactView,
  LessonView,
  MemoryFactView,
  DecisionView,
} from '../../services/intelligenceApi';

// ── Framer helpers ────────────────────────────────────────────────────────────

const fadeIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.22 },
};

function staggerChild(i: number) {
  return { ...fadeIn, transition: { duration: 0.2, delay: i * 0.04 } };
}

// ── Kind icons ────────────────────────────────────────────────────────────────

const KIND_ICON: Record<string, string> = {
  email_account: '✉',
  service_login: '🔑',
  messenger: '💬',
  phone: '📱',
  company: '🏢',
  payment_method: '💳',
  api_key: '🔌',
  document: '📄',
  contact: '👤',
  wifi_network: '📶',
  crypto_wallet: '🪙',
  custom: '🗂',
};

function kindIcon(kind: string): string {
  return KIND_ICON[kind] ?? '📦';
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  title,
  count,
  children,
  idx,
  emptyMsg,
  isEmpty,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  idx: number;
  emptyMsg: string;
  isEmpty: boolean;
}) {
  return (
    <motion.div {...staggerChild(idx)} className="mb-8">
      <div className="flex items-baseline gap-2 mb-3">
        <h2
          className="text-xs font-bold tracking-widest uppercase"
          style={{ color: 'var(--ink-muted, rgba(255,255,255,0.45))' }}
        >
          {title}
        </h2>
        {count !== undefined && (
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}
          >
            {count}
          </span>
        )}
      </div>
      {isEmpty ? (
        <p className="text-sm py-4 text-center" style={{ color: 'rgba(255,255,255,0.28)' }}>
          {emptyMsg}
        </p>
      ) : (
        children
      )}
    </motion.div>
  );
}

// ── Vault cards grid ──────────────────────────────────────────────────────────

function VaultCardsSection({ cards, idx }: { cards: VaultCardMeta[]; idx: number }) {
  return (
    <Section
      title="Vault Cards"
      count={cards.length}
      idx={idx}
      emptyMsg="PHANTOM has not saved any credentials yet — share them in chat to build the vault."
      isEmpty={cards.length === 0}
    >
      <div className="flex flex-wrap gap-3">
        {cards.map((card) => (
          <div
            key={card.id}
            className="rounded-xl border p-3 flex flex-col gap-1 min-w-[200px]"
            style={{
              background: 'rgba(255,255,255,0.04)',
              borderColor: 'rgba(255,255,255,0.10)',
            }}
          >
            <div className="flex items-center gap-2">
              <span className="text-xl">{kindIcon(card.kind)}</span>
              <span className="text-sm font-semibold text-white/90 truncate">{card.title}</span>
            </div>
            <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.40)' }}>
              {card.redacted_summary}
            </span>
            <span className="text-[10px] mt-auto" style={{ color: 'rgba(255,255,255,0.30)' }}>
              {new Date(card.updated_at).toLocaleDateString()}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Personal facts list ───────────────────────────────────────────────────────

function ImportanceBar({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="h-1 rounded-full w-24" style={{ background: 'rgba(255,255,255,0.10)' }}>
      <div
        className="h-full rounded-full"
        style={{
          width: `${pct}%`,
          background: pct > 70 ? '#22d3ee' : pct > 40 ? '#a78bfa' : 'rgba(255,255,255,0.3)',
        }}
      />
    </div>
  );
}

function UserFactsSection({ facts, idx }: { facts: UserFactView[]; idx: number }) {
  const toggleExclude = useIntelligenceStore((s) => s.toggleExclude);

  return (
    <Section
      title="Personal Facts"
      count={facts.length}
      idx={idx}
      emptyMsg="PHANTOM does not yet remember any personal facts — they grow with conversation."
      isEmpty={facts.length === 0}
    >
      <div className="flex flex-col gap-2">
        {facts.map((fact) => (
          <div
            key={fact.id}
            className="flex items-start gap-3 rounded-xl border p-3"
            style={{
              background: fact.exclude_from_prompts
                ? 'rgba(239,68,68,0.05)'
                : 'rgba(255,255,255,0.04)',
              borderColor: fact.exclude_from_prompts
                ? 'rgba(239,68,68,0.20)'
                : 'rgba(255,255,255,0.08)',
            }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white/85 break-words">{fact.text}</p>
              <div className="flex items-center gap-3 mt-1.5">
                <span
                  className="text-[10px] uppercase tracking-wider"
                  style={{ color: 'rgba(255,255,255,0.35)' }}
                >
                  {fact.category}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.20)', fontSize: 10 }}>·</span>
                <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.30)' }}>
                  {new Date(fact.captured_at).toLocaleDateString()}
                </span>
              </div>
            </div>
            {/* exclude toggle — min 44×44 target */}
            <button
              type="button"
              title={fact.exclude_from_prompts ? 'Re-include in prompts' : 'Exclude from prompts'}
              onClick={() => void toggleExclude(fact.id, fact.exclude_from_prompts)}
              className="shrink-0 rounded-lg flex items-center justify-center transition-colors"
              style={{
                width: 44,
                height: 44,
                background: fact.exclude_from_prompts
                  ? 'rgba(239,68,68,0.15)'
                  : 'rgba(255,255,255,0.05)',
                color: fact.exclude_from_prompts ? '#f87171' : 'rgba(255,255,255,0.35)',
              }}
              aria-pressed={fact.exclude_from_prompts}
              aria-label={fact.exclude_from_prompts ? 'Re-include in prompts' : 'Exclude from prompts'}
            >
              {fact.exclude_from_prompts ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Lessons ───────────────────────────────────────────────────────────────────

function LessonsSection({ lessons, idx }: { lessons: LessonView[]; idx: number }) {
  return (
    <Section
      title="Lessons"
      count={lessons.length}
      idx={idx}
      emptyMsg="No lessons yet — PHANTOM distils rules from completed tasks over time."
      isEmpty={lessons.length === 0}
    >
      <div className="flex flex-col gap-2">
        {lessons.slice(0, 10).map((lesson) => (
          <div
            key={lesson.lesson_id}
            className="rounded-xl border p-3"
            style={{
              background: 'rgba(255,255,255,0.03)',
              borderColor: 'rgba(255,255,255,0.08)',
            }}
          >
            {lesson.applicability && (
              <p
                className="text-[10px] uppercase tracking-wider mb-1"
                style={{ color: 'rgba(167,139,250,0.7)' }}
              >
                when {lesson.applicability}
              </p>
            )}
            {lesson.what_worked && (
              <p className="text-sm text-white/80">
                <span style={{ color: '#86efac', fontSize: 11 }}>DO: </span>
                {lesson.what_worked}
              </p>
            )}
            {lesson.what_avoid && (
              <p className="text-sm text-white/70 mt-1">
                <span style={{ color: '#fca5a5', fontSize: 11 }}>AVOID: </span>
                {lesson.what_avoid}
              </p>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Behavioural model ─────────────────────────────────────────────────────────

function BehaviouralModelSection({
  model,
  idx,
}: {
  model: Record<string, unknown>;
  idx: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const isEmpty = Object.keys(model).length === 0;
  const preview = JSON.stringify(model, null, 2).slice(0, 300);

  return (
    <Section
      title="Behavioural Model"
      idx={idx}
      emptyMsg="No behavioural model built yet — it evolves as PHANTOM observes your patterns."
      isEmpty={isEmpty}
    >
      <div
        className="rounded-xl border p-3"
        style={{
          background: 'rgba(255,255,255,0.03)',
          borderColor: 'rgba(255,255,255,0.08)',
        }}
      >
        <pre
          className="text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words"
          style={{ color: 'rgba(255,255,255,0.60)', maxHeight: expanded ? 'none' : 160, overflow: 'hidden' }}
        >
          {expanded ? JSON.stringify(model, null, 2) : preview + (preview.length >= 300 ? '…' : '')}
        </pre>
        {!isEmpty && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 flex items-center gap-1 text-xs rounded px-2 py-1 min-h-[44px]"
            style={{ color: 'rgba(255,255,255,0.45)' }}
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? 'Collapse' : 'Expand all'}
          </button>
        )}
      </div>
    </Section>
  );
}

// ── Recent decisions ──────────────────────────────────────────────────────────

function DecisionsSection({ decisions, idx }: { decisions: DecisionView[]; idx: number }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <Section
      title="Recent Decisions"
      count={decisions.length}
      idx={idx}
      emptyMsg="No agent decisions recorded yet — they accumulate as PHANTOM takes actions."
      isEmpty={decisions.length === 0}
    >
      <div className="flex flex-col gap-1.5">
        {decisions.slice(0, 10).map((d) => (
          <div key={d.id}>
            <button
              type="button"
              className="w-full text-left rounded-xl border p-3 min-h-[44px] transition-colors"
              style={{
                background: d.ok ? 'rgba(255,255,255,0.03)' : 'rgba(239,68,68,0.05)',
                borderColor: d.ok ? 'rgba(255,255,255,0.08)' : 'rgba(239,68,68,0.18)',
              }}
              onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
            >
              <div className="flex items-center gap-2">
                <span
                  className="text-[10px] font-bold"
                  style={{ color: d.ok ? '#86efac' : '#f87171' }}
                >
                  {d.ok ? 'OK' : 'ERR'}
                </span>
                <span className="text-sm text-white/80 truncate flex-1">
                  {d.action_name}
                </span>
                <span className="text-[10px] shrink-0" style={{ color: 'rgba(255,255,255,0.30)' }}>
                  {new Date(d.timestamp).toLocaleTimeString()}
                </span>
              </div>
              {expandedId === d.id && d.intent && (
                <p
                  className="mt-2 text-xs break-words"
                  style={{ color: 'rgba(255,255,255,0.55)' }}
                >
                  {d.intent}
                </p>
              )}
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Strategic memory ──────────────────────────────────────────────────────────

function MemoryFactsSection({ facts, idx }: { facts: MemoryFactView[]; idx: number }) {
  return (
    <Section
      title="Strategic Memory"
      count={facts.length}
      idx={idx}
      emptyMsg="No strategic memory yet — facts are stored here as conversations accumulate."
      isEmpty={facts.length === 0}
    >
      <div className="flex flex-col gap-1.5">
        {facts.slice(0, 20).map((fact) => (
          <div
            key={fact.fact_id}
            className="rounded-xl border px-3 py-2"
            style={{
              background: 'rgba(255,255,255,0.03)',
              borderColor: 'rgba(255,255,255,0.07)',
            }}
          >
            <p className="text-sm text-white/75 break-words">{fact.content}</p>
            <div className="flex items-center gap-2 mt-1">
              <span
                className="text-[10px] uppercase tracking-wide"
                style={{ color: 'rgba(255,255,255,0.30)' }}
              >
                {fact.category}
              </span>
              <ImportanceBar value={fact.importance} />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Search results ────────────────────────────────────────────────────────────

const SOURCE_COLOR: Record<string, string> = {
  vault: '#22d3ee',
  facts: '#a78bfa',
  lessons: '#86efac',
  memory: '#fb923c',
  decisions: '#f472b6',
};

function SearchResults() {
  const results = useIntelligenceStore((s) => s.searchResults);
  const loading = useIntelligenceStore((s) => s.searchLoading);
  const query = useIntelligenceStore((s) => s.searchQuery);

  if (!query) return null;
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-white/40 text-sm">
        <Loader2 size={14} className="animate-spin" />
        Searching…
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <p className="py-4 text-sm text-center" style={{ color: 'rgba(255,255,255,0.28)' }}>
        No results for "{query}"
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 mb-6">
      {results.map((hit, i) => (
        <motion.div
          key={`${hit.source}-${hit.object_id}-${i}`}
          {...staggerChild(i)}
          className="rounded-xl border px-3 py-2"
          style={{
            background: 'rgba(255,255,255,0.04)',
            borderColor: 'rgba(255,255,255,0.08)',
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{
                background: `${SOURCE_COLOR[hit.source] ?? '#fff'}22`,
                color: SOURCE_COLOR[hit.source] ?? '#fff',
              }}
            >
              {hit.source}
            </span>
            <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.30)' }}>
              score {(hit.score * 100).toFixed(0)}%
            </span>
          </div>
          <p className="text-sm text-white/75 break-words">{hit.snippet}</p>
        </motion.div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function IntelligenceHub({ isOpen, onClose }: Props) {
  const snapshot = useIntelligenceStore((s) => s.snapshot);
  const loading = useIntelligenceStore((s) => s.loading);
  const error = useIntelligenceStore((s) => s.error);
  const loadHub = useIntelligenceStore((s) => s.loadHub);
  const runSearch = useIntelligenceStore((s) => s.runSearch);
  const clearSearch = useIntelligenceStore((s) => s.clearSearch);
  const [localQuery, setLocalQuery] = useState('');
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen && !snapshot) {
      void loadHub();
    }
  }, [isOpen]);

  function handleSearchChange(val: string) {
    setLocalQuery(val);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (!val || val.length < 2) {
      clearSearch();
      return;
    }
    searchDebounce.current = setTimeout(() => {
      void runSearch(val);
    }, 400);
  }

  const counts = snapshot?.counts ?? {};

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
          {/* backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/55 backdrop-blur-md"
            onClick={onClose}
          />

          {/* panel */}
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="relative z-10 w-full max-w-4xl my-6 rounded-3xl overflow-hidden"
            style={{
              background: 'var(--surface-1, rgba(12,12,18,0.97))',
              border: '1px solid rgba(255,255,255,0.10)',
              boxShadow: '0 32px 80px rgba(0,0,0,0.65)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div
              className="sticky top-0 z-10 px-6 pt-5 pb-4"
              style={{
                background: 'var(--surface-1, rgba(12,12,18,0.97))',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1
                    className="text-sm font-bold tracking-widest uppercase"
                    style={{ color: 'rgba(255,255,255,0.55)' }}
                  >
                    WHAT PHANTOM KNOWS ABOUT YOU
                  </h1>
                  {snapshot && (
                    <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.30)' }}>
                      {counts.vault_cards ?? 0} vault cards ·{' '}
                      {counts.facts ?? 0} facts ·{' '}
                      {counts.lessons ?? 0} lessons ·{' '}
                      {counts.memory_facts ?? 0} memory facts ·{' '}
                      {counts.recent_decisions ?? 0} decisions
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="shrink-0 rounded-xl flex items-center justify-center transition-colors hover:bg-white/10"
                  style={{ width: 44, height: 44, color: 'rgba(255,255,255,0.50)' }}
                  aria-label="Close Intelligence Hub"
                >
                  <X size={18} />
                </button>
              </div>

              {/* search bar */}
              <div
                className="mt-3 flex items-center gap-2 rounded-xl px-3"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
              >
                <Search size={14} style={{ color: 'rgba(255,255,255,0.35)' }} />
                <input
                  type="text"
                  value={localQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search vault, facts, lessons, memory, decisions…"
                  className="flex-1 bg-transparent outline-none text-sm py-3"
                  style={{ color: 'rgba(255,255,255,0.85)', minHeight: 44 }}
                />
                {localQuery && (
                  <button
                    type="button"
                    onClick={() => { setLocalQuery(''); clearSearch(); }}
                    className="text-white/30 hover:text-white/60 transition-colors"
                    aria-label="Clear search"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* body */}
            <div className="px-6 pb-8 pt-5">
              {loading && (
                <div className="flex items-center gap-2 py-8 text-white/40 text-sm justify-center">
                  <Loader2 size={16} className="animate-spin" />
                  Loading intelligence hub…
                </div>
              )}
              {error && (
                <div
                  className="mb-4 p-3 rounded-xl text-sm"
                  style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}
                >
                  {error}
                </div>
              )}

              {/* search results (shown when query is active) */}
              {localQuery.length >= 2 && <SearchResults />}

              {/* main sections (hidden when search is active) */}
              {!localQuery && snapshot && (
                <>
                  <VaultCardsSection cards={snapshot.vault_cards} idx={0} />
                  <UserFactsSection facts={snapshot.user_facts} idx={1} />
                  <LessonsSection lessons={snapshot.lessons} idx={2} />
                  <BehaviouralModelSection model={snapshot.behavioural_model} idx={3} />
                  <DecisionsSection decisions={snapshot.recent_decisions} idx={4} />
                  <MemoryFactsSection facts={snapshot.memory_facts} idx={5} />
                </>
              )}

              {!loading && !error && !snapshot && !localQuery && (
                <p className="text-center py-12 text-sm" style={{ color: 'rgba(255,255,255,0.28)' }}>
                  PHANTOM has not built a knowledge model yet. Start a conversation to let it learn.
                </p>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
