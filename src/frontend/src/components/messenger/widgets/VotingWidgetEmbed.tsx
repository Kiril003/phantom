import React, { useState } from 'react';
import { VotingData } from '../../../types/messenger';
import { soundFx } from '../../../utils/messengerSound';
import { CheckCircle2, Clock, Trophy } from 'lucide-react';

interface VotingWidgetEmbedProps {
  data: VotingData;
  isSelf?: boolean;
  currentUserId?: string;
  onUpdate?: (updated: VotingData) => void;
}

export const VotingWidgetEmbed: React.FC<VotingWidgetEmbedProps> = ({
  data,
  isSelf: _isSelf,
  currentUserId = 'self',
  onUpdate,
}) => {
  const [poll, setPoll] = useState<VotingData>(data);

  const handleVote = (optionId: string) => {
    if (poll.isClosed) return;
    soundFx.playTap();

    const updatedOptions = poll.options.map((opt) => {
      const isSelected = opt.id === optionId;
      const alreadyVoted = opt.voters.includes(currentUserId);

      if (isSelected) {
        if (alreadyVoted) {
          // Unvote
          return {
            ...opt,
            votes: Math.max(0, opt.votes - 1),
            voters: opt.voters.filter((id) => id !== currentUserId),
          };
        } else {
          // Vote
          return {
            ...opt,
            votes: opt.votes + 1,
            voters: [...opt.voters, currentUserId],
          };
        }
      } else {
        // If not multiple, remove from others
        if (!poll.allowMultiple && alreadyVoted) {
          return {
            ...opt,
            votes: Math.max(0, opt.votes - 1),
            voters: opt.voters.filter((id) => id !== currentUserId),
          };
        }
        return opt;
      }
    });

    const totalVotes = updatedOptions.reduce((sum, opt) => sum + opt.votes, 0);
    const sorted = [...updatedOptions].sort((a, b) => b.votes - a.votes);
    const winningOptionId = sorted[0]?.votes > 0 ? sorted[0].id : undefined;

    const updated: VotingData = {
      ...poll,
      options: updatedOptions,
      totalVotes,
      winningOptionId,
    };

    setPoll(updated);
    onUpdate?.(updated);
  };

  return (
    <div className="w-full max-w-xl bg-black/40 border border-white/15 rounded-2xl p-4 backdrop-blur-md shadow-lg space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <h3 className="text-sm font-bold text-white tracking-tight">{poll.question}</h3>
          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            Voting
          </span>
        </div>
        {poll.deadline && (
          <span className="flex items-center gap-1 text-[11px] text-amber-300/80 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
            <Clock className="w-3 h-3" />
            <span>{poll.deadline}</span>
          </span>
        )}
      </div>

      {/* Options List */}
      <div className="space-y-2.5">
        {poll.options.map((option) => {
          const isVoted = option.voters.includes(currentUserId);
          const percent =
            poll.totalVotes > 0
              ? Math.round((option.votes / poll.totalVotes) * 100)
              : 0;
          const isWinner = poll.winningOptionId === option.id && option.votes > 0;

          return (
            <div
              key={option.id}
              onClick={() => handleVote(option.id)}
              className={`group relative overflow-hidden rounded-xl border p-3 cursor-pointer transition-all ${
                isVoted
                  ? 'border-emerald-500/50 bg-emerald-500/10'
                  : isWinner
                  ? 'border-amber-500/40 bg-amber-500/5'
                  : 'border-white/10 bg-white/[0.02] hover:border-white/20'
              }`}
            >
              {/* Progress Bar Fill */}
              <div
                className={`absolute top-0 bottom-0 left-0 transition-all duration-500 pointer-events-none opacity-25 ${
                  isVoted
                    ? 'bg-emerald-500'
                    : isWinner
                    ? 'bg-amber-400'
                    : 'bg-white/20'
                }`}
                style={{ width: `${percent}%` }}
              />

              <div className="relative flex items-center justify-between z-10">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${
                      isVoted
                        ? 'border-emerald-400 bg-emerald-500 text-black'
                        : 'border-white/30 group-hover:border-white/60'
                    }`}
                  >
                    {isVoted && <CheckCircle2 className="w-3.5 h-3.5" />}
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      isVoted ? 'text-emerald-300 font-semibold' : 'text-white/90'
                    }`}
                  >
                    {option.text}
                  </span>
                  {isWinner && (
                    <Trophy className="w-3.5 h-3.5 text-amber-400 animate-bounce" />
                  )}
                </div>

                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="text-white/40">{option.votes} гол.</span>
                  <span className="font-bold text-white/90 w-9 text-right">{percent}%</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[11px] text-white/40">
        <span>Усього голосів: {poll.totalVotes}</span>
        <span>{poll.isClosed ? '🔴 Голосування закрито' : '🟢 Активне голосування'}</span>
      </div>
    </div>
  );
};
