import React, { useEffect, useState } from 'react';
import { MessagesSquare, X } from 'lucide-react';
import { useSpaceStore } from '../../stores/spaceStore';

/**
 * Гілка — розмова від конкретного листа, з власним непрочитаним.
 *
 * Рівень, якого в застосунку не було: тип `Thread` існував, дороги до нього
 * не було. Відкривається подією `phantom:open-thread` з дій над листом.
 */
export const ThreadPanel: React.FC<{ me: string }> = ({ me }) => {
  const activeTopicId = useSpaceStore((s) => s.activeTopicId);
  const activeThreadId = useSpaceStore((s) => s.activeThreadId);
  const threads = useSpaceStore((s) => s.threads);
  const createThread = useSpaceStore((s) => s.createThread);
  const openThread = useSpaceStore((s) => s.openThread);

  const [noTopic, setNoTopic] = useState(false);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const messageId = (e as CustomEvent).detail?.messageId as string | undefined;
      if (!messageId) return;
      const topicId = useSpaceStore.getState().activeTopicId;
      // Гілка живе в топіку. Без топіка не вигадуємо його за людину —
      // кажемо, чого бракує.
      if (!topicId) {
        setNoTopic(true);
        return;
      }
      setNoTopic(false);
      openThread(createThread(topicId, messageId, me).id);
    };
    window.addEventListener('phantom:open-thread', onOpen);
    return () => window.removeEventListener('phantom:open-thread', onOpen);
  }, [createThread, openThread, me]);

  if (noTopic) {
    return (
      <aside
        data-testid="thread-panel"
        className="w-full sm:w-[300px] shrink-0 h-full border-l border-black/5 bg-[#F7F5EE] p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-bold uppercase tracking-widest">Гілка</span>
          <button onClick={() => setNoTopic(false)} aria-label="Закрити гілку" className="p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-[#1E2521]/60">
          Гілка росте всередині топіка, а топік зараз не відкритий. Оберіть
          простір і топік ліворуч — тоді відповідь гілкою матиме де жити.
        </p>
      </aside>
    );
  }

  const thread = threads.find((t) => t.id === activeThreadId) ?? null;
  if (!thread) return null;

  const siblings = threads.filter((t) => t.topicId === activeTopicId);

  return (
    <aside
      data-testid="thread-panel"
      className="w-full sm:w-[300px] shrink-0 h-full border-l border-black/5 bg-[#F7F5EE] flex flex-col"
    >
      <div className="p-3 border-b border-black/5 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <MessagesSquare className="w-4 h-4 opacity-60 shrink-0" />
          <span className="text-[11px] font-bold uppercase tracking-widest truncate">Гілка</span>
        </div>
        <button onClick={() => openThread(null)} aria-label="Закрити гілку" className="p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 border-b border-black/5">
        <div className="text-[10px] uppercase font-bold tracking-widest text-[#1E2521]/50 mb-1">
          Від листа
        </div>
        <div className="text-xs font-mono text-[#1E2521]/70 break-all">{thread.rootMessageId}</div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {thread.messageCount === 0 ? (
          <p className="text-[11px] leading-relaxed text-[#1E2521]/60">
            У гілці ще нічого немає. Тут відповіді не змішуються з основною
            розмовою й мають власне непрочитане.
          </p>
        ) : (
          <div className="text-[11px]">{thread.messageCount} відповідей</div>
        )}
      </div>

      {siblings.length > 1 && (
        <div className="p-2 border-t border-black/5">
          <div className="text-[10px] uppercase font-bold tracking-widest text-[#1E2521]/50 px-1 pb-1">
            Гілки топіка ({siblings.length})
          </div>
          {siblings.map((t) => (
            <button
              key={t.id}
              onClick={() => openThread(t.id)}
              aria-pressed={t.id === activeThreadId}
              className={`w-full min-h-[48px] px-2 rounded-xl text-left text-xs truncate ${
                t.id === activeThreadId ? 'bg-[#1E2521] text-[#F7F5EE]' : 'hover:bg-white/70'
              }`}
            >
              {t.rootMessageId}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
};
