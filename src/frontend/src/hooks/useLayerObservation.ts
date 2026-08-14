import { useEffect, useState } from 'react';
import { wsClient, type WSMessage } from '../services/websocket';

/**
 * Коли шар востаннє підтверджували, а не коли він востаннє змінювався.
 *
 * Тасковик віщає лише зміни, тож у мирний час шар мовчить годинами — і без
 * окремого підтвердження клієнт не може відрізнити «спокійно й щойно
 * перевірено» від «не чули нічого з учора». Бекенд віщає `layer_observed`
 * кожен вдалий такт (`geo/live_tasker.py`), без геометрії.
 *
 * Вік рахується від *нашого* часу отримання, а не від часу сервера: телефон
 * і ПК можуть розходитись годинником, а питання тут не «котра година в
 * джерела», а «скільки минуло відтоді, як ми щось чули».
 */

export interface LayerObservation {
  /** Момент за годинником клієнта. 0 — не чули нічого. */
  lastHeardAt: number;
  count: number;
}

export function useLayerObservation(layerId: string): LayerObservation {
  const [observation, setObservation] = useState<LayerObservation>({
    lastHeardAt: 0,
    count: 0,
  });

  useEffect(() => {
    setObservation({ lastHeardAt: 0, count: 0 });
    const unsubscribe = wsClient.on<WSMessage>('map', (msg) => {
      const data = (msg.data ?? {}) as Record<string, unknown>;
      if (String(data.op ?? msg.type ?? '') !== 'layer_observed') return;
      if (data.target !== layerId) return;
      const payload = (data.payload ?? {}) as Record<string, unknown>;
      const count = Number(payload.count ?? 0);
      setObservation({
        lastHeardAt: Date.now(),
        count: Number.isFinite(count) ? count : 0,
      });
    });
    return () => {
      unsubscribe();
    };
  }, [layerId]);

  return observation;
}

/** Годинник, що змушує перемалювати чіп, коли час минув, а даних не було. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
