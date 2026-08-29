import React, { useState } from 'react';
import { VotingData } from '../../../types/messenger';
import { soundFx } from '../../../utils/messengerSound';
import { CheckCircle2, Trophy, Plus, Check, Lock, Layers } from 'lucide-react';
import { useMessengerStore } from '../../../stores/messengerStore';

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
  const [isAddingOption, setIsAddingOption] = useState(false);
  const [newOptionText, setNewOptionText] = useState('');
  const [exportedToCanvas, setExportedToCanvas] = useState(false);

  const handleVote = (optionId: string) => {
    if (poll.isClosed) return;
    soundFx.playTap();

    const updatedOptions = poll.options.map((opt) => {
      const isSelected = opt.id === optionId;
      const alreadyVoted = opt.voters.includes(currentUserId);

      if (isSelected) {
        if (alreadyVoted) {
          return {
            ...opt,
            votes: Math.max(0, opt.votes - 1),
            voters: opt.voters.filter((id) => id !== currentUserId),
          };
        } else {
          return {
            ...opt,
            votes: opt.votes + 1,
            voters: [...opt.voters, currentUserId],
          };
        }
      } else {
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

    const updated = {
      ...poll,
      options: updatedOptions,
      totalVotes,
      winningOptionId,
    };
    setPoll(updated);
    onUpdate?.(updated);
  };

  const handleAddOption = () => {
    if (!newOptionText.trim()) {
      setIsAddingOption(false);
      return;
    }
    soundFx.playSend();
    const newOpt = {
      id: `opt_${Date.now()}`,
      text: newOptionText.trim(),
      votes: 0,
      voters: [],
    };
    const updated = {
      ...poll,
      options: [...poll.options, newOpt],
    };
    setPoll(updated);
    setNewOptionText('');
    setIsAddingOption(false);
    onUpdate?.(updated);
  };

  const toggleClosePoll = () => {
    soundFx.playTap();
    const updated = { ...poll, isClosed: !poll.isClosed };
    setPoll(updated);
    onUpdate?.(updated);
  };

  const exportResultToCanvas = () => {
    soundFx.playSend();
    const store = useMessengerStore.getState();
    const winning = poll.options.find((o) => o.id === poll.winningOptionId);
    store.addCustomMessage({
      id: `msg_c_${Date.now()}`,
      senderId: store.currentUser.id,
      senderName: store.currentUser.name,
      senderAvatar: store.currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'widget:canvas',
      isSelf: true,
      canvasData: {
        id: `canvas_poll_${Date.now()}`,
        threadId: 'root',
        conversationId: 'current',
        title: `Підсумок голосування: ${poll.question}`,
        rawMarkdown: `### 🎯 Результат голосування: ${poll.question}\nПереможець: **${winning?.text || 'Не визначено'}** (${winning?.votes || 0} голосів)`,
        decisionsCount: 1,
        openQuestionsCount: 0,
        updatedBy: store.currentUser.name,
        blocks: [
          {
            id: 'b1',
            type: 'decision',
            content: `Ухвалено за підсумками голосування: «${winning?.text || poll.question}»`,
            updatedAt: 'щойно',
          },
        ],
        lastUpdated: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      },
    });
    setExportedToCanvas(true);
    setTimeout(() => setExportedToCanvas(false), 2000);
  };

  return (
    <div className="w-full max-w-[500px] rounded-2xl bg-[#FAF7F0] border border-[#E5DEC9] overflow-hidden shadow-sm hover:shadow-md transition-all text-[#21261F]">
      {/* Header */}
      <div className="p-3.5 bg-[#F7F4EC] border-b border-[#E5DEC9] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#FDF5ED] border border-[#EADCC8] flex items-center justify-center text-[#D96C35]">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-[13px] font-bold text-[#21261F]">{poll.question}</h4>
            <p className="text-[10.5px] text-[#6E7568]">
              {poll.totalVotes} голосів • {poll.deadline ? `Дедлайн: ${poll.deadline}` : 'Активне'}
            </p>
          </div>
        </div>

        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
            poll.isClosed
              ? 'bg-slate-100 text-slate-700 border-slate-300'
              : 'bg-emerald-50 text-emerald-800 border-emerald-300'
          }`}
        >
          {poll.isClosed ? 'Закрито' : 'Live'}
        </span>
      </div>

      {/* Options List */}
      <div className="p-3.5 space-y-2.5">
        {poll.options.map((option) => {
          const isSelected = option.voters.includes(currentUserId);
          const isWinning = option.id === poll.winningOptionId && option.votes > 0;
          const percentage =
            poll.totalVotes > 0 ? Math.round((option.votes / poll.totalVotes) * 100) : 0;

          return (
            <div
              key={option.id}
              onClick={() => handleVote(option.id)}
              className={`relative overflow-hidden p-3 rounded-xl border transition-all cursor-pointer ${
                isSelected
                  ? 'border-[#D96C35] bg-[#FDF9F3] ring-1 ring-[#D96C35]/30'
                  : 'border-[#E5DEC9] bg-[#FDFCF9] hover:bg-[#FAF7F0]'
              }`}
            >
              {/* Progress Bar background */}
              <div
                className={`absolute inset-0 transition-all duration-300 opacity-20 pointer-events-none ${
                  isWinning ? 'bg-emerald-500' : 'bg-[#D96C35]'
                }`}
                style={{ width: `${percentage}%` }}
              />

              <div className="relative flex items-center justify-between z-10">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-4 h-4 rounded-full border flex items-center justify-center text-[10px] ${
                      isSelected
                        ? 'bg-[#D96C35] text-white border-[#D96C35]'
                        : 'border-[#CCC3B0] bg-white'
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3" />}
                  </span>
                  <span className="text-xs font-semibold text-[#21261F]">{option.text}</span>
                  {isWinning && (
                    <Trophy className="w-3.5 h-3.5 text-amber-600 animate-bounce" />
                  )}
                </div>

                <div className="flex items-center gap-1.5 font-mono text-xs text-[#6E7568]">
                  <span className="font-bold text-[#21261F]">{option.votes}</span>
                  <span>({percentage}%)</span>
                </div>
              </div>
            </div>
          );
        })}

        {isAddingOption ? (
          <div className="flex items-center gap-1.5 pt-1">
            <input
              type="text"
              value={newOptionText}
              onChange={(e) => setNewOptionText(e.target.value)}
              placeholder="Новий варіант відповіді..."
              className="flex-1 p-2 bg-white border border-[#E5DEC9] rounded-xl text-xs text-[#21261F] focus:outline-none focus:border-[#D96C35]"
              autoFocus
            />
            <button
              onClick={() => setIsAddingOption(false)}
              className="px-2 py-1.5 text-xs text-[#6E7568]"
            >
              Скасувати
            </button>
            <button
              onClick={handleAddOption}
              className="px-3 py-1.5 rounded-xl bg-[#D96C35] text-white text-xs font-bold"
            >
              Додати
            </button>
          </div>
        ) : (
          !poll.isClosed && (
            <button
              onClick={() => setIsAddingOption(true)}
              className="w-full py-2 border border-dashed border-[#E5DEC9] hover:border-[#D96C35] rounded-xl text-xs font-semibold text-[#6E7568] hover:text-[#D96C35] transition-colors flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Додати свій варіант</span>
            </button>
          )
        )}
      </div>

      {/* Footer Controls */}
      <div className="p-3 bg-[#F7F4EC] border-t border-[#E5DEC9] flex items-center justify-between text-xs text-[#6E7568]">
        <button
          onClick={toggleClosePoll}
          className="flex items-center gap-1 hover:text-[#21261F] font-semibold"
        >
          <Lock className="w-3.5 h-3.5" />
          <span>{poll.isClosed ? 'Відкрити знову' : 'Зафіксувати результат'}</span>
        </button>

        <button
          onClick={exportResultToCanvas}
          className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-[#FDF5ED] border border-[#E5DEC9] rounded-lg text-[#D96C35] font-bold shadow-2xs transition-all"
        >
          <Layers className="w-3.5 h-3.5" />
          <span>{exportedToCanvas ? 'Експортовано в Canvas ✓' : 'У Canvas'}</span>
        </button>
      </div>
    </div>
  );
};
