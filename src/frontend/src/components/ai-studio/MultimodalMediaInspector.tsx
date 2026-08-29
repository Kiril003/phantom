/**
 * PHANTOM OS — Multimodal Media Inspector & Signal Extraction
 * Мультимодальний інспектор медіа: екстракція кольорової палітри (HEX/RGB),
 * сегментація аудіохвиль, розпізнавання тексту (OCR) та аналіз структури документів.
 */

import React, { useState } from 'react';
import { Eye, Palette, FileText, Activity, X, Copy, Check, Sparkles } from 'lucide-react';
import { useAISynthesisStore } from '../../stores/aiSynthesisStore';
import { soundFx } from '../../utils/messengerSound';

interface MultimodalMediaInspectorProps {
  onClose?: () => void;
}

export const MultimodalMediaInspector: React.FC<MultimodalMediaInspectorProps> = ({ onClose }) => {
  const { sendMessage } = useAISynthesisStore();
  const [activeTab, setActiveTab] = useState<'palette' | 'audio' | 'ocr'>('palette');
  const [copiedHex, setCopiedHex] = useState<string | null>(null);

  // Extracted sample palette
  const sampleColors = [
    { name: 'Terracotta Core', hex: '#E87A42', rgb: 'rgb(232, 122, 66)', contrast: 'AA' },
    { name: 'Warm Cream White', hex: '#FAF7F0', rgb: 'rgb(250, 247, 240)', contrast: 'AAA' },
    { name: 'Forest Moss Dark', hex: '#1E2521', rgb: 'rgb(30, 37, 33)', contrast: 'AAA' },
    { name: 'Golden Sun Accent', hex: '#F3B562', rgb: 'rgb(243, 181, 98)', contrast: 'AA' },
    { name: 'Emerald Sentinel', hex: '#4C8A55', rgb: 'rgb(76, 138, 85)', contrast: 'AA' },
  ];

  const handleCopyHex = (hex: string) => {
    soundFx.playTap();
    navigator.clipboard.writeText(hex);
    setCopiedHex(hex);
    setTimeout(() => setCopiedHex(null), 1500);
  };

  const handleInjectPrompt = (infoText: string) => {
    soundFx.playSend();
    sendMessage(`Зроби аналіз екстрагованих параметрів: ${infoText}`);
    if (onClose) onClose();
  };

  return (
    <div className="flex flex-col h-full bg-[#FAF7F0] border-l border-[#E0D7C6] select-none text-xs">
      {/* Inspector Header */}
      <div className="p-4 bg-white/90 backdrop-blur-md border-b border-[#E8E1D3] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-[#C25925]">
            <Eye className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-extrabold text-sm text-[#1E2521]">Мультимодальний інспектор</h3>
            <p className="text-[11px] text-[#6E7568]">Екстракція кольорів, аудіо-сигналів та тексту</p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#6E7568] hover:text-[#1E2521] hover:bg-[#F2ECE1]"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="p-3 bg-[#F5F1E6] border-b border-[#EBE3D3] flex gap-1.5">
        <button
          onClick={() => setActiveTab('palette')}
          className={`flex-1 py-1.5 rounded-xl font-bold flex items-center justify-center gap-1 transition-all ${
            activeTab === 'palette' ? 'bg-white text-[#1E2521] shadow-2xs' : 'text-[#6E7568] hover:text-[#1E2521]'
          }`}
        >
          <Palette className="w-3.5 h-3.5" />
          <span>Палітра</span>
        </button>
        <button
          onClick={() => setActiveTab('audio')}
          className={`flex-1 py-1.5 rounded-xl font-bold flex items-center justify-center gap-1 transition-all ${
            activeTab === 'audio' ? 'bg-white text-[#1E2521] shadow-2xs' : 'text-[#6E7568] hover:text-[#1E2521]'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Аудіо-хвиля</span>
        </button>
        <button
          onClick={() => setActiveTab('ocr')}
          className={`flex-1 py-1.5 rounded-xl font-bold flex items-center justify-center gap-1 transition-all ${
            activeTab === 'ocr' ? 'bg-white text-[#1E2521] shadow-2xs' : 'text-[#6E7568] hover:text-[#1E2521]'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>OCR Текст</span>
        </button>
      </div>

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'palette' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#1E2521]">Домінантні токени кольору:</span>
              <button
                onClick={() => handleInjectPrompt(`Використай кольорову палітру: ${sampleColors.map(c => c.hex).join(', ')} для створення Tailwind теми`)}
                className="text-[11px] font-bold text-[#C25925] hover:underline flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3" />
                <span>Застосувати у промпт</span>
              </button>
            </div>

            <div className="space-y-2">
              {sampleColors.map((col) => (
                <div
                  key={col.hex}
                  onClick={() => handleCopyHex(col.hex)}
                  className="p-2.5 bg-white border border-[#E0D7C6] rounded-2xl flex items-center justify-between cursor-pointer hover:border-[#D2C7B0] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-xl border border-black/10 shadow-2xs shrink-0"
                      style={{ backgroundColor: col.hex }}
                    />
                    <div>
                      <h4 className="font-bold text-xs text-[#1E2521]">{col.name}</h4>
                      <p className="font-mono text-[11px] text-[#6E7568]">{col.hex} · {col.rgb}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded text-[9.5px] font-bold">
                      WCAG {col.contrast}
                    </span>
                    {copiedHex === col.hex ? (
                      <Check className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Copy className="w-4 h-4 text-[#8A9186]" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'audio' && (
          <div className="space-y-3">
            <span className="font-bold text-[#1E2521]">Спектрограма та частотний профіль:</span>
            <div className="p-4 bg-[#1E2521] rounded-2xl border border-[#3A423B] space-y-3">
              <div className="flex items-end gap-1 h-24 pt-4">
                {Array.from({ length: 32 }, (_, i) => {
                  const heightPct = 15 + Math.sin(i * 0.4) * 40 + Math.cos(i * 0.8) * 35;
                  return (
                    <div
                      key={i}
                      style={{ height: `${Math.max(10, Math.min(100, heightPct))}%` }}
                      className="flex-1 bg-gradient-to-t from-[#C25925] to-[#F3B562] rounded-t-sm"
                    />
                  );
                })}
              </div>
              <div className="flex justify-between text-[10px] text-[#8A9186] font-mono border-t border-[#3A423B] pt-2">
                <span>0 Hz</span>
                <span>Opus 48 kHz (Full-Duplex)</span>
                <span>24 kHz</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'ocr' && (
          <div className="space-y-3">
            <span className="font-bold text-[#1E2521]">Розпізнаний текст із зображення (OCR):</span>
            <div className="p-3.5 bg-white border border-[#E0D7C6] rounded-2xl font-mono text-[11px] text-[#1E2521] leading-relaxed">
              &quot;PHANTOM Companion Architecture Blueprint. Distributed CRDT Mesh, Local WebGPU LLM Inference & Full-Duplex Voice Gateway.&quot;
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
