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
    expect(f.style.height).toBe('520px');
  });

  it('expand toggle blows the panel to a fixed full-screen surface, same iframe', async () => {
    const { container, getByLabelText, getByTestId } = render(
      <SceneArtifactPanel data={data as any} />,
    );
    const before = container.querySelector('iframe');
    await act(async () => { getByLabelText('розгорнути артефакт').click(); });
    const panel = getByTestId('artifact-panel');
    expect(panel.getAttribute('data-expanded')).toBe('1');
    expect(panel.style.position).toBe('fixed');
    // Same iframe element — broker/animation state survives the resize.
    expect(container.querySelector('iframe')).toBe(before);
    await act(async () => { getByLabelText('згорнути артефакт').click(); });
    expect(getByTestId('artifact-panel').getAttribute('data-expanded')).toBe('0');
  });
});
