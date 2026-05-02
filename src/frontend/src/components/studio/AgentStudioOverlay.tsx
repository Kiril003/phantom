/**
 * Phase 17b — AgentStudioOverlay.
 *
 * Single mounted overlay that hosts the saved-agents library + the visual
 * builder. Toggled via uiStore.studioOpen (or directly via prop). Sized to
 * fit 1024×600 with no main-screen scroll.
 *
 * Two views: list (default) ↔ editor. Editor opens when:
 *   • user taps "+ Новий агент" (blank draft), or
 *   • user taps "Редагувати" on a row (load existing).
 *
 * Run-time inputs are gathered through AgentRunDialog (see file). The
 * conversational builder lives in DialogueLayout — this overlay shows the
 * saved-agent set + visual editor.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Plus,
  Play,
  Edit3,
  Copy,
  Trash2,
  Save,
  ArrowLeft,
  History,
  AlertTriangle,
  Search,
  ChevronRight,
} from 'lucide-react';
import type {
  AgentCardKind,
  CardCategory,
  CustomAgent,
} from '@shared/types';
import { useStudioStore } from '../../stores/studioStore';
import { AgentRunDialog } from './AgentRunDialog';

interface Props {
  open: boolean;
  onClose: () => void;
}

type View = 'library' | 'editor';

const CATEGORY_ORDER: CardCategory[] = [
  'source',
  'transform',
  'decision',
  'output',
  'council',
];

const CATEGORY_LABEL: Record<CardCategory, string> = {
  source: 'Джерела',
  transform: 'Трансформації',
  decision: 'Рішення',
  output: 'Виходи',
  council: 'Рада',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('uk-UA', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function LibraryView({
  onEdit,
  onNew,
  onRun,
  onClose,
}: {
  onEdit: (a: CustomAgent) => void;
  onNew: () => void;
  onRun: (a: CustomAgent) => void;
  onClose: () => void;
}) {
  const agents = useStudioStore((s) => s.agents);
  const loading = useStudioStore((s) => s.loadingAgents);
  const error = useStudioStore((s) => s.agentsError);
  const loadAgents = useStudioStore((s) => s.loadAgents);
  const removeAgent = useStudioStore((s) => s.removeAgent);
  const cloneAgent = useStudioStore((s) => s.cloneAgent);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const filtered = useMemo(() => {
    if (!query) return agents;
    return agents.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));
  }, [agents, query]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 12 }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span className="eyebrow-amber" style={{ fontSize: 11 }}>
            AGENT STUDIO
          </span>
          <h2 style={{ margin: '4px 0 0 0', fontSize: 20, color: 'var(--ink-strong)' }}>
            Твої агенти
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onNew}
            style={{
              minHeight: 44,
              padding: '0 16px',
              borderRadius: 12,
              background: 'linear-gradient(180deg, var(--primary, #F4AF25) 0%, #E89A1C 100%)',
              border: '1px solid rgba(168,118,18,0.45)',
              color: '#1F1308',
              fontSize: 13,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
            }}
          >
            <Plus size={16} />
            Новий агент
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              border: '1px solid rgba(180,150,90,0.30)',
              background: 'transparent',
              color: 'var(--ink-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Закрити Studio"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 12px',
          borderRadius: 999,
          border: '1px solid rgba(180,150,90,0.25)',
          background: 'rgba(255,255,255,0.55)',
        }}
      >
        <Search size={14} color="var(--ink-muted)" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Пошук агентів"
          style={{
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontSize: 13,
            color: 'var(--ink-strong)',
            flex: 1,
            padding: '6px 0',
          }}
        />
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 10,
          paddingRight: 6,
        }}
      >
        {loading && (
          <div style={{ color: 'var(--ink-muted)', padding: 16 }}>Завантажую…</div>
        )}
        {error && (
          <div style={{ color: '#B9201F', padding: 12 }}>{error}</div>
        )}
        {!loading && filtered.length === 0 && !error && (
          <div
            style={{
              gridColumn: '1 / -1',
              textAlign: 'center',
              padding: 32,
              color: 'var(--ink-muted)',
              fontStyle: 'italic',
            }}
          >
            Поки нема жодного агента. Натисни «Новий агент» або скажи в чаті:
            «Створи мені агента, який…».
          </div>
        )}
        {filtered.map((a) => (
          <div
            key={a.id}
            style={{
              padding: 14,
              borderRadius: 14,
              background: 'rgba(255,255,255,0.55)',
              border: '1px solid rgba(180,150,90,0.20)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              minHeight: 150,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: 'var(--ink-strong)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {a.avatar ? `${a.avatar} ` : ''}
                  {a.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>
                  {a.cards.length} карток · {a.recipients.length} адресатів · {a.schedule.kind}
                </div>
              </div>
              <span
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: a.enabled ? '#0E6A2A' : '#A36F1F',
                }}
              >
                {a.enabled ? 'Увімкнено' : 'Вимкнено'}
              </span>
            </div>
            {a.description && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--ink-muted)',
                  lineHeight: 1.35,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {a.description}
              </div>
            )}
            <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--ink-faint)' }}>
              <span>
                <History
                  size={11}
                  style={{ verticalAlign: 'middle', marginRight: 4 }}
                />
                {fmtDate(a.last_run_at)}
              </span>
              <span>
                {a.run_count} прогонів · {Math.round((a.run_count > 0 ? a.success_count / a.run_count : 0) * 100)}% ✓
              </span>
            </div>
            <div
              style={{
                marginTop: 'auto',
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={() => onRun(a)}
                style={{
                  flex: 1,
                  minHeight: 38,
                  padding: '0 12px',
                  borderRadius: 10,
                  background: 'linear-gradient(180deg, var(--primary, #F4AF25) 0%, #E89A1C 100%)',
                  border: '1px solid rgba(168,118,18,0.45)',
                  color: '#1F1308',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                }}
              >
                <Play size={12} /> Запустити
              </button>
              <button
                type="button"
                onClick={() => onEdit(a)}
                style={{
                  minHeight: 38,
                  padding: '0 10px',
                  borderRadius: 10,
                  background: 'transparent',
                  border: '1px solid rgba(180,150,90,0.30)',
                  color: 'var(--ink-strong)',
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                aria-label="Редагувати"
              >
                <Edit3 size={12} />
              </button>
              <button
                type="button"
                onClick={() => void cloneAgent(a.id)}
                style={{
                  minHeight: 38,
                  padding: '0 10px',
                  borderRadius: 10,
                  background: 'transparent',
                  border: '1px solid rgba(180,150,90,0.30)',
                  color: 'var(--ink-strong)',
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                aria-label="Клонувати"
              >
                <Copy size={12} />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Видалити агента «${a.name}»?`)) {
                    void removeAgent(a.id);
                  }
                }}
                style={{
                  minHeight: 38,
                  padding: '0 10px',
                  borderRadius: 10,
                  background: 'rgba(185,32,31,0.06)',
                  border: '1px solid rgba(185,32,31,0.30)',
                  color: '#B9201F',
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                aria-label="Видалити"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditorView({ onBack }: { onBack: () => void }) {
  const draft = useStudioStore((s) => s.draft);
  const catalog = useStudioStore((s) => s.catalog);
  const loadCatalog = useStudioStore((s) => s.loadCatalog);
  const setDraft = useStudioStore((s) => s.setDraft);
  const addCard = useStudioStore((s) => s.addCard);
  const updateCard = useStudioStore((s) => s.updateCard);
  const removeCard = useStudioStore((s) => s.removeCard);
  const selectedCardId = useStudioStore((s) => s.selectedCardId);
  const selectCard = useStudioStore((s) => s.selectCard);
  const saveDraft = useStudioStore((s) => s.saveDraft);
  const saveBusy = useStudioStore((s) => s.saveBusy);
  const saveError = useStudioStore((s) => s.saveError);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  if (!draft) return null;

  const selectedCard = draft.cards.find((c) => c.id === selectedCardId) ?? null;
  const selectedEntry = selectedCard
    ? catalog.find((c) => c.kind === selectedCard.kind) ?? null
    : null;

  const groupedCatalog = CATEGORY_ORDER.map((cat) => ({
    cat,
    entries: catalog.filter((e) => e.category === cat),
  }));

  const handleSave = async () => {
    const saved = await saveDraft();
    if (saved) onBack();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 10 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            border: '1px solid rgba(180,150,90,0.30)',
            background: 'transparent',
            color: 'var(--ink-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="eyebrow-amber" style={{ fontSize: 11 }}>
            КОНСТРУКТОР АГЕНТА
          </span>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ name: e.target.value })}
            placeholder="Імʼя агента"
            style={{
              width: '100%',
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--ink-strong)',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              padding: '4px 0',
            }}
          />
        </div>
        {saveError && (
          <span style={{ color: '#B9201F', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <AlertTriangle size={12} /> {saveError}
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saveBusy}
          style={{
            minHeight: 44,
            padding: '0 18px',
            borderRadius: 12,
            background: 'linear-gradient(180deg, var(--primary, #F4AF25) 0%, #E89A1C 100%)',
            border: '1px solid rgba(168,118,18,0.45)',
            color: '#1F1308',
            fontSize: 13,
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            cursor: saveBusy ? 'wait' : 'pointer',
          }}
        >
          <Save size={14} /> Зберегти
        </button>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '180px 1fr 240px',
          gap: 10,
        }}
      >
        {/* Catalog palette */}
        <aside
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 8,
            borderRadius: 12,
            border: '1px solid rgba(180,150,90,0.20)',
            background: 'rgba(255,255,255,0.45)',
            overflowY: 'auto',
          }}
        >
          <span className="eyebrow-amber" style={{ fontSize: 10 }}>
            КАРТКИ
          </span>
          {groupedCatalog.map(({ cat, entries }) => (
            <div key={cat} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-muted)',
                }}
              >
                {CATEGORY_LABEL[cat]}
              </span>
              {entries.map((e) => (
                <button
                  key={e.kind}
                  type="button"
                  onClick={() => addCard(e.kind as AgentCardKind)}
                  style={{
                    textAlign: 'left',
                    padding: '6px 8px',
                    borderRadius: 8,
                    border: '1px solid rgba(180,150,90,0.18)',
                    background: 'rgba(255,255,255,0.65)',
                    fontSize: 12,
                    color: 'var(--ink-strong)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.title}
                  </span>
                  <Plus size={12} color="var(--ink-muted)" />
                </button>
              ))}
            </div>
          ))}
        </aside>

        {/* Canvas — vertical chain of cards */}
        <main
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: 12,
            borderRadius: 12,
            border: '1px solid rgba(180,150,90,0.20)',
            background: 'rgba(255,255,255,0.40)',
            overflowY: 'auto',
          }}
        >
          {draft.cards.length === 0 && (
            <div
              style={{
                margin: 'auto',
                padding: 24,
                textAlign: 'center',
                color: 'var(--ink-muted)',
                fontStyle: 'italic',
              }}
            >
              Перетягни картку зліва, щоб додати поведінку.
            </div>
          )}
          {draft.cards.map((card, idx) => {
            const selected = card.id === selectedCardId;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => selectCard(card.id)}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: `1px solid ${
                    selected ? 'rgba(244,175,37,0.55)' : 'rgba(180,150,90,0.20)'
                  }`,
                  background: selected
                    ? 'rgba(244,175,37,0.14)'
                    : 'rgba(255,255,255,0.65)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  boxShadow: selected ? '0 8px 22px rgba(244,175,37,0.25)' : 'none',
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    background: 'rgba(255,255,255,0.85)',
                    border: '1px solid rgba(180,150,90,0.20)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--ink-muted)',
                  }}
                >
                  {idx + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-strong)' }}>
                    {card.title || card.kind}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--ink-muted)' }}>
                    {card.category} · {card.kind}
                  </div>
                </div>
                <ChevronRight size={14} color="var(--ink-muted)" />
              </button>
            );
          })}
        </main>

        {/* Inspector */}
        <aside
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 12,
            borderRadius: 12,
            border: '1px solid rgba(180,150,90,0.20)',
            background: 'rgba(255,255,255,0.45)',
            overflowY: 'auto',
          }}
        >
          {selectedCard && selectedEntry ? (
            <>
              <span className="eyebrow-amber" style={{ fontSize: 10 }}>
                {selectedEntry.title}
              </span>
              <input
                value={selectedCard.title}
                onChange={(e) => updateCard(selectedCard.id, { title: e.target.value })}
                placeholder="Назва картки"
                style={{
                  padding: '6px 8px',
                  borderRadius: 8,
                  border: '1px solid rgba(180,150,90,0.20)',
                  background: 'rgba(255,255,255,0.65)',
                  fontSize: 13,
                  color: 'var(--ink-strong)',
                  outline: 'none',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                {selectedEntry.description}
              </span>
              {selectedEntry.config_schema.map((field) => {
                const value = (selectedCard.config?.[field.key] ?? '') as string;
                if (field.kind === 'textarea') {
                  return (
                    <textarea
                      key={field.key}
                      value={String(value)}
                      onChange={(e) =>
                        updateCard(selectedCard.id, {
                          config: { ...selectedCard.config, [field.key]: e.target.value },
                        })
                      }
                      placeholder={field.placeholder ?? field.label}
                      style={{
                        minHeight: 60,
                        padding: 8,
                        borderRadius: 8,
                        border: '1px solid rgba(180,150,90,0.20)',
                        fontSize: 12,
                        background: 'rgba(255,255,255,0.65)',
                        color: 'var(--ink-strong)',
                        outline: 'none',
                        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                      }}
                    />
                  );
                }
                if (field.kind === 'bool') {
                  return (
                    <label
                      key={field.key}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 12,
                        color: 'var(--ink-strong)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(selectedCard.config?.[field.key])}
                        onChange={(e) =>
                          updateCard(selectedCard.id, {
                            config: { ...selectedCard.config, [field.key]: e.target.checked },
                          })
                        }
                      />
                      {field.label}
                    </label>
                  );
                }
                if (field.kind === 'select') {
                  return (
                    <label
                      key={field.key}
                      style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'flex', flexDirection: 'column', gap: 2 }}
                    >
                      {field.label}
                      <select
                        value={String(value)}
                        onChange={(e) =>
                          updateCard(selectedCard.id, {
                            config: { ...selectedCard.config, [field.key]: e.target.value },
                          })
                        }
                        style={{
                          padding: '6px 8px',
                          borderRadius: 8,
                          border: '1px solid rgba(180,150,90,0.20)',
                          background: 'rgba(255,255,255,0.65)',
                          fontSize: 12,
                          color: 'var(--ink-strong)',
                          outline: 'none',
                        }}
                      >
                        <option value="">…</option>
                        {field.options?.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                }
                if (field.kind === 'number') {
                  return (
                    <label
                      key={field.key}
                      style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'flex', flexDirection: 'column', gap: 2 }}
                    >
                      {field.label}
                      <input
                        type="number"
                        value={Number((selectedCard.config?.[field.key] as number) ?? 0)}
                        onChange={(e) =>
                          updateCard(selectedCard.id, {
                            config: { ...selectedCard.config, [field.key]: Number(e.target.value) },
                          })
                        }
                        style={{
                          padding: '6px 8px',
                          borderRadius: 8,
                          border: '1px solid rgba(180,150,90,0.20)',
                          background: 'rgba(255,255,255,0.65)',
                          fontSize: 12,
                          color: 'var(--ink-strong)',
                          outline: 'none',
                        }}
                      />
                    </label>
                  );
                }
                // text fallback
                return (
                  <label
                    key={field.key}
                    style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'flex', flexDirection: 'column', gap: 2 }}
                  >
                    {field.label}
                    <input
                      value={String(value)}
                      onChange={(e) =>
                        updateCard(selectedCard.id, {
                          config: { ...selectedCard.config, [field.key]: e.target.value },
                        })
                      }
                      placeholder={field.placeholder}
                      style={{
                        padding: '6px 8px',
                        borderRadius: 8,
                        border: '1px solid rgba(180,150,90,0.20)',
                        background: 'rgba(255,255,255,0.65)',
                        fontSize: 12,
                        color: 'var(--ink-strong)',
                        outline: 'none',
                      }}
                    />
                  </label>
                );
              })}
              <button
                type="button"
                onClick={() => removeCard(selectedCard.id)}
                style={{
                  marginTop: 8,
                  minHeight: 38,
                  padding: '0 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(185,32,31,0.30)',
                  background: 'rgba(185,32,31,0.06)',
                  color: '#B9201F',
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  justifyContent: 'center',
                }}
              >
                <Trash2 size={12} /> Видалити картку
              </button>
            </>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--ink-muted)', fontStyle: 'italic' }}>
              Виділи картку, щоб налаштувати.
            </span>
          )}
          <hr style={{ border: 'none', borderTop: '1px solid rgba(180,150,90,0.20)', margin: '8px 0' }} />
          <span className="eyebrow-amber" style={{ fontSize: 10 }}>МЕТА</span>
          <textarea
            value={draft.goal_template}
            onChange={(e) => setDraft({ goal_template: e.target.value })}
            placeholder="Шаблон цілі (підтримує {{date}}, {{user.name}})"
            style={{
              minHeight: 60,
              padding: 8,
              borderRadius: 8,
              border: '1px solid rgba(180,150,90,0.20)',
              background: 'rgba(255,255,255,0.65)',
              fontSize: 12,
              color: 'var(--ink-strong)',
              outline: 'none',
            }}
          />
        </aside>
      </div>
    </div>
  );
}

export function AgentStudioOverlay({ open, onClose }: Props) {
  const [view, setView] = useState<View>('library');
  const [runFor, setRunFor] = useState<CustomAgent | null>(null);

  const startNewDraft = useStudioStore((s) => s.startNewDraft);
  const loadDraftFromAgent = useStudioStore((s) => s.loadDraftFromAgent);

  useEffect(() => {
    if (!open) {
      setView('library');
      setRunFor(null);
    }
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0"
          style={{
            zIndex: 67,
            background: 'rgba(28,22,14,0.55)',
            backdropFilter: 'blur(10px)',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            className="glass-strong"
            style={{
              position: 'absolute',
              top: 24,
              left: 24,
              right: 24,
              bottom: 24,
              borderRadius: 22,
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow:
                '0 30px 70px rgba(120,70,10,0.36), 0 0 0 1px var(--glass-border)',
            }}
            initial={{ scale: 0.97, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 12 }}
            transition={{ duration: 0.22 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Agent Studio"
          >
            {view === 'library' && (
              <LibraryView
                onClose={onClose}
                onNew={() => {
                  startNewDraft();
                  setView('editor');
                }}
                onEdit={(a) => {
                  loadDraftFromAgent(a);
                  setView('editor');
                }}
                onRun={(a) => setRunFor(a)}
              />
            )}
            {view === 'editor' && <EditorView onBack={() => setView('library')} />}
          </motion.div>

          {runFor && (
            <AgentRunDialog
              agent={runFor}
              onClose={() => setRunFor(null)}
              onLaunched={() => setRunFor(null)}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
