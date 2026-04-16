import { useMemo } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

export type ChartType = 'line' | 'bar' | 'area' | 'pie';

export interface ChartData {
  chart_type: ChartType;
  title?: string;
  data: Array<Record<string, unknown>>;
  x_key?: string;
  y_keys?: string[];
  colors?: string[];
}

interface ChartResponseProps {
  data: ChartData;
}

const PHANTOM_CHART_COLORS = [
  'var(--accent)',
  'var(--signal-info)',
  'var(--signal-ok)',
  'var(--signal-warn)',
  'var(--signal-alert)',
];

function resolveCssVar(name: string): string {
  if (typeof document === 'undefined') return '#7aa2f7';
  const val = getComputedStyle(document.documentElement).getPropertyValue(name.replace(/^var\(|\)$/g, '')).trim();
  return val || '#7aa2f7';
}

export function ChartResponse({ data }: ChartResponseProps) {
  const {
    chart_type = 'bar',
    title,
    data: rows = [],
    x_key = 'name',
    y_keys = ['value'],
  } = data;

  const colors = useMemo(() => {
    return (data.colors ?? PHANTOM_CHART_COLORS).map((c) =>
      c.startsWith('var(') ? resolveCssVar(c) : c
    );
  }, [data.colors]);

  const validY = useMemo(() => {
    if (y_keys && y_keys.length > 0) return y_keys;
    const first = rows[0] ?? {};
    return Object.keys(first).filter((k) => k !== x_key && typeof first[k] === 'number');
  }, [y_keys, rows, x_key]);

  if (!rows || rows.length === 0) {
    return (
      <div
        className="px-3 py-6 rounded-md text-center font-mono tracking-wider"
        style={{
          background: 'var(--surface-raised)',
          border: '1px dashed var(--line-subtle)',
          color: 'var(--ink-muted)',
          fontSize: 'var(--fs-micro)',
        }}
      >
        NO CHART DATA
      </div>
    );
  }

  const height = 220;

  const tooltipStyle = {
    background: 'var(--surface-raised)',
    border: '1px solid var(--line-default)',
    borderRadius: 6,
    fontSize: 'var(--fs-xs)',
    color: 'var(--ink-primary)',
  };

  return (
    <div
      className="rounded-md p-3"
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--line-subtle)',
      }}
    >
      {title && (
        <div
          className="mb-2 font-mono tracking-wider uppercase"
          style={{ color: 'var(--ink-secondary)', fontSize: 'var(--fs-micro)' }}
        >
          {title}
        </div>
      )}
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          {chart_type === 'line' ? (
            <LineChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line-subtle)" />
              <XAxis dataKey={x_key} stroke="var(--ink-muted)" fontSize={11} />
              <YAxis stroke="var(--ink-muted)" fontSize={11} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: 'var(--line-default)' }} />
              {validY.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {validY.map((k, i) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={colors[i % colors.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive
                />
              ))}
            </LineChart>
          ) : chart_type === 'area' ? (
            <AreaChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <defs>
                {validY.map((k, i) => (
                  <linearGradient key={k} id={`grad-${k}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={colors[i % colors.length]} stopOpacity={0.7} />
                    <stop offset="95%" stopColor={colors[i % colors.length]} stopOpacity={0.05} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line-subtle)" />
              <XAxis dataKey={x_key} stroke="var(--ink-muted)" fontSize={11} />
              <YAxis stroke="var(--ink-muted)" fontSize={11} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: 'var(--line-default)' }} />
              {validY.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {validY.map((k, i) => (
                <Area
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={colors[i % colors.length]}
                  strokeWidth={2}
                  fill={`url(#grad-${k})`}
                  isAnimationActive
                />
              ))}
            </AreaChart>
          ) : chart_type === 'pie' ? (
            <PieChart>
              <Tooltip contentStyle={tooltipStyle} />
              <Pie
                data={rows}
                dataKey={validY[0] ?? 'value'}
                nameKey={x_key}
                innerRadius={40}
                outerRadius={80}
                paddingAngle={2}
                isAnimationActive
              >
                {rows.map((_, i) => (
                  <Cell key={i} fill={colors[i % colors.length]} stroke="var(--surface-deep)" strokeWidth={1.5} />
                ))}
              </Pie>
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          ) : (
            <BarChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line-subtle)" />
              <XAxis dataKey={x_key} stroke="var(--ink-muted)" fontSize={11} />
              <YAxis stroke="var(--ink-muted)" fontSize={11} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--line-subtle)' }} />
              {validY.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {validY.map((k, i) => (
                <Bar
                  key={k}
                  dataKey={k}
                  fill={colors[i % colors.length]}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
