import React, { useState } from 'react';
import {
  GraduationCap,
  FileCheck,
  X,
  Timer,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface StudentSubmission {
  id: string;
  studentName: string;
  assignment: string;
  submittedAt: string;
  autograderScore: number;
  maxScore: number;
  testsPassed: string;
  status: 'Graded' | 'Review Required';
}

interface QueueItem {
  id: string;
  studentName: string;
  topic: string;
  estimatedMinutes: number;
  status: 'In Progress' | 'Waiting';
}

interface AcademicLmsHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const AcademicLmsHubModal: React.FC<AcademicLmsHubModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Академічна група',
}) => {
  const [activeTab, setActiveTab] = useState<'submissions' | 'queue' | 'gradebook'>('submissions');
  const [isAutograderRunning, setIsAutograderRunning] = useState(false);

  const [submissions, setSubmissions] = useState<StudentSubmission[]>([
    {
      id: 'sub1',
      studentName: 'Кирило',
      assignment: 'Лабораторна №3: Ed25519 & Ratchet Tree Engine',
      submittedAt: 'Сьогодні, 14:20',
      autograderScore: 95,
      maxScore: 100,
      testsPassed: '19/20 unit-тестів пройдено',
      status: 'Graded',
    },
    {
      id: 'sub2',
      studentName: 'Марина',
      assignment: 'Лабораторна №3: Ed25519 & Ratchet Tree Engine',
      submittedAt: 'Вчора, 18:05',
      autograderScore: 100,
      maxScore: 100,
      testsPassed: '20/20 unit-тестів пройдено',
      status: 'Graded',
    },
  ]);

  const [queue] = useState<QueueItem[]>([
    { id: 'q1', studentName: 'Саня', topic: 'Захист курсової роботи (LoRa Mesh)', estimatedMinutes: 10, status: 'In Progress' },
    { id: 'q2', studentName: 'Олексій', topic: 'Питання по Лаб №2 (CRDT Tree)', estimatedMinutes: 5, status: 'Waiting' },
    { id: 'q3', studentName: 'Марина', topic: 'Здача індивідуального розрахунку', estimatedMinutes: 7, status: 'Waiting' },
  ]);

  if (!isOpen) return null;

  const handleRunAutograder = () => {
    soundFx.playSend();
    setIsAutograderRunning(true);
    setTimeout(() => {
      setIsAutograderRunning(false);
      setSubmissions((prev) => [
        {
          id: `sub_${Date.now()}`,
          studentName: 'Нова робота (Тільки що)',
          assignment: 'Лабораторна №4: Zero-Knowledge Range Proofs',
          submittedAt: 'Щойно',
          autograderScore: 100,
          maxScore: 100,
          testsPassed: '15/15 unit-тестів пройдено',
          status: 'Graded',
        },
        ...prev,
      ]);
    }, 1200);
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
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Академічний LMS Хаб & Autograder
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Здача робіт з автоперевіркою, жива черга та відомість успішності
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('submissions')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'submissions' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Здача робіт
              </button>
              <button
                onClick={() => setActiveTab('queue')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'queue' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Черга на захист ({queue.length})
              </button>
              <button
                onClick={() => setActiveTab('gradebook')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'gradebook' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Відомість & Допуск
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] hover:text-[#21261F] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar space-y-4">
          {/* TAB 1: Submissions & Local Autograder */}
          {activeTab === 'submissions' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-950 flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-emerald-900">
                  <FileCheck className="w-4 h-4 text-emerald-600" />
                  <span>Локальний Autograder: Unit-тести коду при відправці</span>
                </div>
                <button
                  onClick={handleRunAutograder}
                  disabled={isAutograderRunning}
                  className="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold transition-all shadow-xs"
                >
                  {isAutograderRunning ? 'Тестування...' : '+ Тестова здача лаби'}
                </button>
              </div>

              <div className="space-y-2.5">
                {submissions.map((sub) => (
                  <div key={sub.id} className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-xs text-[#21261F]">{sub.studentName}</span>
                        <h5 className="text-xs text-[#6E7568]">{sub.assignment}</h5>
                      </div>

                      <div className="text-right">
                        <span className="font-mono font-bold text-sm text-emerald-700">
                          {sub.autograderScore} / {sub.maxScore} б.
                        </span>
                        <span className="block text-[10px] text-[#8A9186]">{sub.submittedAt}</span>
                      </div>
                    </div>

                    <div className="p-2 bg-[#FAF8F5] border border-[#E8E1D3] rounded-lg text-[11px] font-mono text-emerald-800 flex justify-between">
                      <span>✓ {sub.testsPassed}</span>
                      <span className="font-bold">Статус: Зараховано</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: Office Hours Queue */}
          {activeTab === 'queue' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2 text-xs text-indigo-950">
                <div className="flex items-center gap-2 font-bold text-indigo-900">
                  <Timer className="w-4 h-4 text-indigo-600" />
                  <span>Електронна черга на захист робіт & Консультації</span>
                </div>
                <p className="leading-relaxed">
                  Жива черга студентів з індивідуальними слотами часу та таймером для викладача без скупчення під кабінетом чи хаосу в чаті.
                </p>
              </div>

              <div className="space-y-2.5">
                {queue.map((item, idx) => (
                  <div key={item.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-xs w-5 text-[#8A9186]">#{idx + 1}</span>
                      <div>
                        <h5 className="font-bold text-xs text-[#21261F]">{item.studentName}</h5>
                        <p className="text-[11px] text-[#6E7568]">{item.topic}</p>
                      </div>
                    </div>

                    <div className="text-right">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          item.status === 'In Progress'
                            ? 'bg-amber-100 text-amber-800 animate-pulse'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {item.status === 'In Progress' ? 'Захист триває...' : 'Очікує'}
                      </span>
                      <span className="block text-[10px] text-[#8A9186] font-mono mt-0.5">~{item.estimatedMinutes} хв</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: Gradebook & Academic Forecast */}
          {activeTab === 'gradebook' && (
            <div className="space-y-4">
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div>
                    <h5 className="font-bold text-xs text-[#21261F]">Особистий прогрес та прогноз допуску</h5>
                    <p className="text-[11px] text-[#6E7568]">Курс: Комп'ютерна інженерія та P2P-системи</p>
                  </div>
                  <span className="font-mono font-bold text-lg text-[#D96C35]">88 / 100 б.</span>
                </div>

                <div className="w-full bg-[#FAF8F5] border border-[#E8E1D3] rounded-full h-2.5 overflow-hidden">
                  <div className="bg-emerald-600 h-full rounded-full" style={{ width: '88%' }} />
                </div>

                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-950 flex items-center justify-between">
                  <span className="font-semibold">Прогноз допуску до іспиту:</span>
                  <span className="font-bold font-mono text-emerald-800">ГАРАНТОВАНО ДОПУЩЕНО ✓</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Full Academic LMS Engine</span>
          <span className="font-mono">Local Autograder v2.0</span>
        </div>
      </div>
    </div>
  );
};
