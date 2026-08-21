/**
 * Стан ретранслятора для месенджера.
 *
 * Панель показує лише те, що віддав вузол: жодних зашитих адрес, латентностей
 * чи статусів «online». Поки вузол не відповів — стан невідомий, і так і кажемо.
 */

import { request } from './api';

export interface RelayNodeStatus {
  connected: boolean;
  node_id: string;
  relay: string;
  sessions: number;
  last_error: string;
}

type StatusListener = (status: RelayNodeStatus | null) => void;

const POLL_INTERVAL_MS = 15_000;

class PhantomRelayService {
  private status: RelayNodeStatus | null = null;
  private listeners = new Set<StatusListener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  /** Стан невідомий, доки вузол не відповів — це не те саме, що offline. */
  public getStatus(): RelayNodeStatus | null {
    return this.status;
  }

  public isAvailable(): boolean {
    return this.status?.connected === true;
  }

  public nodeId(): string | undefined {
    return this.status?.node_id || undefined;
  }

  public subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  public start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS);
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public async refresh(): Promise<RelayNodeStatus | null> {
    if (this.inFlight) return this.status;
    this.inFlight = true;
    try {
      const next = await request<RelayNodeStatus>('GET', '/messenger/relay/status');
      this.status = next;
    } catch {
      // Вузол недосяжний — статус невідомий, а не «offline з нульовою латентністю».
      this.status = null;
    } finally {
      this.inFlight = false;
      this.listeners.forEach((cb) => cb(this.status));
    }
    return this.status;
  }
}

export const phantomRelayService = new PhantomRelayService();
