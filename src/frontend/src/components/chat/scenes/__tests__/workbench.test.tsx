import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { WorkbenchSceneData } from '@shared/types';

const wsHandlers: Array<(msg: any) => void> = [];
vi.mock('../../../../services/websocket', () => ({
  wsClient: {
    on: vi.fn((_ch: string, h: (msg: any) => void) => {
      wsHandlers.push(h);
      return () => {
        const i = wsHandlers.indexOf(h);
        if (i >= 0) wsHandlers.splice(i, 1);
      };
    }),
  },
}));

import { WorkbenchScene } from '../WorkbenchScene';
import { ArtifactBroker } from '../artifactBroker';
import { wsClient } from '../../../../services/websocket';

const BASE: WorkbenchSceneData = {
  workbench_id: 'wb1',
  title: 'Демо дронів',
  status: 'building',
  entry: 'index.html',
  preview_url: '/api/v1/workbench/wb1/preview/index.html?t=tok',
  file_count: 0,
  passes: [],
  ai_note: 'Майстерня відкрита',
};

function emit(msg: any) {
  act(() => { for (const h of [...wsHandlers]) h(msg); });
}

describe('WorkbenchScene', () => {
  beforeEach(() => { wsHandlers.length = 0; vi.clearAllMocks(); });

  it('renders building state with live phase strip', () => {
    render(<WorkbenchScene data={BASE} />);
    expect(screen.getByTestId('workbench-scene')).toBeInTheDocument();
    expect(screen.getByTestId('workbench-live-phase')).toBeInTheDocument();
    expect(screen.getByTitle('Демо дронів')).toHaveAttribute(
      'src', expect.stringContaining('/api/v1/workbench/wb1/preview/'));
  });

  it('follows workbench.phase events for its own id only', () => {
    render(<WorkbenchScene data={BASE} />);
    emit({ type: 'workbench.phase',
           data: { workbench_id: 'OTHER', phase: 'see', pass: 1 } });
    emit({ type: 'workbench.phase',
           data: { workbench_id: 'wb1', phase: 'critique', pass: 1 } });
    expect(screen.getByTestId('workbench-live-phase').textContent)
      .toContain('критикую себе');
  });

  it('records verdicts and flips to ready', () => {
    render(<WorkbenchScene data={BASE} />);
    emit({ type: 'workbench.phase',
           data: { workbench_id: 'wb1', phase: 'verdict', pass: 1,
                   verdict: 'REVISE', score: 4, critique: 'порожній хедер' } });
    expect(screen.getByText(/REVISE 4\/10/)).toBeInTheDocument();
    emit({ type: 'workbench.phase',
           data: { workbench_id: 'wb1', phase: 'verdict', pass: 2,
                   verdict: 'SHIP', score: 9, critique: 'готово' } });
    emit({ type: 'workbench.phase',
           data: { workbench_id: 'wb1', phase: 'ready', elapsed_s: 12 } });
    expect(screen.queryByTestId('workbench-live-phase')).toBeNull();
    expect(screen.getByText(/SHIP 9\/10/)).toBeInTheDocument();
    expect(screen.getByLabelText('На весь екран')).toBeInTheDocument();
  });

  it('shows failure state', () => {
    render(<WorkbenchScene data={BASE} />);
    emit({ type: 'workbench.phase',
           data: { workbench_id: 'wb1', phase: 'failed', error: 'llm down' } });
    expect(screen.getByText('ЗБІЙ')).toBeInTheDocument();
  });

  it('ready scene renders past passes without ws subscription', () => {
    render(<WorkbenchScene data={{
      ...BASE, status: 'ready',
      passes: [{ n: 1, verdict: 'SHIP', score: 8, critique: 'ок', blind: true }],
    }} />);
    expect(vi.mocked(wsClient.on)).not.toHaveBeenCalled();
    expect(screen.getByText(/SHIP 8\/10 · без ока/)).toBeInTheDocument();
  });
});

describe('ArtifactBroker feed:live (W3)', () => {
  beforeEach(() => { wsHandlers.length = 0; vi.clearAllMocks(); });

  function makeFrame() {
    const posted: any[] = [];
    const contentWindow = { postMessage: (m: any) => posted.push(m) } as any;
    return { contentWindow, posted };
  }

  it('forbids subscribe without feed:live capability', async () => {
    const f = makeFrame();
    const b = new ArtifactBroker(f.contentWindow, ['read:context'], vi.fn());
    b.attach();
    window.dispatchEvent(new MessageEvent('message', {
      source: f.contentWindow,
      data: { type: 'phantom.subscribe', reqId: 's1', channel: 'context' },
    }));
    await Promise.resolve();
    expect(f.posted[0]).toMatchObject({ reqId: 's1', ok: false, error: 'forbidden' });
    b.detach();
  });

  it('forbids channels outside the curated list', async () => {
    const f = makeFrame();
    const b = new ArtifactBroker(f.contentWindow, ['feed:live'], vi.fn());
    b.attach();
    window.dispatchEvent(new MessageEvent('message', {
      source: f.contentWindow,
      data: { type: 'phantom.subscribe', reqId: 's2', channel: 'vault' },
    }));
    await Promise.resolve();
    expect(f.posted[0]).toMatchObject({ reqId: 's2', ok: false, error: 'forbidden' });
    b.detach();
  });

  it('bridges ws messages into the iframe as phantom.feed and stops on detach', async () => {
    const f = makeFrame();
    const b = new ArtifactBroker(f.contentWindow, ['feed:live'], vi.fn());
    b.attach();
    window.dispatchEvent(new MessageEvent('message', {
      source: f.contentWindow,
      data: { type: 'phantom.subscribe', reqId: 's3', channel: 'context' },
    }));
    await Promise.resolve();
    expect(f.posted[0]).toMatchObject({ reqId: 's3', ok: true, channel: 'context' });

    emit({ type: 'context.update', data: { aqi: 42 } });
    const feed = f.posted.find((m) => m.type === 'phantom.feed');
    expect(feed).toMatchObject({
      channel: 'context', event: 'context.update', data: { aqi: 42 },
    });

    b.detach();
    expect(wsHandlers).toHaveLength(0);
  });
});
