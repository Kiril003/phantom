import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { useMissionStore } from '../../stores/missionStore';
import { useUIStore } from '../../stores/uiStore';
import type { MissionPhase, MissionStatus } from '@shared/types/mission';
import type { ExportMissionRequest } from '../../services/missionApi';

interface Props {
  missionId: string;
  onClose: () => void;
}

const ACTIVE_STATUSES: MissionStatus[] = [
  'planning',
  'running',
  'paused',
  'awaiting_user',
  'blocked_quota',
];

const STATUS_META: Record<MissionStatus, { label: string; color: string; bg: string }> = {
  planning: { label: 'PLANNING', color: '#5B8FCC', bg: 'rgba(91,143,204,0.16)' },
  running: { label: 'RUNNING', color: '#A36F1F', bg: 'rgba(244,175,37,0.18)' },
  paused: { label: 'PAUSED', color: '#5B8FCC', bg: 'rgba(91,143,204,0.14)' },
  awaiting_user: { label: 'WAITING', color: '#A36F1F', bg: 'rgba(244,175,37,0.18)' },
  blocked_quota: { label: 'QUOTA', color: '#8A6B3F', bg: 'rgba(180,140,80,0.16)' },
  done: { label: 'DONE', color: '#0E6A2A', bg: 'rgba(34,197,94,0.16)' },
  failed: { label: 'FAILED', color: '#B9201F', bg: 'rgba(185,32,31,0.14)' },
  stopped: { label: 'STOPPED', color: '#8A6B3F', bg: 'rgba(180,140,80,0.14)' },
  abandoned: { label: 'ABANDONED', color: '#6B5C42', bg: 'rgba(120,90,50,0.14)' },
};

function PhaseRow({ phase }: { phase: MissionPhase }) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[phase.status] ?? STATUS_META.planning;
  const artifacts = phase.artifacts_json ?? [];

  const PhaseIcon =
    phase.status === 'done'
      ? CheckCircle2
      : phase.status === 'failed'
      ? AlertTriangle
      : Clock;

  return (
    <div
      className="glass-panel"
      style={{
        borderRadius: 12,
        background: 'rgba(255,255,255,0.6)',
        border: '1px solid rgba(255,255,255,0.4)',
        overflow: 'hidden',
        boxShadow: '0 4px 12px rgba(0,0,0,0.02)',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          width: '100%',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          minHeight: 44,
        }}
        aria-expanded={expanded}
      >
        <PhaseIcon
          size={14}
          style={{ color: meta.color, flexShrink: 0 }}
        />
        <span
          className="font-mono text-[10px] text-neutral-500 shrink-0"
        >
          {String(phase.idx + 1).padStart(2, '0')}
        </span>
        <span
          className="flex-1 text-[13px] font-bold text-slate-800 leading-snug font-display"
        >
          {phase.description}
        </span>
        <span
          className="px-2 py-0.5 rounded-full font-bold font-mono text-[9px] tracking-widest shrink-0"
          style={{ background: meta.bg, color: meta.color }}
        >
          {meta.label}
        </span>
        {expanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{
                padding: '0 14px 14px 40px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {phase.success_criteria && (
                <div>
                  <div className="micro-label text-[9px] text-neutral-400 mb-1">Success criteria</div>
                  <div className="text-[11px] text-slate-600 leading-relaxed">{phase.success_criteria}</div>
                </div>
              )}
              {artifacts.length > 0 && (
                <div className="pt-2 border-t border-black/5">
                  <div className="micro-label text-[9px] text-neutral-400 mb-2">Artifacts</div>
                  <div className="flex flex-col gap-1.5">
                    {artifacts.map((a, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-[10px] font-mono text-slate-500"
                      >
                        {a.produced ? (
                          <CheckCircle2 size={10} className="text-green-600" />
                        ) : (
                          <Clock size={10} />
                        )}
                        <span className="truncate">{a.path}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function MissionDetailScreen({ missionId, onClose }: Props) {
  const loadMission = useMissionStore((s) => s.loadMission);
  const currentMission = useMissionStore((s) => s.currentMission);
  const composeReport = useMissionStore((s) => s.composeReport);
  const exportMission = useMissionStore((s) => s.exportMission);
  const loadingReport = useMissionStore((s) => s.loading.report);
  const loadingExport = useMissionStore((s) => s.loading.export);
  const toast = useUIStore((s) => s.toast);
  const setReportOpen = useUIStore((s) => s.setMissionReportOpen);

  const ledgerRef = useRef<HTMLPreElement>(null);

  const mission = currentMission?.id === missionId ? currentMission : null;
  const isActive = mission ? ACTIVE_STATUSES.includes(mission.status) : false;

  useEffect(() => {
    loadMission(missionId).catch(() => undefined);
  }, [missionId, loadMission]);

  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => {
      loadMission(missionId).catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [isActive, missionId, loadMission]);

  useEffect(() => {
    if (ledgerRef.current) {
      ledgerRef.current.scrollTop = ledgerRef.current.scrollHeight;
    }
  }, [mission?.ledger_text]);

  const handleComposeReport = async () => {
    try {
      await composeReport(missionId);
      setReportOpen(true);
    } catch (err) {
      toast({ kind: 'error', message: err instanceof Error ? err.message : 'Report failed' });
    }
  };

  const handleExport = async (format: ExportMissionRequest['format']) => {
    try {
      const resp = await exportMission(missionId, { format });
      toast({ kind: 'success', message: `Exported to ${resp.path}` });
    } catch (err) {
      toast({ kind: 'error', message: err instanceof Error ? err.message : 'Export failed' });
    }
  };

  const statusMeta = mission ? (STATUS_META[mission.status] ?? STATUS_META.planning) : STATUS_META.planning;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 flex items-center justify-center p-4"
        style={{ zIndex: 100, background: 'rgba(28,22,14,0.7)', backdropFilter: 'blur(30px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
      >
        <motion.div
          className="glass-strong flex flex-col"
          style={{
            width: 900,
            height: 540,
            borderRadius: 24,
            background: 'rgba(255,255,255,0.92)',
            boxShadow: '0 40px 100px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.5)',
            overflow: 'hidden',
          }}
          initial={{ scale: 0.96, y: 30 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.96, y: 30 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          {/* Header */}
          <header
            className="flex items-center justify-between px-6 py-4 border-b border-black/5 bg-white/20 shrink-0"
          >
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="micro-label text-primary-deep font-bold">MISSION_PROTO</span>
              <h1 className="text-[18px] font-bold text-slate-900 font-display truncate pr-4">
                {mission?.brief || 'INITIALIZING MISSION...'}
              </h1>
            </div>

            <div className="flex items-center gap-4 shrink-0">
               {mission && (
                 <div className="flex items-center gap-3 pr-4 border-r border-black/5">
                    <span className="px-2.5 py-1 rounded-full font-bold font-mono text-[10px] tracking-widest" style={{ background: statusMeta.bg, color: statusMeta.color }}>
                       {statusMeta.label}
                    </span>
                    <span className="text-[11px] font-bold text-slate-400 font-mono">
                       {mission.phases_done}/{mission.phase_count} PHASES
                    </span>
                 </div>
               )}
               <button
                 onClick={onClose}
                 className="w-10 h-10 flex items-center justify-center rounded-xl bg-black/5 hover:bg-black/10 transition-colors"
               >
                 <X size={20} className="text-slate-500" />
               </button>
            </div>
          </header>

          {/* Body */}
          <div className="flex-1 grid grid-cols-12 gap-4 p-5 min-h-0">
            {/* Timeline */}
            <div className="col-span-5 flex flex-col gap-3 min-h-0">
               <span className="micro-label text-slate-400 px-1">Phase timeline</span>
               <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-2 scrollbar-thin">
                 {mission?.phases.map((phase) => (
                   <PhaseRow key={phase.id} phase={phase} />
                 ))}
               </div>
            </div>

            {/* Ledger */}
            <div className="col-span-7 flex flex-col gap-3 min-h-0">
               <div className="flex items-center justify-between px-1">
                  <span className="micro-label text-slate-400">Ledger</span>
                  {isActive && <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold font-mono text-[9px] animate-pulse">LIVE</div>}
               </div>
               <div className="flex-1 bg-black/[0.03] border border-black/5 rounded-2xl overflow-hidden relative">
                 <pre
                    ref={ledgerRef}
                    className="absolute inset-0 p-4 font-mono text-[11px] text-slate-700 leading-relaxed overflow-y-auto whitespace-pre-wrap"
                 >
                    {mission?.ledger_text || '—'}
                 </pre>
               </div>
            </div>
          </div>

          {/* Footer */}
          <footer className="shrink-0 px-6 py-4 border-t border-black/5 flex items-center justify-between bg-black/5">
             <div className="flex items-center gap-2">
                <ActionBtn label="Compose report" busy={loadingReport} onClick={handleComposeReport} primary />
                <div className="w-px h-6 bg-black/10 mx-1" />
                <ActionBtn label="Export PDF" busy={loadingExport} onClick={() => handleExport('pdf')} />
                <ActionBtn label="Export Ledger" busy={loadingExport} onClick={() => handleExport('ledger_md')} />
             </div>

             {mission?.ledger_path && (
               <div className="text-[10px] font-mono text-slate-400 tabular uppercase tracking-tighter opacity-60">
                 VAULT://{mission.ledger_path.split('/').pop()}
               </div>
             )}
          </footer>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function ActionBtn({
  label,
  busy,
  onClick,
  primary = false,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        minHeight: 44,
        padding: '0 16px',
        borderRadius: 12,
        background: primary
          ? 'linear-gradient(180deg, var(--primary, #F4AF25) 0%, #E89A1C 100%)'
          : 'rgba(180,150,90,0.10)',
        border: primary
          ? '1px solid rgba(168,118,18,0.40)'
          : '1px solid rgba(180,150,90,0.22)',
        color: primary ? '#1F1308' : 'var(--ink-strong)',
        cursor: busy ? 'wait' : 'pointer',
        fontSize: 12,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        boxShadow: primary ? '0 6px 16px rgba(244,175,37,0.22)' : 'none',
      }}
    >
      {busy && <Loader2 size={12} className="animate-spin" />}
      {label}
    </button>
  );
}
