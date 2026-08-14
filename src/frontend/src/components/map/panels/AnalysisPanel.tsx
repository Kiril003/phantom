import { useState, useEffect, useMemo } from 'react';
import { X, Ruler, Mountain, MousePointer2, Activity } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { mapApi } from '../../../services/api';
import { useMapStore } from '../../../stores/mapStore';

/**
 * Phase 24-G — Analysis Panel.
 *
 * Tactical surface for spatial intelligence. Provides:
 * - Line-of-sight analysis (future)
 * - Measurement (distance/area)
 * - Elevation profiles along path
 * - Signal coverage simulation (future)
 */

export interface AnalysisPanelProps {
  open: boolean;
  onClose: () => void;
  selectedPath?: [number, number][]; // lat, lon
}

export function AnalysisPanel({ open, onClose, selectedPath = [] }: AnalysisPanelProps) {
  const [profile, setProfile] = useState<{ distance_m: number; elevation_m: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<'none' | 'measure' | 'elevation'>('none');

  useEffect(() => {
    if (open && selectedPath.length >= 2 && activeTool === 'elevation') {
      fetchProfile();
    }
  }, [open, selectedPath, activeTool]);

  const fetchProfile = async () => {
    setLoading(true);
    setRefusal(null);
    try {
      const res = await mapApi.elevationProfile(selectedPath);
      setProfile(res.profile);
    } catch (err) {
      // Бекенд відмовляє 503-ю, коли DEM не встановлено. Порожній графік без
      // пояснення — та сама неправда, лише тихіша, тож несемо причину в панель.
      setProfile([]);
      setRefusal(
        (err as { status?: number })?.status === 503
          ? 'DEM не встановлено — рельєф нема з чого читати.'
          : `Не вдалося отримати профіль: ${(err as Error)?.message ?? 'причина невідома'}`,
      );
    } finally {
      setLoading(false);
    }
  };

  const totalDistance = useMemo(() => {
    if (profile.length === 0) return 0;
    return profile[profile.length - 1].distance_m;
  }, [profile]);

  // Порожній профіль повертаємо нулем окремо: сіяти нулем сам Math.min/max означало б,
  // що мінімум ніколи не підніметься вище рівня моря, а вся Україна лежить вище.
  const minElev = useMemo(
    () => (profile.length === 0 ? 0 : Math.min(...profile.map(p => p.elevation_m))),
    [profile],
  );
  const maxElev = useMemo(
    () => (profile.length === 0 ? 0 : Math.max(...profile.map(p => p.elevation_m))),
    [profile],
  );

  const tactical = useMapStore((s) => s.tactical);
  const hasFix = tactical.fix;
  const fixLabel = hasFix
    ? `Фікс за супутниками · ${tactical.satellites}`
    : tactical.lat != null
      ? 'Фіксу немає · місце приблизне'
      : 'Місце невідоме';

  if (!open) return null;

  return (
    <div className="absolute top-20 right-[84px] w-80 max-h-[calc(100vh-230px)] flex flex-col glass-elevated rounded-2xl shadow-2xl overflow-hidden z-20 transition-all animate-in slide-in-from-right-8">
      {/* Header */}
      <div className="p-4 border-b border-black/5 flex items-center justify-between bg-black/[0.04]">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-amber-500" />
          <span className="text-xs font-bold uppercase tracking-widest text-[color:var(--ink-primary)]">Аналітика</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-full hover:bg-black/10 text-[color:var(--ink-muted)] transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 p-2 bg-black/[0.04] border-b border-black/5">
        <ToolButton 
          icon={<MousePointer2 size={14} />} 
          active={activeTool === 'none'} 
          onClick={() => setActiveTool('none')}
          label="Вибір"
        />
        <ToolButton 
          icon={<Ruler size={14} />} 
          active={activeTool === 'measure'} 
          onClick={() => setActiveTool('measure')}
          label="Лінійка"
        />
        <ToolButton 
          icon={<Mountain size={14} />} 
          active={activeTool === 'elevation'} 
          onClick={() => setActiveTool('elevation')}
          label="Рельєф"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
        {activeTool === 'none' && (
          <div className="py-10 text-center space-y-2 opacity-40">
            <MousePointer2 size={32} className="mx-auto" />
            <div className="text-[10px] uppercase font-bold tracking-tighter">Оберіть інструмент або об'єкт на мапі</div>
          </div>
        )}

        {activeTool === 'measure' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-black/[0.04] border border-black/5">
              <div className="text-[10px] text-[color:var(--ink-muted)] uppercase font-bold mb-1">Відстань</div>
              <div className="text-2xl font-display text-[color:var(--ink-primary)]">
                {totalDistance > 1000 
                  ? `${(totalDistance / 1000).toFixed(2)} км` 
                  : `${Math.round(totalDistance)} м`}
              </div>
            </div>
            <div className="text-[10px] text-[color:var(--ink-muted)] leading-relaxed italic px-1">
              Натисніть на мапу, щоб побудувати маршрут для вимірювання.
            </div>
          </div>
        )}

        {activeTool === 'elevation' && (
          <div className="space-y-4">
            {selectedPath.length < 2 ? (
              <div className="py-10 text-center space-y-2 opacity-40">
                <Mountain size={32} className="mx-auto" />
                <div className="text-[10px] uppercase font-bold tracking-tighter">Побудуйте лінію для профілю висот</div>
              </div>
            ) : loading ? (
              <div className="py-10 text-center space-y-2 opacity-40 animate-pulse">
                <Mountain size={32} className="mx-auto" />
                <div className="text-[10px] uppercase font-bold tracking-tighter">Обчислення...</div>
              </div>
            ) : refusal ? (
              <div className="py-8 text-center space-y-2" role="status">
                <Mountain size={32} className="mx-auto opacity-40" />
                <div className="text-[10px] uppercase font-bold tracking-tighter text-[color:var(--ink-secondary)]">
                  Даних про висоту немає
                </div>
                <div className="px-2 text-[10px] leading-relaxed text-[color:var(--ink-muted)]">{refusal}</div>
              </div>
            ) : profile.length === 0 ? (
              <div className="py-10 text-center space-y-2 opacity-40">
                <Mountain size={32} className="mx-auto" />
                <div className="text-[10px] uppercase font-bold tracking-tighter">Профілю ще немає</div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-xl bg-black/[0.04] border border-black/5">
                    <div className="text-[10px] text-[color:var(--ink-muted)] uppercase font-bold mb-1">Мін. висота</div>
                    <div className="text-lg font-display text-[color:var(--ink-primary)]">{Math.round(minElev)} м</div>
                  </div>
                  <div className="p-3 rounded-xl bg-black/[0.04] border border-black/5">
                    <div className="text-[10px] text-[color:var(--ink-muted)] uppercase font-bold mb-1">Макс. висота</div>
                    <div className="text-lg font-display text-[color:var(--ink-primary)]">{Math.round(maxElev)} м</div>
                  </div>
                </div>

                <div className="h-48 w-full mt-4 bg-black/[0.04] rounded-xl border border-black/5 p-2 overflow-hidden">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={profile}>
                      <defs>
                        <linearGradient id="colorElev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="distance_m" hide />
                      <YAxis domain={[minElev - 10, maxElev + 10]} hide />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const d = payload[0].payload;
                            return (
                              <div className="bg-ink-primary/95 border border-black/10 p-2 rounded text-[10px] font-bold">
                                <div>{d.distance_m.toFixed(0)} м</div>
                                <div className="text-amber-500">{d.elevation_m.toFixed(1)} м</div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="elevation_m"
                        stroke="#f59e0b"
                        fillOpacity={1}
                        fill="url(#colorElev)"
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Тут світилось «RTK Fix: Active» — намертво вписаним рядком, поки
          приймач бачив нуль супутників. Показуємо те, що є насправді. */}
      <div className="flex items-center justify-between border-t border-black/5 bg-black/[0.04] p-3 text-[10px] font-bold uppercase tracking-wider text-[color:var(--ink-muted)]">
        <span>{fixLabel}</span>
        <span className={`flex items-center gap-1 ${hasFix ? 'text-emerald-600' : 'text-[color:var(--ink-muted)]'}`}>
          <div className={`h-1 w-1 rounded-full bg-current ${hasFix ? 'animate-pulse' : ''}`} />
          {hasFix ? 'Наживо' : 'Без фіксу'}
        </span>
      </div>
    </div>
  );
}

function ToolButton({ icon, active, onClick, label }: { icon: React.ReactNode, active: boolean, onClick: () => void, label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${
        active 
          ? 'bg-amber-500/20 text-amber-500 shadow-[inset_0_0_10px_rgba(245,158,11,0.1)]' 
          : 'text-[color:var(--ink-muted)] hover:bg-black/5 hover:text-[color:var(--ink-secondary)]'
      }`}
    >
      {icon}
      <span className="text-[8px] font-bold tracking-tighter uppercase">{label}</span>
    </button>
  );
}
