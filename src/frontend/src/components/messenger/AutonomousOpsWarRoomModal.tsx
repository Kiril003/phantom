import React, { useState } from 'react';
import {
  TrendingUp,
  Flame,
  Scale,
  X,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface IncidentWarRoom {
  id: string;
  title: string;
  severity: 'Critical' | 'High';
  affectedService: string;
  onCallEngineer: string;
  status: 'War Room Active' | 'Resolved';
}

interface DisputeCase {
  id: string;
  title: string;
  amountUAH: number;
  parties: string;
  arbitratorsCount: number;
  status: 'Голосування арбітрів' | 'Вирішено';
}

interface AutonomousOpsWarRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const AutonomousOpsWarRoomModal: React.FC<AutonomousOpsWarRoomModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Автономний менеджмент',
}) => {
  const [activeTab, setActiveTab] = useState<'predictive' | 'war_room' | 'disputes'>('predictive');

  const [incidents, setIncidents] = useState<IncidentWarRoom[]>([
    {
      id: 'inc-404',
      title: 'Database Replica Sync Timeout on Radxa-03',
      severity: 'Critical',
      affectedService: 'CRDT Vector Store',
      onCallEngineer: 'Марина (@marina_core)',
      status: 'War Room Active',
    },
  ]);

  const [disputes] = useState<DisputeCase[]>([
    {
      id: 'dsp-01',
      title: 'Розробка CAD креслень антени LoRa SX1262',
      amountUAH: 12000,
      parties: 'Замовник @agro_tech ↔ Виконавець @alex_hw',
      arbitratorsCount: 3,
      status: 'Голосування арбітрів',
    },
  ]);

  if (!isOpen) return null;

  const handleResolveIncident = (id: string) => {
    soundFx.playSend();
    setIncidents(
      incidents.map((inc) => (inc.id === id ? { ...inc, status: 'Resolved' } : inc))
    );
    alert('Інцидент закрито. Автоматичний Post-Mortem звіт збережено у vault/postmortems/inc-404.md ✓');
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
              <Flame className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Autonomous Ops, War Room & P2P Арбітраж
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Прогностичний аналіз дедлайнів, диспетчер аварій та арбітраж
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('predictive')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'predictive' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Прогноз релізу
              </button>
              <button
                onClick={() => setActiveTab('war_room')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'war_room' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                War Room ({incidents.length})
              </button>
              <button
                onClick={() => setActiveTab('disputes')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'disputes' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                P2P Арбітраж
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
          {/* TAB 1: Predictive Resource Scheduling */}
          {activeTab === 'predictive' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs text-amber-950">
                <div className="flex items-center gap-2 font-bold text-amber-900">
                  <TrendingUp className="w-4 h-4 text-amber-600" />
                  <span>Прогностичний аналіз Canvas завдань: Попередження про дедлайн</span>
                </div>
                <p className="leading-relaxed">
                  На основі поточної швидкості закриття карток та блокерів у гілці #engineering, реліз v2.4 ризикує затриматися на 4 дні.
                </p>
              </div>

              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs text-xs">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-[#21261F]">Прогрес релізу v2.4 (Sprint A-H)</span>
                  <span className="font-mono font-bold text-emerald-700">92% готово</span>
                </div>

                <div className="w-full bg-[#FAF8F5] border border-[#E8E1D3] rounded-full h-2.5 overflow-hidden">
                  <div className="bg-emerald-600 h-full rounded-full" style={{ width: '92%' }} />
                </div>

                <span className="text-[11px] text-[#6E7568] block pt-1">
                  Рекомендація системи: делегувати 2 задачі автотестування QA-спеціалісту для уникнення зриву.
                </span>
              </div>
            </div>
          )}

          {/* TAB 2: Autonomous Incident War Room */}
          {activeTab === 'war_room' && (
            <div className="space-y-4">
              {incidents.map((inc) => (
                <div key={inc.id} className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">
                          {inc.severity}
                        </span>
                        <h5 className="font-bold text-xs text-[#21261F]">{inc.title}</h5>
                      </div>
                      <p className="text-[11px] text-[#6E7568] mt-0.5">
                        Сервіс: {inc.affectedService} · Черговий: {inc.onCallEngineer}
                      </p>
                    </div>

                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                      {inc.status}
                    </span>
                  </div>

                  <div className="p-2.5 bg-[#FAF8F5] border border-[#E8E1D3] rounded-lg text-[11px] font-mono text-[#21261F]">
                    [War Room Canvas]: Автоматично імпортовано системні логи за останні 5 хв.
                  </div>

                  {inc.status === 'War Room Active' && (
                    <button
                      onClick={() => handleResolveIncident(inc.id)}
                      className="w-full py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                    >
                      Закрити інцидент & Сформувати Post-Mortem
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* TAB 3: P2P Dispute Resolution */}
          {activeTab === 'disputes' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2 text-xs text-indigo-950">
                <div className="flex items-center gap-2 font-bold text-indigo-900">
                  <Scale className="w-4 h-4 text-indigo-600" />
                  <span>Децентралізований P2P Арбітраж угод</span>
                </div>
                <p className="leading-relaxed">
                  Незалежні арбітри з високим рейтингом довіри розглядають суперечки щодо якості робіт і приймають рішення більшістю голосів (фіксована винагорода 2.5%).
                </p>
              </div>

              {disputes.map((dsp) => (
                <div key={dsp.id} className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono text-xs font-bold text-[#D96C35]">{dsp.id}</span>
                      <h5 className="font-bold text-xs text-[#21261F] mt-0.5">{dsp.title}</h5>
                      <p className="text-[11px] text-[#6E7568]">{dsp.parties}</p>
                    </div>

                    <div className="text-right">
                      <span className="font-mono font-bold text-sm text-[#21261F]">{dsp.amountUAH} ₴</span>
                      <span className="block text-[10px] text-indigo-700 font-bold mt-0.5">
                        {dsp.arbitratorsCount} арбітри призначені
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Autonomous Ops & Dispute Resolution</span>
          <span className="font-mono">P2P Arbitration Protocol</span>
        </div>
      </div>
    </div>
  );
};
