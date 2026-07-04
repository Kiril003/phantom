import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { SceneArtifactPanel } from '../panels/SceneArtifactPanel';

const data = { html: '<p>hi</p>', title: 'T', capabilities: ['read:context'] as const };

describe('SceneArtifactPanel', () => {
  it('mounts a script-only sandbox with NO allow-same-origin', () => {
    const { container } = render(<SceneArtifactPanel data={data as any} />);
    const f = container.querySelector('iframe')!;
    expect(f.getAttribute('sandbox')).toBe('allow-scripts');
    expect(f.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  it('injects a CSP that forbids network', () => {
    const { container } = render(<SceneArtifactPanel data={data as any} />);
    const srcdoc = container.querySelector('iframe')!.getAttribute('srcdoc')!;
    expect(srcdoc).toContain("connect-src 'none'");
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).toContain('<p>hi</p>');
  });

  it('kill switch unmounts the iframe', async () => {
    const { container, getByLabelText } = render(<SceneArtifactPanel data={data as any} />);
    await act(async () => { getByLabelText('зупинити артефакт').click(); });
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('renders a wide landscape surface by default (not phone-sized)', () => {
    const { container, getByTestId } = render(<SceneArtifactPanel data={data as any} />);
    expect(getByTestId('artifact-panel').getAttribute('data-expanded')).toBe('0');
    const f = container.querySelector('iframe') as HTMLIFrameElement;
    expect(f.style.width).toBe('100%');
    // Content-hugging height, clamped [260, 420] until the measurer reports.
    expect(f.style.height).toBe('320px');
  });

  it('expand rides a body portal — fixed fullscreen immune to transformed ancestors', async () => {
    const { baseElement, getByLabelText, getByTestId } = render(
      <SceneArtifactPanel data={data as any} />,
    );
    await act(async () => { getByLabelText('розгорнути артефакт').click(); });
    const panel = getByTestId('artifact-panel');
    expect(panel.getAttribute('data-expanded')).toBe('1');
    expect(panel.style.position).toBe('fixed');
    // Portal target: document.body, NOT the (transformable) transcript node.
    expect(panel.parentElement).toBe(baseElement.ownerDocument.body);
    const f = baseElement.querySelector('iframe') as HTMLIFrameElement;
    expect(f.style.height).toBe('100%');
    await act(async () => { getByLabelText('згорнути артефакт').click(); });
    expect(getByTestId('artifact-panel').getAttribute('data-expanded')).toBe('0');
  });

  it('Escape collapses the fullscreen surface', async () => {
    const { getByLabelText, getByTestId } = render(<SceneArtifactPanel data={data as any} />);
    await act(async () => { getByLabelText('розгорнути артефакт').click(); });
    expect(getByTestId('artifact-panel').getAttribute('data-expanded')).toBe('1');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(getByTestId('artifact-panel').getAttribute('data-expanded')).toBe('0');
  });

  it('clamped auto-height follows the artifact height report', async () => {
    const { container, getByTestId } = render(<SceneArtifactPanel data={data as any} />);
    const f = container.querySelector('iframe') as HTMLIFrameElement;
    const report = (height: number) =>
      act(async () => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'phantom:artifact:height', height },
            source: f.contentWindow,
          }),
        );
      });
    await report(300);
    expect(f.style.height).toBe('300px');
    await report(9000);
    expect(f.style.height).toBe('420px');
    await report(10);
    expect(f.style.height).toBe('260px');
    expect(getByTestId('artifact-panel')).toBeTruthy();
  });
});
