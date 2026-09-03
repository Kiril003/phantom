import { useEffect, useRef, useState } from 'react';
import type { AgentTaskStatus, AgentTaskSummary, AgentTrack } from '@shared/types';
import { wsClient, type WSMessage } from '../../services/websocket';

/**
 * Живлення пейна «Компанія» з каналу `background_events`.
 *
 * ЧОМУ окремий модуль, а не ще сто рядків у пейні: тут дві речі, які
 * мусять перевірятися окремо від малювання — чиста функція, що звертає
 * подію в рядок списку, і підписка, що знає лише про зʼєднання. Пейн
 * лишається про вигляд.
 *
 * ЧОМУ взагалі: ядро шле делеговане в `background_events`
 * (agent/kernel/runtime.py:531 — `hub.broadcast("background_events", …)`),
 * а підписників на цьому каналі не було жодного — рядок у тип-юніоні
 * `WSChannel` і все. Людина делегувала роботу і не бачила її ніде, доки
 * не тиснула «оновити». Пейн був знімком, а не потоком.
 *
 * ЧОГО ТУТ НЕМА: вигадок. У рядок іде тільки те, що приїхало в події.
 * Ціль, доріжка, батьківський прогін, роль — з payload; час — з `ts`
 * самого повідомлення, який ставить вузол (api/websocket_hub.py:77).
 * Статус `running` — не здогад: `task.started` ядро шле в тій самій
 * точці, де пише `status="running"` у базу (agent/kernel/loop.py:857).
 */

/** Термінальні події каналу → статус, який ядро в цю мить пише в базу.
 *  Перелік дослівний з `_BACKGROUND_ALLOWED_EVENTS` (runtime.py:84). */
const TERMINAL_STATUS: Record<string, AgentTaskStatus> = {
  'task.completed': 'done',
  'task.failed': 'failed',
  'task.stopped': 'stopped',
  'task.timeout': 'timeout',
};

/** Слід делегування — рівно те, що несе `task.started`, і нічого понад.
 *  У списку з API цих полів нема взагалі, тож єдине джерело — потік. */
export interface DelegationMark {
  parentTaskId: string | null;
  role: string | null;
}

export interface StreamPatch {
  /** Оновлений список; null — подія списку не змінила. */
  tasks: AgentTaskSummary[] | null;
  /** Подія про прогін, якого в списку нема. Списком це не полагодити —
   *  ціль нам ніхто не називав, вигадувати її не будемо. Треба перепитати
   *  ядро. */
  needsReconcile: boolean;
  /** Слід делегування; null — подія його не несла. */
  delegation: ({ taskId: string } & DelegationMark) | null;
}

const NOTHING: StreamPatch = { tasks: null, needsReconcile: false, delegation: null };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Подія каналу → новий список прогонів.
 *
 * Спостережні події (`substate.changed`, `action.started` тощо) списку не
 * чіпають: вони доводять, що канал живий, але нового прогону не оголошують.
 */
export function applyBackgroundEvent(
  prev: AgentTaskSummary[] | null,
  msg: WSMessage,
): StreamPatch {
  const data = (msg.data ?? {}) as Record<string, unknown>;
  const taskId = str(data.task_id);
  if (!taskId) return NOTHING;
  const atIso = new Date(typeof msg.ts === 'number' ? msg.ts : Date.now()).toISOString();

  if (msg.type === 'task.started') {
    const list = prev ?? [];
    const goal = str(data.goal);
    const track: AgentTrack = data.track === 'foreground' ? 'foreground' : 'background';
    const idx = list.findIndex((t) => t.id === taskId);
    const row: AgentTaskSummary =
      idx >= 0
        ? {
            ...list[idx],
            // Перезапуск того самого прогону: статус і доріжка — з події,
            // ціль лишаємо стару, якщо подія свою не принесла.
            goal: goal ?? list[idx].goal,
            status: 'running',
            track,
            paused_reason: null,
            error: null,
            finished_at: null,
          }
        : {
            id: taskId,
            goal: goal ?? '',
            status: 'running',
            track,
            paused_reason: null,
            error: null,
            // Час приходу події, не рядок з бази. Наступний знімок
            // перепише авторитетним значенням — розбіжність тут у межах
            // мережевої затримки, і вона названа саме так.
            created_at: atIso,
            finished_at: null,
          };
    const parentTaskId = str(data.parent_task_id);
    return {
      tasks: idx >= 0 ? list.map((t, i) => (i === idx ? row : t)) : [row, ...list],
      needsReconcile: false,
      // «Делеговано» кажемо лише коли ядро назвало батька. Фонового
      // прогону без батька так звати не можна — це не те саме.
      delegation: parentTaskId
        ? { taskId, parentTaskId, role: str(data.subagent_role) }
        : null,
    };
  }

  const status = TERMINAL_STATUS[msg.type];
  if (status) {
    const list = prev ?? [];
    const idx = list.findIndex((t) => t.id === taskId);
    if (idx < 0) return { tasks: null, needsReconcile: true, delegation: null };
    return {
      tasks: list.map((t, i) =>
        i === idx ? { ...t, status, error: str(data.error), finished_at: atIso } : t,
      ),
      needsReconcile: false,
      delegation: null,
    };
  }

  return NOTHING;
}

export function hhmm(d: Date): string {
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Слово свіжості. Обрив і порожнеча — різні стани, і жоден із них не
 * має права виглядати як свіжий знімок. Поки канал тримається — кажемо
 * про потік; щойно обірвався — кажемо, що показане застигло, і коли саме.
 */
export function freshnessWord(args: {
  connected: boolean;
  lastEventAt: Date | null;
  loadedAt: Date | null;
}): string {
  const { connected, lastEventAt, loadedAt } = args;
  if (!connected) {
    return loadedAt
      ? `потік обірвано · показане застигло на ${hhmm(loadedAt)}`
      : 'потік обірвано · знімка ще не було';
  }
  if (lastEventAt) return `потік · остання подія ${hhmm(lastEventAt)}`;
  return loadedAt
    ? `потік підключено · знімок ${hhmm(loadedAt)}`
    : 'потік підключено · знімка ще не було';
}

/**
 * Підписка на `background_events` плюс чесний стан зʼєднання.
 *
 * Стан беремо з того самого клієнта, що й «Активність» у Кокпіті
 * (components/cockpit/ActivityCell.tsx:73) — `onConnect`/`onDisconnect`
 * плюс синхронне читання при монтуванні, бо подія підключення могла
 * статися до того, як пейн відкрили.
 */
export function useBackgroundStream(onEvent: (msg: WSMessage) => void): {
  connected: boolean;
  lastEventAt: Date | null;
} {
  const [connected, setConnected] = useState<boolean>(() => wsClient.isConnected);
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const handler = useRef(onEvent);

  // Свіжий обробник без перепідписки: інакше кожен рендер пейна рвав би
  // канал і на мить робив його глухим.
  useEffect(() => {
    handler.current = onEvent;
  });

  useEffect(() => {
    const offChannel = wsClient.on('background_events', (msg: WSMessage) => {
      setLastEventAt(typeof msg.ts === 'number' ? new Date(msg.ts) : new Date());
      handler.current(msg);
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

  return { connected, lastEventAt };
}
