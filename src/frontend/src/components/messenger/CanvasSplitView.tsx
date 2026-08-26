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
  Send,
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
  const [published, setPublished] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [newBlockType, setNewBlockType] = useState<CanvasBlock['type']>('decision');
  const [newBlockContent, setNewBlockContent] = useState('');
  const [isAddingBlock, setIsAddingBlock] = useState(false);
  const [rawMarkdownText, setRawMarkdownText] = useState('');

  const storageKey = `phantom_canvas_${chatId}_${threadId}`;

  // Initialize document with persistence
  const [doc, setDoc] = useState<CanvasDocument>(() => {
    if (initialDoc) return initialDoc;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }

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

  // Save to local storage whenever doc changes
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(doc));
    } catch {
      // ignore
    }
  }, [doc, storageKey]);

  // Sync raw markdown on doc changes
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

  // Publish / Share Canvas card directly to the active chat
  const handlePublishToChat = () => {
    soundFx.playSend();
    const store = useMessengerStore.getState();
    const activeChatId = store.activeChatId || chatId;
    if (!activeChatId) return;

    const clientId = `c_${Date.now()}_canvas`;
    const message: Message = {
      id: clientId,
      senderId: store.currentUser.id,
      senderName: store.currentUser.name,
      senderAvatar: store.currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'widget:canvas',
      text: `📄 Опубліковано живий Canvas: ${doc.title}`,
      canvasData: doc,
      isSelf: true,
      status: 'sent',
    };

    // Add to chat messages in store
    store.addCustomMessage(message);
    setPublished(true);
    setTimeout(() => setPublished(false), 2500);
  };

  // Smart AI extraction from chat messages
  const handleExtractFromMessages = () => {
    soundFx.playSend();
    const textMsgs = messages.filter((m) => m.text && !m.isDeleted && m.type === 'text');
    if (!textMsgs.length) return;

    const extractedBlocks: CanvasBlock[] = [];

    textMsgs.forEach((m, idx) => {
      const txt = m.text || '';
      const lower = txt.toLowerCase();

      // Check for decisions
      if (
        lower.includes('вирішили') ||
        lower.includes('погодили') ||
        lower.includes('прийнято') ||
        lower.includes('робимо так') ||
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
      // Check for tasks
      else if (
        lower.includes('треба ') ||
        lower.includes('потрібно ') ||
        lower.includes('зробити') ||
        lower.includes('todo') ||
        lower.includes('завдання:') ||
        txt.includes('- [ ]')
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
      // Check for code / configs
      else if (txt.includes('```') || txt.includes('function') || txt.includes('const ') || txt.includes('import ')) {
        extractedBlocks.push({
          id: `ai_code_${Date.now()}_${idx}`,
          type: 'code',
          content: txt.replace(/```[a-z]*\n?/g, '').trim(),
          authorName: m.senderName,
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
      className="flex flex-col h-full bg-[#FAF7F0] text-[#21261F] border-l border-[#E5DEC9] shadow-xl transition-all select-text"
      style={{ fontFamily: 'var(--font-sans, system-ui, sans-serif)' }}
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5DEC9] bg-[#F7F4EC] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-[#FDF5ED] border border-[#EADCC8] flex items-center justify-center text-[#D96C35] shrink-0 shadow-sm">
            <Layers className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-bold tracking-tight text-[#21261F] truncate">
                {doc.title}
              </h2>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FDF5ED] text-[#D96C35] border border-[#EADCC8] shrink-0">
                Work OS Canvas
              </span>
            </div>
            <p className="text-[11px] text-[#6E7568] truncate mt-0.5">
              Синхронізовано з бесідою • Змінено: {doc.lastUpdated}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {/* Publish to Chat Button */}
          <button
            onClick={handlePublishToChat}
            title="Опублікувати цей Canvas прямо в чат для всіх співрозмовників"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold shadow-sm transition-all ${
              published
                ? 'bg-emerald-600 text-white'
                : 'bg-[#D96C35] hover:bg-[#B85425] text-white'
            }`}
          >
            {published ? <Check className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
            <span>{published ? 'Опубліковано ✓' : 'Надіслати в чат 🚀'}</span>
          </button>

          {/* AI Extract */}
          <button
            onClick={handleExtractFromMessages}
            title="Автоматично витягти рішення та завдання з розмови"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#FDF5ED] hover:bg-[#FBE8D6] border border-[#EADCC8] text-[#D96C35] text-[11.5px] font-semibold transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">AI Синтез</span>
          </button>

          {/* Width Mode Toggle */}
          {onToggleWidthMode && (
            <button
              onClick={() => onToggleWidthMode(widthMode === 'half' ? 'wide' : widthMode === 'wide' ? 'full' : 'half')}
              title={widthMode === 'half' ? 'Розширити на 65%' : widthMode === 'wide' ? 'Повноекранний Canvas' : 'Спліт 50%'}
              className="p-1.5 rounded-lg hover:bg-[#EAE4D7] text-[#6E7568] transition-colors"
            >
              {widthMode === 'full' ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}

          {/* Copy Markdown */}
          <button
            onClick={handleCopyMarkdown}
            title="Копіювати весь Markdown"
            className="p-1.5 rounded-lg hover:bg-[#EAE4D7] text-[#6E7568] transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
          </button>

          {/* Download File */}
          <button
            onClick={handleDownload}
            title="Експорт у файл .md"
            className="p-1.5 rounded-lg hover:bg-[#EAE4D7] text-[#6E7568] transition-colors"
          >
            <FileDown className="w-4 h-4" />
          </button>

          {/* Close Panel */}
          <button
            onClick={onClose}
            title="Закрити спліт-екран"
            className="p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-600 text-[#6E7568] transition-colors ml-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Subheader Tabs & Vitals ────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-[#E5DEC9] bg-[#FAF7F0] shrink-0">
        <div className="flex items-center gap-1 bg-[#EAE4D7] p-0.5 rounded-lg border border-[#DDD5C5]">
          <button
            onClick={() => setActiveTab('blocks')}
            className={`flex items-center gap-1.5 px-3 py-1 text-[11.5px] font-semibold rounded-md transition-all ${
              activeTab === 'blocks'
                ? 'bg-[#FDFCF9] text-[#21261F] shadow-sm'
                : 'text-[#6E7568] hover:text-[#21261F]'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-[#D96C35]" />
            <span>Живі блоки</span>
          </button>

          <button
            onClick={() => setActiveTab('markdown')}
            className={`flex items-center gap-1.5 px-3 py-1 text-[11.5px] font-semibold rounded-md transition-all ${
              activeTab === 'markdown'
                ? 'bg-[#FDFCF9] text-[#21261F] shadow-sm'
                : 'text-[#6E7568] hover:text-[#21261F]'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Markdown</span>
          </button>

          <button
            onClick={() => setActiveTab('summary')}
            className={`flex items-center gap-1.5 px-3 py-1 text-[11.5px] font-semibold rounded-md transition-all ${
              activeTab === 'summary'
                ? 'bg-[#FDFCF9] text-[#21261F] shadow-sm'
                : 'text-[#6E7568] hover:text-[#21261F]'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Підсумок</span>
          </button>
        </div>

        {/* Counters */}
        <div className="flex items-center gap-3 text-[11.5px] font-medium text-[#6E7568]">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#D96C35]" />
            <b className="text-[#21261F]">{decisionsList.length}</b> рішень
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-indigo-500" />
            <b className="text-[#21261F]">{actionItemsList.length}</b> завдань
          </span>
        </div>
      </div>

      {/* ── Document Body ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3.5 custom-scrollbar">
        {/* TAB: Blocks */}
        {activeTab === 'blocks' && (
          <div className="space-y-3">
            {doc.blocks.map((block, index) => (
              <div
                key={block.id}
                className={`group relative p-4 rounded-xl border transition-all ${
                  block.type === 'decision'
                    ? 'bg-[#FDF9F3] border-[#EADCC8] hover:border-[#D96C35]'
                    : block.type === 'action-item'
                    ? 'bg-[#FDFCF9] border-[#E5DEC9] hover:border-indigo-400/50'
                    : block.type === 'heading'
                    ? 'bg-[#F7F4EC] border-[#E5DEC9]'
                    : 'bg-[#FDFCF9] border-[#E5DEC9] hover:border-[#D96C35]/40'
                }`}
              >
                {/* Block Controls (Move, Edit, Delete) */}
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 flex items-center gap-1 bg-[#F7F4EC] p-1 rounded-lg border border-[#E5DEC9] shadow-sm transition-opacity">
                  <button
                    onClick={() => handleMoveBlock(index, 'up')}
                    disabled={index === 0}
                    title="Перемістити вгору"
                    className="p-1 hover:bg-[#EAE4D7] rounded disabled:opacity-30 text-[#6E7568]"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleMoveBlock(index, 'down')}
                    disabled={index === doc.blocks.length - 1}
                    title="Перемістити вниз"
                    className="p-1 hover:bg-[#EAE4D7] rounded disabled:opacity-30 text-[#6E7568]"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleStartEdit(block)}
                    title="Редагувати"
                    className="p-1 hover:bg-[#EAE4D7] rounded text-[#6E7568]"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteBlock(block.id)}
                    title="Видалити блок"
                    className="p-1 hover:bg-red-500/10 hover:text-red-600 rounded text-[#6E7568]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Inline Editing Form */}
                {editingBlockId === block.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full min-h-[70px] p-2.5 bg-white border border-[#D96C35] rounded-lg text-[13px] text-[#21261F] focus:outline-none resize-none leading-relaxed"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingBlockId(null)}
                        className="px-3 py-1 text-xs text-[#6E7568] hover:text-[#21261F]"
                      >
                        Скасувати
                      </button>
                      <button
                        onClick={() => handleSaveEdit(block.id)}
                        className="px-3 py-1 rounded-md bg-[#D96C35] hover:bg-[#B85425] text-white text-xs font-semibold"
                      >
                        Зберегти
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* HEADING BLOCK */}
                    {block.type === 'heading' && (
                      <h3
                        onClick={() => handleStartEdit(block)}
                        className="text-[15px] font-bold text-[#21261F] tracking-tight flex items-center gap-2.5 cursor-pointer"
                      >
                        <span className="w-1.5 h-4 bg-[#D96C35] rounded-full shrink-0" />
                        <span>{block.content}</span>
                      </h3>
                    )}

                    {/* DECISION BLOCK */}
                    {block.type === 'decision' && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#D96C35] bg-[#FDF5ED] px-2.5 py-0.5 rounded-full border border-[#EADCC8]">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Ухвалене рішення
                          </span>
                          {block.authorName && (
                            <span className="text-[11px] text-[#6E7568]">
                              • {block.authorName}
                            </span>
                          )}
                        </div>
                        <p
                          onClick={() => handleStartEdit(block)}
                          className="text-[13px] text-[#21261F] leading-relaxed font-medium pl-1 cursor-pointer hover:opacity-90"
                        >
                          {block.content}
                        </p>
                      </div>
                    )}

                    {/* ACTION ITEM / TASK BLOCK */}
                    {block.type === 'action-item' && (
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => toggleChecklist(block.id)}
                          className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 ${
                            block.checked
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : 'border-[#CCC4B5] hover:border-indigo-500 bg-white'
                          }`}
                        >
                          {block.checked && <Check className="w-3 h-3 stroke-[3]" />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p
                            onClick={() => handleStartEdit(block)}
                            className={`text-[13px] leading-relaxed cursor-pointer ${
                              block.checked
                                ? 'text-[#8A9186] line-through'
                                : 'text-[#21261F] font-medium'
                            }`}
                          >
                            {block.content}
                          </p>
                          {block.authorName && (
                            <span className="text-[10.5px] text-[#8A9186] mt-1 block">
                              Відповідальний: <b>{block.authorName}</b>
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* CODE BLOCK */}
                    {block.type === 'code' && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10.5px] text-[#6E7568] px-1 font-mono">
                          <span>Код / Конфігурація</span>
                          <button
                            onClick={() => navigator.clipboard.writeText(block.content)}
                            className="hover:text-[#D96C35]"
                          >
                            Копіювати
                          </button>
                        </div>
                        <pre
                          onClick={() => handleStartEdit(block)}
                          className="p-3 bg-[#F4EFE6] rounded-xl border border-[#E5DEC9] font-mono text-[12px] text-[#21261F] overflow-x-auto cursor-pointer leading-relaxed"
                        >
                          {block.content}
                        </pre>
                      </div>
                    )}

                    {/* REGULAR TEXT BLOCK */}
                    {block.type === 'text' && (
                      <p
                        onClick={() => handleStartEdit(block)}
                        className="text-[13px] text-[#21261F] leading-relaxed cursor-pointer"
                      >
                        {block.content}
                      </p>
                    )}
                  </>
                )}
              </div>
            ))}

            {/* Add New Block Composer */}
            {isAddingBlock ? (
              <div className="p-4 rounded-xl border border-[#D96C35] bg-[#FDF9F3] space-y-3 animate-in fade-in duration-150 shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-bold text-[#21261F] flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5 text-[#D96C35]" />
                    Новий блок у Canvas
                  </span>
                  <select
                    value={newBlockType}
                    onChange={(e) => setNewBlockType(e.target.value as CanvasBlock['type'])}
                    className="bg-white border border-[#E5DEC9] text-xs rounded-lg px-2.5 py-1 text-[#21261F] focus:outline-none focus:border-[#D96C35]"
                  >
                    <option value="decision">🎯 Рішення (Decision)</option>
                    <option value="action-item">✅ Завдання (Action Item)</option>
                    <option value="heading">📌 Заголовок (Heading)</option>
                    <option value="text">📝 Текст (Note)</option>
                    <option value="code">💻 Код (Code / Spec)</option>
                  </select>
                </div>

                <textarea
                  value={newBlockContent}
                  onChange={(e) => setNewBlockContent(e.target.value)}
                  placeholder={
                    newBlockType === 'decision'
                      ? 'Опишіть ухвалене командою рішення…'
                      : newBlockType === 'action-item'
                      ? 'Опишіть завдання або дію…'
                      : newBlockType === 'heading'
                      ? 'Введіть заголовок розділу…'
                      : 'Введіть вміст блоку…'
                  }
                  className="w-full h-24 p-3 bg-white border border-[#E5DEC9] rounded-xl text-[13px] text-[#21261F] placeholder-[#8A9186] focus:outline-none focus:border-[#D96C35] resize-none"
                  autoFocus
                />

                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setIsAddingBlock(false)}
                    className="px-3 py-1.5 text-xs text-[#6E7568] hover:text-[#21261F]"
                  >
                    Скасувати
                  </button>
                  <button
                    onClick={handleAddBlock}
                    className="px-4 py-1.5 rounded-lg bg-[#D96C35] hover:bg-[#B85425] text-white text-xs font-bold transition-all shadow-sm"
                  >
                    Додати до Canvas
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsAddingBlock(true)}
                className="w-full py-3 border-2 border-dashed border-[#E5DEC9] hover:border-[#D96C35] rounded-xl text-xs font-semibold text-[#6E7568] hover:text-[#D96C35] hover:bg-[#FDF5ED] transition-all flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>Додати блок до Canvas (+ Рішення, Завдання, Код)</span>
              </button>
            )}
          </div>
        )}

        {/* TAB: Markdown Raw Editor */}
        {activeTab === 'markdown' && (
          <div className="h-full flex flex-col space-y-2">
            <div className="flex items-center justify-between text-[11px] text-[#6E7568] px-1">
              <span>Редактор Markdown (живе оновлення)</span>
              <span>GitHub Flavored Markdown</span>
            </div>
            <textarea
              value={rawMarkdownText}
              onChange={(e) => setRawMarkdownText(e.target.value)}
              className="w-full h-full min-h-[420px] p-4 font-mono text-[12.5px] text-[#21261F] bg-[#FAF7F0] rounded-xl border border-[#E5DEC9] resize-none focus:outline-none focus:border-[#D96C35] leading-relaxed select-text"
            />
          </div>
        )}

        {/* TAB: Executive Summary */}
        {activeTab === 'summary' && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-[#FDF9F3] border border-[#EADCC8]">
              <h4 className="text-[13px] font-bold text-[#D96C35] flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4" />
                Реєстр ухвалених рішень ({decisionsList.length})
              </h4>
              {decisionsList.length === 0 ? (
                <p className="text-xs text-[#8A9186]">Ще немає зафіксованих рішень.</p>
              ) : (
                <ul className="space-y-2">
                  {decisionsList.map((d, i) => (
                    <li key={i} className="text-xs leading-relaxed text-[#21261F] flex items-start gap-2">
                      <span className="text-[#D96C35] font-bold shrink-0">{i + 1}.</span>
                      <span>{d.content}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="p-4 rounded-xl bg-[#FAF7F0] border border-[#E5DEC9]">
              <h4 className="text-[13px] font-bold text-[#21261F] flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-indigo-500" />
                Список відкритих завдань ({actionItemsList.filter((a) => !a.checked).length})
              </h4>
              {actionItemsList.length === 0 ? (
                <p className="text-xs text-[#8A9186]">Усі завдання виконано або список порожній.</p>
              ) : (
                <ul className="space-y-2">
                  {actionItemsList.map((a, i) => (
                    <li key={i} className="text-xs flex items-center justify-between gap-2">
                      <span className={a.checked ? 'line-through text-[#8A9186]' : 'text-[#21261F]'}>
                        {a.content}
                      </span>
                      {a.authorName && (
                        <span className="text-[10px] text-[#8A9186] shrink-0 font-mono">@{a.authorName}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Footer Vitals ─────────────────────────────────────────────────── */}
      <div className="px-5 py-3 border-t border-[#E5DEC9] bg-[#F7F4EC] flex items-center justify-between text-[11px] text-[#6E7568] shrink-0">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Автозбереження (Local-first CRDT)
        </span>
        <span>{doc.blocks.length} блоків</span>
      </div>
    </div>
  );
};
