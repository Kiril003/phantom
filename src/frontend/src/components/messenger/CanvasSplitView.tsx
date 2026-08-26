import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  CheckCircle2,
  Copy,
  Check,
  Edit3,
  Trash2,
  Layers,
  Maximize2,
  Minimize2,
  ChevronUp,
  ChevronDown,
  FileText,
  Sparkles,
  FileDown,
} from 'lucide-react';
import { CanvasDocument, CanvasBlock, Message } from '../../types/messenger';
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

type TabMode = 'blocks' | 'markdown' | 'summary';

export const CanvasSplitView: React.FC<CanvasSplitViewProps> = ({
  chatTitle,
  chatId = 'current_chat',
  threadId = 'root_thread',
  messages = [],
  initialDoc,
  onClose,
  onSave,
  widthMode = 'half',
  onToggleWidthMode,
}) => {
  const [activeTab, setActiveTab] = useState<TabMode>('blocks');
  const [copied, setCopied] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [newBlockType, setNewBlockType] = useState<CanvasBlock['type']>('decision');
  const [newBlockContent, setNewBlockContent] = useState('');
  const [isAddingBlock, setIsAddingBlock] = useState(false);
  const [rawMarkdownText, setRawMarkdownText] = useState('');

  const storageKey = `phantom_canvas_${chatId}_${threadId}`;

  const [doc, setDoc] = useState<CanvasDocument>(() => {
    if (initialDoc) return initialDoc;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch { }

    return {
      id: `canvas_${Date.now()}`,
      threadId,
      conversationId: chatId,
      title: `${chatTitle} — Робочий Canvas рішень`,
      rawMarkdown: '',
      decisionsCount: 1,
      openQuestionsCount: 0,
      lastUpdated: 'щойно',
      updatedBy: 'Ви',
      blocks: [
        {
          id: 'b1',
          type: 'heading',
          content: `${chatTitle} — Спільний простір рішень`,
          updatedAt: 'щойно',
        },
        {
          id: 'b2',
          type: 'decision',
          content: 'Погоджено перехід на гібридну Work OS модель із живими Canvas-документами.',
          authorName: 'Команда',
          updatedAt: 'щойно',
        },
        {
          id: 'b3',
          type: 'action-item',
          content: 'Синхронізувати спліт-екран із гілками обговорення та віджетами',
          authorName: 'Ви',
          checked: false,
          updatedAt: 'щойно',
        },
      ],
    };
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(doc));
    } catch { }
  }, [doc, storageKey]);

  useEffect(() => {
    const md = doc.blocks
      .map((b) => {
        if (b.type === 'heading') return `## ${b.content}`;
        if (b.type === 'decision') return `> 🎯 **РІШЕННЯ:** ${b.content}`;
        if (b.type === 'action-item') return `- [${b.checked ? 'x' : ' '}] ${b.content}${b.authorName ? ` (@${b.authorName})` : ''}`;
        if (b.type === 'code') return `\`\`\`\n${b.content}\n\`\`\``;
        return b.content;
      })
      .join('\n\n');
    setRawMarkdownText(md);
  }, [doc.blocks]);

  const updateDoc = (newDoc: CanvasDocument) => {
    setDoc(newDoc);
    onSave?.(newDoc);
  };

  const toggleChecklist = (blockId: string) => {
    soundFx.playTap();
    const updatedBlocks = doc.blocks.map((b) =>
      b.id === blockId ? { ...b, checked: !b.checked } : b
    );
    updateDoc({ ...doc, blocks: updatedBlocks, lastUpdated: 'щойно' });
  };

  const handleStartEdit = (block: CanvasBlock) => {
    setEditingBlockId(block.id);
    setEditContent(block.content);
  };

  const handleSaveEdit = (blockId: string) => {
    soundFx.playTap();
    const updatedBlocks = doc.blocks.map((b) =>
      b.id === blockId ? { ...b, content: editContent.trim() || b.content } : b
    );
    setEditingBlockId(null);
    updateDoc({ ...doc, blocks: updatedBlocks, lastUpdated: 'щойно' });
  };

  const handleAddBlock = () => {
    if (!newBlockContent.trim()) {
      setIsAddingBlock(false);
      return;
    }
    soundFx.playSend();
    const newBlock: CanvasBlock = {
      id: `block_${Date.now()}`,
      type: newBlockType,
      content: newBlockContent.trim(),
      authorName: 'Ви',
      checked: false,
      updatedAt: 'щойно',
    };
    const updatedBlocks = [...doc.blocks, newBlock];
    const decisionsCount = updatedBlocks.filter((b) => b.type === 'decision').length;
    updateDoc({
      ...doc,
      blocks: updatedBlocks,
      decisionsCount,
      lastUpdated: 'щойно',
    });
    setNewBlockContent('');
    setIsAddingBlock(false);
  };

  const handleDeleteBlock = (blockId: string) => {
    soundFx.playTap();
    const updatedBlocks = doc.blocks.filter((b) => b.id !== blockId);
    const decisionsCount = updatedBlocks.filter((b) => b.type === 'decision').length;
    updateDoc({
      ...doc,
      blocks: updatedBlocks,
      decisionsCount,
      lastUpdated: 'щойно',
    });
  };

  const handleMoveBlock = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= doc.blocks.length) return;
    soundFx.playTap();
    const newBlocks = [...doc.blocks];
    const temp = newBlocks[index];
    newBlocks[index] = newBlocks[targetIndex];
    newBlocks[targetIndex] = temp;
    updateDoc({ ...doc, blocks: newBlocks, lastUpdated: 'щойно' });
  };

  const handleExtractFromMessages = () => {
    soundFx.playSend();
    const textMsgs = messages.filter((m) => m.text && !m.isDeleted && m.type === 'text');
    if (!textMsgs.length) return;

    const extractedBlocks: CanvasBlock[] = [];
    textMsgs.forEach((m, idx) => {
      const txt = m.text || '';
      const lower = txt.toLowerCase();

      if (
        lower.includes('вирішили') ||
        lower.includes('погодили') ||
        lower.includes('прийнято') ||
        lower.includes('рішення:')
      ) {
        extractedBlocks.push({
          id: `ai_dec_${Date.now()}_${idx}`,
          type: 'decision',
          content: txt.replace(/^(вирішили|погодили|рішення:)\s*/i, ''),
          authorName: m.senderName,
          updatedAt: 'щойно',
        });
      }
      else if (
        lower.includes('треба ') ||
        lower.includes('потрібно ') ||
        lower.includes('зробити') ||
        lower.includes('todo') ||
        lower.includes('завдання:')
      ) {
        extractedBlocks.push({
          id: `ai_task_${Date.now()}_${idx}`,
          type: 'action-item',
          content: txt.replace(/^(\-\s*\[\s*\]|todo:|завдання:)\s*/i, ''),
          authorName: m.senderName,
          checked: false,
          updatedAt: 'щойно',
        });
      }
    });

    if (extractedBlocks.length > 0) {
      const merged = [...doc.blocks, ...extractedBlocks];
      const decisionsCount = merged.filter((b) => b.type === 'decision').length;
      updateDoc({
        ...doc,
        blocks: merged,
        decisionsCount,
        lastUpdated: 'щойно (AI синтез)',
      });
    }
  };

  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(rawMarkdownText);
    setCopied(true);
    soundFx.playTap();
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([rawMarkdownText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.title.replace(/[\s/\\:]+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const decisionsList = doc.blocks.filter((b) => b.type === 'decision');
  const actionItemsList = doc.blocks.filter((b) => b.type === 'action-item');

  return (
    <div
      className="flex flex-col h-full bg-[#FDFCF9] dark:bg-[#121417] text-[#21261F] dark:text-[#F3EEE3] border-l border-[#E5DEC9] dark:border-white/10 shadow-xl transition-all select-text"
      style={{ fontFamily: 'var(--font-sans, system-ui, sans-serif)' }}
    >
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5DEC9] dark:border-white/10 bg-[#F7F4EC] dark:bg-[#1A1D24] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-[#FDF5ED] dark:bg-amber-500/10 border border-[#EADCC8] dark:border-amber-500/30 flex items-center justify-center text-[#D96C35] shrink-0 shadow-sm">
            <Layers className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-[13.5px] font-bold tracking-tight text-[#21261F] dark:text-[#F3EEE3] truncate">
                {doc.title}
              </h2>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FDF5ED] text-[#D96C35] border border-[#EADCC8] dark:bg-amber-500/15 dark:text-amber-400 shrink-0">
                Work OS Canvas
              </span>
            </div>
            <p className="text-[11px] text-[#6E7568] dark:text-white/40 truncate mt-0.5">
              Синхронізовано з бесідою • Змінено: {doc.lastUpdated}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <button
            onClick={handleExtractFromMessages}
            title="Автоматично витягти рішення та завдання з повідомлень розмови"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#FDF5ED] hover:bg-[#FBE8D6] dark:bg-amber-500/10 dark:hover:bg-amber-500/20 border border-[#EADCC8] dark:border-amber-500/30 text-[#D96C35] dark:text-amber-400 text-[11.5px] font-semibold transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">AI Синтез</span>
          </button>
          {onToggleWidthMode && (
            <button
              onClick={() => onToggleWidthMode(widthMode === 'half' ? 'wide' : widthMode === 'wide' ? 'full' : 'half')}
              className="p-1.5 rounded-lg hover:bg-[#EAE4D7] dark:hover:bg-white/10 text-[#6E7568] dark:text-white/60 transition-colors"
            >
              {widthMode === 'full' ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={handleCopyMarkdown}
            className="p-1.5 rounded-lg hover:bg-[#EAE4D7] dark:hover:bg-white/10 text-[#6E7568] dark:text-white/60 transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
          <button
            onClick={handleDownload}
            className="p-1.5 rounded-lg hover:bg-[#EAE4D7] dark:hover:bg-white/10 text-[#6E7568] dark:text-white/60 transition-colors"
          >
            <FileDown className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-600 dark:hover:bg-red-500/20 dark:hover:text-red-400 text-[#6E7568] dark:text-white/60 transition-colors ml-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between px-5 py-2.5 border-b border-[#E5DEC9] dark:border-white/10 bg-[#FAF7F0] dark:bg-[#16191E] shrink-0">
        <div className="flex items-center gap-1 bg-[#EAE4D7] dark:bg-black/40 p-0.5 rounded-lg border border-[#DDD5C5] dark:border-white/5">
          <button
            onClick={() => setActiveTab('blocks')}
            className={`flex items-center gap-1.5 px-3 py-1 text-[11.5px] font-semibold rounded-md transition-all ${
              activeTab === 'blocks' ? 'bg-[#FDFCF9] dark:bg-[#222730] text-[#21261F] dark:text-[#F3EEE3] shadow-sm' : 'text-[#6E7568] dark:text-white/50'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-[#D96C35]" />
            <span>Живі блоки</span>
          </button>
          <button
            onClick={() => setActiveTab('markdown')}
            className={`flex items-center gap-1.5 px-3 py-1 text-[11.5px] font-semibold rounded-md transition-all ${
              activeTab === 'markdown' ? 'bg-[#FDFCF9] dark:bg-[#222730] text-[#21261F] dark:text-[#F3EEE3] shadow-sm' : 'text-[#6E7568] dark:text-white/50'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Markdown</span>
          </button>
          <button
            onClick={() => setActiveTab('summary')}
            className={`flex items-center gap-1.5 px-3 py-1 text-[11.5px] font-semibold rounded-md transition-all ${
              activeTab === 'summary' ? 'bg-[#FDFCF9] dark:bg-[#222730] text-[#21261F] dark:text-[#F3EEE3] shadow-sm' : 'text-[#6E7568] dark:text-white/50'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Підсумок</span>
          </button>
        </div>
        <div className="flex items-center gap-3 text-[11.5px] font-medium text-[#6E7568] dark:text-white/50">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#D96C35]" />
            <b className="text-[#21261F] dark:text-white">{decisionsList.length}</b> рішень
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-indigo-500" />
            <b className="text-[#21261F] dark:text-white">{actionItemsList.length}</b> завдань
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3.5 custom-scrollbar">
        {activeTab === 'blocks' && (
          <div className="space-y-3">
            {doc.blocks.map((block, index) => (
              <div
                key={block.id}
                className={`group relative p-4 rounded-xl border transition-all ${
                  block.type === 'decision'
                    ? 'bg-[#FDF9F3] dark:bg-amber-500/5 border-[#EADCC8] dark:border-amber-500/25'
                    : 'bg-[#FDFCF9] dark:bg-[#1A1D24] border-[#E5DEC9] dark:border-white/10'
                }`}
              >
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 flex items-center gap-1 bg-[#F7F4EC] dark:bg-[#222730] p-1 rounded-lg border border-[#E5DEC9] dark:border-white/10 shadow-sm transition-opacity">
                  <button onClick={() => handleMoveBlock(index, 'up')} disabled={index === 0} className="p-1 hover:bg-[#EAE4D7] dark:hover:bg-white/10 rounded disabled:opacity-30"><ChevronUp className="w-3.5 h-3.5" /></button>
                  <button onClick={() => handleMoveBlock(index, 'down')} disabled={index === doc.blocks.length - 1} className="p-1 hover:bg-[#EAE4D7] dark:hover:bg-white/10 rounded disabled:opacity-30"><ChevronDown className="w-3.5 h-3.5" /></button>
                  <button onClick={() => handleStartEdit(block)} className="p-1 hover:bg-[#EAE4D7] dark:hover:bg-white/10 rounded"><Edit3 className="w-3.5 h-3.5" /></button>
                  <button onClick={() => handleDeleteBlock(block.id)} className="p-1 hover:bg-red-500/10 hover:text-red-600 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                {editingBlockId === block.id ? (
                  <div className="space-y-2">
                    <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} className="w-full min-h-[70px] p-2.5 bg-white dark:bg-black/40 border border-[#D96C35] rounded-lg text-[13px] text-[#21261F] dark:text-white focus:outline-none" autoFocus />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingBlockId(null)} className="px-3 py-1 text-xs text-[#6E7568]">Скасувати</button>
                      <button onClick={() => handleSaveEdit(block.id)} className="px-3 py-1 rounded-md bg-[#D96C35] text-white text-xs font-semibold">Зберегти</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {block.type === 'heading' && <h3 className="text-[15px] font-bold text-[#21261F] dark:text-white flex items-center gap-2.5"><span className="w-1.5 h-4 bg-[#D96C35] rounded-full" />{block.content}</h3>}
                    {block.type === 'decision' && (
                      <div>
                        <div className="flex items-center gap-2 mb-2"><span className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-[#D96C35] bg-[#FDF5ED] dark:bg-amber-500/20 px-2.5 py-0.5 rounded-full border border-[#EADCC8] dark:border-amber-500/30"><CheckCircle2 className="w-3.5 h-3.5" />Ухвалене рішення</span></div>
                        <p onClick={() => handleStartEdit(block)} className="text-[13px] text-[#21261F] dark:text-[#F3EEE3] leading-relaxed pl-1 cursor-pointer">{block.content}</p>
                      </div>
                    )}
                    {block.type === 'action-item' && (
                      <div className="flex items-start gap-3">
                        <button onClick={() => toggleChecklist(block.id)} className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${block.checked ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-[#CCC4B5] dark:border-white/30'}`}>{block.checked && <Check className="w-3 h-3" />}</button>
                        <p onClick={() => handleStartEdit(block)} className={`text-[13px] cursor-pointer ${block.checked ? 'line-through text-[#8A9186]' : ''}`}>{block.content}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {isAddingBlock ? (
              <div className="p-4 rounded-xl border border-[#D96C35] bg-[#FDF9F3] dark:bg-[#1A1D24] space-y-3">
                <select value={newBlockType} onChange={(e) => setNewBlockType(e.target.value as CanvasBlock['type'])} className="w-full bg-white dark:bg-black/50 border border-[#E5DEC9] dark:border-white/20 text-xs rounded-lg px-2 py-1">
                  <option value="decision">🎯 Рішення</option>
                  <option value="action-item">✅ Завдання</option>
                  <option value="heading">📌 Заголовок</option>
                  <option value="text">📝 Текст</option>
                </select>
                <textarea value={newBlockContent} onChange={(e) => setNewBlockContent(e.target.value)} className="w-full h-24 p-3 bg-white dark:bg-black/40 border rounded-xl text-[13px] text-white focus:outline-none" placeholder="Введіть вміст..." autoFocus />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setIsAddingBlock(false)} className="px-3 py-1 text-xs">Скасувати</button>
                  <button onClick={handleAddBlock} className="px-4 py-1.5 rounded-lg bg-[#D96C35] text-white text-xs font-bold">Додати</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setIsAddingBlock(true)} className="w-full py-3 border-2 border-dashed border-[#E5DEC9] dark:border-white/15 rounded-xl text-xs text-[#6E7568] flex items-center justify-center gap-2"><Plus className="w-4 h-4" />Додати блок</button>
            )}
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="px-5 py-3 border-t border-white/5 bg-white/[0.01] flex items-center justify-between text-[11px] text-white/40">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          Автозбереження ввімкнено
        </span>
        <span>Local-first CRDT Sync</span>
      </div>
    </div>
  );
};
