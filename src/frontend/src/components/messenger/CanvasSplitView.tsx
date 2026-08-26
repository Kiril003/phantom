import React, { useState } from 'react';
import {
  X,
  Plus,
  Copy,
  Check,
  Trash2,
  ChevronUp,
  ChevronDown,
  Maximize2,
  Minimize2,
  Sparkles,
  Send,
  RotateCcw,
} from 'lucide-react';
import { CanvasDocument, CanvasBlock, Message } from '../../types/messenger';
import { useMessengerStore } from '../../stores/messengerStore';
import { soundFx } from '../../utils/messengerSound';

interface CanvasSplitViewProps {
  chatTitle: string;
  chatId?: string;
  threadId?: string;
  messages?: Message[];
  initialDoc?: CanvasDocument;
  onClose: () => void;
  onSave?: (doc: CanvasDocument) => void;
  widthMode?: 'half' | 'wide' | 'full';
  onToggleWidthMode?: (mode: 'half' | 'wide' | 'full') => void;
}

export type ExtendedBlockType =
  | 'heading'
  | 'text'
  | 'decision'
  | 'action-item'
  | 'code'
  | 'callout';

export interface ExtendedCanvasBlock extends Omit<CanvasBlock, 'type'> {
  type: ExtendedBlockType;
  priority?: 'urgent' | 'high' | 'med' | 'low';
  assignee?: string;
  dueDate?: string;
  status?: 'draft' | 'in_review' | 'approved' | 'rejected';
  language?: string;
}

export const CanvasSplitView: React.FC<CanvasSplitViewProps> = ({
  chatTitle,
  chatId = 'current_chat',
  threadId = 'root_thread',
  messages: _messages = [],
  initialDoc,
  onClose,
  onSave: _onSave,
  widthMode = 'half',
  onToggleWidthMode,
}) => {
  const [docTitle, setDocTitle] = useState(initialDoc?.title || `${chatTitle} — Документ`);
  const [copied, setCopied] = useState(false);
  const [published, setPublished] = useState(false);
  const [history, setHistory] = useState<ExtendedCanvasBlock[][]>([]);
  const [historyIdx, setHistoryIdx] = useState(0);

  const storageKey = `phantom_canvas_v3_${chatId}_${threadId}`;

  // Default clean blocks without corporate jargon
  const defaultBlocks: ExtendedCanvasBlock[] = [
    {
      id: 'b1',
      type: 'heading',
      content: 'Фінальні домовленості та архітектура',
      updatedAt: 'щойно',
    },
    {
      id: 'b2',
      type: 'text',
      content: 'Документ фіксує узгоджені рішення з обговорення в чаті для швидкого доступу команди без гортання стрічки.',
      updatedAt: 'щойно',
    },
    {
      id: 'b3',
      type: 'decision',
      content: 'Перехід на гібридну модель: розгортання будь-якої гілки в спліт-екран із живим документом рішень.',
      status: 'approved',
      updatedAt: 'щойно',
    },
    {
      id: 'b4',
      type: 'action-item',
      content: 'Синхронізація спліт-екрана та віджетів',
      assignee: 'Кирило',
      checked: true,
      updatedAt: 'щойно',
    },
    {
      id: 'b5',
      type: 'action-item',
      content: 'Тестування P2P звʼязку на мобільних пристроях',
      assignee: 'Саня',
      checked: false,
      updatedAt: 'щойно',
    },
    {
      id: 'b6',
      type: 'code',
      content: `// P2P DataChannel Mesh Sync\nexport function syncMesh(payload) {\n  peers.forEach(p => p.send(payload));\n}`,
      language: 'typescript',
      updatedAt: 'щойно',
    },
  ];

  const [blocks, setBlocks] = useState<ExtendedCanvasBlock[]>(() => {
    if (initialDoc && initialDoc.blocks) return initialDoc.blocks as ExtendedCanvasBlock[];
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch {}
    return defaultBlocks;
  });

  const pushHistory = (newBlocks: ExtendedCanvasBlock[]) => {
    const updated = history.slice(0, historyIdx + 1);
    updated.push(newBlocks);
    setHistory(updated);
    setHistoryIdx(updated.length - 1);
    setBlocks(newBlocks);
    try {
      localStorage.setItem(storageKey, JSON.stringify(newBlocks));
    } catch {}
  };

  const undo = () => {
    if (historyIdx > 0) {
      soundFx.playTap();
      const prev = history[historyIdx - 1];
      setHistoryIdx(historyIdx - 1);
      setBlocks(prev);
    }
  };

  const updateBlock = (id: string, updates: Partial<ExtendedCanvasBlock>) => {
    const next = blocks.map((b) => (b.id === id ? { ...b, ...updates, updatedAt: 'щойно' } : b));
    pushHistory(next);
  };

  const deleteBlock = (id: string) => {
    soundFx.playTap();
    const next = blocks.filter((b) => b.id !== id);
    pushHistory(next);
  };

  const moveBlock = (index: number, direction: 'up' | 'down') => {
    soundFx.playTap();
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(index, 1);
    next.splice(targetIdx, 0, moved);
    pushHistory(next);
  };

  const addBlock = (type: ExtendedBlockType, afterIdx?: number) => {
    soundFx.playTap();
    const newB: ExtendedCanvasBlock = {
      id: `b_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      type,
      content:
        type === 'heading'
          ? 'Новий заголовок'
          : type === 'decision'
          ? 'Ухвалене рішення...'
          : type === 'action-item'
          ? 'Нове завдання'
          : type === 'code'
          ? '// Код...'
          : type === 'callout'
          ? 'Примітка або зауваження...'
          : 'Текст...',
      assignee: type === 'action-item' ? 'Ви' : undefined,
      checked: false,
      updatedAt: 'щойно',
    };

    const next = [...blocks];
    if (afterIdx !== undefined && afterIdx >= 0) {
      next.splice(afterIdx + 1, 0, newB);
    } else {
      next.push(newB);
    }
    pushHistory(next);
  };

  const runAiSynthesis = () => {
    soundFx.playSend();
    const aiBlock: ExtendedCanvasBlock = {
      id: `ai_${Date.now()}`,
      type: 'decision',
      content: 'AI Підсумок: Зафіксовано ключові рішення бесіди та розподілено завдання між учасниками.',
      updatedAt: 'щойно',
    };
    pushHistory([...blocks, aiBlock]);
  };

  const handlePublishToChat = () => {
    soundFx.playSend();
    const store = useMessengerStore.getState();
    const md = blocks.map((b) => b.content).join('\n\n');

    store.addCustomMessage({
      id: `msg_canvas_${Date.now()}`,
      senderId: store.currentUser.id,
      senderName: store.currentUser.name,
      senderAvatar: store.currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'widget:canvas',
      isSelf: true,
      canvasData: {
        id: `canvas_${Date.now()}`,
        threadId,
        conversationId: chatId,
        title: docTitle,
        rawMarkdown: md,
        decisionsCount: blocks.filter((b) => b.type === 'decision').length,
        openQuestionsCount: 0,
        updatedBy: store.currentUser.name,
        blocks: blocks.map((b) => ({
          id: b.id,
          type: b.type === 'heading' ? 'heading' : b.type === 'decision' ? 'decision' : b.type === 'action-item' ? 'action-item' : b.type === 'code' ? 'code' : 'text',
          content: b.content,
          checked: b.checked,
          updatedAt: b.updatedAt,
        })),
        lastUpdated: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      },
    });

    setPublished(true);
    setTimeout(() => setPublished(false), 2000);
  };

  const copyMarkdown = () => {
    soundFx.playTap();
    const md = blocks.map((b) => b.content).join('\n\n');
    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-[#FAF7F0] border-l border-[#E5DEC9] text-[#21261F] select-text shadow-xl relative overflow-hidden">
      {/* 1. Header Toolbar — Clean & Uncluttered */}
      <div className="px-5 py-3.5 bg-[#FAF7F0] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0 flex-1">
          <input
            type="text"
            value={docTitle}
            onChange={(e) => setDocTitle(e.target.value)}
            className="w-full bg-transparent font-bold text-sm text-[#21261F] focus:outline-none border-b border-transparent focus:border-[#D96C35]/50 pb-0.5 truncate"
            placeholder="Назва документу..."
          />
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={undo}
            disabled={historyIdx === 0}
            className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] disabled:opacity-25 transition-colors"
            title="Скасувати (Undo)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={runAiSynthesis}
            className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-[#FDF5ED] border border-[#E5DEC9] rounded-lg text-xs font-semibold text-[#D96C35] transition-all"
            title="AI аналіз рішень з чату"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI</span>
          </button>

          <button
            onClick={copyMarkdown}
            className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] transition-colors"
            title="Копіювати Markdown"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={handlePublishToChat}
            className="flex items-center gap-1 px-3 py-1 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-lg text-xs font-semibold shadow-2xs transition-all"
            title="Поділитися в чаті"
          >
            <Send className="w-3 h-3" />
            <span>{published ? 'Надіслано ✓' : 'У чат'}</span>
          </button>

          {onToggleWidthMode && (
            <button
              onClick={() => onToggleWidthMode(widthMode === 'half' ? 'full' : 'half')}
              className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] transition-colors"
              title={widthMode === 'half' ? 'Розгорнути' : 'Згорнути'}
            >
              {widthMode === 'half' ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
            </button>
          )}

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] transition-colors ml-1"
            title="Закрити"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Document Canvas Body (Notion / Craft style) */}
      <div className="flex-1 min-h-0 p-6 md:p-8 overflow-y-auto custom-scrollbar space-y-4 max-w-3xl mx-auto w-full">
        {blocks.map((block, idx) => (
          <div
            key={block.id}
            className="group relative flex items-start gap-2 transition-all -ml-6 pl-6 rounded-lg hover:bg-[#F3EDE0]/50 py-1"
          >
            {/* Hover Actions (Reorder / Add / Delete) */}
            <div className="absolute left-0 top-1.5 opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity select-none">
              <button
                onClick={() => moveBlock(idx, 'up')}
                disabled={idx === 0}
                className="p-0.5 hover:bg-white rounded text-[#8A9186] hover:text-[#21261F] disabled:opacity-20"
                title="Вгору"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
              <button
                onClick={() => moveBlock(idx, 'down')}
                disabled={idx === blocks.length - 1}
                className="p-0.5 hover:bg-white rounded text-[#8A9186] hover:text-[#21261F] disabled:opacity-20"
                title="Вниз"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
              <button
                onClick={() => addBlock('text', idx)}
                className="p-0.5 hover:bg-white rounded text-[#D96C35]"
                title="Додати рядок"
              >
                <Plus className="w-3 h-3" />
              </button>
              <button
                onClick={() => deleteBlock(block.id)}
                className="p-0.5 hover:bg-red-50 rounded text-red-500"
                title="Видалити"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            {/* Block Body */}
            <div className="w-full">
              {block.type === 'heading' ? (
                <input
                  type="text"
                  value={block.content}
                  onChange={(e) => updateBlock(block.id, { content: e.target.value })}
                  placeholder="Заголовок..."
                  className="w-full bg-transparent font-bold text-base md:text-lg text-[#21261F] focus:outline-none border-b border-transparent focus:border-[#D96C35]/40 py-1"
                />
              ) : block.type === 'decision' ? (
                <div className="border-l-2 border-[#D96C35] pl-3 py-1 bg-[#FDF5ED]/60 rounded-r-lg">
                  <textarea
                    value={block.content}
                    onChange={(e) => updateBlock(block.id, { content: e.target.value })}
                    rows={2}
                    className="w-full bg-transparent font-medium text-xs md:text-[13px] text-[#1C241B] focus:outline-none leading-relaxed resize-none"
                    placeholder="Ухвалене рішення..."
                  />
                </div>
              ) : block.type === 'action-item' ? (
                <div className="flex items-center gap-2.5 py-0.5">
                  <input
                    type="checkbox"
                    checked={Boolean(block.checked)}
                    onChange={(e) => updateBlock(block.id, { checked: e.target.checked })}
                    className="w-4 h-4 accent-[#D96C35] rounded cursor-pointer shrink-0"
                  />
                  <input
                    type="text"
                    value={block.content}
                    onChange={(e) => updateBlock(block.id, { content: e.target.value })}
                    placeholder="Завдання..."
                    className={`flex-1 bg-transparent text-xs md:text-[13px] focus:outline-none ${
                      block.checked ? 'line-through text-[#8A9186]' : 'text-[#21261F]'
                    }`}
                  />
                  {block.assignee && (
                    <span className="text-[11px] text-[#6E7568] px-1.5 py-0.5 rounded bg-[#EFE8DA] font-medium shrink-0">
                      @{block.assignee}
                    </span>
                  )}
                </div>
              ) : block.type === 'code' ? (
                <div className="w-full rounded-xl bg-[#1C1F1B] p-3 text-emerald-400 font-mono text-xs overflow-x-auto shadow-2xs my-1">
                  <textarea
                    value={block.content}
                    onChange={(e) => updateBlock(block.id, { content: e.target.value })}
                    rows={4}
                    className="w-full bg-transparent font-mono text-xs text-emerald-400 focus:outline-none leading-relaxed resize-y"
                  />
                </div>
              ) : block.type === 'callout' ? (
                <div className="p-3 rounded-xl bg-white border border-[#E5DEC9] text-xs text-[#5F6A60] leading-relaxed">
                  <textarea
                    value={block.content}
                    onChange={(e) => updateBlock(block.id, { content: e.target.value })}
                    rows={2}
                    className="w-full bg-transparent focus:outline-none resize-none"
                  />
                </div>
              ) : (
                <textarea
                  value={block.content}
                  onChange={(e) => updateBlock(block.id, { content: e.target.value })}
                  rows={2}
                  className="w-full bg-transparent text-xs md:text-[13px] text-[#21261F] focus:outline-none leading-relaxed resize-none py-0.5"
                  placeholder="Введіть текст або натисніть + для нового блоку..."
                />
              )}
            </div>
          </div>
        ))}

        {/* Minimalist Bottom Inserter */}
        <div className="pt-4 flex items-center justify-center gap-2 text-xs text-[#6E7568] border-t border-[#EAE3D5]">
          <span className="text-[11px] font-medium">+ Додати:</span>
          <button
            onClick={() => addBlock('text')}
            className="px-2 py-1 rounded hover:bg-[#EFE8DA] text-[#21261F] font-medium"
          >
            Текст
          </button>
          <button
            onClick={() => addBlock('decision')}
            className="px-2 py-1 rounded hover:bg-[#FDF5ED] text-[#D96C35] font-semibold"
          >
            Рішення
          </button>
          <button
            onClick={() => addBlock('action-item')}
            className="px-2 py-1 rounded hover:bg-[#EFE8DA] text-[#21261F] font-medium"
          >
            Завдання
          </button>
          <button
            onClick={() => addBlock('code')}
            className="px-2 py-1 rounded hover:bg-[#EFE8DA] text-[#21261F] font-medium"
          >
            Код
          </button>
          <button
            onClick={() => addBlock('heading')}
            className="px-2 py-1 rounded hover:bg-[#EFE8DA] text-[#21261F] font-medium"
          >
            Заголовок
          </button>
        </div>
      </div>

      {/* 3. Subtle Status Footer */}
      <div className="px-5 py-2 bg-[#FAF7F0] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
        <span>{blocks.length} блоків</span>
        <span>Збережено</span>
      </div>
    </div>
  );
};
