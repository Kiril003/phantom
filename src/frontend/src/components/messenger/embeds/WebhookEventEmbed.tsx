import React from 'react';
import { WebhookEventData } from '../../../types/messenger';
import { GitBranch, GitPullRequest, GitCommit, AlertTriangle, CheckCircle2, ExternalLink, Activity } from 'lucide-react';

interface WebhookEventEmbedProps {
  data: WebhookEventData;
}

export const WebhookEventEmbed: React.FC<WebhookEventEmbedProps> = ({ data }) => {
  const getStatusBadge = () => {
    switch (data.status) {
      case 'success':
        return (
          <span className="flex items-center gap-1 text-[10px] text-emerald-300 bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
            <CheckCircle2 className="w-3 h-3" /> PASS
          </span>
        );
      case 'failure':
        return (
          <span className="flex items-center gap-1 text-[10px] text-red-300 bg-red-500/20 border border-red-500/30 px-2 py-0.5 rounded-full font-bold">
            <AlertTriangle className="w-3 h-3" /> FAIL
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[10px] text-amber-300 bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 rounded-full font-bold">
            <Activity className="w-3 h-3" /> EVENT
          </span>
        );
    }
  };

  return (
    <div className="w-full max-w-xl bg-black/60 border border-white/15 rounded-2xl p-3.5 backdrop-blur-md shadow-lg space-y-2.5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded bg-white/10 text-white/80">
            {data.eventType.includes('pr') || data.eventType.includes('pull') ? (
              <GitPullRequest className="w-3.5 h-3.5 text-purple-400" />
            ) : data.eventType.includes('push') || data.eventType.includes('commit') ? (
              <GitCommit className="w-3.5 h-3.5 text-blue-400" />
            ) : (
              <GitBranch className="w-3.5 h-3.5 text-amber-400" />
            )}
          </div>
          <div>
            <span className="text-xs font-bold text-white tracking-tight">{data.repository || 'Dev Hub'}</span>
            <span className="text-[10px] text-white/40 ml-2 font-mono">{data.eventType}</span>
          </div>
        </div>

        {getStatusBadge()}
      </div>

      {/* Main Info */}
      <div className="space-y-1">
        <p className="text-xs font-semibold text-white/90">{data.title}</p>
        {data.description && <p className="text-xs text-white/60 line-clamp-2 leading-relaxed">{data.description}</p>}
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[11px] text-white/40 font-mono">
        <div className="flex items-center gap-2">
          {data.sender && <span>Автор: {data.sender}</span>}
          {data.commitHash && (
            <span className="bg-white/5 px-1.5 py-0.5 rounded text-[10px] text-amber-300/80">
              {data.commitHash.slice(0, 7)}
            </span>
          )}
        </div>

        {data.url && (
          <a
            href={data.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-indigo-300 hover:text-indigo-200 transition-colors"
          >
            <span>Переглянути</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
};
