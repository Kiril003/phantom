/**
 * Phase 17a — Live Plan Editor.
 *
 * A modal for editing the agent's sub-goal tree while the task is paused.
 * Operations supported (matched to BE PATCH ops):
 *   - reorder (up / down arrows on each row)
 *   - edit (inline contenteditable for description)
 *   - skip (gray out)
 *   - delete (remove)
 *   - inject (add new row at the bottom or via [+] in between)
 *
 * Edits are buffered locally and applied as a single batch on Save → PATCH.
 * Cancel discards. Backend rejects changes for non-paused tasks; we surface
 * its 409 here cleanly.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Save,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
} from 'lucide-react';
import type { AgentSubGoal } from '@shared/types';
import { agentApi } from '../../../services/agentApi';

interface Props {
  open: boolean;
  taskId: string;
  initialSubGoals: AgentSubGoal[];
  onClose: () => void;
  onApplied?: (subGoals: AgentSubGoal[]) => void;
}

type Local = AgentSubGoal & {
  _new?: boolean;
  _deleted?: boolean;
  _editedDescription?: string;
};

function StatusDot({ s }: { s: AgentSubGoal['status'] }) {
  const color =
    s === 'done'
      ? '#0E6A2A'
      : s === 'failed'
      ? '#B9201F'
      : s === 'active'
      ? 'var(--primary, #F4AF25)'
      : s === 'skipped'
      ? '#A6997D'
      : '#7E7460';
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

export function PlanEditor({
  open,
  taskId,
  initialSubGoals,
  onClose,
  onApplied,
}: Props) {
  const [items, setItems] = useState<Local[]>(initialSubGoals.map((sg) => ({ ...sg })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState('');

  useEffect(() => {
    if (open) {
      setItems(initialSubGoals.map((sg) => ({ ...sg })));
      setError(null);
      setNewDraft('');
    }
  }, [open, initialSubGoals]);

  const movableItems = items.filter((it) => !it._deleted);

  const move = (id: string, dir: -1 | 1) => {
    setItems((prev) => {
      const visible = prev.filter((it) => !it._deleted);
      const hiddenAtTail = prev.filter((it) => it._deleted);
      const idx = visible.findIndex((it) => it.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= visible.length) return prev;
      const next = [...visible];
      const [picked] = next.splice(idx, 1);
      next.splice(target, 0, picked);
      return [...next, ...hiddenAtTail];
    });
  };

  const editText = (id: string, text: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === id ? { ...it, _editedDescription: text } : it,
      ),
    );
  };

  const skip = (id: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? { ...it, status: it.status === 'skipped' ? 'pending' : 'skipped' }
          : it,
      ),
    );
  };

  const removeRow = (id: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, _deleted: true } : it)),
    );
  };

  const addNew = () => {
    const text = newDraft.trim();
    if (!text) return;
    const tempId = `new-${Math.random().toString(36).slice(2, 9)}`;
    const sg: Local = {
      id: tempId,
      description: text,
      rationale: '',
      expected_actions: 3,
      status: 'pending',
      acceptance_criteria: '',
      actions_used: 0,
      _new: true,
    };
    setItems((prev) => [...prev, sg]);
    setNewDraft('');
  };

  const buildDiffs = (): Array<Record<string, unknown>> => {
    const diffs: Array<Record<string, unknown>> = [];
    const original = new Map(initialSubGoals.map((sg) => [sg.id, sg]));
    // Deletions and skips first.
    for (const it of items) {
      const orig = original.get(it.id);
      if (it._deleted && orig) {
        diffs.push({ op: 'delete', id: it.id });
        continue;
      }
      if (orig && it.status === 'skipped' && orig.status !== 'skipped') {
        diffs.push({ op: 'skip', id: it.id });
      }
      if (orig && it._editedDescription && it._editedDescription !== orig.description) {
        diffs.push({
          op: 'edit',
          id: it.id,
          description: it._editedDescription,
        });
      }
    }
    // Reorder if existing rows changed order. We compute a reorder once per save.
    const visibleExistingOrder = items
      .filter((it) => !it._deleted && !it._new)
      .map((it) => it.id);
    const originalOrder = initialSubGoals
      .filter((sg) => visibleExistingOrder.includes(sg.id))
      .map((sg) => sg.id);
    if (visibleExistingOrder.join('|') !== originalOrder.join('|')) {
      diffs.push({ op: 'reorder', ids: visibleExistingOrder });
    }
    // Injects last so the position aligns with the post-reorder layout.
    let pos = 0;
    for (const it of items.filter((it) => !it._deleted)) {
      if (it._new) {
        diffs.push({
          op: 'inject',
          description: it._editedDescription ?? it.description,
          position: pos,
          rationale: '',
        });
      }
      pos += 1;
    }
    return diffs;
  };

  const dirty = useMemo(() => buildDiffs().length > 0, [items, initialSubGoals]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const diffs = buildDiffs();
      if (diffs.length === 0) {
        onClose();
        return;
      }
      const resp = await agentApi.patchPlan(taskId, diffs as never);
      onApplied?.(resp.sub_goals);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed to save plan edits';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0"
          style={{
            zIndex: 68,
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
              left: 60,
              right: 60,
              bottom: 24,
              borderRadius: 22,
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow:
                '0 24px 60px rgba(120,70,10,0.32), 0 0 0 1px var(--glass-border)',
            }}
            initial={{ scale: 0.96, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 12 }}
            transition={{ duration: 0.22 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Редагування плану"
          >
            <header
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <span className="eyebrow-amber" style={{ fontSize: 11 }}>
                  ПЛАН АГЕНТА
                </span>
                <h2
                  style={{
                    margin: '4px 0 0 0',
                    fontSize: 18,
                    color: 'var(--ink-strong)',
                  }}
                >
                  Редагуй під-цілі
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  border: '1px solid rgba(180,150,90,0.30)',
                  background: 'transparent',
                  color: 'var(--ink-muted)',
                  cursor: busy ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Закрити редактор"
              >
                <X size={18} />
              </button>
            </header>

            {error && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'rgba(185,32,31,0.10)',
                  color: '#B9201F',
                  fontSize: 12,
                }}
              >
                <AlertTriangle size={14} />
                {error}
              </div>
            )}

            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                paddingRight: 6,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {movableItems.length === 0 && (
                <span
                  style={{
                    textAlign: 'center',
                    color: 'var(--ink-muted)',
                    padding: 16,
                    fontStyle: 'italic',
                  }}
                >
                  Немає під-цілей. Додай нову нижче.
                </span>
              )}
              {movableItems.map((it, idx) => {
                const skipped = it.status === 'skipped';
                const value = it._editedDescription ?? it.description;
                return (
                  <div
                    key={it.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 12,
                      background: it._new
                        ? 'rgba(244,175,37,0.10)'
                        : skipped
                        ? 'rgba(180,150,90,0.10)'
                        : 'rgba(255,255,255,0.55)',
                      border: '1px solid rgba(180,150,90,0.20)',
                      opacity: skipped ? 0.7 : 1,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => move(it.id, -1)}
                        disabled={idx === 0 || busy}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          border: '1px solid rgba(180,150,90,0.25)',
                          background: 'transparent',
                          color: idx === 0 ? 'rgba(180,150,90,0.4)' : 'var(--ink-muted)',
                          cursor: idx === 0 ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        aria-label="Підняти вгору"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(it.id, 1)}
                        disabled={idx === movableItems.length - 1 || busy}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          border: '1px solid rgba(180,150,90,0.25)',
                          background: 'transparent',
                          color:
                            idx === movableItems.length - 1
                              ? 'rgba(180,150,90,0.4)'
                              : 'var(--ink-muted)',
                          cursor:
                            idx === movableItems.length - 1
                              ? 'not-allowed'
                              : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        aria-label="Опустити нижче"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                    <div
                      style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <StatusDot s={it.status} />
                        <input
                          value={value}
                          onChange={(e) => editText(it.id, e.target.value)}
                          style={{
                            flex: 1,
                            padding: '8px 10px',
                            borderRadius: 8,
                            border: '1px solid rgba(180,150,90,0.20)',
                            background: 'rgba(255,255,255,0.65)',
                            fontSize: 13,
                            color: 'var(--ink-strong)',
                            outline: 'none',
                            textDecoration: skipped ? 'line-through' : 'none',
                          }}
                          aria-label="Опис під-цілі"
                          disabled={busy}
                        />
                      </div>
                      {it.rationale && (
                        <span
                          style={{
                            fontSize: 11,
                            color: 'var(--ink-muted)',
                            paddingLeft: 16,
                          }}
                        >
                          {it.rationale}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => skip(it.id)}
                        disabled={busy}
                        title={skipped ? 'Повернути' : 'Пропустити'}
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          border: '1px solid rgba(180,150,90,0.25)',
                          background: 'transparent',
                          color: 'var(--ink-muted)',
                          cursor: busy ? 'wait' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        aria-label={skipped ? 'Повернути' : 'Пропустити'}
                      >
                        {skipped ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRow(it.id)}
                        disabled={busy}
                        title="Видалити"
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          border: '1px solid rgba(185,32,31,0.30)',
                          background: 'rgba(185,32,31,0.06)',
                          color: '#B9201F',
                          cursor: busy ? 'wait' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        aria-label="Видалити"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add new row */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                padding: 10,
                borderRadius: 12,
                background: 'rgba(244,175,37,0.08)',
                border: '1px dashed rgba(244,175,37,0.40)',
              }}
            >
              <Plus size={16} color="var(--primary, #F4AF25)" />
              <input
                value={newDraft}
                onChange={(e) => setNewDraft(e.target.value)}
                placeholder="Нова під-ціль…"
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(180,150,90,0.20)',
                  background: 'rgba(255,255,255,0.70)',
                  fontSize: 13,
                  outline: 'none',
                  color: 'var(--ink-strong)',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addNew();
                }}
                disabled={busy}
              />
              <button
                type="button"
                onClick={addNew}
                disabled={busy || !newDraft.trim()}
                style={{
                  minHeight: 44,
                  padding: '0 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(168,118,18,0.30)',
                  background: 'rgba(244,175,37,0.20)',
                  color: '#A36F1F',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: busy || !newDraft.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                Додати
              </button>
            </div>

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 4,
              }}
            >
              <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                {dirty ? 'Зміни не збережено' : 'Без змін'}
              </span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  style={{
                    minHeight: 44,
                    padding: '0 16px',
                    borderRadius: 12,
                    background: 'transparent',
                    border: '1px solid rgba(180,150,90,0.30)',
                    color: 'var(--ink-muted)',
                    fontSize: 13,
                    cursor: busy ? 'wait' : 'pointer',
                  }}
                >
                  Скасувати
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={busy || !dirty}
                  style={{
                    minHeight: 44,
                    padding: '0 18px',
                    borderRadius: 12,
                    background:
                      dirty && !busy
                        ? 'linear-gradient(180deg, var(--primary, #F4AF25) 0%, #E89A1C 100%)'
                        : 'rgba(180,150,90,0.18)',
                    border: `1px solid ${
                      dirty ? 'rgba(168,118,18,0.45)' : 'rgba(180,150,90,0.20)'
                    }`,
                    color: dirty && !busy ? '#1F1308' : 'var(--ink-muted)',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: dirty && !busy ? 'pointer' : 'not-allowed',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Save size={16} />
                  Зберегти
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
