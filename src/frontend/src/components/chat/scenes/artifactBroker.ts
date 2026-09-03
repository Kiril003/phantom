import type { ArtifactCapability } from '@shared/types/chat';
import { wsClient, type WSChannel, type WSMessage } from '../../../services/websocket';
// Адреса бекенда — тільки з єдиного джерела. У пакунку фронт віддається
// asset-протоколом Tauri, тож відносний fetch на /api іде на tauri.localhost,
// а не на sidecar, і виклик не доходить — виміряно на зібраному AppImage.
import { apiUrl } from '../../../services/backendOrigin';

const READ_KEYS: Record<string, ArtifactCapability> = {
  'context.snapshot': 'read:context',
  'sensors.latest': 'read:sensors',
  'memory.facts': 'read:memory',
  'system.state': 'read:state',
};

/** W3 — WS channels an artifact may stream live. Curated, never '*'. */
const FEED_CHANNELS: readonly string[] = ['context', 'system', 'map'];

type ReadFn = (key: string) => Promise<unknown>;

export class ArtifactBroker {
  private onMsg = (e: MessageEvent) => this.handle(e);
  private feedOffs = new Map<string, () => void>();

  constructor(
    private frame: Window,
    private caps: ArtifactCapability[],
    private read: ReadFn,
  ) {}

  attach() { window.addEventListener('message', this.onMsg); }

  detach() {
    window.removeEventListener('message', this.onMsg);
    for (const off of this.feedOffs.values()) off();
    this.feedOffs.clear();
  }

  private reply(m: object) { this.frame.postMessage(m, '*'); }

  private async handle(e: MessageEvent) {
    if (e.source !== this.frame) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;

    if (d.type === 'phantom.read') {
      if (!Object.hasOwn(READ_KEYS, d.key) || !this.caps.includes(READ_KEYS[d.key])) {
        this.reply({ type: 'phantom.read.result', reqId: d.reqId, error: 'forbidden' });
        return;
      }
      try {
        this.reply({ type: 'phantom.read.result', reqId: d.reqId, data: await this.read(d.key) });
      } catch {
        this.reply({ type: 'phantom.read.result', reqId: d.reqId, error: 'read_failed' });
      }
      return;
    }

    if (d.type === 'phantom.subscribe') {
      const channel = String(d.channel ?? '');
      if (!this.caps.includes('feed:live') || !FEED_CHANNELS.includes(channel)) {
        this.reply({ type: 'phantom.subscribe.result', reqId: d.reqId,
                     ok: false, error: 'forbidden' });
        return;
      }
      if (!this.feedOffs.has(channel)) {
        const off = wsClient.on(channel as WSChannel, (msg: WSMessage) => {
          this.reply({ type: 'phantom.feed', channel, event: msg.type, data: msg.data });
        });
        this.feedOffs.set(channel, off);
      }
      this.reply({ type: 'phantom.subscribe.result', reqId: d.reqId, ok: true, channel });
      return;
    }

    if (d.type === 'phantom.unsubscribe') {
      const channel = String(d.channel ?? '');
      this.feedOffs.get(channel)?.();
      this.feedOffs.delete(channel);
      this.reply({ type: 'phantom.unsubscribe.result', reqId: d.reqId, ok: true, channel });
      return;
    }

    if (d.type === 'phantom.action') {
      if (!this.caps.includes('action:tools')) {
        this.reply({ type: 'phantom.action.result', reqId: d.reqId, ok: false, error: 'forbidden' });
        return;
      }
      try {
        const r = await fetch(apiUrl('/api/v1/chat/artifact-action'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ tool: d.tool, args: d.args ?? {} }),
        });
        const j = await r.json();
        this.reply({ type: 'phantom.action.result', reqId: d.reqId, ok: !!j.ok, result: j.result, error: j.error });
      } catch {
        this.reply({ type: 'phantom.action.result', reqId: d.reqId, ok: false, error: 'dispatch_failed' });
      }
    }
  }
}
