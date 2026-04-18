import { useState } from 'react';
import { ThumbsUp, ThumbsDown, MessageCircle } from 'lucide-react';
import { useAgentStore } from '../../stores/agentStore';

export function FeedbackButtons({ auditId }: { auditId: number }) {
  const [given, setGiven] = useState<string | null>(null);
  const submit = useAgentStore((s) => s.submitFeedback);

  const fire = async (rating: 'up' | 'down' | 'comment') => {
    setGiven(rating);
    try {
      let comment: string | undefined;
      if (rating === 'comment') {
        const c = window.prompt('Comment on this action');
        if (!c) return;
        comment = c;
      }
      await submit(auditId, rating, comment);
    } catch {
      setGiven(null);
    }
  };

  return (
    <div className="flex gap-1">
      <FeedbackBtn icon={<ThumbsUp size={14} />} active={given === 'up'} onClick={() => fire('up')} />
      <FeedbackBtn icon={<ThumbsDown size={14} />} active={given === 'down'} onClick={() => fire('down')} />
      <FeedbackBtn icon={<MessageCircle size={14} />} active={given === 'comment'} onClick={() => fire('comment')} />
    </div>
  );
}

function FeedbackBtn({ icon, active, onClick }: { icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 9999,
        background: active ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--ink-muted)',
        border: '1px solid var(--glass-border)',
      }}
    >
      {icon}
    </button>
  );
}
