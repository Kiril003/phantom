import { Pause, Play, MessageSquarePlus, SkipForward, OctagonX } from 'lucide-react';
import { useAgentStore } from '../../stores/agentStore';

interface Props {
  onIntervene: () => void;
}

export function ControlsBar({ onIntervene }: Props) {
  const status = useAgentStore((s) => s.status);
  const substate = useAgentStore((s) => s.substate);
  const pauseTask = useAgentStore((s) => s.pauseTask);
  const resumeTask = useAgentStore((s) => s.resumeTask);
  const cancelStep = useAgentStore((s) => s.cancelStep);
  const stopTask = useAgentStore((s) => s.stopTask);

  const taskActive =
    status === 'running' ||
    status === 'paused' ||
    status === 'awaiting_user' ||
    status === 'planning';
  const isPaused = status === 'paused';

  return (
    <div className="flex items-center gap-2" data-testid="controls-bar">
      {taskActive && !isPaused && (
        <ControlButton icon={<Pause size={16} />} label="Pause" onClick={pauseTask} />
      )}
      {taskActive && isPaused && (
        <ControlButton icon={<Play size={16} />} label="Resume" onClick={resumeTask} tone="primary" />
      )}
      {taskActive && (
        <ControlButton
          icon={<MessageSquarePlus size={16} />}
          label="Intervene"
          onClick={onIntervene}
        />
      )}
      {taskActive && substate === 'acting' && (
        <ControlButton icon={<SkipForward size={16} />} label="Cancel step" onClick={cancelStep} />
      )}
      {taskActive && (
        <ControlButton
          icon={<OctagonX size={18} />}
          label="STOP"
          onClick={stopTask}
          tone="alert"
          large
        />
      )}
    </div>
  );
}

function ControlButton({
  icon,
  label,
  onClick,
  tone = 'default',
  large = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'primary' | 'alert';
  large?: boolean;
}) {
  const color =
    tone === 'alert' ? 'var(--signal-alert)' : tone === 'primary' ? 'var(--accent)' : 'var(--ink-secondary)';
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 px-3"
      style={{
        minHeight: 44,
        minWidth: large ? 96 : 64,
        borderRadius: 12,
        background:
          tone === 'alert'
            ? 'color-mix(in srgb, var(--signal-alert) 18%, transparent)'
            : 'color-mix(in srgb, var(--accent) 8%, transparent)',
        color,
        border: `1px solid color-mix(in srgb, ${color} 32%, transparent)`,
        fontSize: large ? 'var(--fs-sm)' : 'var(--fs-xs)',
        fontFamily: 'var(--font-mono)',
        letterSpacing: 'var(--tracking-wider)',
      }}
      aria-label={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
