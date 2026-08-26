import React, { useState } from 'react';
import {
  Users,
  CheckCircle2,
  X,
  Search,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface OnboardingStep {
  id: string;
  title: string;
  category: string;
  completed: boolean;
  unlockedSpaces: string[];
}

interface TeamMemberAvailability {
  id: string;
  name: string;
  role: string;
  status: 'In Office' | 'Remote' | 'On Leave' | 'Sick Leave';
  until: string;
}

interface SkillExpert {
  id: string;
  name: string;
  domain: string;
  tags: string[];
  openForSync: boolean;
}

interface CorporateHROpsModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const CorporateHROpsModal: React.FC<CorporateHROpsModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Корпоративний простір',
}) => {
  const [activeTab, setActiveTab] = useState<'onboarding' | 'availability' | 'skills'>('onboarding');
  const [skillSearchQuery, setSkillSearchQuery] = useState('');

  const [steps, setSteps] = useState<OnboardingStep[]>([
    { id: 's1', title: 'Генерація Ed25519 ключів та YubiKey автентифікація', category: 'Безпека', completed: true, unlockedSpaces: ['#general', '#dev-setup'] },
    { id: 's2', title: 'Клонування phantom-companion та запуск через Docker/Cargo', category: 'Інженерія', completed: true, unlockedSpaces: ['#engineering-core'] },
    { id: 's3', title: 'Знайомство з ментором та перший перевірений комміт у гілку', category: 'Команда', completed: false, unlockedSpaces: ['#production-release'] },
  ]);

  const [teamAvailability] = useState<TeamMemberAvailability[]>([
    { id: 't1', name: 'Кирило', role: 'Lead Architect', status: 'In Office', until: 'Сьогодні до 19:00' },
    { id: 't2', name: 'Саня', role: 'Hardware & RF Engineer', status: 'Remote', until: 'Поділ (On-demand)' },
    { id: 't3', name: 'Марина', role: 'Core Protocols Developer', status: 'In Office', until: 'Сьогодні до 18:30' },
    { id: 't4', name: 'Олексій', role: 'QA & Test Automation', status: 'On Leave', until: 'До 01 Вересня' },
  ]);

  const [experts] = useState<SkillExpert[]>([
    { id: 'e1', name: 'Саня', domain: 'Радіочастоти & Embedded', tags: ['LoRa SX1262', 'ESP32', 'Radxa RK3588', 'Bare-metal C'], openForSync: true },
    { id: 'e2', name: 'Марина', domain: 'Розподілені системи', tags: ['CRDT', 'State-based SEC', 'Ratchet Tree', 'Rust'], openForSync: true },
    { id: 'e3', name: 'Кирило', domain: 'Архітектура & UI', tags: ['P2P Mesh', 'Zero-Leak Security', 'KaTeX', 'TypeScript'], openForSync: true },
  ]);

  if (!isOpen) return null;

  const toggleStep = (id: string) => {
    soundFx.playTap();
    setSteps(steps.map((s) => (s.id === id ? { ...s, completed: !s.completed } : s)));
  };

  const filteredExperts = experts.filter(
    (e) =>
      e.name.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
      e.domain.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
      e.tags.some((t) => t.toLowerCase().includes(skillSearchQuery.toLowerCase()))
  );

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
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Корпоративний HR, Онбординг & Карта Навичок
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Роадмап новачка, доступність команди та Skill Matrix
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('onboarding')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'onboarding' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Онбординг
              </button>
              <button
                onClick={() => setActiveTab('availability')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'availability' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Графік команди
              </button>
              <button
                onClick={() => setActiveTab('skills')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'skills' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Skill Matrix
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
          {/* TAB 1: Onboarding Roadmap */}
          {activeTab === 'onboarding' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-1 text-xs text-indigo-950">
                <span className="font-bold text-indigo-900">Покроковий онбординг з автоматичним відкриттям просторів</span>
                <p className="text-[11px]">
                  Прогрес: {steps.filter((s) => s.completed).length} з {steps.length} етапів завершено (66%)
                </p>
              </div>

              <div className="space-y-2.5">
                {steps.map((step) => (
                  <div
                    key={step.id}
                    onClick={() => toggleStep(step.id)}
                    className="p-4 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs cursor-pointer hover:border-[#D96C35] transition-all"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-[#D96C35] bg-[#FDF5ED] px-2 py-0.5 rounded">
                          {step.category}
                        </span>
                        <h5 className={`font-bold text-xs ${step.completed ? 'line-through text-[#8A9186]' : 'text-[#21261F]'}`}>
                          {step.title}
                        </h5>
                      </div>
                      <p className="text-[10px] text-[#6E7568]">
                        Відкриває доступ до: {step.unlockedSpaces.join(', ')}
                      </p>
                    </div>

                    <div
                      className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                        step.completed
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'border-[#D5CEBF] bg-white'
                      }`}
                    >
                      {step.completed && <CheckCircle2 className="w-3.5 h-3.5" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: Team Availability */}
          {activeTab === 'availability' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-[#21261F]">Матриця доступності та відпусток</h4>
                <span className="text-[11px] text-[#6E7568]">4 учасники активні</span>
              </div>

              <div className="space-y-2.5">
                {teamAvailability.map((m) => (
                  <div key={m.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div>
                      <h5 className="font-bold text-xs text-[#21261F]">{m.name}</h5>
                      <p className="text-[11px] text-[#6E7568]">{m.role}</p>
                    </div>

                    <div className="text-right">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          m.status === 'In Office'
                            ? 'bg-emerald-100 text-emerald-800'
                            : m.status === 'Remote'
                            ? 'bg-indigo-100 text-indigo-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {m.status}
                      </span>
                      <span className="block text-[10px] text-[#8A9186] mt-0.5">{m.until}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: Skill Matrix */}
          {activeTab === 'skills' && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="w-4 h-4 text-[#8A9186] absolute left-3 top-3" />
                <input
                  type="text"
                  placeholder="Пошук експерта за технологією (наприклад, LoRa, Rust, CRDT)..."
                  value={skillSearchQuery}
                  onChange={(e) => setSkillSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl text-xs text-[#21261F] focus:outline-none"
                />
              </div>

              <div className="space-y-2.5">
                {filteredExperts.map((exp) => (
                  <div key={exp.id} className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <h5 className="font-bold text-xs text-[#21261F]">{exp.name}</h5>
                        <p className="text-[11px] text-[#D96C35] font-semibold">{exp.domain}</p>
                      </div>

                      <button
                        onClick={() => {
                          soundFx.playSend();
                          alert(`Запит на консультацію надіслано до @${exp.name}`);
                        }}
                        className="px-3 py-1 bg-[#21261F] hover:bg-[#3E453A] text-white rounded-lg text-xs font-bold transition-all shadow-xs"
                      >
                        Запросити в задачу
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {exp.tags.map((tag) => (
                        <span key={tag} className="text-[10px] font-mono bg-[#FAF8F5] px-2 py-0.5 rounded border border-[#E8E1D3] text-[#6E7568]">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Corporate HR & Operational Fabric</span>
          <span className="font-mono">Skill Matrix Engine</span>
        </div>
      </div>
    </div>
  );
};
