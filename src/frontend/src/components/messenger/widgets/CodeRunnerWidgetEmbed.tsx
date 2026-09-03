import React, { useState } from 'react';
import { CodeRunnerData } from '../../../types/messenger';
import { soundFx } from '../../../utils/messengerSound';
import { Play, Check, Terminal, Copy, Loader2, Clock } from 'lucide-react';

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
  const [code, setCode] = useState(data.code);
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(data.lastOutput || null);
  const [executionTimeMs, setExecutionTimeMs] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const handleRun = () => {
    soundFx.playTap();
    setIsRunning(true);
    setOutput(null);
    const start = performance.now();

    setTimeout(() => {
      let finalOutput = '';
      try {
        if (runner.language === 'javascript' || runner.language === 'typescript') {
          const logs: string[] = [];
          const customConsole = {
            log: (...args: any[]) =>
              logs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ')),
            info: (...args: any[]) => logs.push(`[INFO] ${args.join(' ')}`),
            warn: (...args: any[]) => logs.push(`[WARN] ${args.join(' ')}`),
            error: (...args: any[]) => logs.push(`[ERROR] ${args.join(' ')}`),
            table: (obj: any) => logs.push(JSON.stringify(obj, null, 2)),
          };
          const fn = new Function('console', code);
          const result = fn(customConsole);
          if (result !== undefined && logs.length === 0) {
            logs.push(typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result));
          }
          finalOutput = logs.length > 0 ? logs.join('\n') : '✨ Код успішно виконано (0 помилок).';
        } else {
          // Тут стояв ВИГАДАНИЙ успіх: «[PYTHON Isolated Sandbox] … ✓ Status:
          // 200 OK … Execution completed without memory leaks» — не виконавши
          // жодного рядка. Вигаданий код стану, вигадана заява про пам'ять і
          // обіцянка ізоляції, якої не існує ні тут, ні в гілці JS вище.
          //
          // Найтихіша мить — «ми цього не вміємо» — перетворювалась на
          // найгучніше твердження. І, на відміну від `new Function` поруч,
          // CSP пакунка цього не спиняє: брехня не потребує дозволу на
          // виконання.
          //
          // Виконання не додаємо — знімаємо обіцянку, якої ніхто не виконує.
          finalOutput =
            `${runner.language} тут не запускається.\n` +
            'Виконуються лише JavaScript і TypeScript, і лише у вікні застосунку.\n' +
            'Код збережено як є — його ніхто не змінював.';
        }
      } catch (err: any) {
        finalOutput = `⚠️ Runtime Error:\n${err?.stack || err?.message || String(err)}`;
      }

      const elapsed = Math.round(performance.now() - start);
      setExecutionTimeMs(elapsed);
      setIsRunning(false);
      setOutput(finalOutput);
      // Стан ставимо за тим, ЩО СТАЛОСЬ, а не за тим, що ми дійшли сюди:
      // гілка з винятком теж потрапляє в цей рядок. У пакунку це не
      // теоретично — CSP забороняє `new Function`, тож JS-код дасть
      // `EvalError`, і напис «Runtime Error» стояв би поруч зі значком успіху.
      const failed = finalOutput.startsWith('⚠️');
      const status: CodeRunnerData['status'] = failed ? 'error' : 'success';
      const updated: CodeRunnerData = { ...runner, code, lastOutput: finalOutput, status };
      setRunner(updated);
      onUpdate?.(updated);
    }, 150);
  };

  const handleCopy = () => {
    soundFx.playTap();
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full max-w-[540px] rounded-2xl bg-[#1C1F1B] border border-[#30382E] overflow-hidden shadow-md text-[#E8ECE5] my-1">
      {/* Header */}
      <div className="p-3 bg-[#141713] border-b border-[#2B3329] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-[#D96C35]" />
          <h4 className="text-xs font-mono font-bold text-white truncate">{runner.title || 'Code Runner'}</h4>
          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-[#2A3328] text-emerald-400 border border-[#3E4A3B]">
            {runner.language}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopy}
            className="p-1 hover:bg-[#283026] rounded text-[#8A9584] hover:text-white"
            title="Копіювати код"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={handleRun}
            disabled={isRunning}
            className="flex items-center gap-1.5 px-3 py-1 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-lg text-xs font-bold font-mono shadow-sm transition-all active:scale-95 disabled:opacity-50"
          >
            {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            <span>{isRunning ? 'Виконую...' : 'Run'}</span>
          </button>
        </div>
      </div>

      {/* Code Editor Area */}
      <div className="p-3 bg-[#181B16]">
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          rows={Math.min(10, Math.max(3, code.split('\n').length))}
          className="w-full bg-transparent font-mono text-xs text-emerald-400 focus:outline-none leading-relaxed resize-y"
          spellCheck={false}
        />
      </div>

      {/* Output Console */}
      {output && (
        <div className="p-3 bg-[#10120F] border-t border-[#262D24] font-mono text-xs space-y-1.5">
          <div className="flex items-center justify-between text-[10.5px] text-[#7A8675] pb-1 border-b border-[#21261F]">
            <span className="font-bold uppercase tracking-wider text-emerald-500">Output:</span>
            {executionTimeMs !== null && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>{executionTimeMs} ms</span>
              </span>
            )}
          </div>
          <pre className="whitespace-pre-wrap leading-relaxed text-[#D2D8CE] overflow-x-auto max-h-48 custom-scrollbar">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
};
