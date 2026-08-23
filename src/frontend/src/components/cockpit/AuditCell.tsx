import React from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchAuditPage, type AuditEntry } from '../../services/cockpitApi';
import { CockpitCell, CellWord, hhmmss } from './CockpitCell';

/**
 * «Аудит» — журнал дій виконавця, з пагінацією.
 *
 * Джерело справжнє: таблиця agent_audit, у яку пише і когнітивний
 * рантайм, і record_tool_invocation на кожному шляху chat-tool.
 * Читається через GET /api/v1/cockpit/audit курсором before_id;
 * «показати ще» догортає старіші сторінки, «оновити» перечитує
 * з вершини. Порожній журнал — чесне слово, не порожня таблиця.
 */

const PAGE_SIZE = 25;

type Load =
  | { s: 'reading' }
  | { s: 'ok'; at: Date }
  | { s: 'unreachable' }
  | { s: 'unauthorized' };

const STATUS_WORD: Record<AuditEntry['status'], string> = {
  ok: 'ок',
  retry: 'повтор',
  fail: 'провал',
};

const STATUS_COLOR: Record<AuditEntry['status'], string> = {
  ok: 'text-emerald-400',
  retry: 'text-amber-400',
  fail: 'text-rose-400',
};

export function AuditCell() {
  const [load, setLoad] = React.useState<Load>({ s: 'reading' });
  const [entries, setEntries] = React.useState<AuditEntry[]>([]);
  const [total, setTotal] = React.useState<number | null>(null);
  const [nextBeforeId, setNextBeforeId] = React.useState<number | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);

  const readTop = React.useCallback(async () => {
    setLoad({ s: 'reading' });
    const pulse = await fetchAuditPage({ limit: PAGE_SIZE });
    if (pulse.ok) {
      setEntries(pulse.data.entries);
      setTotal(pulse.data.total);
      setNextBeforeId(pulse.data.next_before_id);
      setLoad({ s: 'ok', at: new Date() });
    } else {
      setLoad(pulse.reason === 'unauthorized' ? { s: 'unauthorized' } : { s: 'unreachable' });
    }
  }, []);

  React.useEffect(() => {
    void readTop();
  }, [readTop]);

  const loadMore = React.useCallback(async () => {
    if (nextBeforeId === null) return;
    setLoadingMore(true);
    const pulse = await fetchAuditPage({ limit: PAGE_SIZE, beforeId: nextBeforeId });
    setLoadingMore(false);
    if (pulse.ok) {
      setEntries((prev) => [...prev, ...pulse.data.entries]);
      setTotal(pulse.data.total);
      setNextBeforeId(pulse.data.next_before_id);
    }
  }, [nextBeforeId]);

  return (
    <CockpitCell
      title="Аудит"
      source={total !== null ? `agent_audit · ${total} записів` : 'agent_audit'}
      asOf={load.s === 'ok' ? load.at : null}
      actions={
        <button
          type="button"
          onClick={() => void readTop()}
          aria-label="оновити журнал"
          className="p-1.5 rounded-md border min-h-[44px] min-w-[44px] flex items-center justify-center"
          style={{ borderColor: 'var(--glass-border)', color: 'var(--ink-muted)' }}
        >
          <RefreshCw size={13} className={load.s === 'reading' ? 'animate-spin' : ''} />
        </button>
      }
    >
      {load.s === 'reading' && entries.length === 0 && <CellWord>читаю журнал…</CellWord>}
      {load.s === 'unauthorized' && (
        <CellWord>журнал відповідає лише операторам — цьому користувачу джерело мовчить</CellWord>
      )}
      {load.s === 'unreachable' && (
        <CellWord>ядро недоступне — журнал аудиту не прочитати</CellWord>
      )}
      {load.s === 'ok' && entries.length === 0 && (
        <CellWord>
          журнал порожній — виконавець ще не записав жодної дії
          <br />
          <span style={{ color: 'var(--ink-muted)' }}>
            кожен виклик інструмента чи крок агента з’явиться тут
          </span>
        </CellWord>
      )}
      {entries.length > 0 && (
        <div className="px-3 py-2">
          <ul className="space-y-1">
            {entries.map((e) => (
              <li key={e.id} className="flex items-baseline gap-2 text-xs leading-relaxed">
                <span className="font-mono shrink-0" style={{ color: 'var(--ink-muted)' }}>
                  {e.ts_ms !== null ? hhmmss(new Date(e.ts_ms)) : '—'}
                </span>
                <span className={`shrink-0 font-medium ${STATUS_COLOR[e.status]}`}>
                  {STATUS_WORD[e.status]}
                </span>
                <span className="font-mono shrink-0" style={{ color: 'var(--ink-primary)' }}>
                  {e.action_name}
                </span>
                <span className="truncate" style={{ color: 'var(--ink-muted)' }} title={e.intent ?? ''}>
                  {e.intent ?? ''}
                </span>
                <span className="font-mono shrink-0 ml-auto" style={{ color: 'var(--ink-faint)' }}>
                  {e.elapsed_ms} мс
                </span>
              </li>
            ))}
          </ul>
          {nextBeforeId !== null ? (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="mt-2 w-full text-xs py-2 min-h-[44px] rounded-lg border"
              style={{ borderColor: 'var(--glass-border)', color: 'var(--ink-secondary)' }}
            >
              {loadingMore ? 'читаю…' : 'показати старіші'}
            </button>
          ) : (
            <div className="mt-2 text-center text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              журнал вичерпано
            </div>
          )}
        </div>
      )}
    </CockpitCell>
  );
}
