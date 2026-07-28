import { useState, useEffect } from 'react';
import { X, FileText, Archive, Search, Clock, Loader2, MessageCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgentStore } from '../../../stores/agentStore';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function AgentVault({ isOpen, onClose }: Props) {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedTask, setSelectedTask] = useState<any>(null);
  
  const historyTasks = useAgentStore((s) => s.historyTasks);
  const loading = useAgentStore((s) => s.historyLoading);
  const loadHistory = useAgentStore((s) => s.loadHistory);
  const fetchReport = useAgentStore((s) => s.fetchReport);
  const reportPending = useAgentStore((s) => s.reportPending);
  const reportLoading = useAgentStore((s) => s.reportLoading);

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen, loadHistory]);

  useEffect(() => {
    if (selectedTask && !reportLoading) {
      fetchReport(selectedTask.id);
    }
  }, [selectedTask]);

  const filteredTasks = historyTasks.filter(t => 
    (selectedCategory === 'all' || t.status === selectedCategory) &&
    (t.goal.toLowerCase().includes(search.toLowerCase()) || t.id.toLowerCase().includes(search.toLowerCase()))
  );

  const categories = [
    { id: 'all', label: 'Вся діяльність', icon: <Archive size={18} />, count: historyTasks.length },
    { id: 'done', label: 'Звіти', icon: <FileText size={18} />, count: historyTasks.filter(t => t.status === 'done').length },
    { id: 'failed', label: 'Інциденти', icon: <Clock size={18} />, count: historyTasks.filter(t => t.status === 'failed').length },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40 backdrop-blur-md"
          />
          
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 30 }}
            className="relative w-full max-w-5xl h-[640px] overflow-hidden rounded-[32px] flex"
            style={{
              background: 'var(--glass-elevated, rgba(255,255,255,0.88))',
              border: '1px solid var(--glass-border)',
              boxShadow: '0 30px 90px rgba(120,70,10,0.15)',
            }}
          >
            {/* Sidebar */}
            <div className="w-64 border-r flex flex-col bg-white/40" style={{ borderRight: '1px solid var(--glass-border)' }}>
              <div className="p-8">
                <h2 className="text-2xl font-serif font-bold tracking-tight text-ink-primary">
                  Сховище
                </h2>
                <p className="text-[10px] text-primary-shadow font-mono mt-1 uppercase tracking-[0.2em] opacity-60">Центр Аналітики</p>
              </div>

              <nav className="flex-1 px-4 space-y-1">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all ${
                      selectedCategory === cat.id ? 'bg-primary/10 shadow-sm' : 'hover:bg-black/5'
                    }`}
                  >
                    <span className={selectedCategory === cat.id ? 'text-primary' : 'text-ink-muted'}>
                      {cat.icon}
                    </span>
                    <span className={`flex-1 text-left text-sm font-medium ${selectedCategory === cat.id ? 'text-ink-primary' : 'text-ink-secondary'}`}>
                      {cat.label}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-black/5 text-ink-muted">
                      {cat.count}
                    </span>
                  </button>
                ))}
              </nav>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col bg-white/10">
              <div className="p-5 flex items-center gap-4 border-b bg-white/20" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                <div className="flex-1 relative">
                  <Search size={16} className="absolute left-4 top-3 text-ink-muted" />
                  <input 
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Пошук журналів задач..." 
                    className="w-full bg-white/50 border border-white rounded-xl pl-11 pr-4 py-2.5 text-sm focus:outline-none focus:border-primary/40 text-ink-primary"
                  />
                </div>
                <button onClick={onClose} className="p-2.5 hover:bg-black/5 rounded-xl transition-colors">
                  <X size={20} className="text-ink-muted" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8">
                {loading ? (
                  <div className="h-full flex items-center justify-center opacity-30">
                    <Loader2 size={32} className="animate-spin" />
                  </div>
                ) : (
                  <>
                    {filteredTasks.length === 0 ? (
                      <div className="col-span-3 h-64 flex items-center justify-center text-ink-muted text-xs font-mono uppercase tracking-widest opacity-40">
                        Записів за вашим запитом не знайдено.
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-4">
                        {filteredTasks.map((task) => (
                          <motion.div 
                            key={task.id}
                            whileHover={{ y: -2 }}
                            onClick={() => setSelectedTask(task)}
                            className="group p-3 rounded-[18px] border bg-white/50 hover:bg-white/80 transition-all cursor-pointer shadow-sm relative overflow-hidden"
                            style={{ borderColor: 'var(--glass-border)' }}
                          >
                            <div className="flex items-start justify-between">
                              <div className={`p-1.5 rounded-lg ${task.status === 'done' ? 'bg-green-100 text-green-600' : 'bg-primary/10 text-primary'}`}>
                                <FileText size={14} />
                              </div>
                              <span className="text-[8px] text-ink-muted font-mono uppercase tracking-wider opacity-60">
                                {new Date(task.created_at).toLocaleDateString()}
                              </span>
                            </div>
                            <h4 className="mt-3 font-serif font-bold text-sm text-ink-primary leading-tight line-clamp-1">
                              {task.goal}
                            </h4>
                            
                            <div className="mt-4 flex items-center justify-between">
                              <span className={`px-2 py-0.5 rounded-md text-[8px] font-bold uppercase tracking-wider ${
                                task.status === 'done' ? 'bg-green-50 text-green-700' : 'bg-black/5 text-ink-muted'
                              }`}>
                                {task.status}
                              </span>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  useAgentStore.getState().startTask(task.goal);
                                  onClose();
                                }}
                                className="px-2 py-1 bg-primary text-white rounded-lg text-[9px] font-bold hover:bg-primary-shadow transition-colors"
                              >
                                ПРОДОВЖИТИ
                              </button>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Detail Overlay */}
            <AnimatePresence>
              {selectedTask && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="absolute inset-y-0 right-0 w-2/3 border-l shadow-2xl flex flex-col"
                  style={{ 
                    background: 'var(--glass-elevated, rgba(255,255,255,0.95))',
                    borderLeft: '1px solid var(--glass-border)' 
                  }}
                >
                  <div className="p-6 border-b flex items-center justify-between bg-white/50" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <div>
                      <h3 className="text-xl font-serif font-bold text-ink-primary">Деталі задачі</h3>
                      <p className="text-[10px] text-ink-muted font-mono mt-1 uppercase opacity-60">ІД: {selectedTask.id}</p>
                    </div>
                    <button onClick={() => setSelectedTask(null)} className="p-2 hover:bg-black/5 rounded-xl transition-colors">
                      <X size={20} className="text-ink-muted" />
                    </button>
                  </div>
                  <div className="flex-1 p-6 overflow-y-auto space-y-6">
                    <div>
                      <h4 className="text-xs font-mono uppercase text-ink-muted mb-2 tracking-widest">Ціль / Задача</h4>
                      <p className="text-sm font-medium text-ink-primary bg-white/50 p-4 rounded-2xl border" style={{ borderColor: 'var(--glass-border)' }}>
                        {selectedTask.goal}
                      </p>
                    </div>

                    {reportLoading ? (
                      <div className="flex items-center gap-2 text-ink-muted text-xs animate-pulse">
                        <Loader2 size={14} className="animate-spin" />
                        Формування детального звіту...
                      </div>
                    ) : reportPending && reportPending.task_id === selectedTask.id ? (
                      <div className="space-y-6">
                        {reportPending.llm_narrative && (
                          <div>
                            <h4 className="text-xs font-mono uppercase text-ink-muted mb-2 tracking-widest">Підсумок</h4>
                            <p className="text-xs leading-relaxed text-ink-secondary bg-primary/5 p-4 rounded-2xl border border-primary/10 italic">
                              "{reportPending.llm_narrative}"
                            </p>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                          {reportPending.achievements.length > 0 && (
                            <div>
                              <h4 className="text-[10px] font-mono uppercase text-green-600 mb-2 tracking-widest">Досягнення</h4>
                              <ul className="space-y-1.5">
                                {reportPending.achievements.map((a, i) => (
                                  <li key={i} className="text-xs text-ink-primary flex items-start gap-2">
                                    <span className="text-green-500 mt-0.5">✓</span>
                                    {a}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {reportPending.key_decisions.length > 0 && (
                            <div>
                              <h4 className="text-[10px] font-mono uppercase text-indigo-600 mb-2 tracking-widest">Ключові рішення</h4>
                              <div className="space-y-2">
                                {reportPending.key_decisions.map((d, i) => (
                                  <div key={i} className="p-3 rounded-xl bg-indigo-50/50 border border-indigo-100 flex flex-col gap-1">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[9px] font-bold text-indigo-600 uppercase tracking-tighter">Крок {d.step_idx} · {d.verdict}</span>
                                      <span className="text-[9px] text-ink-muted opacity-50">
                                        {d.ts ? (isNaN(Number(d.ts)) ? new Date(d.ts).toLocaleTimeString('uk-UA') : new Date(Number(d.ts) * 1000).toLocaleTimeString('uk-UA')) : '—'}
                                      </span>
                                    </div>
                                    <p className="text-xs text-ink-primary leading-snug">{d.summary}</p>
                                    {d.objection && (
                                      <p className="text-[10px] text-red-600 italic bg-red-50 p-1.5 rounded-lg border border-red-100 mt-1">
                                        Внутрішня дискусія: {d.objection}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {reportPending.evidence_links.length > 0 && (
                            <div>
                              <h4 className="text-[10px] font-mono uppercase text-emerald-600 mb-2 tracking-widest">Докази та джерела</h4>
                              <div className="flex flex-wrap gap-2">
                                {reportPending.evidence_links.map((link, i) => (
                                  <a 
                                    key={i}
                                    href={link.kind === 'url' ? link.ref : '#'}
                                    target={link.kind === 'url' ? '_blank' : undefined}
                                    className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-100 text-[10px] text-emerald-700 flex items-center gap-2 hover:bg-emerald-100 transition-colors"
                                  >
                                    {link.kind === 'url' ? <Search size={10} /> : <FileText size={10} />}
                                    {link.label || link.ref.slice(0, 24)}
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}

                          {reportPending.obstacles.length > 0 && (
                            <div>
                              <h4 className="text-[10px] font-mono uppercase text-amber-600 mb-2 tracking-widest">Перешкоди</h4>
                              <ul className="space-y-1.5">
                                {reportPending.obstacles.map((o, i) => (
                                  <li key={i} className="text-xs text-ink-primary flex items-start gap-2">
                                    <span className="text-amber-500 mt-0.5">!</span>
                                    {o}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>

                        {reportPending.next_steps.length > 0 && (
                          <div>
                            <h4 className="text-[10px] font-mono uppercase text-primary-shadow mb-2 tracking-widest">Рекомендовані наступні кроки</h4>
                            <div className="flex flex-wrap gap-2">
                              {reportPending.next_steps.map((s, i) => (
                                <span key={i} className="px-3 py-1.5 rounded-xl bg-white border border-black/5 text-[11px] text-ink-secondary shadow-sm">
                                  {s}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {reportPending.audit_trail_compact.length > 0 && (
                          <div>
                            <h4 className="text-[10px] font-mono uppercase text-ink-muted mb-2 tracking-widest">Трасування виконання</h4>
                            <div className="space-y-1.5">
                              {reportPending.audit_trail_compact.slice(0, 10).map((a, i) => (
                                <div key={i} className="flex items-center gap-3 text-[10px] font-mono p-2 rounded-lg bg-black/5">
                                  <span className="text-ink-muted w-4">{a.step_idx}</span>
                                  <span className={`px-1.5 py-0.5 rounded ${a.ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                    {a.action}
                                  </span>
                                  <span className="text-ink-secondary truncate flex-1">{a.intent}</span>
                                  <span className="text-ink-muted opacity-50">{a.elapsed_ms}мс</span>
                                </div>
                              ))}
                              {reportPending.audit_trail_compact.length > 10 && (
                                <div className="text-center text-[9px] text-ink-muted opacity-50 mt-1">
                                  + ще {reportPending.audit_trail_compact.length - 10} кроків у повному журналі
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-4">
                        <div>
                          <h4 className="text-xs font-mono uppercase text-ink-muted mb-1 tracking-widest">Стан</h4>
                          <span className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                            selectedTask.status === 'done' ? 'bg-green-100 text-green-700' : 
                            selectedTask.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-black/5 text-ink-muted'
                          }`}>
                            {selectedTask.status}
                          </span>
                        </div>
                        <div>
                          <h4 className="text-xs font-mono uppercase text-ink-muted mb-1 tracking-widest">Створено</h4>
                          <span className="text-sm text-ink-primary font-mono">
                            {new Date(selectedTask.created_at).toLocaleString('uk-UA')}
                          </span>
                        </div>
                      </div>
                    )}

                    {selectedTask.error && (
                      <div className="mt-4">
                        <h4 className="text-[10px] font-mono uppercase text-red-600 mb-2 tracking-widest">Аналіз інциденту</h4>
                        <div className="p-4 rounded-2xl bg-red-50 border border-red-100 flex flex-col gap-3">
                          <div className="flex items-start gap-3">
                            <div className="p-1.5 bg-red-100 rounded-lg text-red-600">
                              <X size={14} />
                            </div>
                            <div className="flex-1">
                              <p className="text-[11px] font-bold text-red-700 uppercase tracking-tight">Першопричина</p>
                              <p className="text-xs text-red-900 font-mono mt-0.5 break-all">{selectedTask.error}</p>
                            </div>
                          </div>
                          {reportPending && reportPending.obstacles.length > 0 && (
                            <div className="pl-9 space-y-2">
                              <p className="text-[10px] font-medium text-red-600 opacity-60 uppercase">Виявлені перешкоди контексту:</p>
                              <ul className="space-y-1">
                                {reportPending.obstacles.map((o, i) => (
                                  <li key={i} className="text-[11px] text-red-800 flex items-start gap-2">
                                    <span className="opacity-40">•</span>
                                    {o}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions Footer */}
                  <div className="p-6 border-t bg-white/40 flex items-center gap-3" style={{ borderTop: '1px solid var(--glass-border)' }}>
                    <button 
                      onClick={() => {
                        useAgentStore.getState().resumeAsConversation();
                        onClose();
                      }}
                      className="flex-1 h-11 bg-primary text-white rounded-2xl font-bold text-sm shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                      <MessageCircle size={18} />
                      ПРОДОВЖИТИ В ЧАТІ
                    </button>
                    <button 
                      onClick={() => {
                        useAgentStore.getState().startTask(selectedTask.goal);
                        onClose();
                      }}
                      className="px-6 h-11 bg-black/5 text-ink-primary rounded-2xl font-bold text-sm hover:bg-black/10 active:scale-95 transition-all"
                    >
                      ПЕРЕЗАПУСТИТИ
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
