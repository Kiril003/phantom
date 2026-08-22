/**
 * Щоб дзвінок було чути й видно навіть тоді, коли вкладка не активна.
 *
 * Три канали, і жоден із них не вигаданий: рінгтон з осциляторів, блимання
 * тайтла вкладки і — якщо на це є дозвіл браузера — системний банер. Усе троє
 * стихає на одному й тому ж: слухавку взяли, скинули або зв'язок не встав.
 */

import { useEffect } from 'react';
import { callEngine } from '../services/callEngine';
import { notificationPrefs } from '../services/notificationPrefs';
import { callRingtone } from '../utils/callRingtone';

const BLINK_MS = 900;

export function useCallAlerts(): void {
  useEffect(() => {
    const baseTitle = document.title;
    let blink: ReturnType<typeof setInterval> | null = null;
    let banner: Notification | null = null;
    // Стан рушія оновлюється і заради статистики; реагуємо лише на зміну фази.
    let phase = '';

    const quiet = () => {
      callRingtone.stop();
      if (blink) clearInterval(blink);
      blink = null;
      document.title = baseTitle;
      try {
        banner?.close();
      } catch {
        /* банер уже закрили руками */
      }
      banner = null;
    };

    const apply = () => {
      const snapshot = callEngine.getSnapshot();
      const next = `${snapshot.state}:${snapshot.callId ?? ''}`;
      if (next === phase) return;
      phase = next;
      quiet();

      if (snapshot.state === 'ringing') {
        const name = snapshot.peer?.displayName || 'Невідомий вузол';
        const headline = `Дзвінок від ${name}`;
        callRingtone.startIncoming();
        document.title = headline;
        let shown = true;
        blink = setInterval(() => {
          shown = !shown;
          document.title = shown ? headline : baseTitle;
        }, BLINK_MS);
        banner = notificationPrefs.show(headline, {
          body: snapshot.media === 'video' ? 'Вхідний відеодзвінок' : 'Вхідний дзвінок',
          tag: snapshot.callId ?? 'phantom-call',
          requireInteraction: true,
        });
        if (banner) {
          banner.onclick = () => {
            window.focus();
            banner?.close();
          };
        }
        return;
      }

      if (snapshot.state === 'calling') callRingtone.startOutgoing();
    };

    apply();
    const off = callEngine.subscribe(apply);
    return () => {
      off();
      quiet();
    };
  }, []);
}
