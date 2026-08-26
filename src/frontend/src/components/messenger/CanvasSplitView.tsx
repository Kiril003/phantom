import React, { useState } from 'react';
import {
  X,
  Plus,
  CheckCircle2,
  ListTodo,
  Download,
  Copy,
  Check,
  Sparkles,
  Edit3,
  Eye,
  Trash2,
  Layers,
} from 'lucide-react';
import { CanvasDocument, CanvasBlock, Message } from '../../types/messenger';
import { soundFx } from '../../utils/messengerSound';

interface CanvasSplitViewProps {
  chatTitle: string;
  threadId?: string;
  messages?: Message[];
  initialDoc?: CanvasDocument;
  onClose: () => void;
  onSave?: (doc: CanvasDocument) => void;
}

export const CanvasSplitView: React.FC<CanvasSplitViewProps> = ({
  chatTitle,
  threadId = 'root_thread',
  messages = [],
  initialDoc,
  onClose,
  onSave,
}) => {
  const [activeTab, setActiveTab] = useState<'structured' | 'markdown'>('structured');
  const [copied, setCopied] = useState(false);
  const [newBlockType, setNewBlockType] = useState<CanvasBlock['type']>('text');
  const [newBlockContent, setNewBlockContent] = useState('');
  const [isAddingBlock, setIsAddingBlock] = useState(false);

  const [doc, setDoc] = useState<CanvasDocument>(() => {
    if (initialDoc) return initialDoc;
    return {
      id: `canvas_${Date.now()}`,
      threadId,
      conversationId: 'current',
      title: `Рішення та артефакти: ${chatTitle}`,
      rawMarkdown: `# ${chatTitle} — Робочий документ\n\n## 📌 Ключові рішення\n- Рішення 1\n\n## 🎯 Завдання\n- [ ] Завдання 1`,
      decisionsCount: 1,
      openQuestionsCount: 0,
      lastUpdated: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      updatedBy: 'Ви',
      blocks: [
        {
          id: 'b1',
          type: 'heading',
          content: `${chatTitle} — Робочий документ`,
          updatedAt: 'щойно',
        },
        {
          id: 'b2',
          type: 'decision',
          content: 'Архітектурний стек погоджено: Local-first Work OS з P2P синхронізацією.',
          authorName: 'Тімлід',
          updatedAt: 'щойно',
        },
        {
          id: 'b3',
          type: 'action-item',
          content: 'Реалізувати віджети голосування та Kanban-дошки',
          authorName: 'Ви',
          checked: false,
          updatedAt: 'щойно',
        },
      ],
    };
  });

  const toggleChecklist = (blockId: string) => {
    soundFx.playTap();
    const updatedBlocks = doc.blocks.map((b) =>
      b.id === blockId ? { ...b, checked: !b.checked } : b
    );
    const updated = { ...doc, blocks: updatedBlocks, lastUpdated: 'щойно' };
    setDoc(updated);
    onSave?.(updated);
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
    const updated = {
      ...doc,
      blocks: updatedBlocks,
      decisionsCount,
      lastUpdated: 'щойно',
    };
    setDoc(updated);
    setNewBlockContent('');
    setIsAddingBlock(false);
    onSave?.(updated);
  };

  const handleDeleteBlock = (blockId: string) => {
    const updatedBlocks = doc.blocks.filter((b) => b.id !== blockId);
    const decisionsCount = updatedBlocks.filter((b) => b.type === 'decision').length;
    const updated = { ...doc, blocks: updatedBlocks, decisionsCount, lastUpdated: 'щойно' };
    setDoc(updated);
    onSave?.(updated);
  };

  const handleExtractFromMessages = () => {
    soundFx.playTap();
    const textMsgs = messages.filter((m) => m.text && m.text.length > 5);
    const extractedBlocks: CanvasBlock[] = textMsgs.slice(-5).map((m, idx) => {
      const isAction =
        m.text!.toLowerCase().includes('зроблю') ||
        m.text!.toLowerCase().includes('дороблю') ||
        m.text!.toLowerCase().includes('треба') ||
        m.text!.toLowerCase().includes('потрібно');
      return {
        id: `extracted_${Date.now()}_${idx}`,
        type: isAction ? 'action-item' : 'decision',
        content: m.text!,
        authorName: m.senderName,
        checked: false,
        updatedAt: 'авто-витяг',
      };
    });

    if (extractedBlocks.length === 0) {
      extractedBlocks.push({
        id: `extracted_${Date.now()}`,
        type: 'decision',
        content: 'Витягнуто з контексту: Усі учасники погодили поточний план спринту.',
        authorName: 'Phantom AI',
        updatedAt: 'щойно',
      });
    }

    const updatedBlocks = [...doc.blocks, ...extractedBlocks];
    const decisionsCount = updatedBlocks.filter((b) => b.type === 'decision').length;
    const updated = {
      ...doc,
      blocks: updatedBlocks,
      decisionsCount,
      lastUpdated: 'щойно',
    };
    setDoc(updated);
    onSave?.(updated);
  };

  const handleCopyMarkdown = () => {
    const lines = doc.blocks.map((b) => {
      if (b.type === 'heading') return `## ${b.content}`;
      if (b.type === 'decision') return `> **🎯 Рішення:** ${b.content} *(Автор: ${b.authorName || 'Команда'})*`;
      if (b.type === 'action-item') return `- [${b.checked ? 'x' : ' '}] ${b.content}`;
      if (b.type === 'code') return `\`\`\`\n${b.content}\n\`\`\``;
      return b.content;
    });
    const fullMd = `# ${doc.title}\n\n` + lines.join('\n\n');
    navigator.clipboard.writeText(fullMd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const lines = doc.blocks.map((b) => {
      if (b.type === 'heading') return `## ${b.content}`;
      if (b.type === 'decision') return `> **🎯 Рішення:** ${b.content}`;
      if (b.type === 'action-item') return `- [${b.checked ? 'x' : ' '}] ${b.content}`;
      if (b.type === 'code') return `\`\`\`\n${b.content}\n\`\`\``;
      return b.content;
    });
    const fullMd = `# ${doc.title}\n\n` + lines.join('\n\n');
    const blob = new Blob([fullMd], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.title.replace(/\s+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full bg-[#0E1015]/95 border-l border-white/10 text-white backdrop-blur-xl animate-in slide-in-from-right duration-300 shadow-2xl z-30">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold tracking-tight text-white/90">Живий Canvas Рішень</h2>
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Split-Doc
              </span>
            </div>
            <p className="text-[11px] text-white/40 mt-0.5">
              Синхронізовано з гілкою • Оновлено: {doc.lastUpdated}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExtractFromMessages}
            title="Авто-витяг рішень із розмови"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 text-xs font-medium transition-all"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>AI Витяг</span>
          </button>

          <button
            onClick={handleCopyMarkdown}
            title="Копіювати Markdown"
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>

          <button
            onClick={handleDownload}
            title="Завантажити .md"
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white transition-colors"
          >
            <Download className="w-4 h-4" />
          </button>

          <button
            onClick={onClose}
            title="Закрити спліт-екран"
            className="p-2 rounded-lg bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/30 text-white/70 hover:text-red-300 transition-colors ml-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/5 bg-white/[0.01]">
        <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/5">
          <button
            onClick={() => setActiveTab('structured')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
              activeTab === 'structured'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm'
                : 'text-white/50 hover:text-white'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Структура блоків</span>
          </button>
          <button
            onClick={() => setActiveTab('markdown')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
              activeTab === 'markdown'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm'
                : 'text-white/50 hover:text-white'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Markdown Raw</span>
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs text-white/50">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
            <span>{doc.blocks.filter((b) => b.type === 'decision').length} рішень</span>
          </span>
          <span className="flex items-center gap-1">
            <ListTodo className="w-3.5 h-3.5 text-indigo-400" />
            <span>{doc.blocks.filter((b) => b.type === 'action-item').length} завдань</span>
          </span>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 custom-scrollbar">
        {activeTab === 'markdown' ? (
          <div className="h-full">
            <textarea
              value={doc.blocks
                .map((b) => {
                  if (b.type === 'heading') return `## ${b.content}`;
                  if (b.type === 'decision') return `> **🎯 Рішення:** ${b.content}`;
                  if (b.type === 'action-item') return `- [${b.checked ? 'x' : ' '}] ${b.content}`;
                  if (b.type === 'code') return `\`\`\`\n${b.content}\n\`\`\``;
                  return b.content;
                })
                .join('\n\n')}
              readOnly
              className="w-full h-full p-4 font-mono text-xs text-white/80 bg-black/40 rounded-xl border border-white/10 resize-none focus:outline-none focus:border-amber-500/50 leading-relaxed"
            />
          </div>
        ) : (
          <div className="space-y-3">
            {doc.blocks.map((block) => (
              <div
                key={block.id}
                className={`group relative p-3.5 rounded-xl border transition-all ${
                  block.type === 'decision'
                    ? 'bg-gradient-to-r from-amber-500/10 to-orange-500/5 border-amber-500/30 hover:border-amber-500/50'
                    : block.type === 'action-item'
                    ? 'bg-indigo-500/5 border-indigo-500/20 hover:border-indigo-500/40'
                    : block.type === 'heading'
                    ? 'bg-white/[0.03] border-white/15'
                    : 'bg-white/[0.02] border-white/5 hover:border-white/15'
                }`}
              >
                {/* Delete button */}
                <button
                  onClick={() => handleDeleteBlock(block.id)}
                  className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 p-1 text-white/30 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                {block.type === 'heading' && (
                  <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                    <span className="w-1.5 h-4 bg-amber-400 rounded-full" />
                    {block.content}
                  </h3>
                )}

                {block.type === 'decision' && (
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded-full border border-amber-500/30">
                        <CheckCircle2 className="w-3 h-3" />
                        Ухвалене рішення
                      </span>
                      {block.authorName && (
                        <span className="text-[11px] text-white/40">• {block.authorName}</span>
                      )}
                    </div>
                    <p className="text-xs text-white/90 leading-relaxed pl-1">{block.content}</p>
                  </div>
                )}

                {block.type === 'action-item' && (
                  <div className="flex items-start gap-2.5">
                    <button
                      onClick={() => toggleChecklist(block.id)}
                      className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-all ${
                        block.checked
                          ? 'bg-emerald-500 border-emerald-400 text-black'
                          : 'border-white/30 hover:border-indigo-400 bg-black/40'
                      }`}
                    >
                      {block.checked && <Check className="w-3 h-3 stroke-[3]" />}
                    </button>
                    <div className="flex-1">
                      <p
                        className={`text-xs leading-relaxed ${
                          block.checked ? 'text-white/40 line-through' : 'text-white/90'
                        }`}
                      >
                        {block.content}
                      </p>
                      {block.authorName && (
                        <span className="text-[10px] text-white/35 mt-0.5 block">
                          Відповідальний: {block.authorName}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {block.type === 'code' && (
                  <pre className="p-3 bg-black/60 rounded-lg border border-white/10 font-mono text-[11px] text-amber-200/90 overflow-x-auto">
                    {block.content}
                  </pre>
                )}

                {block.type === 'text' && (
                  <p className="text-xs text-white/80 leading-relaxed">{block.content}</p>
                )}
              </div>
            ))}

            {/* Add block interface */}
            {isAddingBlock ? (
              <div className="p-3.5 rounded-xl border border-amber-500/30 bg-black/40 space-y-3 animate-in fade-in duration-200">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/60">Тип блоку:</span>
                  <select
                    value={newBlockType}
                    onChange={(e) => setNewBlockType(e.target.value as CanvasBlock['type'])}
                    className="bg-white/10 border border-white/20 text-xs rounded-lg px-2 py-1 text-white focus:outline-none focus:border-amber-400"
                  >
                    <option value="decision" className="bg-[#1A1D24] text-amber-300">
                      🎯 Рішення (Decision)
                    </option>
                    <option value="action-item" className="bg-[#1A1D24] text-indigo-300">
                      🎯 Завдання (Action Item)
                    </option>
                    <option value="heading" className="bg-[#1A1D24] text-white">
                      📌 Заголовок
                    </option>
                    <option value="text" className="bg-[#1A1D24] text-white">
                      📝 Текст
                    </option>
                    <option value="code" className="bg-[#1A1D24] text-amber-200">
                      💻 Код / Конфіг
                    </option>
                  </select>
                </div>

                <textarea
                  value={newBlockContent}
                  onChange={(e) => setNewBlockContent(e.target.value)}
                  placeholder={
                    newBlockType === 'decision'
                      ? 'Опишіть ухвалене командою рішення...'
                      : newBlockType === 'action-item'
                      ? 'Опишіть завдання або дію...'
                      : 'Введіть вміст блоку...'
                  }
                  className="w-full h-20 p-2.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 focus:outline-none focus:border-amber-400/60 resize-none"
                />

                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setIsAddingBlock(false)}
                    className="px-3 py-1.5 text-xs text-white/60 hover:text-white"
                  >
                    Скасувати
                  </button>
                  <button
                    onClick={handleAddBlock}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition-all"
                  >
                    Додати блок
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsAddingBlock(true)}
                className="w-full py-2.5 border border-dashed border-white/15 hover:border-amber-500/40 rounded-xl text-xs text-white/50 hover:text-amber-300 hover:bg-amber-500/5 transition-all flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Додати блок до Canvas</span>
              </button>
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
