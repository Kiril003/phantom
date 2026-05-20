import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileCode2, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import type { PatchFileSceneData } from '@shared/types';

interface PatchFileSceneProps {
  data: PatchFileSceneData;
}

export function PatchFileScene({ data }: PatchFileSceneProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!data.codePreview) return;
    navigator.clipboard.writeText(data.codePreview);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className="glass lift"
      style={{ width: 540, padding: 14, position: 'relative', overflow: 'hidden' }}
      data-testid="scene-patch-file"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 shrink-0">
            <FileCode2 size={15} />
          </div>
          <div>
            <h4 className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[280px]">
              {data.filename.split('/').pop()}
            </h4>
            <p className="text-[8px] font-mono text-slate-400 truncate max-w-[320px]">
              {data.filename}
            </p>
          </div>
        </div>

        {/* Change Stats */}
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 font-mono text-[9px] font-bold">
            <span className="text-emerald-500">+{data.additions}</span>
            <span className="text-rose-500">-{data.deletions}</span>
          </div>
          {data.codePreview && (
            <button
              onClick={() => setExpanded(prev => !prev)}
              className="p-1 rounded bg-white/40 dark:bg-white/5 border border-white/10 hover:bg-white/80 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              {expanded ? <ChevronUp size={11} className="text-slate-500" /> : <ChevronDown size={11} className="text-slate-500" />}
            </button>
          )}
        </div>
      </div>

      {/* Description Text */}
      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2.5 leading-relaxed pl-1.5 border-l border-amber-500/30">
        {data.description}
      </p>

      {/* Code Preview block (expandable) */}
      <AnimatePresence>
        {expanded && data.codePreview && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden mt-3"
          >
            <div className="relative border border-white/10 rounded-xl bg-slate-950/70 overflow-hidden">
              {/* Copy button */}
              <button
                onClick={handleCopy}
                className="absolute right-2 top-2 p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors border border-white/5"
              >
                {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
              </button>
              <pre className="p-3 overflow-x-auto text-[9px] font-mono text-slate-350 leading-relaxed scrollbar-thin max-h-56">
                <code>{data.codePreview}</code>
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
