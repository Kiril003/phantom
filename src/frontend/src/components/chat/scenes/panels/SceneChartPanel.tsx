/**
 * Phase-28-A — chart ScenePanel renderer.
 *
 * Thin wrapper over the existing `ChartResponse` (Recharts) so the
 * Day-4 panel composer can carry a chart panel inside a scene
 * envelope. Schema mirrors ChartData; the only translation is
 * `rows` (panel) ↔ `data` (Recharts).
 *
 * Back-compat: legacy chart_data attachments still render via
 * ResponseRenderer when the message has no `scene` field.
 */
import type { ScenePanel } from '@shared/types';
import { ChartResponse, type ChartData } from '../../ChartResponse';

type ChartPanelData = Extract<ScenePanel, { kind: 'chart' }>['data'];

export interface SceneChartPanelProps {
  data: ChartPanelData;
}

export function SceneChartPanel({ data }: SceneChartPanelProps) {
  const chartData: ChartData = {
    chart_type: data.chart_type,
    title: data.title,
    data: data.rows ?? [],
    x_key: data.x_key,
    y_keys: data.y_keys,
    colors: data.colors,
  };
  return (
    <div data-testid="scene-chart-panel" data-chart-type={data.chart_type}>
      <ChartResponse data={chartData} />
    </div>
  );
}
