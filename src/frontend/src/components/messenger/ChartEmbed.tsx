import React from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';
import { BarChart3, TrendingUp } from 'lucide-react';
import { ChartData } from '../../types/messenger';

interface ChartEmbedProps {
  data: ChartData;
}

export const ChartEmbed: React.FC<ChartEmbedProps> = ({ data }) => {
  return (
    <div className="space-y-3 pt-1 select-none bg-[#FDFCF9] border border-[#F1EDE3] rounded-2xl p-3 sm:p-4 shadow-xl text-[#1E2521]">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 pb-2 border-b border-[#E6DFD3]">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-[#F9F7F1] text-[#E87A42] border border-[#DDD4C4] rounded-xl shadow-sm">
            <BarChart3 className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-extrabold text-xs sm:text-sm text-[#1E2521] leading-tight">
              {data.title}
            </h4>
            <span className="text-[10px] text-[#5F6A60] uppercase tracking-wider font-semibold">
              Інтерактивна візуалізація
            </span>
          </div>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="w-full h-52 pt-2 bg-[#F7F5EE] rounded-xl border border-[#E6DFD3] p-2 shadow-inner">
        <ResponsiveContainer width="100%" height="100%">
          {data.type === 'line' ? (
            <LineChart data={data.data || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1C281F" />
              <XAxis dataKey="name" tick={{ fill: '#5F6A60', fontSize: 10 }} stroke="#F1EDE3" />
              <YAxis tick={{ fill: '#5F6A60', fontSize: 10 }} stroke="#F1EDE3" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#FDFCF9',
                  borderRadius: '12px',
                  border: '1px solid #DDD4C4',
                  fontSize: '11px',
                  color: '#1E2521',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '4px', color: '#5F6A60' }} />
              {(data.keys || []).map((k) => (
                <Line
                  key={k.key}
                  type="monotone"
                  dataKey={k.key}
                  name={k.label}
                  stroke={k.color || '#E87A42'}
                  strokeWidth={2.5}
                  dot={{ fill: k.color || '#E87A42', r: 4 }}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={data.data || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1C281F" />
              <XAxis dataKey="name" tick={{ fill: '#5F6A60', fontSize: 10 }} stroke="#F1EDE3" />
              <YAxis tick={{ fill: '#5F6A60', fontSize: 10 }} stroke="#F1EDE3" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#FDFCF9',
                  borderRadius: '12px',
                  border: '1px solid #DDD4C4',
                  fontSize: '11px',
                  color: '#1E2521',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '4px', color: '#5F6A60' }} />
              {(data.keys || []).map((k) => (
                <Bar
                  key={k.key}
                  dataKey={k.key}
                  name={k.label}
                  fill={k.color || '#E87A42'}
                  radius={[6, 6, 0, 0]}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Key Takeaway Insight Pill */}
      {data.takeaway && (
        <div className="flex items-center gap-2 p-2.5 bg-[#F9F7F1] border border-[#E6DFD3] rounded-xl text-xs text-[#5F6A60] shadow-sm">
          <TrendingUp className="w-4 h-4 text-[#E87A42] shrink-0" />
          <p className="leading-snug">{data.takeaway}</p>
        </div>
      )}
    </div>
  );
};
