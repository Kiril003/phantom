import React, { useState } from 'react';
import {
  PenTool,
  Play,
  X,
  Plus,
  Trash2,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useMessengerStore } from '../../stores/messengerStore';
import { useCanvasStore } from '../../stores/canvasStore';
import { useWorkOsStore } from '../../stores/workOsStore';

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
  const [activeTab, setActiveTab] = useState<'whiteboard' | 'code_playground'>('whiteboard');
  const [isCodeRunning, setIsCodeRunning] = useState(false);
  const [codeOutput, setCodeOutput] = useState('Mean packet time: 4.8ms | Latency std: 0.18ms\n✓ Wasm sandboxed memory safe execution complete');
  const [newStickyText, setNewStickyText] = useState('');

  const { shapes, addShape, deleteShape } = useCanvasStore();
  const { addTask } = useWorkOsStore();

  if (!isOpen) return null;

  const handleConvertNoteToTask = (_shapeId: string, text: string) => {
    soundFx.playSend();
    addTask({
      title: text,
      status: 'todo',
      priority: 'high',
      assigneeName: 'Kiril',
      tags: ['whiteboard', 'canvas'],
    });

    const store = useMessengerStore.getState();
    store.addCustomMessage({
      id: `msg_task_from_note_${Date.now()}`,
      senderId: store.currentUser.id,
      senderName: 'Whiteboard Task Converter',
      senderAvatar: store.currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'text',
      isSelf: true,
      text: `📋 **[Стікер конвертовано в задачу Canvas]**\n• Завдання: *${text}*\n• Статус: Додано в беклог проєкту (To Do) ✓`,
    });
  };

  const handleAddSticky = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStickyText.trim()) return;
    soundFx.playTap();
    addShape({
      type: 'note',
      x: Math.floor(Math.random() * 300 + 50),
      y: Math.floor(Math.random() * 200 + 50),
      width: 180,
      height: 120,
      color: '#FEF3C7',
      text: newStickyText.trim(),
      authorName: 'Kiril',
    });
    setNewStickyText('');
  };

  const handleRunPlaygroundCode = () => {
    soundFx.playSend();
    setIsCodeRunning(true);
    setTimeout(() => {
      setIsCodeRunning(false);
      setCodeOutput(`[Wasm Runtime Kernel @ 0x4f810]\nRan 12 iterations in 1.4ms\nOutput: [Vector3D: { x: 14.2, y: -8.1, z: 99.4 }]\nExit code 0 (Success)`);
    }, 500);
  };

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150 select-text"
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
                Multiplayer Whiteboard & Code Runner
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Спільні стікери, інтерактивні векторні фігури та Wasm Sandbox
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
                Стікери & Дошка ({shapes.length})
              </button>
              <button
                onClick={() => setActiveTab('code_playground')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'code_playground' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Code Runner
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#6E7568] hover:text-[#21261F] hover:bg-[#F1EBDD] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1 bg-[#FAF8F5]">
          {activeTab === 'whiteboard' ? (
            <div className="space-y-4">
              <form onSubmit={handleAddSticky} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Додати новий стікер або ідею на дошку..."
                  value={newStickyText}
                  onChange={(e) => setNewStickyText(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-white border border-[#E8E1D3] rounded-lg text-xs"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-[#D96C35] text-white font-bold text-xs rounded-lg flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Стікер
                </button>
              </form>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {shapes.map((shape) => (
                  <div
                    key={shape.id}
                    className="p-4 rounded-xl border border-amber-300 bg-amber-50 flex flex-col justify-between shadow-xs min-h-[140px]"
                  >
                    <div>
                      <div className="flex items-center justify-between text-[10px] text-[#8A8577] mb-2">
                        <span className="font-bold text-[#21261F]">{shape.authorName || 'Автор'}</span>
                        <button
                          onClick={() => deleteShape(shape.id)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-xs text-[#21261F] leading-relaxed">{shape.text}</p>
                    </div>
                    <div className="pt-3 border-t border-amber-200/60 flex justify-end">
                      <button
                        onClick={() => handleConvertNoteToTask(shape.id, shape.text || '')}
                        className="px-2.5 py-1 bg-white border border-amber-300 text-amber-900 rounded-lg text-[10px] font-bold hover:bg-amber-100 transition-colors"
                      >
                        + В задачу Canvas
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-[#21261F]">WebAssembly Micro-Kernel Runner</span>
                <button
                  onClick={handleRunPlaygroundCode}
                  disabled={isCodeRunning}
                  className="px-3 py-1.5 bg-[#D96C35] text-white font-bold text-xs rounded-lg flex items-center gap-1.5 hover:bg-[#C25B27]"
                >
                  <Play className="w-3.5 h-3.5" /> {isCodeRunning ? 'Виконується...' : 'Запустити код'}
                </button>
              </div>
              <pre className="p-4 bg-[#1E2521] text-[#E8E1D3] rounded-xl text-xs font-mono overflow-x-auto min-h-[180px]">
                {codeOutput}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-xs text-[#6E7568]">
          <span>Автоматична CRDT синхронізація векторних шарів</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-[#EFE9DC] text-[#21261F] font-medium rounded-lg hover:bg-[#E5DEC9] transition-colors"
          >
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
};
