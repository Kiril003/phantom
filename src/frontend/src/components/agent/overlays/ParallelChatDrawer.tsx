import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Send, Bot as BotIcon, User as UserIcon, Loader2, Wrench } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgentStore } from '../../../stores/agentStore';
import type { AgentChatMessage } from '../../../stores/agentStore';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

function substateLabel(s: string): string {
  const map: Record<string, string> = {
    idle: 'очікую',
    thinking: 'міркую',
    planning: 'планую',
    acting: 'дію',
    reflecting: 'аналізую',
    waiting_user: 'чекаю відповідь',
  };
  return map[s] ?? s;
}

function MessageBubble({ m }: { m: AgentChatMessage }) {
  const isUser = m.role === 'user';
  // Tool-call chips: lines matching [tool:...] pattern emitted by the pipeline.
  const toolChipRe = /\[tool:([^\]]+)\]/g;
  const chips: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = toolChipRe.exec(m.content)) !== null) chips.push(match[1]);
  const displayText = m.content.replace(/\[tool:[^\]]+\]/g, '').trim();

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] p-3 rounded-2xl flex gap-3 shadow-sm ${
          isUser
            ? 'bg-primary/10 border border-primary/20'
            : 'bg-white/60 border border-white'
        }`}
      >
        <div className="flex-shrink-0 mt-1">
          {isUser
            ? <UserIcon size={16} className="text-primary" />
            : <BotIcon size={16} className="text-primary-shadow" />}
        </div>
        <div className="flex flex-col gap-1">
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1">
              {chips.map((chip, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono bg-primary/10 text-primary-shadow border border-primary/20"
                >
                  <Wrench size={10} />
                  {chip}
                </span>
              ))}
            </div>
          )}
          <div className="text-sm leading-relaxed text-ink-primary whitespace-pre-wrap">
            {displayText || m.content}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ParallelChatDrawer({ isOpen, onClose }: Props) {
  const { agentChat, sendAgentMessage, loadAgentThread, substate, currentTask } = useAgentStore();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Hydrate thread from backend when drawer opens.
  useEffect(() => {
    if (isOpen) {
      const taskId = currentTask?.task.id;
      loadAgentThread(taskId);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Auto-scroll on new messages or streaming.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [agentChat.messages, agentChat.streaming]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || agentChat.streaming) return;
    setInput('');
    try {
      await sendAgentMessage(text);
    } catch {
      // Error is surfaced by the store appending a streaming=false state;
      // no additional UI required here.
    }
  }, [input, agentChat.streaming, sendAgentMessage]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
          />

          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 bottom-0 w-[400px] z-50 flex flex-col"
            style={{
              background: 'var(--glass-elevated, rgba(255,255,255,0.85))',
              backdropFilter: 'blur(16px)',
              borderLeft: '1px solid var(--glass-border)',
              boxShadow: '-10px 0 50px rgba(120,70,10,0.15)',
            }}
          >
            {/* Header with live substate strip */}
            <div
              className="px-4 pt-4 pb-3 flex flex-col gap-1 border-b"
              style={{ borderBottom: '1px solid var(--glass-border)' }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <h3 className="font-display font-bold text-sm tracking-wider uppercase text-primary-shadow">
                    Агент
                  </h3>
                </div>
                <button
                  onClick={onClose}
                  className="p-1 hover:bg-black/5 rounded-lg transition-colors"
                  aria-label="Закрити"
                >
                  <X size={20} className="text-primary-shadow/60" />
                </button>
              </div>
              {/* Live substate pill */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-muted">стан:</span>
                <span className="text-xs font-mono text-primary-shadow bg-primary/8 px-2 py-0.5 rounded-full">
                  {substateLabel(substate)}
                </span>
                {currentTask?.task.goal && (
                  <span className="text-xs text-ink-muted truncate max-w-[180px]" title={currentTask.task.goal}>
                    · {currentTask.task.goal}
                  </span>
                )}
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
              {agentChat.messages.length === 0 && !agentChat.streaming && (
                <p className="text-xs text-ink-muted text-center mt-8">
                  Запитайте агента поки він працює над завданням.
                </p>
              )}
              {agentChat.messages.map((m, i) => (
                <MessageBubble key={`${m.role}-${i}-${m.created_at ?? i}`} m={m} />
              ))}
              {agentChat.streaming && (
                <div className="flex justify-start">
                  <div className="bg-white/40 border border-white/50 p-3 rounded-2xl flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-primary" />
                    <span className="text-xs text-ink-muted italic">міркую…</span>
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div
              className="p-4 bg-black/5 border-t"
              style={{ borderTop: '1px solid var(--glass-border)' }}
            >
              <div className="relative">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                  placeholder="Запитати агента…"
                  disabled={agentChat.streaming}
                  className="w-full bg-white/50 border border-white rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:border-primary/50 transition-all text-ink-primary disabled:opacity-50"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || agentChat.streaming}
                  className="absolute right-2 top-1.5 p-1.5 text-primary hover:text-primary-shadow disabled:text-ink-faint transition-colors"
                  aria-label="Надіслати"
                >
                  <Send size={20} />
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
