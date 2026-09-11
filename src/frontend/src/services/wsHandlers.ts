/**
 * wsHandlers — central place to wire WebSocket channels into stores.
 *
 * Phase-5 R1-FAMILIAR-1 introduces this file because the existing WS
 * subscribers live inline inside `providers.tsx` (sensor / state / oled);
 * keeping the Familiar wiring next to them would force every future
 * channel to grow that already-busy file. New channels should land here
 * instead — `providers.tsx` only needs to call `registerWsHandlers()`
 * once after `wsClient.connect()`.
 *
 * Currently wires:
 *   - `familiar` channel → `familiarStore.manifest('ai-summon', …)`
 */
import { wsClient } from './websocket';
import { registerTtsPlayerWsHandler } from './ttsPlayer';
import { useFamiliarStore } from '../stores/familiarStore';
import { useUIStore } from '../stores/uiStore';
import { useBakeStore } from '../stores/bakeStore';
import type {
  BakeSnapshot,
  FamiliarPose,
  FamiliarTarget,
} from '@shared/types';

interface FamiliarManifestationWsPayload {
  pose?: FamiliarPose;
  message?: string | null;
  duration_ms?: number | null;
  target?:
    | (FamiliarTarget & Record<string, unknown>)
    | null;
}

const VALID_POSES: ReadonlyArray<FamiliarPose> = [
  'idle',
  'floating',
  'pointing',
  'peeking',
  'sleeping',
  'waving',
  'vanishing',
];

function coerceTarget(raw: unknown): FamiliarTarget | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const target: FamiliarTarget = {};
  if (typeof r.selector === 'string' && r.selector.length > 0) {
    target.selector = r.selector;
  }
  if (typeof r.x === 'number' && Number.isFinite(r.x)) {
    target.x = r.x;
  }
  if (typeof r.y === 'number' && Number.isFinite(r.y)) {
    target.y = r.y;
  }
  return Object.keys(target).length > 0 ? target : undefined;
}

/**
 * Register the Familiar WS handler. Returns an unsubscribe function so
 * the caller can tear it down on unmount (the providers effect already
 * tracks this style of cleanup).
 */
export function registerFamiliarWsHandler(): () => void {
  return wsClient.on('familiar', (msg) => {
    if (msg.type !== 'manifestation') return;
    const data = msg.data as FamiliarManifestationWsPayload;
    const pose: FamiliarPose =
      data.pose && VALID_POSES.includes(data.pose) ? data.pose : 'waving';
    const message =
      typeof data.message === 'string' && data.message.length > 0
        ? data.message
        : undefined;
    const durationMs =
      typeof data.duration_ms === 'number' && data.duration_ms > 0
        ? data.duration_ms
        : undefined;
    const target = coerceTarget(data.target);
    useFamiliarStore.getState().manifest('ai-summon', {
      pose,
      message,
      durationMs,
      target,
    });
  });
}

/**
 * Convenience batch wiring — call once after `wsClient.connect()` and
 * keep the returned cleanup for unmount. Future WS-driven features
 * register here.
 */
/**
 * ПОЛІС — global bell. Gates, budget alarms and mission endings must be
 * audible from ANY screen, not only inside /polis. Room deltas are wired
 * separately in `polisStore.registerPolisWsHandler`.
 */
export function registerPolisBellHandler(): () => void {
  return wsClient.on('polis', (msg) => {
    const toast = useUIStore.getState().toast;
    if (msg.type === 'gate_opened') {
      const q =
        ((msg.data as Record<string, any>)?.gate?.question as string) ??
        'рішення чекає';
      toast({ kind: 'warn', message: `🔔 Поліс: ${q}` });
    } else if (msg.type === 'budget_alert') {
      const p = Math.round(
        (((msg.data as Record<string, any>)?.pressure as number) ?? 0) * 100,
      );
      toast({ kind: 'warn', message: `₿ Поліс: бюджет місії на ${p}%` });
    } else if (msg.type === 'mission_status') {
      const m = (msg.data as Record<string, any>)?.mission;
      if (m?.status === 'done') {
        toast({ kind: 'success', message: `Поліс: «${m.title}» виконано` });
      } else if (m?.status === 'failed') {
        toast({ kind: 'error', message: `Поліс: «${m.title}» зірвано` });
      }
    }
  });
}

/**
 * Піч дорожніх пакетів. Кожне повідомлення несе ПОВНИЙ знімок роботи, тож
 * стор його заміняє — зливати не можна: зникле поле мусить зникнути.
 *
 * `pack.visible` приходить, коли спечений пакет стало видно шляху доставки;
 * знімок у ньому той самий, тож окремої гілки він не потребує.
 *
 * Канал тут лише пришвидшує — жодна гілка інтерфейсу не залежить від того,
 * що сокет живий: `bakeStore.refresh()` читає ту саму правду по HTTP.
 */
export function registerBakeWsHandler(): () => void {
  return wsClient.on('bake', (msg) => {
    if (!msg.type.startsWith('job.') && msg.type !== 'pack.visible') return;
    const data = msg.data as Record<string, unknown>;
    // Домовлений вигляд — голий знімок у `data`. Обгортку `{job: …}` теж
    // приймаємо: два читачі цього контракту вже розійшлись у тому, чи вона є.
    const raw = (data.job ?? data) as Record<string, unknown> | null;
    if (!raw || typeof raw.job_id !== 'string' || typeof raw.stage !== 'string') return;
    useBakeStore.getState().applySnapshot(raw as unknown as BakeSnapshot);
  });
}

export function registerWsHandlers(): () => void {
  const unsubs: Array<() => void> = [
    registerFamiliarWsHandler(),
    // B1 — incremental sentence TTS playback (chat/tts.sentence + tts.stop).
    registerTtsPlayerWsHandler(),
    // ПОЛІС — глобальний дзвін Ратуші.
    registerPolisBellHandler(),
    // Піч дорожніх пакетів — знімок роботи з бекенда.
    registerBakeWsHandler(),
  ];
  return () => {
    unsubs.forEach((u) => {
      try {
        u();
      } catch {
        /* ignore */
      }
    });
  };
}
