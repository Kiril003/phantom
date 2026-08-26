import React, { useState } from 'react';
import {
  PenTool,
  Play,
  X,
  MousePointer,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useMessengerStore } from '../../stores/messengerStore';

interface StickyNoteItem {
  id: string;
  author: string;
  color: string;
  text: string;
  convertedToTask: boolean;
}

interface CollaborativeWhiteboardPlaygroundModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const CollaborativeWhiteboardPlaygroundModal: React.FC<CollaborativeWhiteboardPlaygroundModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Мультиплеєрний простір',
}) => {
  const [activeTab, setActiveTab] = useState<'whiteboard' | 'laser_share' | 'code_playground'>('whiteboard');
  const [isCodeRunning, setIsCodeRunning] = useState(false);
  const [codeOutput, setCodeOutput] = useState('Mean packet time: 4.8ms | Latency std: 0.18ms\n✓ Wasm sandboxed memory safe execution complete');

  const [stickyNotes, setStickyNotes] = useState<StickyNoteItem[]>([
    { id: 'st1', author: 'Кирило', color: 'bg-amber-100 border-amber-300', text: 'Додати 868MHz RSSI графік у віджет', convertedToTask: false },
    { id: 'st2', author: 'Марина', color: 'bg-emerald-100 border-emerald-300', text: 'Перевірити векторні годинники CRDT', convertedToTask: false },
    { id: 'st3', author: 'Саня', color: 'bg-indigo-100 border-indigo-300', text: 'Замовити 10 шт антенних конекторів SMA', convertedToTask: true },
  ]);

  if (!isOpen) return null;

  const handleConvertNoteToTask = (id: string, text: string) => {
    soundFx.playSend();
    setStickyNotes(
      stickyNotes.map((n) => (n.id === id ? { ...n, convertedToTask: true } : n))
    );
    const store = useMessengerStore.getState();
    store.addCustomMessage({
      id: `msg_task_from_note_${Date.now()}`,
      senderId: store.currentUser.id,
      senderName: 'Whiteboard Task Converter',
      senderAvatar: store.currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'text',
      isSelf: true,
      text: `📋 **[Стікер конвертовано в задачу Canvas]**\n• Завдання: *${text}*\n• Статус: Додано в беклог спринту (To Do) ✓`,
    });
  };

  const handleRunPlaygroundCode = () => {
    soundFx.playSend();
    setIsCodeRunning(true);
    setTimeout(() => {
      setIsCodeRunning(false);
      setCodeOutput(`[Wasm Runtime Kernel @ 0x4f810]\nRan 12 iterations in 1.4ms\nOutput: [Vector3D: { x: 14.2, y: -8.1, z: 99.4 }]\nExit code 0 (Success)`);
    }, 700);
  };

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
              <PenTool className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Multiplayer Whiteboard, Лазерний Скріншер & Code Runner
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Спільні стікери, курсори колег та Wasm Code Playground
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('whiteboard')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'whiteboard' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Whiteboard
              </button>
              <button
                onClick={() => setActiveTab('laser_share')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'laser_share' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Лазерний Скріншер
              </button>
              <button
                onClick={() => setActiveTab('code_playground')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'code_playground' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Code Playground
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
          {/* TAB 1: Multiplayer Whiteboard */}
          {activeTab === 'whiteboard' && (
            <div className="space-y-4">
              <div className="p-4 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl relative h-64 overflow-hidden shadow-2xs flex flex-wrap gap-3 p-4">
                {/* Live Peer Cursors */}
                <div className="absolute top-6 left-1/3 flex items-center gap-1 text-xs font-bold text-indigo-700 pointer-events-none animate-pulse">
                  <MousePointer className="w-4 h-4 fill-indigo-600 text-indigo-600" />
                  <span className="bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded shadow">Марина</span>
                </div>

                <div className="absolute bottom-10 right-1/4 flex items-center gap-1 text-xs font-bold text-emerald-700 pointer-events-none">
                  <MousePointer className="w-4 h-4 fill-emerald-600 text-emerald-600" />
                  <span className="bg-emerald-600 text-white text-[10px] px-1.5 py-0.5 rounded shadow">Саня</span>
                </div>

                {/* Sticky Notes */}
                {stickyNotes.map((note) => (
                  <div
                    key={note.id}
                    className={`w-48 p-3 rounded-xl border text-xs flex flex-col justify-between shadow-xs ${note.color}`}
                  >
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-[#8A9186] uppercase">@{note.author}</span>
                      <p className="font-semibold text-[#21261F]">{note.text}</p>
                    </div>

                    <button
                      onClick={() => handleConvertNoteToTask(note.id, note.text)}
                      disabled={note.convertedToTask}
                      className={`mt-2 py-1 px-2 rounded-lg text-[10px] font-bold transition-all ${
                        note.convertedToTask
                          ? 'bg-emerald-600 text-white cursor-default'
                          : 'bg-white hover:bg-[#FAF8F5] border border-[#E5DEC9] text-[#21261F]'
                      }`}
                    >
                      {note.convertedToTask ? 'В Canvas задачах ✓' : '+ Створити задачу'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: Live Spatial Screen Sharing */}
          {activeTab === 'laser_share' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-1 text-xs text-indigo-950">
                <span className="font-bold text-indigo-900">Спільний екран із тимчасовими лазерними мітками</span>
                <p className="text-[11px]">
                  Учасники дзвінка можуть малювати поверх екрана без перешкод для доповідача.
                </p>
              </div>

              <div className="p-6 bg-[#21261F] text-white rounded-xl h-48 flex flex-col justify-between items-center relative">
                <div className="w-full flex justify-between text-xs text-[#8A9186]">
                  <span>Трансляція: Figma (UI Design v2.4)</span>
                  <span className="text-red-400 font-bold flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                    LIVE
                  </span>
                </div>

                <div className="p-3 bg-red-500/20 border border-red-500 rounded-full text-red-300 font-mono text-xs flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-red-500 animate-bounce" />
                  <span>Лазерна мітка від @Кирило: перевірити відступи в шапці</span>
                </div>

                <span className="text-[10px] text-[#8A9186]">3 учасники залишають просторові коментарі</span>
              </div>
            </div>
          )}

          {/* TAB 3: Interactive Code Playground */}
          {activeTab === 'code_playground' && (
            <div className="space-y-4">
              <div className="border border-[#E5DEC9] rounded-xl overflow-hidden shadow-2xs">
                <div className="bg-[#FAF8F5] p-3 border-b border-[#E8E1D3] flex justify-between items-center">
                  <span className="font-mono text-xs font-bold text-[#6E7568]">Rust / Wasm Code Snippet</span>
                  <button
                    onClick={handleRunPlaygroundCode}
                    disabled={isCodeRunning}
                    className="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>{isCodeRunning ? 'Виконання...' : 'Run in Wasm'}</span>
                  </button>
                </div>

                <div className="p-3 bg-[#21261F] text-emerald-400 font-mono text-xs">
                  <pre>{`fn simulate_lora_hop(packet_size: usize) -> f64 {
    let air_time_ms = (packet_size as f64 * 8.0) / 19.2;
    air_time_ms + 1.2
}`}</pre>
                </div>

                <div className="p-3 bg-[#FAF8F5] border-t border-[#E8E1D3] font-mono text-xs text-[#21261F]">
                  <span className="text-[10px] text-[#8A9186] font-bold block pb-1">[Wasm Terminal Out]:</span>
                  <pre className="text-xs text-[#21261F]">{codeOutput}</pre>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Multiplayer & Real-time Canvas</span>
          <span className="font-mono">Live Sync Engine v3.0</span>
        </div>
      </div>
    </div>
  );
};
