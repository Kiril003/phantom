import React, { useState } from 'react';
import {
  GraduationCap,
  Play,
  X,
  HelpCircle,
  Share2,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useMessengerStore } from '../../stores/messengerStore';

interface Flashcard {
  id: string;
  question: string;
  answer: string;
  intervalDays: number;
  reviewed: boolean;
}

interface DeadlineItem {
  id: string;
  course: string;
  task: string;
  dueDate: string;
  daysLeft: number;
  progressPercent: number;
  assignees: string[];
}

interface AcademyHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const AcademyHubModal: React.FC<AcademyHubModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Академічна група',
}) => {
  const [activeTab, setActiveTab] = useState<'latex' | 'deadlines' | 'flashcards' | 'papers'>('deadlines');
  const [latexInput, setLatexInput] = useState('\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}');
  const [showFlashcardAnswer, setShowFlashcardAnswer] = useState<string | null>(null);

  const [deadlines] = useState<DeadlineItem[]>([
    {
      id: 'd1',
      course: 'Криптографія та P2P Протоколи',
      task: 'Лабораторна №3: Реалізація Ed25519 та Ratchet Tree',
      dueDate: '2026-09-02',
      daysLeft: 6,
      progressPercent: 65,
      assignees: ['Кирило', 'Саня', 'Марина'],
    },
    {
      id: 'd2',
      course: 'Дискретна математика',
      task: 'Іспит: Графи, CRDT-дерева та реляційні алгебри',
      dueDate: '2026-09-10',
      daysLeft: 14,
      progressPercent: 30,
      assignees: ['Уся група'],
    },
  ]);

  const [flashcards] = useState<Flashcard[]>([
    {
      id: 'f1',
      question: 'У чому полягає різниця між State-based (CvRDT) та Operation-based (CmRDT) реплікацією?',
      answer: 'CvRDT пересилає повний стан вузла та використовує функцію merge (LUB), тоді як CmRDT пересилає лише атомарні мутації через причинно-впорядкований канал звʼязку.',
      intervalDays: 3,
      reviewed: false,
    },
    {
      id: 'f2',
      question: 'Що гарантує властивість Strong Eventual Consistency (SEC)?',
      answer: 'Всі репліки, що отримали однаковий набір операцій, гарантовано переходять у строго ідентичний еквівалентний стан без додаткового узгодження.',
      intervalDays: 5,
      reviewed: true,
    },
  ]);

  if (!isOpen) return null;

  const handleShareLatex = () => {
    soundFx.playSend();
    const store = useMessengerStore.getState();
    store.addCustomMessage({
      id: `msg_latex_${Date.now()}`,
      senderId: store.currentUser.id,
      senderName: store.currentUser.name,
      senderAvatar: store.currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'text',
      isSelf: true,
      text: `📐 **Формула з конспекту (LaTeX):**\n\n$$\n${latexInput}\n$$\n\n*(Рендериться локальним KaTeX рушієм)*`,
    });
    onClose();
  };

  const handleStartQuiz = () => {
    soundFx.playSend();
    const store = useMessengerStore.getState();
    store.addCustomMessage({
      id: `msg_quiz_${Date.now()}`,
      senderId: store.currentUser.id,
      senderName: 'Academy Quiz Master',
      senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'poll',
      isSelf: false,
      pollData: {
        id: `poll_${Date.now()}`,
        question: 'Квіз: Яка властивість є ключовою для Conflict-free Replicated Data Types (CRDT)?',
        options: [
          { id: 'opt1', text: 'Комутативність та асоціативність операцій злиття', votes: 3, voters: ['user_me', 'u2', 'u3'] },
          { id: 'opt2', text: 'Централізований сервер блокування таблиць', votes: 0, voters: [] },
          { id: 'opt3', text: 'Синхронний двофазний коміт (2PC)', votes: 0, voters: [] },
        ],
        totalVotes: 3,
      },
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#EFF6FF] border-b border-[#BFDBFE] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-white text-blue-600 border border-blue-200 shadow-2xs">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-blue-950">
                Сфера: Навчання & Академія · {chatTitle}
              </h3>
              <p className="text-[11px] text-blue-800">
                LaTeX конспекти, дедлайни сесії, Anki картки та наукові PDF
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-blue-100 p-0.5 rounded-lg text-xs font-medium text-blue-800">
              <button
                onClick={() => setActiveTab('deadlines')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'deadlines' ? 'bg-white text-blue-900 font-bold shadow-2xs' : 'hover:text-blue-950'
                }`}
              >
                Дедлайни
              </button>
              <button
                onClick={() => setActiveTab('latex')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'latex' ? 'bg-white text-blue-900 font-bold shadow-2xs' : 'hover:text-blue-950'
                }`}
              >
                LaTeX
              </button>
              <button
                onClick={() => setActiveTab('flashcards')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'flashcards' ? 'bg-white text-blue-900 font-bold shadow-2xs' : 'hover:text-blue-950'
                }`}
              >
                Flashcards ({flashcards.length})
              </button>
              <button
                onClick={() => setActiveTab('papers')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'papers' ? 'bg-white text-blue-900 font-bold shadow-2xs' : 'hover:text-blue-950'
                }`}
              >
                PDF Хаб
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-blue-200/50 rounded-lg text-blue-800 hover:text-blue-950 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar space-y-4">
          {/* TAB 1: Deadlines & Exams */}
          {activeTab === 'deadlines' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-[#21261F]">Таймлайн дедлайнів та іспитів</h4>
                <span className="text-[11px] text-[#6E7568]">Спільний прогрес академічної групи</span>
              </div>

              <div className="space-y-3">
                {deadlines.map((d) => (
                  <div key={d.id} className="p-4 rounded-xl border border-[#E5DEC9] bg-white space-y-2.5 shadow-2xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-bold uppercase text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                          {d.course}
                        </span>
                        <h5 className="font-bold text-xs text-[#21261F] mt-1">{d.task}</h5>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="font-mono font-bold text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                          {d.daysLeft} днів лишилось
                        </span>
                        <span className="block text-[10px] text-[#8A9186] mt-0.5 font-mono">{d.dueDate}</span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-[#6E7568]">
                        <span>Виконано групою:</span>
                        <span className="font-bold font-mono">{d.progressPercent}%</span>
                      </div>
                      <div className="w-full h-2 bg-[#EFE9DC] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-600 rounded-full transition-all"
                          style={{ width: `${d.progressPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: LaTeX & Math Notes */}
          {activeTab === 'latex' && (
            <div className="space-y-4">
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3">
                <h5 className="font-bold text-xs text-[#21261F]">Редактор формул KaTeX / LaTeX</h5>
                <textarea
                  value={latexInput}
                  onChange={(e) => setLatexInput(e.target.value)}
                  rows={3}
                  className="w-full p-2.5 bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl font-mono text-xs text-blue-900 focus:outline-none"
                  placeholder="Введіть код LaTeX..."
                />

                {/* Formula Preview Box */}
                <div className="p-4 bg-[#F8FAFC] border border-blue-200 rounded-xl text-center font-serif text-base text-blue-950 overflow-x-auto">
                  {'$$\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$'}
                </div>

                <button
                  onClick={handleShareLatex}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Опублікувати формулу в чат конспекту</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: Flashcards (Anki Style) */}
          {activeTab === 'flashcards' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-[#21261F]">Картки інтервального повторення (Anki P2P)</h4>
                <button
                  onClick={handleStartQuiz}
                  className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Розпочати квіз у групі</span>
                </button>
              </div>

              <div className="space-y-3">
                {flashcards.map((f) => (
                  <div key={f.id} className="p-4 rounded-xl border border-[#E5DEC9] bg-white space-y-2 shadow-2xs">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-bold text-xs text-[#21261F] flex items-center gap-1.5">
                        <HelpCircle className="w-4 h-4 text-blue-600 shrink-0" />
                        {f.question}
                      </span>
                      <span className="text-[10px] font-mono text-blue-800 bg-blue-50 px-1.5 py-0.5 rounded shrink-0">
                        {f.intervalDays} дні інтервал
                      </span>
                    </div>

                    {showFlashcardAnswer === f.id ? (
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-950 leading-relaxed animate-in fade-in">
                        {f.answer}
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowFlashcardAnswer(f.id)}
                        className="text-xs font-semibold text-blue-600 hover:underline"
                      >
                        Показати відповідь →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: PDF Papers & BibTeX */}
          {activeTab === 'papers' && (
            <div className="space-y-3">
              <h4 className="font-bold text-xs text-[#21261F]">Наукові публікації та BibTeX анотації</h4>
              <div className="p-4 rounded-xl border border-[#E5DEC9] bg-white space-y-2">
                <div className="flex items-center justify-between">
                  <h5 className="font-bold text-xs text-[#21261F]">Conflict-free Replicated Data Types (Shapiro et al.)</h5>
                  <span className="text-[10px] font-mono text-[#8A9186]">PDF · 34 сторінки</span>
                </div>
                <p className="text-[11px] text-[#6E7568]">
                  Анотація: 14 коментарів від групи. Цитування BibTeX експортовано в Canvas.
                </p>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => soundFx.playTap()}
                    className="px-3 py-1 bg-[#FAF8F5] hover:bg-[#EFE9DC] border border-[#E5DEC9] rounded-lg text-xs font-semibold text-[#21261F]"
                  >
                    Читати з коментарями →
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#EFF6FF] border-t border-[#BFDBFE] flex items-center justify-between text-[11px] text-blue-900">
          <span>Спільний академічний простір</span>
          <span className="font-mono">KaTeX / Anki P2P Mesh</span>
        </div>
      </div>
    </div>
  );
};
