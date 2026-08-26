import React, { useState } from 'react';
import {
  SlidersHorizontal,
  Plus,
  X,
  LayoutGrid,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface SchemaField {
  id: string;
  name: string;
  type: 'Text' | 'Status' | 'Number' | 'Select' | 'Date' | 'Voltage';
  defaultValue?: string;
}

interface CustomSpaceRecord {
  id: string;
  values: Record<string, string>;
}

interface ProtocolDrivenSchemaModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const ProtocolDrivenSchemaModal: React.FC<ProtocolDrivenSchemaModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Простір',
}) => {
  const [activeTab, setActiveTab] = useState<'schema' | 'miniview'>('schema');

  const [fields] = useState<SchemaField[]>([
    { id: 'f1', name: 'Компонент / Модуль', type: 'Text', defaultValue: 'ESP32-S3 Mesh' },
    { id: 'f2', name: 'Статус заліза', type: 'Status', defaultValue: 'Active' },
    { id: 'f3', name: 'Робоча напруга', type: 'Voltage', defaultValue: '3.3V' },
    { id: 'f4', name: 'Опис інциденту / Задача', type: 'Text', defaultValue: 'Перевірка споживання у сплячому режимі' },
  ]);

  const [records, setRecords] = useState<CustomSpaceRecord[]>([
    {
      id: 'r1',
      values: {
        'Компонент / Модуль': 'LoRa SX1262 868MHz',
        'Статус заліза': 'Active',
        'Робоча напруга': '3.28V',
        'Опис інциденту / Задача': 'Тест чутливості антени в умовах міської забудови',
      },
    },
    {
      id: 'r2',
      values: {
        'Компонент / Модуль': 'Radxa NPU Co-processor',
        'Статус заліза': 'Testing',
        'Робоча напруга': '5.02V',
        'Опис інциденту / Задача': 'Оптимізація інференсу INT8 квантованої моделі',
      },
    },
  ]);

  const [counterVal, setCounterVal] = useState(42);

  if (!isOpen) return null;

  const addRecord = () => {
    soundFx.playTap();
    const newR: CustomSpaceRecord = {
      id: `rec_${Date.now()}`,
      values: {
        'Компонент / Модуль': 'Новий елемент',
        'Статус заліза': 'Pending',
        'Робоча напруга': '3.30V',
        'Опис інциденту / Задача': 'Очікує налаштування',
      },
    };
    setRecords([...records, newR]);
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
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Кастомні схеми даних & Zero-Code Mini Views
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Протокольний UI, адаптивні таблиці та віджети за 5 секунд
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('schema')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'schema' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Схема простору
              </button>
              <button
                onClick={() => setActiveTab('miniview')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'miniview' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Zero-Code Віджет
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
          {/* TAB 1: Custom Schema Grid */}
          {activeTab === 'schema' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-xs text-[#21261F]">Поля схеми для поточного простору</h4>
                  <p className="text-[11px] text-[#6E7568]">Інтерфейс автоматично підлаштовує форму вводу</p>
                </div>

                <button
                  onClick={addRecord}
                  className="flex items-center gap-1 px-3 py-1.5 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-lg text-xs font-bold transition-all shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Додати запис</span>
                </button>
              </div>

              {/* Records Table */}
              <div className="border border-[#E5DEC9] rounded-xl overflow-hidden bg-white shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#FAF8F5] border-b border-[#E8E1D3] text-[#6E7568] font-bold">
                    <tr>
                      {fields.map((f) => (
                        <th key={f.id} className="p-2.5">
                          {f.name} ({f.type})
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1EBDD]">
                    {records.map((rec) => (
                      <tr key={rec.id} className="hover:bg-[#FAF8F5] transition-colors">
                        {fields.map((f) => (
                          <td key={f.id} className="p-2.5 font-medium text-[#21261F]">
                            {rec.values[f.name] || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: Zero-Code Mini View Builder */}
          {activeTab === 'miniview' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs text-amber-950">
                <div className="flex items-center gap-2 font-bold text-amber-900">
                  <LayoutGrid className="w-4 h-4 text-[#D96C35]" />
                  <span>Zero-Code Віджети (Комбінація блоків за 5 секунд)</span>
                </div>
                <p className="leading-relaxed">
                  Створюйте кастомні мікро-екрани моніторингу заліза, бюджету чи завдань без написання жодного рядка коду.
                </p>
              </div>

              {/* Live Widget Preview Box */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                <h5 className="font-bold text-xs text-[#21261F]">Live Віджет: Hardware Diagnostic Counter</h5>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl space-y-1">
                    <span className="text-[10px] text-[#8A9186] font-semibold">Лічильник помилок / пакетів</span>
                    <p className="font-mono font-bold text-2xl text-[#D96C35]">{counterVal}</p>
                    <div className="flex gap-1 pt-1">
                      <button
                        onClick={() => setCounterVal(counterVal + 1)}
                        className="px-2 py-0.5 bg-white border border-[#E5DEC9] rounded text-xs font-bold"
                      >
                        +1
                      </button>
                      <button
                        onClick={() => setCounterVal(0)}
                        className="px-2 py-0.5 bg-white border border-[#E5DEC9] rounded text-xs font-medium text-[#6E7568]"
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl space-y-1">
                    <span className="text-[10px] text-[#8A9186] font-semibold">Стан живлення шини</span>
                    <p className="font-mono font-bold text-2xl text-emerald-700">3.29 V</p>
                    <span className="text-[10px] text-emerald-800">Нормальний рівень</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Schema-Driven Adaptive UI</span>
          <span className="font-mono">Dynamic Component Graph</span>
        </div>
      </div>
    </div>
  );
};
