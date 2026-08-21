import React, { useState, useMemo } from 'react';
import {
  X,
  BarChart2,
  Activity,
  MessageSquare,
  Sparkles,
  Users,
  Flame,
  ArrowUpRight,
  Clock
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { Chat, SmartFolder } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface FolderInsightsModalProps {
  isOpen: boolean;
  onClose: () => void;
  folder: SmartFolder | null;
  chats: Chat[];
}

export const FolderInsightsModal: React.FC<FolderInsightsModalProps> = ({
  isOpen,
  onClose,
  folder,
  chats,
}) => {
  const [chartType, setChartType] = useState<'area' | 'bar'>('area');

  // Filter chats in this folder
  const folderChats = useMemo(() => {
    if (!folder) return [];
    return chats.filter((c) => {
      if (folder.id === 'all') return true;
      if (folder.chatIds && folder.chatIds.includes(c.id)) return true;
      if (
        folder.filterRules?.includeCircles &&
        folder.filterRules.includeCircles.includes(c.circle)
      ) {
        return true;
      }
      return false;
    });
  }, [folder, chats]);

  // Generate 30-day timeline data
  const { timelineData, total30dMessages, avgDaily, peakDay, topChat } = useMemo(() => {
    if (!folder || folderChats.length === 0) {
      return {
        timelineData: [],
        total30dMessages: 0,
        avgDaily: 0,
        peakDay: { date: '—', count: 0 },
        topChat: null,
      };
    }

    // Base seed from folder id
    const seed = folder.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const totalExistingMsgs = folderChats.reduce((acc, c) => acc + (c.messages?.length || 0), 0);
    const baseMultiplier = Math.max(totalExistingMsgs, 15);

    const days: { date: string; fullDate: string; messages: number; chatsActive: number }[] = [];
    const now = new Date();
    let sum = 0;
    let maxDay = { date: '', count: 0 };

    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const dayIndex = 29 - i;

      // Pseudo-random but deterministic activity curve with weekday boosts
      const wave = Math.sin((dayIndex + seed) * 0.4) * 0.5 + 0.5;
      const randomFactor = ((seed * (dayIndex + 7)) % 17) / 17;
      const weekendDip = isWeekend ? 0.35 : 1.1;

      const count = Math.max(
        1,
        Math.round((baseMultiplier * 0.18 + wave * 12 + randomFactor * 14) * weekendDip)
      );

      const dayStr = d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
      const fullDateStr = d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', weekday: 'short' });

      if (count > maxDay.count) {
        maxDay = { date: dayStr, count };
      }

      sum += count;
      days.push({
        date: dayStr,
        fullDate: fullDateStr,
        messages: count,
        chatsActive: Math.min(folderChats.length, Math.max(1, Math.round(count / 8))),
      });
    }

    // Find top chat by message count
    const sortedChats = [...folderChats].sort(
      (a, b) => (b.messages?.length || 0) - (a.messages?.length || 0)
    );

    return {
      timelineData: days,
      total30dMessages: sum,
      avgDaily: (sum / 30).toFixed(1),
      peakDay: maxDay,
      topChat: sortedChats[0] || null,
    };
  }, [folder, folderChats]);

  if (!isOpen || !folder) return null;

  const accentColor = folder.color || '#E87A42';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150 select-none">
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-[#121A15] border border-[#2B3C30] rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-[#E4EDE7] animate-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="p-4 border-b border-[#1F2B22] bg-[#141C16] flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg shadow-sm shrink-0"
              style={{
                backgroundColor: `${accentColor}25`,
                border: `1px solid ${accentColor}45`,
              }}
            >
              <span>{folder.emoji}</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-sm text-white truncate">
                  {folder.name}
                </h3>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-extrabold shadow-sm"
                  style={{
                    backgroundColor: `${accentColor}20`,
                    color: accentColor,
                    border: `1px solid ${accentColor}40`,
                  }}
                >
                  Insights 30D
                </span>
              </div>
              <p className="text-[11px] text-[#8EA093] truncate">
                {folder.vibe || 'Аналітика частоти повідомлень простору'}
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="p-1.5 hover:bg-[#1E2A21] rounded-xl text-[#8EA093] hover:text-white transition-colors shrink-0"
            title="Закрити"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* 1. Summary KPI Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-3 bg-white border border-[#DFD6C5] rounded-2xl shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[#717E75]">
                <span className="text-[10px] font-bold uppercase tracking-wider">Повідомлень</span>
                <MessageSquare className="w-3.5 h-3.5" style={{ color: accentColor }} />
              </div>
              <div className="text-xl font-black text-[#1F2521] tracking-tight">
                {total30dMessages}
              </div>
              <div className="text-[10px] text-[#528A4B] font-bold flex items-center gap-0.5">
                <ArrowUpRight className="w-3 h-3" />
                <span>+14.8% за 30д</span>
              </div>
            </div>

            <div className="p-3 bg-white border border-[#DFD6C5] rounded-2xl shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[#717E75]">
                <span className="text-[10px] font-bold uppercase tracking-wider">Сер. / день</span>
                <Activity className="w-3.5 h-3.5 text-[#528A4B]" />
              </div>
              <div className="text-xl font-black text-[#1F2521] tracking-tight">
                {avgDaily}
              </div>
              <div className="text-[10px] text-[#717E75]">пов. на добу</div>
            </div>

            <div className="p-3 bg-white border border-[#DFD6C5] rounded-2xl shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[#717E75]">
                <span className="text-[10px] font-bold uppercase tracking-wider">Піковий день</span>
                <Flame className="w-3.5 h-3.5 text-[#E87A42]" />
              </div>
              <div className="text-sm font-black text-[#1F2521] truncate pt-0.5">
                {peakDay.date}
              </div>
              <div className="text-[10px] text-[#717E75]">
                {peakDay.count} повідомлень
              </div>
            </div>

            <div className="p-3 bg-white border border-[#DFD6C5] rounded-2xl shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[#717E75]">
                <span className="text-[10px] font-bold uppercase tracking-wider">Топ бесіда</span>
                <Users className="w-3.5 h-3.5 text-[#7C3AED]" />
              </div>
              <div className="text-xs font-black text-[#1F2521] truncate pt-0.5" title={topChat?.title}>
                {topChat?.title || '—'}
              </div>
              <div className="text-[10px] text-[#717E75] truncate">
                {folderChats.length} чатів у папці
              </div>
            </div>
          </div>

          {/* 2. Visual Frequency Chart Section */}
          <div className="bg-white border border-[#DFD6C5] rounded-2xl p-3.5 space-y-3 shadow-2xs">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4" style={{ color: accentColor }} />
                <h4 className="font-extrabold text-xs text-[#1F2521]">
                  Динаміка повідомлень (30 днів)
                </h4>
              </div>

              {/* Toggle Chart Type */}
              <div className="flex items-center gap-1 bg-[#F6EFE3] p-1 rounded-xl border border-[#DFD6C5]">
                <button
                  onClick={() => {
                    soundFx.playTap();
                    setChartType('area');
                  }}
                  className={`px-2 py-1 text-[10px] font-bold rounded-lg transition-colors ${
                    chartType === 'area'
                      ? 'bg-white text-[#1F2521] shadow-2xs'
                      : 'text-[#717E75] hover:text-[#1F2521]'
                  }`}
                >
                  Графік
                </button>
                <button
                  onClick={() => {
                    soundFx.playTap();
                    setChartType('bar');
                  }}
                  className={`px-2 py-1 text-[10px] font-bold rounded-lg transition-colors ${
                    chartType === 'bar'
                      ? 'bg-white text-[#1F2521] shadow-2xs'
                      : 'text-[#717E75] hover:text-[#1F2521]'
                  }`}
                >
                  Стовпчики
                </button>
              </div>
            </div>

            {/* Chart Canvas */}
            <div className="w-full h-56 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                {chartType === 'area' ? (
                  <AreaChart
                    data={timelineData}
                    margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="folderGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={accentColor} stopOpacity={0.4} />
                        <stop offset="95%" stopColor={accentColor} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F4ECE0" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: '#8C988E', fontSize: 10 }}
                      stroke="#E5DAC8"
                      tickLine={false}
                      interval={4}
                    />
                    <YAxis
                      tick={{ fill: '#8C988E', fontSize: 10 }}
                      stroke="#E5DAC8"
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const d = payload[0].payload;
                          return (
                            <div className="bg-[#FAF8F3] border border-[#DFD6C5] p-2.5 rounded-xl shadow-xl space-y-1 text-xs">
                              <div className="font-extrabold text-[11px] text-[#1F2521] border-b border-[#EAE0D0] pb-1">
                                {d.fullDate}
                              </div>
                              <div className="flex items-center justify-between gap-4 font-semibold text-[#5E6B62]">
                                <span>Повідомлень:</span>
                                <span className="font-black font-mono text-[#1F2521]">
                                  {d.messages}
                                </span>
                              </div>
                              <div className="text-[10px] text-[#8C988E]">
                                Активних чатів: {d.chatsActive}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="messages"
                      stroke={accentColor}
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#folderGradient)"
                    />
                  </AreaChart>
                ) : (
                  <BarChart
                    data={timelineData}
                    margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#F4ECE0" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: '#8C988E', fontSize: 10 }}
                      stroke="#E5DAC8"
                      tickLine={false}
                      interval={4}
                    />
                    <YAxis
                      tick={{ fill: '#8C988E', fontSize: 10 }}
                      stroke="#E5DAC8"
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const d = payload[0].payload;
                          return (
                            <div className="bg-[#FAF8F3] border border-[#DFD6C5] p-2.5 rounded-xl shadow-xl space-y-1 text-xs">
                              <div className="font-extrabold text-[11px] text-[#1F2521] border-b border-[#EAE0D0] pb-1">
                                {d.fullDate}
                              </div>
                              <div className="flex items-center justify-between gap-4 font-semibold text-[#5E6B62]">
                                <span>Повідомлень:</span>
                                <span className="font-black font-mono text-[#1F2521]">
                                  {d.messages}
                                </span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar
                      dataKey="messages"
                      fill={accentColor}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          {/* 3. Breakdown of Top Chats in this folder */}
          <div className="bg-white border border-[#DFD6C5] rounded-2xl p-3.5 space-y-2.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#5E6B62] uppercase tracking-wider">
                Розподіл активності за чатами
              </span>
              <span className="text-[10px] text-[#717E75]">
                Всього {folderChats.length} бесід
              </span>
            </div>

            <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
              {folderChats.length === 0 ? (
                <p className="text-center text-[#8C988E] py-2">У цій папці немає чатів</p>
              ) : (
                folderChats.slice(0, 4).map((chat, idx) => {
                  const msgs = chat.messages?.length || 1;
                  const percent = Math.min(100, Math.round((msgs / (total30dMessages || 1)) * 100));
                  return (
                    <div key={chat.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <img
                            src={chat.avatar}
                            alt={chat.title}
                            className="w-5 h-5 rounded-lg object-cover ring-1 ring-[#DFD6C5] shrink-0"
                          />
                          <span className="font-bold text-[#1F2521] truncate">
                            {chat.title}
                          </span>
                        </div>
                        <span className="font-mono text-[11px] text-[#717E75] shrink-0">
                          {msgs} пов. ({percent}%)
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-[#F2ECE2] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.max(8, percent)}%`,
                            backgroundColor: idx === 0 ? accentColor : idx === 1 ? '#528A4B' : '#7C3AED',
                          }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 4. Organic Workspace Vibe Highlight */}
          <div className="p-3 bg-[#FAF5ED] border border-[#EAE0D0] rounded-2xl flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 shrink-0 mt-0.5" style={{ color: accentColor }} />
            <div className="space-y-0.5 text-xs text-[#5E6B62]">
              <span className="font-bold text-[#1F2521] block">
                Синхронізація ритму простору
              </span>
              <p className="text-[11px] leading-relaxed">
                Найвища активність фіксується у робочі дні з 11:00 до 17:00. Простір відповідає заданому Vibe: «{folder.vibe || 'Deep Focus'}».
              </p>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 border-t border-[#EAE0D0] bg-[#F6EFE3] flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] text-[#717E75]">
            <Clock className="w-3.5 h-3.5" />
            <span>Оновлено: щойно</span>
          </div>

          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="px-4 py-2 bg-[#1F2521] hover:bg-[#333C35] text-white rounded-xl font-bold text-xs transition-colors shadow-xs"
          >
            Зрозуміло
          </button>
        </div>
      </div>
    </div>
  );
};
