import { useState } from 'react';
import { motion } from 'framer-motion';
import { MessageCircle, Menu, Plus, Check, Edit3, Trash2 } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';
import type { ChatSession } from '@shared/types';

/**
 * Оголошена ширина панелі. ChatWindow рахує з неї поріг оверлея, тож
 * число живе тут, поруч із версткою, і імпортується — а не дублюється.
 */
export const SESSIONS_PANEL_W = 260;

interface ChatSidebarProps {
  sessionsOpen: boolean;
  setSessionsOpen: (open: boolean) => void;
  sessions: ChatSession[];
  currentSessionId: string | null;
  startNewSession: () => void;
  openSession: (id: string) => void;
  deleteSession: (id: string) => Promise<void>;
  updateSession: (id: string, summary: string) => Promise<void>;
  /**
   * Панель накриває розмову, а не стоїть із нею в ряду. Вмикає ChatWindow,
   * коли за виміром власної ширини 260px сусіда просто нема звідки взяти.
   */
  overlay?: boolean;
}

export function ChatSidebar({
  sessionsOpen,
  setSessionsOpen,
  sessions,
  currentSessionId,
  startNewSession,
  openSession,
  deleteSession,
  updateSession,
  overlay = false,
}: ChatSidebarProps) {
  const { t, locale } = useTranslation();
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editSessionText, setEditSessionText] = useState('');

  if (!sessionsOpen) return null;

  return (
    <>
      {/* Затемнення позаду оверлея. Воно ж — «клік поза панеллю»: інакше
          на вузькому пейні панель накриває розмову, а закрити її можна
          лише влучивши в 44-піксельний хрестик угорі. Кнопка, а не div,
          щоб той самий вихід був і з клавіатури. */}
      {overlay && (
        <motion.button
          type="button"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => setSessionsOpen(false)}
          aria-label={t('chat.sessions.close')}
          data-testid="chat-sessions-scrim"
          className="absolute inset-0 z-30"
          style={{
            background: 'rgba(10, 14, 22, 0.42)',
            backdropFilter: 'blur(2px)',
            border: 'none',
            padding: 0,
          }}
        />
      )}
      <motion.aside
      initial={{ x: '-100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '-100%', opacity: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      data-testid="chat-sessions-panel"
      data-overlay={overlay ? 'true' : undefined}
      /* Оверлей виходить із потоку — саме тому він нічого не забирає в
         розмови. Сусідом у ряду (широкий пейн) лишається все як було:
         shrink-0, повна висота, своя колонка. */
      className={
        overlay
          ? 'absolute inset-y-0 left-0 w-[260px] max-w-[86%] flex flex-col glass z-40'
          : 'w-[260px] flex flex-col shrink-0 glass z-20'
      }
      style={{
        borderTop: 'none',
        borderBottom: 'none',
        borderLeft: 'none',
        borderRight: '1px solid var(--glass-border)',
        boxShadow: overlay ? '8px 0 32px rgba(0,0,0,0.28)' : '4px 0 24px rgba(0,0,0,0.1)',
        background: 'var(--surface-base)',
      }}
    >
      <header
        className="px-4 flex items-center gap-2 shrink-0"
        style={{
          height: 52,
          borderBottom: '1px solid var(--glass-border)',
        }}
      >
        <button
          type="button"
          onClick={() => setSessionsOpen(false)}
          aria-label={t('chat.sessions.close')}
          className="flex items-center justify-center transition-all active:scale-95"
          style={{
            width: 32,
            height: 32,
            minWidth: 44,
            minHeight: 44,
            borderRadius: 10,
            background: 'transparent',
            border: 'none',
            color: 'var(--ink-secondary)',
          }}
        >
          <Menu size={18} strokeWidth={2} />
        </button>
        <span
          className="flex-1 uppercase"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-micro)',
            color: 'var(--ink-secondary)',
            letterSpacing: 'var(--tracking-widest)',
            fontWeight: 500,
          }}
        >
          {t('chat.sessions.title')}
        </span>
        <button
          type="button"
          onClick={startNewSession}
          className="flex items-center justify-center transition-all active:scale-95"
          style={{
            minWidth: 44,
            minHeight: 44,
            width: 32,
            height: 32,
            borderRadius: 10,
            background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
            color: 'var(--accent)',
            boxShadow: '0 0 12px var(--accent-glow)',
          }}
          aria-label={t('chat.sessions.new')}
          title={t('chat.sessions.new')}
        >
          <Plus size={16} strokeWidth={2} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto py-2 px-2">
        {sessions.length === 0 && (
          <div
            className="flex flex-col items-center justify-center py-12 gap-2 text-center"
            style={{ color: 'var(--ink-muted)' }}
          >
            <MessageCircle size={20} strokeWidth={1.5} />
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fs-xs)',
              }}
            >
              {t('chat.sessions.empty')}
            </span>
            <span
              className="italic"
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 'var(--fs-xs)',
                color: 'var(--ink-faint)',
              }}
            >
              {t('chat.sessions.listening')}
            </span>
          </div>
        )}
        {sessions.map((sess) => {
          const active = sess.id === currentSessionId;
          const preview =
            sess.summary ?? t('chat.sessions.preview', { id: sess.id.slice(0, 6) });
          const startedAt = new Date(sess.started_at);
          const dateLabel = startedAt.toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
          });
          return (
            <div
              key={sess.id}
              className="mb-1 flex items-center gap-2 cursor-pointer transition-all"
              style={{
                padding: '8px 10px',
                borderRadius: 12,
                background: active
                  ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
                  : 'transparent',
                border: `1px solid ${active ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'transparent'}`,
                minHeight: 44,
              }}
              onClick={() => openSession(sess.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') openSession(sess.id);
              }}
            >
              <div className="flex-1 min-w-0">
                {editingSessionId === sess.id ? (
                  <input
                    type="text"
                    autoFocus
                    value={editSessionText}
                    onChange={(e) => setEditSessionText(e.target.value)}
                    onBlur={() => {
                      if (editSessionText.trim() && editSessionText.trim() !== sess.summary) {
                        void updateSession(sess.id, editSessionText.trim());
                      }
                      setEditingSessionId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                      if (e.key === 'Escape') {
                        setEditingSessionId(null);
                      }
                    }}
                    className="w-full bg-transparent outline-none"
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 'var(--fs-xs)',
                      color: 'var(--ink-primary)',
                      borderBottom: '1px solid var(--accent)',
                    }}
                  />
                ) : (
                  <div
                    className="truncate"
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 'var(--fs-xs)',
                      color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
                      fontWeight: active ? 500 : 400,
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditSessionText(sess.summary ?? '');
                      setEditingSessionId(sess.id);
                    }}
                    title={t('chat.sessions.renameHint')}
                  >
                    {preview}
                  </div>
                )}
                <div
                  className="flex items-center gap-1.5"
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--fs-micro)',
                    color: 'var(--ink-muted)',
                  }}
                >
                  <span>{dateLabel}</span>
                  <span>·</span>
                  <span>{t('chat.sessions.count', { count: sess.message_count })}</span>
                </div>
              </div>
              <div className="flex items-center gap-0">
                <button
                  type="button"
                  className="flex items-center justify-center transition-colors active:scale-95"
                  style={{
                    width: 26,
                    height: 26,
                    minWidth: 44,
                    minHeight: 44,
                    color: 'var(--ink-muted)',
                    opacity: active ? 1 : 0.6,
                    background: 'transparent',
                    border: 'none',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (editingSessionId === sess.id) {
                      setEditingSessionId(null);
                    } else {
                      setEditSessionText(sess.summary ?? '');
                      setEditingSessionId(sess.id);
                    }
                  }}
                  aria-label={t('chat.sessions.rename')}
                >
                  {editingSessionId === sess.id ? (
                    <Check size={12} strokeWidth={2} style={{ color: 'var(--accent)' }} />
                  ) : (
                    <Edit3 size={12} strokeWidth={1.5} />
                  )}
                </button>
                <button
                  type="button"
                  className="flex items-center justify-center transition-colors active:scale-95"
                  style={{
                    width: 26,
                    height: 26,
                    minWidth: 44,
                    minHeight: 44,
                    color: 'var(--ink-muted)',
                    opacity: active ? 1 : 0.6,
                    background: 'transparent',
                    border: 'none',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteSession(sess.id);
                  }}
                  aria-label={t('chat.sessions.delete')}
                >
                  <Trash2 size={12} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      </motion.aside>
    </>
  );
}
