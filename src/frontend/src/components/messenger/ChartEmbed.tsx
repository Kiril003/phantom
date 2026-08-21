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
    <div className="space-y-3 pt-1 select-none bg-[#121A15] border border-[#233127] rounded-2xl p-3 sm:p-4 shadow-xl text-[#E4EDE7]">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 pb-2 border-b border-[#1F2B22]">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-[#1A261D] text-[#55C778] border border-[#2B3E31] rounded-xl shadow-sm">
            <BarChart3 className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-extrabold text-xs sm:text-sm text-white leading-tight">
              {data.title}
            </h4>
            <span className="text-[10px] text-[#8EA093] uppercase tracking-wider font-semibold">
              Інтерактивна візуалізація
            </span>
          </div>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="w-full h-52 pt-2 bg-[#0E1410] rounded-xl border border-[#1F2B22] p-2 shadow-inner">
        <ResponsiveContainer width="100%" height="100%">
          {data.type === 'line' ? (
            <LineChart data={data.data || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1C281F" />
              <XAxis dataKey="name" tick={{ fill: '#8EA093', fontSize: 10 }} stroke="#233127" />
              <YAxis tick={{ fill: '#8EA093', fontSize: 10 }} stroke="#233127" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#141C16',
                  borderRadius: '12px',
                  border: '1px solid #2B3C30',
                  fontSize: '11px',
                  color: '#E4EDE7',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '4px', color: '#8EA093' }} />
              {(data.keys || []).map((k) => (
                <Line
                  key={k.key}
                  type="monotone"
                  dataKey={k.key}
                  name={k.label}
                  stroke={k.color || '#55C778'}
                  strokeWidth={2.5}
                  dot={{ fill: k.color || '#55C778', r: 4 }}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={data.data || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1C281F" />
              <XAxis dataKey="name" tick={{ fill: '#8EA093', fontSize: 10 }} stroke="#233127" />
              <YAxis tick={{ fill: '#8EA093', fontSize: 10 }} stroke="#233127" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#141C16',
                  borderRadius: '12px',
                  border: '1px solid #2B3C30',
                  fontSize: '11px',
                  color: '#E4EDE7',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '4px', color: '#8EA093' }} />
              {(data.keys || []).map((k) => (
                <Bar
                  key={k.key}
                  dataKey={k.key}
                  name={k.label}
                  fill={k.color || '#55C778'}
                  radius={[6, 6, 0, 0]}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Key Takeaway Insight Pill */}
      {data.takeaway && (
        <div className="flex items-center gap-2 p-2.5 bg-[#16221A] border border-[#26372B] rounded-xl text-xs text-[#A4B8AB] shadow-sm">
          <TrendingUp className="w-4 h-4 text-[#55C778] shrink-0" />
          <p className="leading-snug">{data.takeaway}</p>
        </div>
      )}
    </div>
  );
};
