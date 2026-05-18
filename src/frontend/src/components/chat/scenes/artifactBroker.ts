import type { ArtifactCapability } from '@shared/types/chat';

const READ_KEYS: Record<string, ArtifactCapability> = {
  'context.snapshot': 'read:context',
  'sensors.latest': 'read:sensors',
  'memory.facts': 'read:memory',
  'system.state': 'read:state',
};

type ReadFn = (key: string) => Promise<unknown>;

export class ArtifactBroker {
  private onMsg = (e: MessageEvent) => this.handle(e);

  constructor(
    private frame: Window,
    private caps: ArtifactCapability[],
    private read: ReadFn,
  ) {}

  attach() { window.addEventListener('message', this.onMsg); }
  detach() { window.removeEventListener('message', this.onMsg); }

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

    if (d.type === 'phantom.action') {
      if (!this.caps.includes('action:tools')) {
        this.reply({ type: 'phantom.action.result', reqId: d.reqId, ok: false, error: 'forbidden' });
        return;
      }
      try {
        const r = await fetch('/api/v1/chat/artifact-action', {
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
