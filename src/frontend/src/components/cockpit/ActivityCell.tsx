import React from 'react';
import { wsClient, type WSMessage } from '../../services/websocket';
import { CockpitCell, CellWord, hhmmss } from './CockpitCell';

/**
 * «Активність» — живий потік каналу agent.stream.
 *
 * Це активність агентів, і зветься вона активністю (доктрина Ф4:
 * інше слово зарезервоване за реальним джерелом, якого цей канал не
 * несе). Кожна подія — час + тип + слово з корисного вантажу.
 * Стрічка накопичується з відкриття чарунки; фільтр — за типом події.
 * Порожньо → «агенти мовчать». Live-барва — лише поки WS тримається.
 */

const BUFFER_CAP = 200;

export interface ActivityEntry {
  id: number;
  at: Date;
  type: string;
  word: string;
}

/**
 * Слово події: перший осмислений рядок з відомих полів корисного
 * вантажу. Нічого не вигадуємо — нема слова, лишається сам тип.
 */
export function eventWord(payload: Record<string, unknown>): string {
  const candidates = [
    payload.goal,
    payload.intent,
    payload.thought,
    payload.text,
    payload.message,
    payload.reason,
    payload.action_name,
    payload.action,
    payload.status,
    payload.title,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      const s = c.trim();
      return s.length > 140 ? `${s.slice(0, 137)}…` : s;
    }
  }
  return '';
}

let nextEntryId = 1;

export function ActivityCell() {
  const [entries, setEntries] = React.useState<ActivityEntry[]>([]);
  const [filter, setFilter] = React.useState<string>('all');
  const [connected, setConnected] = React.useState<boolean>(wsClient.isConnected);
  const [lastAt, setLastAt] = React.useState<Date | null>(null);

  React.useEffect(() => {
    const offChannel = wsClient.on('agent.stream', (msg: WSMessage) => {
      const at = msg.ts ? new Date(msg.ts) : new Date();
      const entry: ActivityEntry = {
        id: nextEntryId++,
        at,
        type: msg.type,
        word: eventWord(msg.data ?? {}),
      };
      setLastAt(at);
      setEntries((prev) => {
        const next = [entry, ...prev];
        return next.length > BUFFER_CAP ? next.slice(0, BUFFER_CAP) : next;
      });
    });
    const offConnect = wsClient.onConnect(() => setConnected(true));
    const offDisconnect = wsClient.onDisconnect(() => setConnected(false));
    setConnected(wsClient.isConnected);
    return () => {
      offChannel();
      offConnect();
      offDisconnect();
    };
  }, []);

  const seenTypes = React.useMemo(
    () => Array.from(new Set(entries.map((e) => e.type))).sort(),
    [entries],
  );
  const visible = filter === 'all' ? entries : entries.filter((e) => e.type === filter);

  return (
    <CockpitCell
      title="Активність"
      source="Активність · живий канал"
      route="WS agent.stream"
      asOf={lastAt}
      live={connected}
      actions={
        <select
          aria-label="фільтр за типом події"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="text-[11px] rounded-md border px-1.5 py-1 min-h-[44px] max-w-[170px]"
          style={{
            background: 'var(--surface-base)',
            color: 'var(--ink-secondary)',
            borderColor: 'var(--glass-border)',
          }}
        >
          <option value="all">усі типи{entries.length > 0 ? ` (${entries.length})` : ''}</option>
          {seenTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      }
    >
      {entries.length === 0 ? (
        <CellWord>
          агенти мовчать
          {!connected && (
            <>
              <br />
              <span style={{ color: 'var(--ink-muted)' }}>
                зв’язку з ядром нема — потік не тече
              </span>
            </>
          )}
          {connected && (
            <>
              <br />
              <span style={{ color: 'var(--ink-muted)' }}>
                стрічка накопичується з відкриття чарунки — дай агентам завдання, і потік оживе
              </span>
            </>
          )}
        </CellWord>
      ) : visible.length === 0 ? (
        <CellWord>подій типу «{filter}» у стрічці нема</CellWord>
      ) : (
        <ul className="px-3 py-2 space-y-1">
          {visible.map((e) => (
            <li key={e.id} className="flex items-baseline gap-2 text-xs leading-relaxed">
              <span className="font-mono shrink-0" style={{ color: 'var(--ink-muted)' }}>
                {hhmmss(e.at)}
              </span>
              <span
                className="font-mono shrink-0 px-1 rounded border text-[10px]"
                style={{ color: 'var(--accent)', borderColor: 'var(--glass-border)' }}
              >
                {e.type}
              </span>
              <span className="truncate" style={{ color: 'var(--ink-secondary)' }} title={e.word}>
                {e.word || '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </CockpitCell>
  );
}
