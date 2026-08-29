import React, { useState } from 'react';
import {
  Workflow,
  Clock,
  ArrowRight,
  X,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface PipelineStep {
  id: string;
  name: string;
  assignee: string;
  status: 'Completed' | 'In Progress' | 'Pending';
  elapsedTime: string;
}

interface VisualStateMachinePipelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const VisualStateMachinePipelineModal: React.FC<VisualStateMachinePipelineModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Робочий процес',
}) => {
  const [activeTab, setActiveTab] = useState<'state_machine' | 'pipeline_trace'>('state_machine');
  const [fsmState, setFsmState] = useState<'Draft' | 'Lead Review' | 'In QA' | 'Deployed'>('Lead Review');

  const [pipelineSteps] = useState<PipelineStep[]>([
    { id: 'p1', name: '1. Створення задачі', assignee: '@Кирило', status: 'Completed', elapsedTime: '4m' },
    { id: 'p2', name: '2. Затвердження лідом', assignee: '@Марина', status: 'Completed', elapsedTime: '12m' },
    { id: 'p3', name: '3. Код-рев\'ю & PR', assignee: '@Саня', status: 'In Progress', elapsedTime: '18m' },
    { id: 'p4', name: '4. Wasm Unit Тести', assignee: 'CI Runner', status: 'Pending', elapsedTime: '0m' },
    { id: 'p5', name: '5. Деплой на Radxa Node', assignee: 'Daemon', status: 'Pending', elapsedTime: '0m' },
  ]);

  if (!isOpen) return null;

  const handleTriggerFsmTransition = (nextState: 'Draft' | 'Lead Review' | 'In QA' | 'Deployed') => {
    soundFx.playSend();
    setFsmState(nextState);
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
              <Workflow className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Visual State Machines & Pipeline Step Tracing
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Інтерактивні кінцеві автомати та покроковий трейсинг процесів
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('state_machine')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'state_machine' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Кінцевий автомат
              </button>
              <button
                onClick={() => setActiveTab('pipeline_trace')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'pipeline_trace' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Pipeline Tracing
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
          {/* TAB 1: Visual State Machine */}
          {activeTab === 'state_machine' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-1 text-xs text-indigo-950">
                <span className="font-bold text-indigo-900">Інтерактивний кінцевий автомат (Finite State Machine)</span>
                <p className="text-[11px]">
                  Клікніть на стрілку переходу для зміни глобального стану процесу для всієї команди.
                </p>
              </div>

              {/* FSM Graph View */}
              <div className="p-6 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-around gap-2 shadow-2xs">
                {(['Draft', 'Lead Review', 'In QA', 'Deployed'] as const).map((st, i, arr) => (
                  <React.Fragment key={st}>
                    <div
                      className={`p-3 rounded-xl border text-xs font-bold text-center transition-all ${
                        fsmState === st
                          ? 'bg-[#D96C35] text-white border-[#D96C35] shadow-md scale-105'
                          : 'bg-[#FAF8F5] border-[#E8E1D3] text-[#21261F]'
                      }`}
                    >
                      <span>{st}</span>
                    </div>

                    {i < arr.length - 1 && (
                      <button
                        onClick={() => handleTriggerFsmTransition(arr[i + 1])}
                        className="p-1.5 bg-[#FAF8F5] hover:bg-[#EFE9DC] border border-[#E8E1D3] rounded-lg text-[#6E7568] hover:text-[#21261F] transition-colors"
                        title={`Перейти до ${arr[i + 1]}`}
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    )}
                  </React.Fragment>
                ))}
              </div>

              <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl flex justify-between items-center text-xs">
                <span className="text-[#6E7568]">Поточний статус об'єкта в просторі:</span>
                <span className="font-mono font-bold text-emerald-700">{fsmState} ✓</span>
              </div>
            </div>
          )}

          {/* TAB 2: Pipeline Step Tracing */}
          {activeTab === 'pipeline_trace' && (
            <div className="space-y-4">
              <h4 className="font-bold text-xs text-[#21261F]">Горизонтальний трейс ланцюжка збірки & деплою</h4>

              <div className="space-y-2.5">
                {pipelineSteps.map((step) => (
                  <div
                    key={step.id}
                    className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            step.status === 'Completed'
                              ? 'bg-emerald-500'
                              : step.status === 'In Progress'
                              ? 'bg-amber-500 animate-ping'
                              : 'bg-gray-300'
                          }`}
                        />
                        <h5 className="font-bold text-xs text-[#21261F]">{step.name}</h5>
                      </div>
                      <span className="text-[11px] text-[#6E7568]">Відповідальний: {step.assignee}</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs text-[#8A9186] flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {step.elapsedTime}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          step.status === 'Completed'
                            ? 'bg-emerald-100 text-emerald-800'
                            : step.status === 'In Progress'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {step.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Visual State Machines & Pipelines</span>
          <span className="font-mono">FSM Graph Engine v2.0</span>
        </div>
      </div>
    </div>
  );
};
