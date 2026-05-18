import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  AlertTriangle,
  Scale,
  X,
  ArrowRightCircle,
  History,
} from 'lucide-react';
import type {
  AgentTaskReport,
} from '@shared/types';

interface Props {
  report: AgentTaskReport;
  onClose: () => void;
  onContinueAsConversation: () => void;
  onOpenHistory?: () => void;
  busy?: boolean;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0с';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}с`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}хв ${rs}с` : `${m}хв`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}год ${rm}хв` : `${h}год`;
}

export function AgentReportScreen({
  report,
  onClose,
  onContinueAsConversation,
  onOpenHistory,
  busy = false,
}: Props) {
  const achievements = useMemo(() => report.achievements ?? [], [report]);
  const obstacles = useMemo(() => report.obstacles ?? [], [report]);
  const decisions = useMemo(() => report.key_decisions ?? [], [report]);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 flex items-center justify-center p-4"
        style={{
          zIndex: 120,
          background: 'rgba(28,22,14,0.75)',
          backdropFilter: 'blur(40px)',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
      >
        <motion.div
          className="glass flex flex-col shadow-2xl"
          style={{
            width: 880,
            height: 540,
            borderRadius: 24,
            background: 'rgba(255,255,255,0.95)',
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.5)',
          }}
          initial={{ scale: 0.96, y: 30 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.96, y: 30 }}
          transition={{ duration: 0.3 }}
          role="dialog"
          aria-label="Підсумковий звіт"
        >
          {/* Header */}
          <header
            className="flex items-center justify-between px-6 py-4 border-b border-black/5 bg-white/10 shrink-0"
          >
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="micro-label text-primary-deep font-bold">TASK_COMPLETION_REPORT</span>
              <h1 className="text-[20px] font-bold text-slate-900 font-display truncate pr-4">
                {report.goal || 'Без назви'}
              </h1>
            </div>

            <div className="flex items-center gap-4 shrink-0">
               <div className="flex flex-col items-end gap-1 px-4 border-r border-black/5">
                  <span className="px-2.5 py-1 rounded-full font-bold font-mono text-[9px] tracking-widest uppercase bg-green-50 text-green-700">
                     {report.status.toUpperCase()}
                  </span>
                  <span className="text-[9px] text-slate-400 font-mono uppercase">
                    {formatDuration(report.duration_ms)} EXECUTION
                  </span>
               </div>
               <button
                 onClick={onClose}
                 className="w-10 h-10 flex items-center justify-center rounded-xl bg-black/5 hover:bg-black/10 transition-colors"
               >
                 <X size={20} className="text-slate-500" />
               </button>
            </div>
          </header>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 grid grid-cols-4 gap-4 scrollbar-thin">
            <div className="flex flex-col gap-2">
               <div className="micro-label text-green-600 flex items-center gap-2 mb-1">
                  <CheckCircle2 size={12} /> Досягнуто
               </div>
               {achievements.length > 0 ? (
                 <ul className="flex flex-col gap-3">
                   {achievements.map((a, i) => (
                     <li key={i} className="text-[13px] text-slate-800 leading-relaxed border-l-2 border-green-500/20 pl-3 py-0.5">{a}</li>
                   ))}
                 </ul>
               ) : <span className="text-xs text-slate-400 italic">Жодних досягнень...</span>}
            </div>

            <div className="flex flex-col gap-2">
               <div className="micro-label text-amber-600 flex items-center gap-2 mb-1">
                  <AlertTriangle size={12} /> Перешкоди
               </div>
               {obstacles.length > 0 ? (
                 <ul className="flex flex-col gap-3">
                   {obstacles.map((o, i) => (
                     <li key={i} className="text-[13px] text-slate-800 leading-relaxed border-l-2 border-amber-500/20 pl-3 py-0.5">{o}</li>
                   ))}
                 </ul>
               ) : <span className="text-xs text-slate-400 italic">Працювало без збоїв</span>}
            </div>

            <div className="col-span-2 flex flex-col gap-2">
               <div className="micro-label text-slate-500 flex items-center gap-2 mb-1">
                  <Scale size={12} /> Ключові рішення
               </div>
               <div className="flex flex-col gap-3">
                 {decisions.map((d, i) => (
                   <div key={i} className="bg-black/[0.03] border border-black/5 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1">
                         <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{d.verdict}</span>
                         <span className="text-[9px] font-mono text-slate-400">CF {d.confidence.toFixed(2)}</span>
                      </div>
                      <div className="text-[12px] text-slate-800 leading-snug">{d.summary}</div>
                   </div>
                 ))}
                 {decisions.length === 0 && <span className="text-xs text-slate-400 italic">Рішень не приймалося</span>}
               </div>
            </div>
          </div>

          {/* Footer */}
          <footer className="shrink-0 px-6 py-4 border-t border-black/5 flex items-center justify-between bg-black/5">
             <button onClick={onOpenHistory} disabled={busy || !onOpenHistory} className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-primary transition-colors font-bold text-xs uppercase tracking-widest">
                <History size={16} /> Історія
             </button>

             <div className="flex items-center gap-3">
                <button onClick={onClose} className="px-5 py-2.5 bg-black/5 text-slate-700 rounded-xl font-bold text-xs hover:bg-black/10 transition-all">
                   Закрити
                </button>
                <button onClick={onContinueAsConversation} className="px-6 py-2.5 bg-primary text-white rounded-xl font-bold text-xs shadow-lg shadow-primary/25 hover:scale-105 transition-all flex items-center gap-2">
                   <ArrowRightCircle size={16} /> Продовжити як розмову
                </button>
             </div>
          </footer>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
