/**
 * PHANTOM OS — Runtime Console & Execution Telemetry
 * Віртуальний ANSI-термінал: системні логи виконання, використання пам'яті (VRAM/RAM),
 * затримка першого токена (TTFT), швидкість генерації (tokens/sec) та глибина контексту (%).
 */

import React, { useState } from 'react';
import {
  Terminal,
  Play,
  Trash2,
  Activity,
  Cpu,
  HardDrive,
  Radio,
  Clock,
  Gauge,
} from 'lucide-react';
import { useAISynthesisStore } from '../../stores/aiSynthesisStore';
import { soundFx } from '../../utils/messengerSound';

interface RuntimeTelemetryConsoleProps {
  onClose?: () => void;
}

export const RuntimeTelemetryConsole: React.FC<RuntimeTelemetryConsoleProps> = () => {
  const {
    lastExecutionResult,
    runCodeSandbox,
    clearSandboxOutput,
    hardwareTelemetry,
    runHardwareDiagnostics,
    memory,
  } = useAISynthesisStore();

  const [inputCode, setInputCode] = useState(`// ⚡ PHANTOM Local Diagnostic Script
const points = [14.2, 18.5, 22.1, 19.8, 25.4, 30.2];
const avg = points.reduce((a, b) => a + b, 0) / points.length;
console.log("Середнє навантаження вузла:", avg.toFixed(2), "ms");
return { status: "HEALTHY", vram_ok: true, p2p_active: true };`);

  const [isProbing, setIsProbing] = useState(false);

  const handleRun = async () => {
    soundFx.playChime();
    await runCodeSandbox(inputCode);
  };

  const handleProbe = async () => {
    setIsProbing(true);
    soundFx.playTap();
    await runHardwareDiagnostics();
    setTimeout(() => setIsProbing(false), 500);
  };

  const contextPct = Math.round((memory.activeContextTokens / memory.maxContextTokens) * 100);

  return (
    <div className="flex flex-col h-full bg-[#141A16] text-[#E0D7C6] border-t border-[#2D362F] select-none font-mono text-xs overflow-hidden">
      {/* Telemetry Top Gauges Strip */}
      <div className="px-3 py-2 bg-[#0E1210] border-b border-[#2D362F] flex flex-wrap items-center justify-between gap-3 text-[11px]">
        {/* VRAM Gauge */}
        <div className="flex items-center gap-2">
          <Cpu className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[#8A9186]">VRAM:</span>
          <span className="font-bold text-white">
            {hardwareTelemetry.vramUsedMb} / {hardwareTelemetry.vramTotalMb} MB
          </span>
          <div className="w-16 h-1.5 bg-[#2D362F] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-[#C25925]"
              style={{ width: `${(hardwareTelemetry.vramUsedMb / hardwareTelemetry.vramTotalMb) * 100}%` }}
            />
          </div>
        </div>

        {/* RAM Gauge */}
        <div className="flex items-center gap-2">
          <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[#8A9186]">RAM:</span>
          <span className="font-bold text-white">
            {(hardwareTelemetry.ramUsedMb / 1024).toFixed(1)} / {(hardwareTelemetry.ramTotalMb / 1024).toFixed(0)} GB
          </span>
        </div>

        {/* TTFT & Tokens/sec */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-[#8A9186]">TTFT:</span>
            <span className="font-bold text-blue-300">{hardwareTelemetry.ttftMs} ms</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[#8A9186]">Speed:</span>
            <span className="font-bold text-emerald-300">{hardwareTelemetry.tokensPerSec} t/s</span>
          </div>
        </div>

        {/* Context Depth % */}
        <div className="flex items-center gap-2">
          <Gauge className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-[#8A9186]">Context:</span>
          <span className="font-bold text-purple-300">{contextPct}% ({memory.activeContextTokens} t)</span>
        </div>

        {/* Probe Diagnostic Button */}
        <button
          onClick={handleProbe}
          disabled={isProbing}
          className="px-2.5 py-1 bg-[#2D362F] hover:bg-[#3A463D] text-white rounded-lg text-[10.5px] font-bold flex items-center gap-1 transition-colors"
        >
          <Radio className={`w-3 h-3 text-[#C25925] ${isProbing ? 'animate-spin' : ''}`} />
          <span>{isProbing ? 'Діагностика...' : 'Probe Telemetry'}</span>
        </button>
      </div>

      {/* Code Input & Execution Logs Split */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#2D362F] overflow-hidden">
        {/* Code Editor */}
        <div className="flex flex-col h-full overflow-hidden p-3 bg-[#18201B]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-[#8A9186] uppercase font-bold">Пісочниця викликів (Sandbox):</span>
            <button
              onClick={handleRun}
              className="px-2.5 py-1 bg-[#C25925] hover:bg-[#AA491A] text-white rounded-lg font-bold text-[10.5px] flex items-center gap-1"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Запустити</span>
            </button>
          </div>
          <textarea
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value)}
            className="flex-1 w-full bg-transparent text-[#E0D7C6] font-mono text-xs focus:outline-none resize-none leading-relaxed"
          />
        </div>

        {/* Logs Output */}
        <div className="flex flex-col h-full overflow-y-auto p-3 bg-[#101412] space-y-2">
          <div className="flex items-center justify-between text-[10px] text-[#8A9186] uppercase font-bold">
            <span>Логи терміналу (Stdout/Stderr):</span>
            <button
              onClick={clearSandboxOutput}
              title="Очистити"
              className="p-1 hover:text-white transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {!lastExecutionResult ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-4 text-[#6E7568]">
              <Terminal className="w-5 h-5 mb-1 opacity-40 text-[#C25925]" />
              <p className="text-[11px]">Термінал готовий до виклику функцій та інференсу.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {lastExecutionResult.stdout.map((line, i) => (
                <div key={i} className="text-[#A3E635] text-[11.5px]">
                  <span className="text-[#6E7568] select-none mr-1.5">&gt;</span>
                  {line}
                </div>
              ))}
              {lastExecutionResult.returnValue !== undefined && (
                <pre className="text-[#38BDF8] text-[11px] p-2 bg-[#18201B] rounded-lg overflow-x-auto">
                  {typeof lastExecutionResult.returnValue === 'object'
                    ? JSON.stringify(lastExecutionResult.returnValue, null, 2)
                    : String(lastExecutionResult.returnValue)}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
