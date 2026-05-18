import { Pause, Play, MessageSquarePlus, SkipForward, OctagonX } from 'lucide-react';
import { useAgentStore } from '../../../stores/agentStore';
import { SentientControlButton } from './SentientControlButton';

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
    status === 'planning' ||
    // Phase 9.2.3 (F-08): keep STOP / INTERVENE reachable while a task is
    // parked on quota. Without this the operator loses the only exit path
    // when the blocked-quota probe loop is cycling.
    status === 'blocked_quota';
  const isPaused = status === 'paused';
  const isBlockedQuota = status === 'blocked_quota';

  return (
    <div className="flex items-center gap-2" data-testid="controls-bar">
      {taskActive && !isPaused && !isBlockedQuota && (
        <SentientControlButton icon={<Pause size={16} />} label="Pause" onClick={pauseTask} />
      )}
      {taskActive && isPaused && (
        <SentientControlButton icon={<Play size={16} />} label="Resume" onClick={resumeTask} tone="primary" />
      )}
      {taskActive && (
        <SentientControlButton
          icon={<MessageSquarePlus size={16} />}
          label="Intervene"
          onClick={onIntervene}
        />
      )}
      {taskActive && substate === 'acting' && (
        <SentientControlButton icon={<SkipForward size={16} />} label="Cancel step" onClick={cancelStep} />
      )}
      {taskActive && (
        <SentientControlButton
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
