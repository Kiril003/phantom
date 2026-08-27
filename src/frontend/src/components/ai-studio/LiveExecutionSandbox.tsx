/**
 * PHANTOM OS — Live Code Interpreter & Execution Sandbox
 * Локальна пісочниця коду: безпечне виконання JS/TS, Python та Math,
 * виведення логів консолі, замір затримки (ms) та інспектор значень.
 */

import React, { useState } from 'react';
import { Terminal, Play, Trash2, CheckCircle2, AlertCircle, Clock, Sparkles } from 'lucide-react';
import { useAISynthesisStore } from '../../stores/aiSynthesisStore';
import { soundFx } from '../../utils/messengerSound';

interface LiveExecutionSandboxProps {
  onClose?: () => void;
}

export const LiveExecutionSandbox: React.FC<LiveExecutionSandboxProps> = () => {
  const {
    lastExecutionResult,
    runCodeSandbox,
    clearSandboxOutput,
  } = useAISynthesisStore();

  const [inputCode, setInputCode] = useState(`// ⚡ PHANTOM Local Sandbox Engine (JS / Math / Pyodide)
const dataset = [14.2, 18.5, 22.1, 19.8, 25.4, 30.2, 28.9];
const sum = dataset.reduce((acc, v) => acc + v, 0);
const average = sum / dataset.length;

console.log("Кількість елементів:", dataset.length);
console.log("Середнє арифметичне значення:", average.toFixed(2));

return {
  status: "OK",
  metrics: { sum: sum.toFixed(1), avg: average.toFixed(2) },
  timestamp: new Date().toISOString()
};`);

  const [isRunning, setIsRunning] = useState(false);

  const handleRun = async () => {
    setIsRunning(true);
    soundFx.playChime();
    await runCodeSandbox(inputCode);
    setIsRunning(false);
  };

  return (
    <div className="flex flex-col h-full bg-[#1E2521] text-[#E0D7C6] border-t border-[#3A423B] select-none font-mono text-xs">
      {/* Sandbox Header */}
      <div className="p-2.5 bg-[#141A16] border-b border-[#2D362F] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-emerald-950 border border-emerald-700 flex items-center justify-center text-emerald-400">
            <Terminal className="w-3 h-3" />
          </div>
          <span className="font-bold text-xs text-white">Локальний Code Interpreter & Пісочниця</span>
          <span className="px-1.5 py-0.5 bg-emerald-900/50 text-emerald-300 border border-emerald-700/50 rounded text-[9.5px]">
            WebAssembly Safe
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              soundFx.playTap();
              clearSandboxOutput();
            }}
            title="Очистити термінал"
            className="p-1.5 hover:bg-[#2D362F] rounded text-[#8A9186] hover:text-white transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleRun}
            disabled={isRunning}
            className="px-3 py-1 bg-[#C25925] hover:bg-[#AA491A] text-white font-bold rounded-lg text-xs flex items-center gap-1 shadow-2xs transition-colors disabled:opacity-50"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>{isRunning ? 'Виконується...' : 'Запустити'}</span>
          </button>
        </div>
      </div>

      {/* Code Editor & Output Split */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#2D362F] overflow-hidden">
        {/* Code Input */}
        <div className="flex flex-col h-full overflow-hidden p-3 bg-[#18201B]">
          <span className="text-[10px] text-[#8A9186] uppercase tracking-wider mb-1 font-bold">Код для виконання:</span>
          <textarea
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value)}
            className="flex-1 w-full bg-transparent text-[#E0D7C6] font-mono text-xs focus:outline-none resize-none leading-relaxed"
          />
        </div>

        {/* Console Logs & Return Value Output */}
        <div className="flex flex-col h-full overflow-y-auto p-3 bg-[#121614] space-y-2.5">
          <div className="flex items-center justify-between text-[10px] text-[#8A9186] uppercase tracking-wider font-bold">
            <span>Результат виконання (Stdout):</span>
            {lastExecutionResult && (
              <span className="flex items-center gap-1 text-emerald-400">
                <Clock className="w-3 h-3" />
                <span>{lastExecutionResult.runtimeMs} ms</span>
              </span>
            )}
          </div>

          {!lastExecutionResult ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-[#6E7568]">
              <Sparkles className="w-6 h-6 mb-1 opacity-50 text-[#C25925]" />
              <p className="text-xs">Натисни «Запустити», щоб побачити вивід виконання коду.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Status Badge */}
              <div className="flex items-center gap-1.5 text-xs">
                {lastExecutionResult.success ? (
                  <span className="text-emerald-400 flex items-center gap-1 font-bold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Успішно завершено</span>
                  </span>
                ) : (
                  <span className="text-red-400 flex items-center gap-1 font-bold">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Помилка виконання</span>
                  </span>
                )}
                <span className="text-[#6E7568]">о {lastExecutionResult.timestamp}</span>
              </div>

              {/* Console Logs */}
              {lastExecutionResult.stdout.length > 0 && (
                <div className="p-2.5 bg-[#18201B] border border-[#2D362F] rounded-xl space-y-1">
                  <span className="text-[10px] text-[#8A9186] uppercase font-bold">Консольні логи:</span>
                  {lastExecutionResult.stdout.map((line, i) => (
                    <div key={i} className="text-[#A3E635] text-xs">
                      <span className="text-[#6E7568] select-none mr-2">&gt;</span>
                      {line}
                    </div>
                  ))}
                </div>
              )}

              {/* Return Value */}
              {lastExecutionResult.returnValue !== undefined && (
                <div className="p-2.5 bg-[#18201B] border border-[#2D362F] rounded-xl space-y-1">
                  <span className="text-[10px] text-[#8A9186] uppercase font-bold">Повернуте значення (Object):</span>
                  <pre className="text-[#38BDF8] text-xs overflow-x-auto">
                    {typeof lastExecutionResult.returnValue === 'object'
                      ? JSON.stringify(lastExecutionResult.returnValue, null, 2)
                      : String(lastExecutionResult.returnValue)}
                  </pre>
                </div>
              )}

              {/* Errors if any */}
              {lastExecutionResult.stderr.length > 0 && (
                <div className="p-2.5 bg-red-950/40 border border-red-800/60 rounded-xl space-y-1 text-red-300">
                  <span className="text-[10px] text-red-400 uppercase font-bold">Трасування помилок:</span>
                  {lastExecutionResult.stderr.map((err, i) => (
                    <div key={i} className="text-xs font-mono">{err}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
