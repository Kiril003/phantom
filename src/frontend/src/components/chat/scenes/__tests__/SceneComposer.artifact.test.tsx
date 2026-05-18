import { it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SceneComposer } from '../SceneComposer';

it('renders an artifact panel via the composer', () => {
  const scene = {
    kind: 'artifact',
    reveal: { policy: 'instant', staggerMs: 0 },
    panels: [{
      id: 'p0', kind: 'artifact',
      data: { html: '<b>x</b>', title: 'T', capabilities: [] },
    }],
  };
  const { container } = render(
    <SceneComposer scene={scene as any} reduceMotion />,
  );
  expect(container.querySelector('iframe')).not.toBeNull();
});
