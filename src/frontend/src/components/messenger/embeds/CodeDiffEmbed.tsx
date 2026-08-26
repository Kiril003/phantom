import React, { useState } from 'react';
import { CodeDiffData } from '../../../types/messenger';
import { GitCommit, Copy, Check } from 'lucide-react';

interface CodeDiffEmbedProps {
  data: CodeDiffData;
}

export const CodeDiffEmbed: React.FC<CodeDiffEmbedProps> = ({ data }) => {
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');
  const [copied, setCopied] = useState(false);

  const oldLines = data.oldCode.split('\n');
  const newLines = data.newCode.split('\n');

  const handleCopy = () => {
    navigator.clipboard.writeText(
      `--- a/${data.filename}\n+++ b/${data.filename}\n` +
        oldLines.map((l) => `- ${l}`).join('\n') +
        '\n' +
        newLines.map((l) => `+ ${l}`).join('\n')
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full max-w-2xl bg-black/60 border border-white/15 rounded-2xl overflow-hidden backdrop-blur-md shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.04] border-b border-white/10">
        <div className="flex items-center gap-2">
          <GitCommit className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-mono font-bold text-white tracking-tight">{data.filename}</span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/10 text-white/70">
            Diff
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-black/40 p-0.5 rounded border border-white/10">
            <button
              onClick={() => setViewMode('unified')}
              className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                viewMode === 'unified' ? 'bg-emerald-500/20 text-emerald-300' : 'text-white/40 hover:text-white'
              }`}
            >
              Unified
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                viewMode === 'split' ? 'bg-emerald-500/20 text-emerald-300' : 'text-white/40 hover:text-white'
              }`}
            >
              Split
            </button>
          </div>

          <button
            onClick={handleCopy}
            title="Копіювати Diff"
            className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Diff View Area */}
      <div className="p-3 bg-[#0B0D11] font-mono text-xs overflow-x-auto leading-relaxed divide-y divide-white/5">
        {viewMode === 'unified' ? (
          <div className="space-y-0.5">
            {oldLines.map((line, i) => (
              <div key={`old-${i}`} className="flex items-center text-red-300/90 bg-red-500/10 px-2 py-0.5 rounded">
                <span className="w-8 text-white/30 text-[10px] select-none">{i + 1}</span>
                <span className="w-4 text-red-400 select-none">-</span>
                <span className="flex-1">{line}</span>
              </div>
            ))}
            {newLines.map((line, i) => (
              <div key={`new-${i}`} className="flex items-center text-emerald-300/90 bg-emerald-500/10 px-2 py-0.5 rounded">
                <span className="w-8 text-white/30 text-[10px] select-none">{i + 1}</span>
                <span className="w-4 text-emerald-400 select-none">+</span>
                <span className="flex-1">{line}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5 bg-red-500/5 p-2 rounded-lg border border-red-500/10">
              <span className="text-[10px] text-red-400 font-bold block mb-1">Оригінал (-):</span>
              {oldLines.map((line, i) => (
                <div key={i} className="text-red-300/80 text-[11px] truncate">
                  <span className="text-white/20 mr-2">{i + 1}</span> {line}
                </div>
              ))}
            </div>
            <div className="space-y-0.5 bg-emerald-500/5 p-2 rounded-lg border border-emerald-500/10">
              <span className="text-[10px] text-emerald-400 font-bold block mb-1">Зміни (+):</span>
              {newLines.map((line, i) => (
                <div key={i} className="text-emerald-300/80 text-[11px] truncate">
                  <span className="text-white/20 mr-2">{i + 1}</span> {line}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
