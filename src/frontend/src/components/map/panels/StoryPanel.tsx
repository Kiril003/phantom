import { useState, useEffect } from 'react';
import { Sparkles, Zap, Brain, X, History } from 'lucide-react';
import { mapApi } from '../../../services/api';

/**
 * Phase 24-H — Story Panel.
 *
 * The map's "consciousness". Displays agent insights, lessons learned
 * in the current area, and mission narrative. Connects the visual
 * state to the system's episodic memory.
 */

export interface MapEvent {
  id: string;
  timestamp: string;
  type: 'insight' | 'lesson' | 'alert' | 'fact';
  content: string;
  lat?: number;
  lon?: number;
  importance: number;
}

export interface StoryPanelProps {
  open: boolean;
  onClose: () => void;
  viewportCenter?: [number, number]; // lat, lon
}

export function StoryPanel({ open, onClose, viewportCenter }: StoryPanelProps) {
  const [events, setEvents] = useState<MapEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchNarrative();
    }
  }, [open, viewportCenter]);

  const fetchNarrative = async () => {
    setLoading(true);
    try {
      // Fetch combined insights: Geo-tagged facts + distilled lessons
      const factsRes = await mapApi.getGeoTaggedFacts(20);
      
      const mappedEvents: MapEvent[] = factsRes.facts.map((f: any) => ({
        id: f.id,
        timestamp: f.created_at,
        type: 'fact',
        content: f.content,
        lat: f.place_lat,
        lon: f.place_lon,
        importance: f.importance || 1
      }));

      // Sort by recency
      mappedEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEvents(mappedEvents);
    } catch (err) {
      console.error('Failed to fetch map narrative:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="absolute top-20 right-[84px] w-80 max-h-[calc(100vh-230px)] flex flex-col bg-ink-primary/95 backdrop-blur-xl border border-black/10 rounded-3xl shadow-2xl overflow-hidden z-20 transition-all animate-in zoom-in-95 duration-300">
      {/* Narrative Header */}
      <div className="p-5 border-b border-black/5 flex items-center justify-between bg-gradient-to-br from-amber-500/10 to-transparent">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
            <Brain size={18} />
          </div>
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[color:var(--ink-primary)]">OmniNarrative</div>
            <div className="text-[9px] text-amber-500/60 font-bold uppercase tracking-widest">Deep Context Engine</div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-xl hover:bg-black/5 text-[color:var(--ink-muted)] transition-all active:scale-90"
        >
          <X size={16} />
        </button>
      </div>

      {/* Narrative Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
        {loading && events.length === 0 ? (
          <div className="py-20 text-center space-y-4">
            <Sparkles size={32} className="mx-auto text-amber-500/20 animate-pulse" />
            <div className="text-[10px] text-[color:var(--ink-muted)] uppercase font-black tracking-widest">Зчитування пам'яті...</div>
          </div>
        ) : events.length === 0 ? (
          <div className="py-20 text-center space-y-3 opacity-20">
            <History size={32} className="mx-auto" />
            <div className="text-[10px] uppercase font-black tracking-widest px-10">Тут ще немає зафіксованих спогадів або інсайтів</div>
          </div>
        ) : (
          <div className="space-y-4">
            {events.map((ev, idx) => (
              <NarrativeCard key={ev.id} event={ev} delay={idx * 0.05} />
            ))}
          </div>
        )}
      </div>

      {/* Footer Branding */}
      <div className="p-4 border-t border-black/5 glass-card flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={12} className="text-amber-500" />
          <span className="text-[8px] font-bold text-[color:var(--ink-muted)] uppercase tracking-tighter italic">Хроніка місця</span>
        </div>
        <div className="text-[8px] font-mono text-[color:var(--ink-primary)]/10 uppercase tracking-widest tabular-nums">
          L-MEM: {events.length} PKTS
        </div>
      </div>
    </div>
  );
}

function NarrativeCard({ event, delay }: { event: MapEvent, delay: number }) {
  const isHighImportance = event.importance > 3;

  return (
    <div 
      className={`group relative p-4 rounded-2xl border transition-all hover:bg-black/5 ${
        isHighImportance 
          ? 'bg-amber-500/5 border-amber-500/20' 
          : 'bg-white/[0.02] border-black/5'
      }`}
      style={{ 
        animation: 'slide-in-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        animationDelay: `${delay}s`
      }}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
          isHighImportance ? 'bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.5)]' : 'bg-white/20'
        }`} />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold text-[color:var(--ink-muted)] mb-1 flex items-center justify-between">
            <span className="uppercase tracking-wider tabular-nums">
              {new Date(event.timestamp).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}
            </span>
            {event.type === 'lesson' && <Sparkles size={10} className="text-amber-500" />}
          </div>
          <div className="text-[13px] leading-relaxed text-[color:var(--ink-primary)] font-serif italic">
            {event.content}
          </div>
        </div>
      </div>
    </div>
  );
}
