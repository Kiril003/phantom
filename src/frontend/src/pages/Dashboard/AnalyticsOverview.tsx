import React from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Bot, Zap, Activity, Users, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { request } from '../../services/api';

interface OverviewOperator {
  name: string;
  role: string;
  ops: number;
}

interface Overview {
  tokens_used_this_month?: number | null;
  max_tokens?: number | null;
  active_agents?: number | null;
  total_sessions?: number | null;
  daily_usage?: { date: string; tokens: number }[] | null;
  operators?: OverviewOperator[] | null;
}

type Load =
  | { s: 'reading' }
  | { s: 'ok'; data: Overview }
  | { s: 'empty' }
  | { s: 'offline' }
  | { s: 'denied'; why: string };

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 100, damping: 15 },
  },
};

function useOverview(): Load {
  const [state, setState] = React.useState<Load>({ s: 'reading' });

  React.useEffect(() => {
    let alive = true;
    request<Overview>('GET', '/analytics/overview')
      .then((data) => {
        if (!alive) return;
        const empty =
          data.tokens_used_this_month == null &&
          data.active_agents == null &&
          data.total_sessions == null &&
          !data.daily_usage?.length;
        setState(empty ? { s: 'empty' } : { s: 'ok', data });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const msg = err instanceof Error ? err.message : '';
        if (/tenant/i.test(msg)) {
          setState({ s: 'denied', why: 'цей профіль ще не належить жодному простору' });
        } else if (/fail|network|load/i.test(msg)) {
          setState({ s: 'offline' });
        } else {
          setState({ s: 'denied', why: msg || 'ядро не відповіло' });
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}

const nf = new Intl.NumberFormat('uk-UA');

function num(v: number | null | undefined): string | null {
  return typeof v === 'number' && Number.isFinite(v) ? nf.format(v) : null;
}

export default function AnalyticsOverview() {
  const load = useOverview();
  const data = load.s === 'ok' ? load.data : null;
  const series = (data?.daily_usage ?? []).map((d) => ({
    name: new Date(d.date).toLocaleDateString('uk-UA', { weekday: 'short' }),
    tokens: d.tokens,
  }));
  const operators = data?.operators ?? [];

  return (
    <div className="w-full h-full p-8 overflow-y-auto no-scrollbar relative">
      <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-orange-600/10 rounded-full blur-[100px] pointer-events-none" />

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-7xl mx-auto space-y-8 relative z-10"
      >
        <header className="flex justify-between items-end">
          <div>
            <motion.h1
              variants={itemVariants}
              className="text-4xl font-display font-bold bg-clip-text text-transparent bg-gradient-to-r from-amber-400 to-orange-500 tracking-tight"
            >
              Огляд системи
            </motion.h1>
            <motion.p variants={itemVariants} className="text-zinc-400 mt-2">
              {statusLine(load)}
            </motion.p>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <MetricCard
            title="Токенів за місяць"
            value={num(data?.tokens_used_this_month)}
            trend={data?.max_tokens ? `з ${nf.format(data.max_tokens)}` : null}
            load={load}
            icon={<Zap className="text-amber-500" size={24} />}
          />
          <MetricCard
            title="Активних агентів"
            value={num(data?.active_agents)}
            trend={null}
            load={load}
            icon={<Bot className="text-emerald-500" size={24} />}
          />
          <MetricCard
            title="Усього сеансів"
            value={num(data?.total_sessions)}
            trend={null}
            load={load}
            icon={<Activity className="text-blue-500" size={24} />}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <motion.div
            variants={itemVariants}
            className="lg:col-span-2 rounded-2xl border border-white/5 bg-black/40 backdrop-blur-xl p-6 shadow-2xl relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            <h3 className="text-lg font-medium text-white mb-6 flex items-center gap-2">
              <Activity size={18} className="text-zinc-400" /> Витрата токенів · 7 днів
            </h3>
            <div className="h-[300px] w-full">
              {series.length === 0 ? (
                <Hollow load={load} nothing="за цей тиждень ще нічого не записано" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'rgba(20,20,22,0.9)',
                        borderColor: 'rgba(255,255,255,0.1)',
                        backdropFilter: 'blur(12px)',
                        borderRadius: '8px',
                        color: '#fff',
                      }}
                      itemStyle={{ color: '#fff' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="tokens"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorTokens)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="rounded-2xl border border-white/5 bg-black/40 backdrop-blur-xl p-6 shadow-2xl relative overflow-hidden flex flex-col"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
            <h3 className="text-lg font-medium text-white mb-6 flex items-center gap-2">
              <Users size={18} className="text-zinc-400" /> Хто працює
            </h3>

            <div className="flex-1 space-y-4">
              {operators.length === 0 ? (
                <Hollow load={load} nothing="поки що тут лише ти" />
              ) : (
                operators.map((user) => (
                  <div
                    key={user.name}
                    className="flex items-center justify-between p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-sm font-bold shadow-lg text-white">
                        {user.name.charAt(0)}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-zinc-100">{user.name}</div>
                        <div className="text-xs text-zinc-500">{user.role}</div>
                      </div>
                    </div>
                    <div className="text-sm font-mono text-zinc-300">{nf.format(user.ops)}</div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

function statusLine(load: Load): string {
  switch (load.s) {
    case 'reading':
      return 'читаю показники…';
    case 'offline':
      return 'ядро недоступне — показники з\'являться, щойно воно відповість';
    case 'denied':
      return load.why;
    case 'empty':
      return 'PHANTOM ще не накопичив статистики';
    case 'ok':
      return 'справжні показники цього ядра';
  }
}

function Hollow({ load, nothing }: { load: Load; nothing: string }) {
  const text =
    load.s === 'reading'
      ? 'читаю…'
      : load.s === 'offline'
        ? 'ядро недоступне'
        : load.s === 'denied'
          ? load.why
          : nothing;
  return (
    <div className="h-full min-h-[120px] flex items-center justify-center text-center px-4">
      <span className="text-sm text-zinc-500">{text}</span>
    </div>
  );
}

function MetricCard({
  title,
  value,
  trend,
  load,
  icon,
}: {
  title: string;
  value: string | null;
  trend: string | null;
  load: Load;
  icon: React.ReactNode;
}) {
  const isUp = trend ? !trend.trim().startsWith('-') : false;
  const blank =
    load.s === 'reading'
      ? '…'
      : load.s === 'offline'
        ? 'нема зв\'язку'
        : load.s === 'denied'
          ? 'недоступно'
          : 'ще нема';

  return (
    <motion.div
      variants={itemVariants}
      className="relative p-6 rounded-2xl border border-white/5 bg-black/40 backdrop-blur-xl shadow-2xl overflow-hidden group"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.08] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

      <div className="flex justify-between items-start mb-4 relative z-10">
        <div className="p-3 rounded-xl bg-white/5 border border-white/10 shadow-inner">{icon}</div>
        {trend && (
          <div
            className={`flex items-center gap-1 text-sm font-medium px-2.5 py-1 rounded-full ${
              isUp ? 'text-emerald-400 bg-emerald-400/10' : 'text-rose-400 bg-rose-400/10'
            }`}
          >
            {isUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {trend}
          </div>
        )}
      </div>

      <div className="relative z-10">
        <h3 className="text-zinc-400 text-sm font-medium mb-1">{title}</h3>
        <div
          className={`font-display font-semibold tracking-tight ${
            value ? 'text-3xl text-white' : 'text-base text-zinc-500'
          }`}
        >
          {value ?? blank}
        </div>
      </div>
    </motion.div>
  );
}
