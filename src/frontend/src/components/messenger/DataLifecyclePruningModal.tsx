import React, { useState } from 'react';
import {
  Sparkles,
  Database,
  FileText,
  CheckCircle2,
  X,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useMessengerStore } from '../../stores/messengerStore';

interface PruningPolicy {
  id: string;
  type: 'media' | 'voice' | 'ephemeral_text' | 'code_and_decisions';
  label: string;
  retentionDays: number;
  autoExtractLivingDoc: boolean;
  sizeMB: number;
}

interface DataLifecyclePruningModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const DataLifecyclePruningModal: React.FC<DataLifecyclePruningModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Бесіда',
}) => {
  const [activeTab, setActiveTab] = useState<'crystallize' | 'lifecycle'>('crystallize');
  const [isCrystallizing, setIsCrystallizing] = useState(false);
  const [crystallizedSummary, setCrystallizedSummary] = useState<string | null>(null);

  const [policies, setPolicies] = useState<PruningPolicy[]>([
    {
      id: 'p1',
      type: 'media',
      label: 'Тимчасові фото та відео (Скриншоти, превʼю)',
      retentionDays: 7,
      autoExtractLivingDoc: true,
      sizeMB: 342,
    },
    {
      id: 'p2',
      type: 'voice',
      label: 'Голосові повідомлення та транскрипти',
      retentionDays: 14,
      autoExtractLivingDoc: true,
      sizeMB: 128,
    },
    {
      id: 'p3',
      type: 'ephemeral_text',
      label: 'Побутовий текст чату (привітання, "ок", реакції)',
      retentionDays: 3,
      autoExtractLivingDoc: true,
      sizeMB: 18,
    },
    {
      id: 'p4',
      type: 'code_and_decisions',
      label: 'Код, ухвалені рішення, ТЗ та фінальні артефакти',
      retentionDays: 9999, // Permanent
      autoExtractLivingDoc: true,
      sizeMB: 4.5,
    },
  ]);

  if (!isOpen) return null;

  const handleCrystallizeNow = () => {
    soundFx.playSend();
    setIsCrystallizing(true);
    setTimeout(() => {
      setIsCrystallizing(false);
      setCrystallizedSummary(
        '📘 **Жива Специфікація Проекту (Living Spec v3.1)**\n\n' +
        '• **Ухвалене рішення:** Повна ізоляція SQLite для кожної сфери.\n' +
        '• **P2P Маршрутизація:** Інтеграція WireGuard (Work) та Tor (Community).\n' +
        '• **Дедлайн спринту:** 02 Вересня 2026.\n' +
        '• **Відповідальні:** @Саня (Ratchet Tree), @Марина (WASM Sandbox).\n\n' +
        '*(342 беззмістовні повідомлення стиснуто в 1 структурований документ)*'
      );
    }, 1200);
  };

  const handleSaveToCanvas = () => {
    if (!crystallizedSummary) return;
    soundFx.playSend();
    const store = useMessengerStore.getState();
    window.dispatchEvent(
      new CustomEvent('phantom:add-to-canvas', {
        detail: { text: crystallizedSummary, type: 'decision' },
      })
    );
    window.dispatchEvent(new CustomEvent('phantom:open-canvas'));
    store.addCustomMessage({
      id: `msg_cryst_${Date.now()}`,
      senderId: store.currentUser.id,
      senderName: 'AI Chronicler (Living Spec)',
      senderAvatar: store.currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'text',
      isSelf: true,
      text: crystallizedSummary,
    });
    onClose();
  };

  const updateRetention = (id: string, days: number) => {
    setPolicies(policies.map((p) => (p.id === id ? { ...p, retentionDays: days } : p)));
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
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Кристалізація знань та Життєвий цикл даних
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Living Spec, Smart Auto-Pruning та очищення від шуму
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('crystallize')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'crystallize' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Living Spec
              </button>
              <button
                onClick={() => setActiveTab('lifecycle')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'lifecycle' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Auto-Pruning ({policies.reduce((a, c) => a + c.sizeMB, 0).toFixed(0)} MB)
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
          {/* TAB 1: Living Spec Chronicler */}
          {activeTab === 'crystallize' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2 text-xs text-indigo-950">
                <div className="flex items-center gap-2 font-bold text-indigo-900">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  <span>Проблема «Кладовища інформації» розв'язана</span>
                </div>
                <p className="leading-relaxed">
                  Чат розглядається як тимчасовий протокол змін (Event Log). Система локально аналізує повідомлення за останні 48 годин, витягує всі рішення, домовленості, ТЗ та кодові блоки, формуючи актуальний стан Living Documentation.
                </p>
              </div>

              {crystallizedSummary ? (
                <div className="p-4 bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      Кристалізація завершена
                    </span>
                    <span className="text-[10px] text-[#8A9186] font-mono">SQLite Vector Mesh</span>
                  </div>

                  <div className="p-3 bg-white border border-[#E8E1D3] rounded-lg text-xs whitespace-pre-line text-[#21261F] leading-relaxed">
                    {crystallizedSummary}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveToCanvas}
                      className="flex-1 py-2 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                    >
                      Зберегти в Canvas та опублікувати Living Spec →
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-6 bg-white border border-[#E5DEC9] rounded-xl flex flex-col items-center justify-center space-y-3 text-center">
                  <FileText className="w-10 h-10 text-[#D96C35]" />
                  <div>
                    <h5 className="font-bold text-xs text-[#21261F]">Кристалізувати Living Spec прямо зараз</h5>
                    <p className="text-[11px] text-[#6E7568] max-w-sm mt-0.5">
                      Стиснути сотні неструктурованих повідомлень у єдиний документ без хмарних серверів.
                    </p>
                  </div>
                  <button
                    onClick={handleCrystallizeNow}
                    disabled={isCrystallizing}
                    className="px-5 py-2.5 bg-[#21261F] hover:bg-[#3E453A] text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2"
                  >
                    <Sparkles className={`w-4 h-4 ${isCrystallizing ? 'animate-spin' : ''}`} />
                    <span>{isCrystallizing ? 'Локальний аналіз...' : 'Запустити кристалізацію знань'}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Smart Auto-Pruning & Storage Lifecycle */}
          {activeTab === 'lifecycle' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-[#21261F]">Політики життєвого циклу та автоочищення</h4>
                <span className="text-[11px] text-[#6E7568]">Локальне сховище: 492.5 MB</span>
              </div>

              <div className="space-y-2.5">
                {policies.map((pol) => (
                  <div key={pol.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <h5 className="font-bold text-xs text-[#21261F]">{pol.label}</h5>
                      <span className="font-mono text-xs font-bold text-[#D96C35]">{pol.sizeMB} MB</span>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-[11px] text-[#6E7568]">Термін збереження локально:</span>
                      <select
                        value={pol.retentionDays}
                        onChange={(e) => updateRetention(pol.id, Number(e.target.value))}
                        className="p-1 bg-[#FAF8F5] border border-[#E5DEC9] rounded-lg text-xs font-medium focus:outline-none"
                      >
                        <option value={3}>3 дні (Ефемерно)</option>
                        <option value={7}>7 днів</option>
                        <option value={14}>14 днів</option>
                        <option value={30}>30 днів</option>
                        <option value={9999}>Назавжди (Артефакти)</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Data Gravity Resistance</span>
          <span className="font-mono">SQLite Local-First Engine</span>
        </div>
      </div>
    </div>
  );
};
