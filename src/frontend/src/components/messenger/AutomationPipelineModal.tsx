import React, { useState } from 'react';
import {
  Zap,
  Plus,
  Play,
  Trash2,
  Clock,
  CheckCircle2,
  X,
  FileSpreadsheet,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useMessengerStore } from '../../stores/messengerStore';

interface AutomationRule {
  id: string;
  name: string;
  triggerType: 'keyword' | 'error_detected' | 'cron_standup' | 'file_shared';
  triggerConfig: string;
  actionType: 'canvas_ticket' | 'p2p_ping' | 'generate_digest' | 'form_collect';
  actionConfig: string;
  enabled: boolean;
  executionsCount: number;
  lastExecuted?: string;
}

interface AutomationPipelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
  chatId?: string;
}

export const AutomationPipelineModal: React.FC<AutomationPipelineModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Бесіда',
  chatId: _chatId = 'current_chat',
}) => {
  const [rules, setRules] = useState<AutomationRule[]>([
    {
      id: 'r1',
      name: 'Авто-тікет при збої збірки',
      triggerType: 'keyword',
      triggerConfig: 'Error або FATAL',
      actionType: 'canvas_ticket',
      actionConfig: 'Створити тікет [High] у Canvas та сповістити @Саня',
      enabled: true,
      executionsCount: 4,
      lastExecuted: '12 хв тому',
    },
    {
      id: 'r2',
      name: 'Щоденний ранковий Stand-up (09:30)',
      triggerType: 'cron_standup',
      triggerConfig: 'Щодня о 09:30 (Пн-Пт)',
      actionType: 'generate_digest',
      actionConfig: 'Зібрати відповіді "Що зроблено / Що в планах / Блокери" в Canvas',
      enabled: true,
      executionsCount: 18,
      lastExecuted: 'Сьогодні о 09:30',
    },
    {
      id: 'r3',
      name: 'Збір багрепортів через Smart Form',
      triggerType: 'keyword',
      triggerConfig: '!bug або #баг',
      actionType: 'form_collect',
      actionConfig: 'Надіслати інтерактивну форму збору багів у чат',
      enabled: true,
      executionsCount: 7,
      lastExecuted: 'Вчора',
    },
  ]);

  const [activeTab, setActiveTab] = useState<'rules' | 'standup' | 'forms'>('rules');
  const [showNewRule, setShowNewRule] = useState(false);
  const [newRuleName, setNewRuleName] = useState('');
  const [newTriggerConfig, setNewTriggerConfig] = useState('');
  const [newActionConfig, setNewActionConfig] = useState('');

  if (!isOpen) return null;

  const toggleRule = (id: string) => {
    soundFx.playTap();
    setRules(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  };

  const deleteRule = (id: string) => {
    soundFx.playTap();
    setRules(rules.filter((r) => r.id !== id));
  };

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleName.trim()) return;
    soundFx.playSend();
    const newR: AutomationRule = {
      id: `rule_${Date.now()}`,
      name: newRuleName.trim(),
      triggerType: 'keyword',
      triggerConfig: newTriggerConfig || 'Слово-тригер',
      actionType: 'canvas_ticket',
      actionConfig: newActionConfig || 'Дія в системі',
      enabled: true,
      executionsCount: 0,
      lastExecuted: 'Щойно',
    };
    setRules([newR, ...rules]);
    setShowNewRule(false);
    setNewRuleName('');
    setNewTriggerConfig('');
    setNewActionConfig('');
  };

  const triggerStandupNow = () => {
    soundFx.playSend();
    const store = useMessengerStore.getState();
    store.addCustomMessage({
      id: `msg_standup_${Date.now()}`,
      senderId: 'bot_standup',
      senderName: 'Async Stand-up Bot',
      senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'text',
      isSelf: false,
      text: `📋 **Асинхронний Stand-up команди:**\n\n1. Що вдалося завершити вчора?\n2. Які головні задачі на сьогодні?\n3. Чи є якісь блокери або питання до команди?\n\n*(Відповіді автоматично агрегуються в Canvas)*`,
    });
    onClose();
  };

  const sendSmartBugForm = () => {
    soundFx.playSend();
    const store = useMessengerStore.getState();
    store.addCustomMessage({
      id: `msg_form_${Date.now()}`,
      senderId: store.currentUser.id,
      senderName: store.currentUser.name,
      senderAvatar: store.currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'text',
      isSelf: true,
      text: `📝 **Smart Form: Збір багрепорту**\n\n[ 🔴 Критичність: High | Модуль: P2P Network | Опис помилки: ... ]\n\n*(Дані записуються в SQLite Data Grid простору)*`,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[82vh] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Local-First Automations & IFTTT
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Локальні правила, Cron Stand-ups та Smart Forms
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Tabs */}
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('rules')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'rules' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Правила ({rules.length})
              </button>
              <button
                onClick={() => setActiveTab('standup')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'standup' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Cron Stand-ups
              </button>
              <button
                onClick={() => setActiveTab('forms')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'forms' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Smart Forms
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

        {/* Tab 1: Rules List */}
        {activeTab === 'rules' && (
          <div className="p-5 flex-1 overflow-y-auto custom-scrollbar space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-xs text-[#21261F]">Активні ланцюжки автоматизації</h4>
              <button
                onClick={() => setShowNewRule(true)}
                className="flex items-center gap-1 px-3 py-1.5 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-lg text-xs font-bold transition-all shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Нове правило</span>
              </button>
            </div>

            <div className="space-y-2.5">
              {rules.map((r) => (
                <div
                  key={r.id}
                  className={`p-3.5 rounded-xl border transition-all ${
                    r.enabled
                      ? 'bg-white border-[#E5DEC9] shadow-2xs'
                      : 'bg-[#FAF8F5]/60 border-[#E8E1D3] opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-[#21261F]">{r.name}</span>
                        <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded font-medium border border-emerald-200">
                          {r.executionsCount} спрацювань
                        </span>
                      </div>

                      {/* Rule Logic Representation */}
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#6E7568]">
                        <span className="font-semibold text-[#D96C35] bg-[#FDF5ED] px-1.5 py-0.5 rounded border border-[#E5DEC9]">
                          ЯКЩО: {r.triggerConfig}
                        </span>
                        <span>→</span>
                        <span className="font-semibold text-[#21261F] bg-[#FAF8F5] px-1.5 py-0.5 rounded border border-[#E8E1D3]">
                          ТОДІ: {r.actionConfig}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => toggleRule(r.id)}
                        className={`w-9 h-5 rounded-full p-0.5 transition-colors ${
                          r.enabled ? 'bg-[#D96C35]' : 'bg-[#D5CEBF]'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-full bg-white transition-transform ${
                            r.enabled ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                      <button
                        onClick={() => deleteRule(r.id)}
                        className="p-1 hover:bg-red-50 text-[#8A9186] hover:text-red-500 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 2: Cron Stand-ups */}
        {activeTab === 'standup' && (
          <div className="p-6 space-y-4 flex-1 overflow-y-auto custom-scrollbar">
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-emerald-900 font-bold text-xs">
                <Clock className="w-4 h-4 text-emerald-600" />
                <span>Автономний Cron Stand-up Runner</span>
              </div>
              <p className="text-xs text-emerald-800 leading-relaxed">
                Кожного робочого дня о 09:30 система автоматично ініціює асинхронне опитування учасників бесіди, структурує відповіді та оновлює блок «Сьогоднішній прогрес» у Canvas.
              </p>
            </div>

            <div className="bg-white p-4 rounded-xl border border-[#E5DEC9] space-y-3">
              <h5 className="font-bold text-xs text-[#21261F]">Конфігурація опитування</h5>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-[11px] text-[#6E7568] font-semibold">Час запуску (Cron)</label>
                  <input
                    type="text"
                    defaultValue="30 9 * * 1-5"
                    className="w-full p-2 bg-[#FAF8F5] border border-[#E5DEC9] rounded-lg mt-1 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#6E7568] font-semibold">Цільовий документ</label>
                  <input
                    type="text"
                    defaultValue="Canvas: Щоденні підсумки"
                    className="w-full p-2 bg-[#FAF8F5] border border-[#E5DEC9] rounded-lg mt-1 text-xs"
                  />
                </div>
              </div>

              <button
                onClick={triggerStandupNow}
                className="w-full py-2 bg-[#D96C35] hover:bg-[#B85425] text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Запустити Stand-up прямо зараз</span>
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: Smart Forms */}
        {activeTab === 'forms' && (
          <div className="p-6 space-y-4 flex-1 overflow-y-auto custom-scrollbar">
            <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-indigo-900 font-bold text-xs">
                <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
                <span>Smart Forms & SQLite Data Collector</span>
              </div>
              <p className="text-xs text-indigo-800 leading-relaxed">
                Генеруйте інтерактивні форми для збору структурованих даних від команди без сторонніх Google Forms чи Typeform. Усі поля автоматично мапляться в локальну базу даних.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-4 rounded-xl border border-[#E5DEC9] bg-white space-y-2">
                <h5 className="font-bold text-xs text-[#21261F]">Форма: Багрепорт</h5>
                <p className="text-[11px] text-[#6E7568]">Поля: Заголовок, Рівень важливості, Логи, Скриншот</p>
                <button
                  onClick={sendSmartBugForm}
                  className="w-full py-1.5 bg-[#FAF8F5] hover:bg-[#EFE9DC] border border-[#E5DEC9] rounded-lg text-xs font-semibold text-[#21261F]"
                >
                  Надіслати в чат →
                </button>
              </div>

              <div className="p-4 rounded-xl border border-[#E5DEC9] bg-white space-y-2">
                <h5 className="font-bold text-xs text-[#21261F]">Форма: Замовлення доступу / обладнання</h5>
                <p className="text-[11px] text-[#6E7568]">Поля: Тип ресурсу, Обґрунтування, Дедлайн</p>
                <button
                  onClick={sendSmartBugForm}
                  className="w-full py-1.5 bg-[#FAF8F5] hover:bg-[#EFE9DC] border border-[#E5DEC9] rounded-lg text-xs font-semibold text-[#21261F]"
                >
                  Надіслати в чат →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: New Rule Form */}
        {showNewRule && (
          <div className="fixed inset-0 phantom-scrim z-60 flex items-center justify-center p-4">
            <form
              onSubmit={handleCreateRule}
              className="bg-white border border-[#E5DEC9] p-5 rounded-2xl w-full max-w-md shadow-2xl space-y-3 animate-in zoom-in-95"
            >
              <h4 className="font-bold text-sm text-[#21261F]">Створити правило автоматизації</h4>
              <div>
                <label className="text-[11px] font-semibold text-[#6E7568]">Назва правила</label>
                <input
                  type="text"
                  required
                  value={newRuleName}
                  onChange={(e) => setNewRuleName(e.target.value)}
                  placeholder="напр. Сповіщення про деплой"
                  className="w-full p-2 bg-[#FAF8F5] border border-[#E5DEC9] rounded-lg text-xs mt-1 text-[#21261F]"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#6E7568]">Умова (Trigger)</label>
                <input
                  type="text"
                  required
                  value={newTriggerConfig}
                  onChange={(e) => setNewTriggerConfig(e.target.value)}
                  placeholder="Слово 'Deploy' або подія"
                  className="w-full p-2 bg-[#FAF8F5] border border-[#E5DEC9] rounded-lg text-xs mt-1 text-[#21261F]"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#6E7568]">Дія (Action)</label>
                <input
                  type="text"
                  required
                  value={newActionConfig}
                  onChange={(e) => setNewActionConfig(e.target.value)}
                  placeholder="Створити запис у Canvas"
                  className="w-full p-2 bg-[#FAF8F5] border border-[#E5DEC9] rounded-lg text-xs mt-1 text-[#21261F]"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewRule(false)}
                  className="flex-1 py-2 bg-[#FAF8F5] hover:bg-[#EFE9DC] rounded-lg text-xs font-semibold"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-lg text-xs font-bold"
                >
                  Зберегти
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span className="flex items-center gap-1 text-emerald-700 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Local Event Bus Active · 0 cloud latency</span>
          </span>
          <span>SQLite Embedded Rules Engine</span>
        </div>
      </div>
    </div>
  );
};
