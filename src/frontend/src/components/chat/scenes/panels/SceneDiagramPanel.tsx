/**
 * Phase-28-A — diagram ScenePanel renderer.
 *
 * Thin wrapper over the existing `DiagramResponse` (d3 force / tree /
 * flow) so the Day-4 panel composer can carry a diagram panel inside
 * a scene envelope. Schema mirrors DiagramData; we forward as-is.
 */
import type { ScenePanel } from '@shared/types';
import { DiagramResponse, type DiagramData } from '../../DiagramResponse';

type DiagramPanelData = Extract<ScenePanel, { kind: 'diagram' }>['data'];

export interface SceneDiagramPanelProps {
  data: DiagramPanelData;
}

export function SceneDiagramPanel({ data }: SceneDiagramPanelProps) {
  const diagramData: DiagramData = {
    kind: data.kind,
    title: data.title,
    nodes: data.nodes ?? [],
    links: data.links ?? [],
  };
  return (
    <div data-testid="scene-diagram-panel" data-diagram-kind={data.kind ?? 'force'}>
      <DiagramResponse data={diagramData} />
    </div>
  );
}
