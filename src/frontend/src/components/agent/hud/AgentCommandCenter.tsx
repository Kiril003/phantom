import { useState, useRef, useEffect } from 'react';
import {
  Mic, Loader2,
  Pause, Play, OctagonX,
  History, MessageCircle, Send,
} from 'lucide-react';
import { useAgentStore } from '../../../stores/agentStore';
import { useUIStore } from '../../../stores/uiStore';
import { useVoiceRecorder } from '../../../hooks/useVoiceRecorder';
import { voiceApi } from '../../../services/voiceApi';
import { sanitizeInput } from '../../../utils/format';

interface Props {
  onOpenParallelChat: () => void;
  /** Called when the operator presses RUN in [Mission] mode. */
  onStartMission?: (brief: string) => void;
  onOpenPlanEditor?: () => void;
}

export function AgentCommandCenter({ onOpenParallelChat, onStartMission }: Props) {
  const status = useAgentStore((s) => s.status);
  const currentTask = useAgentStore((s) => s.currentTask);
  const startTask = useAgentStore((s) => s.startTask);
  const pauseTask = useAgentStore((s) => s.pauseTask);
  const resumeTask = useAgentStore((s) => s.resumeTask);
  const stopTask = useAgentStore((s) => s.stopTask);
  const toast = useUIStore((s) => s.toast);
  const missionModeArmed = useUIStore((s) => s.missionModeArmed);
  const setMissionModeArmed = useUIStore((s) => s.setMissionModeArmed);
  
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const recorder = useVoiceRecorder();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const taskActive = currentTask !== null && !['idle', 'done', 'failed', 'stopped'].includes(status);
  const isPaused = status === 'paused';
  const canRun = !taskActive && value.trim().length > 0;

  // Auto-resize textarea logic
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [value]);

  const submitGoal = async () => {
    const rawGoal = value.trim();
    if (!rawGoal || busy || taskActive) return;
    
    const goal = sanitizeInput(rawGoal);

    if (missionModeArmed && onStartMission) {
      onStartMission(goal);
      setValue('');
      return;
    }

    setBusy(true);
    try {
      await startTask(goal);
      setValue('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не вдалось запустити задачу';
      toast({ kind: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  };

  const onMicPress = async () => {
    if (recorder.state === 'recording') {
      try {
        const blob = await recorder.stop();
        if (!blob) return;
        setTranscribing(true);
        const result = await voiceApi.transcribe(blob);
        const text = sanitizeInput(result?.text ?? '').trim();
        if (text) {
          setValue((prev) => (prev ? `${prev.trimEnd()} ${text}` : text));
        }
      } catch (err) {
        console.error('Mic failed', err);
      } finally {
        setTranscribing(false);
      }
      return;
    }
    if (recorder.state === 'idle') {
      try {
        await recorder.start();
      } catch (err) {
        console.error('Mic start failed', err);
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitGoal();
    }
  };

  const recording = recorder.state === 'recording' || recorder.state === 'requesting';

  // ── Sunrise Premium Integrated Terminal ──────────────────────────────────
  return (
    <div 
      className="flex items-end gap-3 px-3 py-1.5 relative z-50 pointer-events-auto transition-all duration-300" 
      style={{
        borderRadius: 24,
        width: '100%',
        maxWidth: 800,
        minHeight: 52,
        background: 'rgba(255, 255, 255, 0.98)',
        backdropFilter: 'blur(30px)',
        border: '1px solid rgba(120, 70, 10, 0.15)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.8)',
      }}
    >
      <div className="flex items-center gap-1 shrink-0 mb-1">
        <button
          onClick={() => useUIStore.getState().toggleAgentHistory()}
          className="w-9 h-9 flex items-center justify-center hover:bg-black/5 rounded-xl text-amber-900/60 hover:text-primary transition-all active:scale-90"
          title="Історія"
        >
          <History size={18} />
        </button>
        <button
          onClick={onOpenParallelChat}
          className="w-9 h-9 flex items-center justify-center hover:bg-black/5 rounded-xl text-amber-900/60 hover:text-primary transition-all active:scale-90"
          title="Паралельний чат"
        >
          <MessageCircle size={18} />
        </button>
      </div>

      <div className="w-px h-6 bg-amber-900/10 mx-0.5 mb-2" />

      <div className="flex-1 flex items-end gap-2 bg-black/[0.04] rounded-xl px-3 py-2 border border-black/5 focus-within:border-primary/40 transition-all mb-0.5">
        <button
          onClick={onMicPress}
          className={`flex items-center justify-center rounded-full transition-all shrink-0 mb-0.5 ${recording ? 'bg-red-500 text-white shadow-lg' : 'text-primary/60 hover:text-primary'}`}
          style={{ width: 28, height: 28 }}
        >
          {transcribing ? <Loader2 size={16} className="animate-spin" /> : <Mic size={18} />}
        </button>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy || taskActive}
          placeholder={taskActive ? `АКТИВНИЙ ПРОТОКОЛ: ${status.toUpperCase()}...` : "Введіть ціль або задачу..."}
          rows={1}
          className="flex-1 bg-transparent border-none outline-none py-0.5 text-[14px] font-display font-medium tracking-tight text-slate-800 placeholder:text-slate-400 placeholder:italic resize-none overflow-y-auto scrollbar-none"
          onKeyDown={onKeyDown}
        />

        {!taskActive && (
          <div className="flex bg-white/40 p-0.5 rounded-lg border border-black/5 gap-0.5 shrink-0 mb-0.5">
            <button
              onClick={() => setMissionModeArmed(false)}
              className={`px-2 py-0.5 text-[8px] font-bold rounded transition-all ${!missionModeArmed ? 'bg-white text-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              ЗАДАЧА
            </button>
            <button
              onClick={() => setMissionModeArmed(true)}
              className={`px-2 py-0.5 text-[8px] font-bold rounded transition-all ${missionModeArmed ? 'bg-red-500 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              МІСІЯ
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0 mb-1">
        {!taskActive ? (
          <button
            onClick={submitGoal}
            disabled={!canRun || busy}
            className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all shrink-0 ${canRun ? 'bg-primary text-white shadow-lg shadow-primary/20 hover:scale-105 active:scale-95' : 'bg-slate-100 text-slate-300'}`}
          >
            {busy ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
          </button>
        ) : (
          <>
             <HUDButton icon={isPaused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />} onClick={isPaused ? resumeTask : pauseTask} color="var(--primary)" small />
             <HUDButton icon={<OctagonX size={16} />} onClick={stopTask} color="var(--signal-alert)" small />
          </>
        )}
      </div>
    </div>
  );
}

function HUDButton({ icon, onClick, color, small = false }: { icon: React.ReactNode, onClick: () => void, color: string, small?: boolean }) {
  return (
    <button 
      onClick={onClick}
      className="flex items-center justify-center transition-all hover:bg-black/5 active:scale-90"
      style={{
        width: small ? 30 : 40,
        height: small ? 30 : 40,
        borderRadius: small ? 10 : 12,
        color: color,
        border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
        background: `color-mix(in srgb, ${color} 5%, transparent)`,
      }}
    >
      {icon}
    </button>
  );
}
