import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Copy,
  Check,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  Maximize2,
  Minimize2,
  Sparkles,
  Send,
  RotateCcw,
  FileText,
  LayoutDashboard,
  Network,
  User,
  GitBranch,
  Code2,
  CheckSquare,
  Heading,
  Calculator,
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
  | 'callout'
  | 'math';

export interface ExtendedCanvasBlock extends Omit<CanvasBlock, 'type'> {
  type: ExtendedBlockType;
  priority?: 'urgent' | 'high' | 'med' | 'low';
  assignee?: string;
  dueDate?: string;
  status?: 'draft' | 'in_progress' | 'review' | 'approved' | 'rejected' | 'done';
  language?: string;
  x?: number;
  y?: number;
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
  const [viewMode, setViewMode] = useState<'doc' | 'board' | 'whiteboard'>('doc');
  const [copied, setCopied] = useState(false);
  const [published, setPublished] = useState(false);
  const [history, setHistory] = useState<ExtendedCanvasBlock[][]>([]);
  const [historyIdx, setHistoryIdx] = useState(0);

  const storageKey = `phantom_canvas_v3_${chatId}_${threadId}`;
  /** Полотно живе ЛИШЕ в localStorage цієї вкладки — на вузол воно не їде.
   *  Якщо сховище відмовляє (приватне вікно, вичерпана квота), правки
   *  зникають при перезавантаженні. Три `catch {}` ковтали цю відмову
   *  мовчки, тож людина дізнавалась про втрату вже після неї. */
  const [notSaved, setNotSaved] = useState(false);

  // Default clean blocks
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
      type: 'code',
      content: `// P2P DataChannel Mesh Sync\nexport function syncMesh(payload) {\n  peers.forEach(p => p.send(payload));\n}`,
      language: 'typescript',
      updatedAt: 'щойно',
    },
    {
      id: 'b6',
      type: 'action-item',
      content: 'Тестування P2P звʼязку на мобільних пристроях',
      assignee: 'Саня',
      checked: false,
      updatedAt: 'щойно',
    },
  ];

  const [blocks, setBlocks] = useState<ExtendedCanvasBlock[]>(() => {
    if (initialDoc && initialDoc.blocks) return initialDoc.blocks as ExtendedCanvasBlock[];
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch {
      // Читання не вдалось — нижче підуть початкові блоки. Це не втрата
      // написаного: якщо запис колись пройшов, він лишається в сховищі.
    }
    return defaultBlocks;
  });

  const pushHistory = (newBlocks: ExtendedCanvasBlock[]) => {
    const updated = history.slice(0, historyIdx + 1);
    updated.push(newBlocks);
    setHistory(updated);
    setHistoryIdx(updated.length - 1);
    setBlocks(newBlocks);
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

  const handleContentChange = (id: string, newContent: string) => {
    if (newContent.startsWith('/todo ') || newContent.startsWith('/task ')) {
      updateBlock(id, { type: 'action-item', content: newContent.replace(/^\/(todo|task)\s+/, ''), checked: false });
      return;
    }
    if (newContent.startsWith('/decision ') || newContent.startsWith('/d ')) {
      updateBlock(id, { type: 'decision', content: newContent.replace(/^\/(decision|d)\s+/, '') });
      return;
    }
    if (newContent.startsWith('/code ')) {
      updateBlock(id, { type: 'code', content: newContent.replace(/^\/code\s+/, '') });
      return;
    }
    if (newContent.startsWith('/h1 ') || newContent.startsWith('/heading ') || newContent.startsWith('# ')) {
      updateBlock(id, { type: 'heading', content: newContent.replace(/^(\/h1|\/heading|#)\s+/, '') });
      return;
    }
    if (newContent.startsWith('/quote ') || newContent.startsWith('> ')) {
      updateBlock(id, { type: 'callout', content: newContent.replace(/^(\/quote|>)\s+/, '') });
      return;
    }
    if (newContent.startsWith('/math ') || newContent.startsWith('$$ ')) {
      updateBlock(id, { type: 'math', content: newContent.replace(/^(\/math|\$\$)\s+/, '') });
      return;
    }
    updateBlock(id, { content: newContent });
  };

  useEffect(() => {
    const handleAddToCanvas = (e: Event) => {
      const customEv = e as CustomEvent<{ text: string; type?: 'text' | 'decision' | 'action-item' }>;
      if (!customEv.detail?.text) return;
      soundFx.playSend();
      const newBlock: ExtendedCanvasBlock = {
        id: `b_${Date.now()}`,
        type: customEv.detail.type || 'text',
        content: customEv.detail.text,
        updatedAt: 'щойно',
      };
      setBlocks((prev) => [...prev, newBlock]);
    };

    window.addEventListener('phantom:add-to-canvas', handleAddToCanvas);
    return () => window.removeEventListener('phantom:add-to-canvas', handleAddToCanvas);
  }, [storageKey]);

  // Один запис на кожну зміну блоків, і одне місце, де відмова стає видимою.
  // Раніше запис жив у двох гілках із `catch {}` у кожній, а спроба світити
  // прапорець ЗСЕРЕДИНИ оновлювача стану була ще й неправильною: оновлювач
  // мусить лишатись чистим, інакше React має право викликати його двічі.
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(blocks));
      setNotSaved(false);
    } catch {
      setNotSaved(true);
    }
  }, [blocks, storageKey]);

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
          : type === 'math'
          ? 'f(x) = a \\cdot \\sin(bx + c)'
          : '',
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

  // Kanban Board Columns
  const kanbanColumns = [
    { id: 'todo', title: 'Очікує', status: 'draft' },
    { id: 'in_progress', title: 'В роботі', status: 'in_progress' },
    { id: 'review', title: 'Ревʼю', status: 'review' },
    { id: 'done', title: 'Виконано', status: 'done' },
  ];

  return (
    <div className="flex flex-col h-full bg-[#FCFBF8] text-[#21261F] select-text shadow-xl relative overflow-hidden">
      {/* Відмова сховища більше не безшумна. Полотно живе лише в цій вкладці,
          тож невдалий запис означає, що написане зникне при перезавантаженні —
          і сказати про це треба ДО того, як людина закриє вкладку. */}
      {notSaved && (
        <div
          data-testid="canvas-not-saved"
          className="px-3 sm:px-4 py-1.5 bg-[#FBEFE9] border-b border-[#E8C7B6] text-[11.5px] font-semibold text-[#A5502F] shrink-0"
        >
          Сховище вкладки не приймає запис — написане тут зникне після
          перезавантаження. Скопіюйте важливе.
        </div>
      )}

      {/* 1. Header Toolbar — Responsive, Polished, Zero-Overlap */}
      <div className="px-3 sm:px-4 py-2.5 bg-[#FAF8F5] border-b border-[#E8E1D3] flex flex-wrap items-center justify-between gap-2 shrink-0">
        {/* Left: Document Title & Mobile Back Button */}
        <div className="min-w-0 flex items-center gap-1.5 sm:gap-2 flex-1 max-w-[280px]">
          <button
            onClick={onClose}
            className="md:hidden p-1 -ml-1 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] hover:text-[#21261F] transition-colors shrink-0"
            title="Назад до чату"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="p-1 rounded-md bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9] shrink-0">
            <FileText className="w-3.5 h-3.5" />
          </div>
          <input
            type="text"
            value={docTitle}
            onChange={(e) => setDocTitle(e.target.value)}
            className="w-full bg-transparent font-bold text-xs sm:text-sm text-[#21261F] focus:outline-none border-b border-transparent focus:border-[#D96C35]/50 pb-0.5 truncate"
            placeholder="Назва документа..."
          />
        </div>

        {/* Center: View Switcher (Doc / Board / Whiteboard) */}
        <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568] shrink-0">
          <button
            onClick={() => {
              soundFx.playTap();
              setViewMode('doc');
            }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
              viewMode === 'doc' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
            }`}
            title="Документ"
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Документ</span>
          </button>

          <button
            onClick={() => {
              soundFx.playTap();
              setViewMode('board');
            }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
              viewMode === 'board' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
            }`}
            title="Канбан-дошка"
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Канбан</span>
          </button>

          <button
            onClick={() => {
              soundFx.playTap();
              setViewMode('whiteboard');
            }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
              viewMode === 'whiteboard' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
            }`}
            title="Схема"
          >
            <Network className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Схема</span>
          </button>
        </div>

        {/* Right: Quick Action Controls */}
        <div className="flex items-center gap-1 shrink-0">
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
            className="flex items-center gap-1 px-2 py-1 bg-white hover:bg-[#FDF5ED] border border-[#E5DEC9] rounded-lg text-xs font-semibold text-[#D96C35] transition-all shadow-2xs"
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
            className="flex items-center gap-1 px-2.5 py-1 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-lg text-xs font-semibold shadow-xs transition-all"
            title="Поділитися в чаті"
          >
            <Send className="w-3 h-3" />
            <span>{published ? 'Надіслано ✓' : 'У чат'}</span>
          </button>

          {onToggleWidthMode && (
            <button
              onClick={() => onToggleWidthMode(widthMode === 'half' ? 'wide' : widthMode === 'wide' ? 'full' : 'half')}
              className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] transition-colors hidden sm:flex"
              title="Ширина панелі"
            >
              {widthMode === 'full' ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] hover:text-[#21261F] transition-colors"
            title="Закрити Canvas"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Multi-View Body */}

      {/* A) DOC MODE (Structured Block Document) */}
      {viewMode === 'doc' && (
        <div className="flex-1 min-h-0 p-4 sm:p-6 md:p-8 overflow-y-auto custom-scrollbar space-y-3 max-w-3xl mx-auto w-full">
          {blocks.map((block, idx) => (
            <div
              key={block.id}
              className="group relative flex items-start gap-2 transition-all p-1.5 rounded-xl hover:bg-white border border-transparent hover:border-[#EAE3D5] hover:shadow-2xs"
            >
              {/* Drag / Action Controls (Left gutter, always visible on hover inside card) */}
              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity select-none pt-1 shrink-0">
                <button
                  onClick={() => moveBlock(idx, 'up')}
                  disabled={idx === 0}
                  className="p-0.5 hover:bg-[#EFE8DA] rounded text-[#8A9186] hover:text-[#21261F] disabled:opacity-20"
                  title="Вгору"
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button
                  onClick={() => moveBlock(idx, 'down')}
                  disabled={idx === blocks.length - 1}
                  className="p-0.5 hover:bg-[#EFE8DA] rounded text-[#8A9186] hover:text-[#21261F] disabled:opacity-20"
                  title="Вниз"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
                <button
                  onClick={() => deleteBlock(block.id)}
                  className="p-0.5 hover:bg-red-50 rounded text-red-400 hover:text-red-600"
                  title="Видалити блок"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>

              {/* Block Content Container */}
              <div className="flex-1 min-w-0">
                {block.type === 'heading' ? (
                  <input
                    type="text"
                    value={block.content}
                    onChange={(e) => handleContentChange(block.id, e.target.value)}
                    placeholder="Введіть заголовок..."
                    className="w-full bg-transparent font-bold text-base md:text-lg text-[#21261F] focus:outline-none border-b border-transparent focus:border-[#D96C35]/40 py-1"
                  />
                ) : block.type === 'decision' ? (
                  <div className="border-l-3 border-[#D96C35] pl-3 py-2 bg-[#FDF5ED] rounded-r-xl border border-r-[#E5DEC9] border-y-[#E5DEC9]">
                    <span className="text-[10px] uppercase font-bold text-[#D96C35] block pb-0.5">
                      ✓ Ухвалене рішення
                    </span>
                    <textarea
                      value={block.content}
                      onChange={(e) => handleContentChange(block.id, e.target.value)}
                      rows={2}
                      className="w-full bg-transparent font-medium text-xs md:text-[13px] text-[#1C241B] focus:outline-none leading-relaxed resize-none"
                      placeholder="Опишіть зафіксоване рішення..."
                    />
                  </div>
                ) : block.type === 'action-item' ? (
                  <div className="flex items-center gap-2.5 py-1 px-2 rounded-lg bg-white border border-[#E8E1D3]/70">
                    <input
                      type="checkbox"
                      checked={Boolean(block.checked || block.status === 'done')}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        updateBlock(block.id, { checked, status: checked ? 'done' : 'in_progress' });
                      }}
                      className="w-4 h-4 accent-[#D96C35] rounded cursor-pointer shrink-0"
                    />
                    <input
                      type="text"
                      value={block.content}
                      onChange={(e) => handleContentChange(block.id, e.target.value)}
                      placeholder="Введіть завдання..."
                      className={`flex-1 bg-transparent text-xs md:text-[13px] focus:outline-none ${
                        block.checked || block.status === 'done' ? 'line-through text-[#8A9186]' : 'text-[#21261F] font-medium'
                      }`}
                    />
                    {block.assignee && (
                      <span className="text-[11px] font-semibold text-[#D96C35] px-2 py-0.5 rounded-full bg-[#FDF5ED] border border-[#E5DEC9] shrink-0">
                        @{block.assignee}
                      </span>
                    )}
                  </div>
                ) : block.type === 'code' ? (
                  <div className="w-full rounded-xl bg-[#1C211D] border border-[#2F3830] p-3 text-emerald-400 font-mono text-xs overflow-hidden shadow-2xs my-1">
                    <div className="flex justify-between items-center pb-2 border-b border-[#2C332D] text-[10px] text-[#8A9186]">
                      <span>{block.language || 'typescript'}</span>
                      <span className="text-emerald-500 font-bold">Wasm Live Code</span>
                    </div>
                    <textarea
                      value={block.content}
                      onChange={(e) => handleContentChange(block.id, e.target.value)}
                      rows={4}
                      className="w-full bg-transparent font-mono text-xs text-emerald-400 focus:outline-none leading-relaxed resize-none pt-2 custom-scrollbar"
                      placeholder="// Введіть код..."
                    />
                  </div>
                ) : block.type === 'callout' ? (
                  <div className="p-3 rounded-xl bg-white border border-[#E5DEC9] text-xs text-[#5F6A60] leading-relaxed shadow-2xs">
                    <textarea
                      value={block.content}
                      onChange={(e) => handleContentChange(block.id, e.target.value)}
                      rows={2}
                      className="w-full bg-transparent focus:outline-none resize-none"
                      placeholder="Примітка або коментар..."
                    />
                  </div>
                ) : block.type === 'math' ? (
                  <div className="p-3 rounded-xl bg-[#F4F1EA] border border-[#E5DEC9] text-xs font-mono text-indigo-900 leading-relaxed">
                    <div className="text-[10px] text-indigo-700 font-bold pb-1">$$ LaTeX Формула $$</div>
                    <textarea
                      value={block.content}
                      onChange={(e) => handleContentChange(block.id, e.target.value)}
                      rows={2}
                      className="w-full bg-transparent font-mono text-xs text-indigo-950 focus:outline-none resize-none"
                      placeholder="f(x) = ..."
                    />
                  </div>
                ) : (
                  <textarea
                    value={block.content}
                    onChange={(e) => handleContentChange(block.id, e.target.value)}
                    rows={Math.max(1, Math.ceil((block.content.length || 1) / 60))}
                    className="w-full bg-transparent text-xs md:text-[13px] text-[#21261F] focus:outline-none leading-relaxed resize-none py-1 placeholder:text-[#A0A69D]"
                    placeholder="Введіть текст (підтримує /todo, /decision, /code, /h1, /math)..."
                  />
                )}
              </div>
            </div>
          ))}

          {/* Clean Modular Bottom Inserter Bar */}
          <div className="pt-6 border-t border-[#EAE3D5]">
            <div className="p-2 bg-white border border-[#E5DEC9] rounded-xl shadow-2xs flex flex-wrap items-center justify-center gap-1.5 text-xs text-[#6E7568]">
              <span className="text-[11px] font-bold text-[#21261F] pr-1.5 flex items-center gap-1">
                <Plus className="w-3.5 h-3.5 text-[#D96C35]" />
                Додати блок:
              </span>

              <button
                onClick={() => addBlock('text')}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-[#FAF8F5] border border-transparent hover:border-[#E8E1D3] text-[#21261F] font-medium transition-all"
              >
                <FileText className="w-3 h-3 text-[#8A9186]" />
                <span>Текст</span>
              </button>

              <button
                onClick={() => addBlock('decision')}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FDF5ED] hover:bg-[#FAEAD9] border border-[#E5DEC9] text-[#D96C35] font-bold transition-all"
              >
                <Check className="w-3 h-3 text-[#D96C35]" />
                <span>Рішення</span>
              </button>

              <button
                onClick={() => addBlock('action-item')}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-[#FAF8F5] border border-transparent hover:border-[#E8E1D3] text-[#21261F] font-medium transition-all"
              >
                <CheckSquare className="w-3 h-3 text-emerald-600" />
                <span>Завдання</span>
              </button>

              <button
                onClick={() => addBlock('code')}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-[#FAF8F5] border border-transparent hover:border-[#E8E1D3] text-[#21261F] font-medium transition-all"
              >
                <Code2 className="w-3 h-3 text-indigo-600" />
                <span>Код</span>
              </button>

              <button
                onClick={() => addBlock('heading')}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-[#FAF8F5] border border-transparent hover:border-[#E8E1D3] text-[#21261F] font-medium transition-all"
              >
                <Heading className="w-3 h-3 text-[#8A9186]" />
                <span>Заголовок</span>
              </button>

              <button
                onClick={() => addBlock('math')}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-[#FAF8F5] border border-transparent hover:border-[#E8E1D3] text-[#21261F] font-medium transition-all"
              >
                <Calculator className="w-3 h-3 text-amber-600" />
                <span>Формула</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* B) BOARD MODE (Kanban Sprint Board) */}
      {viewMode === 'board' && (
        <div className="flex-1 min-h-0 p-4 md:p-6 overflow-x-auto overflow-y-hidden bg-[#FAF8F5]">
          <div className="flex gap-4 h-full min-w-[760px]">
            {kanbanColumns.map((col) => {
              const colBlocks = blocks.filter((b) => {
                if (col.id === 'done') return b.status === 'done' || b.checked;
                if (col.id === 'review') return b.status === 'review';
                if (col.id === 'in_progress') return b.status === 'in_progress' && !b.checked;
                return b.status === 'draft' || (!b.status && b.type === 'action-item' && !b.checked);
              });

              return (
                <div key={col.id} className="flex-1 bg-[#F3EDE0]/70 rounded-xl p-3 flex flex-col h-full border border-[#E8E1D3]">
                  <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-[#E5DEC9]">
                    <div className="flex items-center gap-1.5 font-bold text-xs text-[#21261F]">
                      <span>{col.title}</span>
                      <span className="px-1.5 py-0.2 rounded-full bg-[#E5DEC9] text-[10px] text-[#6E7568]">
                        {colBlocks.length}
                      </span>
                    </div>
                    <button
                      onClick={() => addBlock('action-item')}
                      className="p-1 hover:bg-white rounded-md text-[#D96C35]"
                      title="Додати завдання"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2.5 custom-scrollbar pr-1">
                    {colBlocks.map((b) => (
                      <div
                        key={b.id}
                        className="bg-white p-3 rounded-lg border border-[#E5DEC9] shadow-2xs space-y-2 hover:border-[#D96C35]/50 transition-all cursor-pointer group"
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                            b.type === 'decision' ? 'bg-[#FDF5ED] text-[#D96C35]' : 'bg-[#EFE8DA] text-[#6E7568]'
                          }`}>
                            {b.type}
                          </span>
                          <button
                            onClick={() => deleteBlock(b.id)}
                            className="opacity-0 group-hover:opacity-100 text-[#8A9186] hover:text-red-500 transition-opacity"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>

                        <textarea
                          value={b.content}
                          onChange={(e) => handleContentChange(b.id, e.target.value)}
                          rows={2}
                          className="w-full bg-transparent text-xs text-[#21261F] font-medium resize-none focus:outline-none"
                          placeholder="Опис картки..."
                        />

                        <div className="flex items-center justify-between pt-1 border-t border-[#F5EFE3] text-[10px] text-[#6E7568]">
                          <span className="flex items-center gap-1 font-medium">
                            <User className="w-3 h-3 text-[#D96C35]" />
                            {b.assignee || 'Всі'}
                          </span>

                          <div className="flex gap-1">
                            {col.id !== 'todo' && (
                              <button
                                onClick={() => updateBlock(b.id, { status: col.id === 'done' ? 'review' : 'draft', checked: false })}
                                className="px-1.5 py-0.5 bg-[#EFE8DA] hover:bg-[#E5DEC9] rounded text-[9px] font-semibold"
                              >
                                ←
                              </button>
                            )}
                            {col.id !== 'done' && (
                              <button
                                onClick={() => {
                                  const nextStatus = col.id === 'todo' ? 'in_progress' : col.id === 'in_progress' ? 'review' : 'done';
                                  updateBlock(b.id, { status: nextStatus as any, checked: nextStatus === 'done' });
                                }}
                                className="px-1.5 py-0.5 bg-[#D96C35] hover:bg-[#B85425] text-white rounded text-[9px] font-semibold"
                              >
                                →
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* C) WHITEBOARD / MINDMAP MODE */}
      {viewMode === 'whiteboard' && (
        <div className="flex-1 min-h-0 relative overflow-hidden bg-[#FAF8F5] bg-[radial-gradient(#D9CFBB_1px,transparent_1px)] [background-size:16px_16px]">
          <div className="absolute inset-0 p-6 overflow-auto custom-scrollbar">
            {/* SVG Link lines between consecutive nodes */}
            <svg className="absolute inset-0 w-[1200px] h-[900px] pointer-events-none stroke-[#D96C35]/30 stroke-2">
              {blocks.slice(0, -1).map((b, i) => {
                const next = blocks[i + 1];
                const x1 = (b.x || 100) + 120;
                const y1 = (b.y || 100) + 40;
                const x2 = (next.x || 200) + 120;
                const y2 = (next.y || 200) + 40;
                return <line key={`line_${b.id}_${next.id}`} x1={x1} y1={y1} x2={x2} y2={y2} strokeDasharray="4 4" />;
              })}
            </svg>

            {/* Interactive draggable Node Cards */}
            {blocks.map((b) => (
              <div
                key={b.id}
                style={{
                  position: 'absolute',
                  left: `${b.x || 100}px`,
                  top: `${b.y || 100}px`,
                  width: '240px',
                }}
                className="bg-white border-2 border-[#E5DEC9] hover:border-[#D96C35] rounded-xl p-3.5 shadow-md space-y-1.5 transition-all select-text z-10"
              >
                <div className="flex items-center justify-between gap-1 text-[10px] text-[#6E7568] border-b border-[#F1EBDD] pb-1">
                  <span className="font-bold uppercase text-[#D96C35] flex items-center gap-1">
                    <GitBranch className="w-3 h-3" />
                    {b.type}
                  </span>
                  <button onClick={() => deleteBlock(b.id)} className="hover:text-red-500">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                <textarea
                  value={b.content}
                  onChange={(e) => handleContentChange(b.id, e.target.value)}
                  rows={3}
                  className="w-full bg-transparent text-xs text-[#21261F] font-medium resize-none focus:outline-none"
                  placeholder="Вузол схеми..."
                />
              </div>
            ))}

            <button
              onClick={() => addBlock('decision')}
              className="fixed bottom-12 right-12 z-20 flex items-center gap-1.5 px-3 py-2 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-full shadow-lg text-xs font-bold"
            >
              <Plus className="w-4 h-4" />
              <span>+ Новий вузол</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. Subtle Status Footer */}
      <div className="px-4 py-2 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
        <span>{blocks.length} блоків</span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>Синхронізовано</span>
        </span>
      </div>
    </div>
  );
};
