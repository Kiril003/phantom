import React, { useState } from 'react';
import {
  Code2,
  X,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface CodeDiffMathHexInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const CodeDiffMathHexInspectorModal: React.FC<CodeDiffMathHexInspectorModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Код, математика та двійкові дані',
}) => {
  const [activeTab, setActiveTab] = useState<'diff' | 'math' | 'hex'>('diff');
  const [mathAmp, setMathAmp] = useState(2);
  const [mathFreq, setMathFreq] = useState(1);

  const hexBytes = [
    '7F', '45', '4C', '46', '02', '01', '01', '00', '00', '00', '00', '00', '00', '00', '00', '00',
    '03', '00', '3E', '00', '01', '00', '00', '00', '80', '14', '00', '00', '00', '00', '00', '00',
    '40', '00', '00', '00', '00', '00', '00', '00', 'A0', '2B', '01', '00', '00', '00', '00', '00',
  ];

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <Code2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Side-by-Side Diff, Math Canvas & Hex Inspector
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Порівняння коду, графіки функцій та двійковий аналіз
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('diff')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'diff' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Code Diff
              </button>
              <button
                onClick={() => setActiveTab('math')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'math' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Math Canvas
              </button>
              <button
                onClick={() => setActiveTab('hex')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'hex' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Hex Inspector
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] hover:text-[#21261F] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar space-y-4">
          {/* TAB 1: Dynamic Side-by-Side Code Diff */}
          {activeTab === 'diff' && (
            <div className="space-y-4">
              <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl flex justify-between items-center text-xs font-mono">
                <span className="font-bold text-[#21261F]">src/services/noiseProtocol.ts</span>
                <span className="text-[#8A9186]">Diff: +3 рядки, -2 рядки</span>
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono text-xs border border-[#E5DEC9] rounded-xl overflow-hidden shadow-2xs">
                {/* Left: Original */}
                <div className="p-3 bg-[#FAF8F5] border-r border-[#E8E1D3] space-y-1">
                  <div className="text-[10px] text-[#8A9186] font-bold pb-1">ORIGINAL:</div>
                  <div className="p-1 bg-red-50 text-red-800 rounded">- const key = generateOldKey();</div>
                  <div className="p-1 text-[#6E7568]">const cipher = createCipher();</div>
                  <div className="p-1 bg-red-50 text-red-800 rounded">- return cipher.encrypt(buf);</div>
                </div>

                {/* Right: Modified */}
                <div className="p-3 bg-white space-y-1">
                  <div className="text-[10px] text-emerald-800 font-bold pb-1">MODIFIED:</div>
                  <div className="p-1 bg-emerald-50 text-emerald-800 rounded">+ const key = ratchet.rotateKey();</div>
                  <div className="p-1 text-[#21261F]">const cipher = createCipher();</div>
                  <div className="p-1 bg-emerald-50 text-emerald-800 rounded">+ return cipher.encryptE2EE(buf);</div>
                  <div className="p-1 bg-emerald-50 text-emerald-800 rounded">+ merkleLog.append(key.hash);</div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Interactive Math Canvas */}
          {activeTab === 'math' && (
            <div className="space-y-4">
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-[#21261F]">Функція хвилі сигналу: $y = {mathAmp} \cdot \sin({mathFreq}x)$</span>
                  <span className="font-mono text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                    Desmos Engine Live
                  </span>
                </div>

                {/* Function Graph Simulation */}
                <div className="h-36 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl flex items-center justify-center p-4">
                  <div className="w-full flex items-center justify-between gap-1 h-full">
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((x) => {
                      const y = Math.sin((x * mathFreq * Math.PI) / 8) * mathAmp;
                      return (
                        <div key={x} className="flex-1 flex flex-col items-center justify-center h-full">
                          <div
                            className="w-2 bg-[#D96C35] rounded-full transition-all duration-150"
                            style={{ height: `${Math.max(6, Math.abs(y) * 20)}px` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Sliders */}
                <div className="grid grid-cols-2 gap-4 text-xs pt-1">
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>Амплітуда (a):</span>
                      <span className="font-mono font-bold">{mathAmp}</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="4"
                      value={mathAmp}
                      onChange={(e) => {
                        soundFx.playTap();
                        setMathAmp(Number(e.target.value));
                      }}
                      className="w-full accent-[#D96C35]"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>Частота (b):</span>
                      <span className="font-mono font-bold">{mathFreq}x</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="4"
                      value={mathFreq}
                      onChange={(e) => {
                        soundFx.playTap();
                        setMathFreq(Number(e.target.value));
                      }}
                      className="w-full accent-[#D96C35]"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Hex / Binary Inspector */}
          {activeTab === 'hex' && (
            <div className="space-y-4">
              <div className="p-3 bg-[#21261F] text-emerald-400 font-mono text-xs rounded-xl space-y-2 shadow-2xs">
                <div className="flex justify-between text-[#8A9186] text-[10px]">
                  <span>ELF 64-bit LSB executable (Radxa Kernel Dump)</span>
                  <span>Offset: 0x00000000</span>
                </div>

                <div className="grid grid-cols-16 gap-1 text-center text-[11px] pt-1">
                  {hexBytes.map((byte, idx) => (
                    <span
                      key={idx}
                      className={`p-1 rounded cursor-pointer transition-colors ${
                        idx < 4
                          ? 'bg-red-500/30 text-red-300 font-bold'
                          : idx < 16
                          ? 'bg-emerald-500/20 text-emerald-200'
                          : 'hover:bg-white/20'
                      }`}
                      title={`Offset 0x${idx.toString(16).padStart(2, '0')}: ${byte}`}
                    >
                      {byte}
                    </span>
                  ))}
                </div>

                <div className="text-[10px] text-[#8A9186] pt-2 border-t border-[#3E453A] flex justify-between">
                  <span>Magic Header: \x7FELF (x86_64 / AArch64)</span>
                  <span>48 Bytes</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Code Diff, Math & Binary Inspector</span>
          <span className="font-mono">Hex Engine v1.8</span>
        </div>
      </div>
    </div>
  );
};
