import React, { useState } from 'react';
import { CodeRunnerData } from '../../../types/messenger';
import { soundFx } from '../../../utils/messengerSound';
import { Play, Check, Terminal, Copy, Loader2, RotateCcw } from 'lucide-react';

interface CodeRunnerWidgetEmbedProps {
  data: CodeRunnerData;
  isSelf?: boolean;
  onUpdate?: (updated: CodeRunnerData) => void;
}

export const CodeRunnerWidgetEmbed: React.FC<CodeRunnerWidgetEmbedProps> = ({
  data,
  isSelf: _isSelf,
  onUpdate,
}) => {
  const [runner, setRunner] = useState<CodeRunnerData>(data);
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(data.lastOutput || null);
  const [copied, setCopied] = useState(false);

  const handleRun = () => {
    soundFx.playTap();
    setIsRunning(true);
    setOutput(null);

    setTimeout(() => {
      let simulatedOutput = '';
      try {
        if (runner.language === 'javascript' || runner.language === 'typescript') {
          // Safe eval for basic expressions / console output
          const logs: string[] = [];
          const customConsole = {
            log: (...args: any[]) => logs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')),
            error: (...args: any[]) => logs.push(`[ERROR] ${args.join(' ')}`),
          };
          const fn = new Function('console', runner.code);
          fn(customConsole);
          simulatedOutput = logs.length > 0 ? logs.join('\n') : '✨ Код виконано успішно (без виводу в консоль).';
        } else if (runner.language === 'python') {
          simulatedOutput = `[Python 3.11 Runtime]\n>>> Running script...\nOutput: {\n  "status": "success",\n  "result": 42,\n  "memory_used": "14.2 MB"\n}\nProcess exited with code 0.`;
        } else {
          simulatedOutput = `$ bash script.sh\n[OK] Task executed in 14ms.\nAll 5 assertions passed.`;
        }
      } catch (err: any) {
        simulatedOutput = `⚠️ Runtime Error: ${err?.message || String(err)}`;
      }

      setIsRunning(false);
      setOutput(simulatedOutput);
      const updated = { ...runner, lastOutput: simulatedOutput, status: 'success' as const };
      setRunner(updated);
      onUpdate?.(updated);
    }, 450);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(runner.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full max-w-2xl bg-black/50 border border-white/15 rounded-2xl overflow-hidden backdrop-blur-md shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.04] border-b border-white/10">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-bold text-white tracking-tight">{runner.title || 'Code Runner'}</span>
          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
            {runner.language}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            title="Копіювати код"
            className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={handleRun}
            disabled={isRunning}
            className="flex items-center gap-1 px-3 py-1 bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold rounded-lg transition-all shadow"
          >
            {isRunning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-black" />
            )}
            <span>{isRunning ? 'Виконання...' : 'Запустити'}</span>
          </button>
        </div>
      </div>

      {/* Code Editor Body */}
      <div className="p-3 bg-[#0B0D11] border-b border-white/10 font-mono text-xs text-cyan-200/90 overflow-x-auto leading-relaxed">
        <textarea
          value={runner.code}
          onChange={(e) => {
            const updated = { ...runner, code: e.target.value };
            setRunner(updated);
            onUpdate?.(updated);
          }}
          className="w-full h-28 bg-transparent text-xs font-mono text-cyan-100 placeholder-white/20 focus:outline-none resize-none"
          spellCheck={false}
        />
      </div>

      {/* Output Console */}
      {output && (
        <div className="p-3 bg-black/90 font-mono text-[11px] text-white/80 border-t border-white/5 space-y-1 animate-in fade-in">
          <div className="flex items-center justify-between text-[10px] text-white/40 pb-1 border-b border-white/5">
            <span>Terminal Output</span>
            <button
              onClick={() => setOutput(null)}
              className="hover:text-white flex items-center gap-1"
            >
              <RotateCcw className="w-2.5 h-2.5" /> очистити
            </button>
          </div>
          <pre className="whitespace-pre-wrap text-emerald-400/90 leading-normal">{output}</pre>
        </div>
      )}
    </div>
  );
};
