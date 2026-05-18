import { useQuery } from '@tanstack/react-query';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  Cell 
} from 'recharts';
import { Brain, Target, User, Activity } from 'lucide-react';

interface Drive {
  name: string;
  current_level: number;
  pressure: number;
}

interface WillState {
  drives: Drive[];
  top_goal: string | null;
  dominant_drive: string;
  identity_summary: string;
}

export function WillPanel() {
  const { data, isLoading, error } = useQuery<WillState>({
    queryKey: ['agent-will-state'],
    queryFn: async () => {
      const resp = await fetch('/api/v1/agent/will/state', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('phantom_token')}`
        }
      });
      if (!resp.ok) throw new Error('Failed to fetch will state');
      return resp.json();
    },
    refetchInterval: 30000, // 30s as requested (pull-only)
  });

  if (isLoading) return <div className="p-8 animate-pulse text-ink-muted">Loading Will Engine...</div>;
  if (error || !data) return <div className="p-8 text-red-500">Error loading Will Engine</div>;

  const chartData = data.drives.map(d => ({
    name: d.name.charAt(0).toUpperCase() + d.name.slice(1),
    value: d.current_level * 100,
    pressure: d.pressure * 100,
    raw: d.name
  }));

  return (
    <div className="flex flex-col h-full bg-white/50 backdrop-blur-md rounded-[32px] border border-white/20 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-black/5 bg-white/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-xl text-indigo-600">
            <Brain size={20} />
          </div>
          <h2 className="text-xl font-serif font-bold text-ink-primary">Will Engine</h2>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 rounded-full">
          <Activity size={12} className="text-green-600 animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-green-700">Autonomous</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Drives Chart */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-mono uppercase tracking-widest text-ink-muted">Fundamental Drives</h3>
            <span className="text-[10px] text-ink-muted opacity-60">Satisfaction (%)</span>
          </div>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 9, fill: 'var(--ink-muted)' }} 
                />
                <YAxis domain={[0, 100]} axisLine={false} tickLine={false} hide />
                <Tooltip 
                  cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.raw === data.dominant_drive ? 'var(--accent-primary, #6366f1)' : '#e2e8f0'} 
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Top Goal */}
        <section className="p-5 bg-indigo-500/5 rounded-3xl border border-indigo-500/10">
          <div className="flex items-center gap-2 mb-3">
            <Target size={14} className="text-indigo-600" />
            <h3 className="text-[10px] font-mono uppercase tracking-widest text-indigo-700">Current Top Goal</h3>
          </div>
          <p className="text-sm font-medium text-ink-primary leading-relaxed">
            {data.top_goal || "No active goals in stack. Observing environment..."}
          </p>
        </section>

        {/* Identity */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <User size={14} className="text-ink-muted" />
            <h3 className="text-[10px] font-mono uppercase tracking-widest text-ink-muted">Self Narrative</h3>
          </div>
          <p className="text-xs text-ink-muted leading-relaxed italic bg-black/5 p-4 rounded-2xl">
            "{data.identity_summary}"
          </p>
        </section>
      </div>
    </div>
  );
}
