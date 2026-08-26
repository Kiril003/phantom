import React, { useState } from 'react';
import { Play, Pause, Video, Sparkles, FileText } from 'lucide-react';
import { AsyncSnippetData } from '../../../types/messenger';
import { soundFx } from '../../../utils/messengerSound';

interface AsyncSnippetBubbleProps {
  data: AsyncSnippetData;
  isSelf?: boolean;
}

export const AsyncSnippetBubble: React.FC<AsyncSnippetBubbleProps> = ({
  data,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTime, setActiveTime] = useState(0);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const togglePlay = () => {
    soundFx.playTap();
    setIsPlaying(!isPlaying);
  };

  const jumpToTime = (timeSeconds: number) => {
    soundFx.playTap();
    setActiveTime(timeSeconds);
    setIsPlaying(true);
  };

  return (
    <div className="w-full max-w-[500px] rounded-2xl bg-[#FAF7F0] border border-[#E5DEC9] overflow-hidden shadow-sm hover:shadow-md transition-all text-[#21261F]">
      <div className="p-3.5 bg-[#F7F4EC] border-b border-[#E5DEC9] flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-[#FDF5ED] border border-[#EADCC8] flex items-center justify-center text-[#D96C35] shrink-0">
            <Video className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h4 className="text-[13.5px] font-bold text-[#21261F] truncate">{data.title}</h4>
            <p className="text-[11px] text-[#6E7568]">
              {data.authorName} • {formatTime(data.durationSeconds)} відео-сніпет
            </p>
          </div>
        </div>

        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FDF5ED] text-[#D96C35] border border-[#EADCC8] shrink-0">
          Async Loom
        </span>
      </div>

      <div className="relative aspect-video bg-[#1C1F1B] flex items-center justify-center overflow-hidden">
        {data.thumbnailUrl ? (
          <img
            src={data.thumbnailUrl}
            alt={data.title}
            className="w-full h-full object-cover opacity-80"
          />
        ) : (
          <div className="text-center p-4">
            <Video className="w-12 h-12 text-[#D96C35]/60 mx-auto mb-2" />
            <p className="text-xs text-[#A8B0A2]">Запис екрана та коментар автора</p>
          </div>
        )}

        <button
          onClick={togglePlay}
          className="absolute inset-0 m-auto w-14 h-14 rounded-full bg-[#D96C35]/90 hover:bg-[#D96C35] hover:scale-105 text-white flex items-center justify-center shadow-lg transition-all"
        >
          {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
        </button>

        <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between text-[11px] font-mono text-white/90 bg-black/50 px-2.5 py-1 rounded-lg backdrop-blur-xs">
          <span>{formatTime(activeTime)}</span>
          <span>{formatTime(data.durationSeconds)}</span>
        </div>
      </div>

      {data.summary && (
        <div className="p-3 bg-[#FDF9F3] border-b border-[#E5DEC9] flex items-start gap-2 text-xs">
          <Sparkles className="w-4 h-4 text-[#D96C35] shrink-0 mt-0.5" />
          <p className="text-[#5F6A60] leading-relaxed">
            <b>AI Витяг:</b> {data.summary}
          </p>
        </div>
      )}

      <div className="p-3.5 space-y-2">
        <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[#6E7568]">
          <span className="flex items-center gap-1">
            <FileText className="w-3.5 h-3.5" />
            Розшифровка та таймкоди
          </span>
          <span className="text-[10px] text-[#8A9186]">Локальний Whisper</span>
        </div>

        <div className="space-y-1.5 max-h-36 overflow-y-auto custom-scrollbar">
          {data.transcripts.map((t, idx) => (
            <div
              key={idx}
              onClick={() => jumpToTime(t.timeSeconds)}
              className={`p-2 rounded-xl border text-xs transition-all cursor-pointer flex items-start gap-2 ${
                activeTime >= t.timeSeconds && activeTime < t.timeSeconds + 20
                  ? 'bg-[#FDF5ED] border-[#D96C35] text-[#21261F]'
                  : 'bg-[#FDFCF9] border-[#E5DEC9] hover:bg-[#FAF7F0] text-[#5F6A60]'
              }`}
            >
              <span className="font-mono font-bold text-[#D96C35] text-[11px] shrink-0">
                {t.timestamp}
              </span>
              <p className="leading-relaxed">{t.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
