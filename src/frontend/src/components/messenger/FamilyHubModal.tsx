import React, { useState } from 'react';
import {
  Home,
  Plus,
  CheckCircle2,
  X,
  Lock,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface ShoppingItem {
  id: string;
  text: string;
  category: 'Продукти' | 'Аптека' | 'Дім';
  done: boolean;
  addedBy: string;
}

interface FamilyEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  participant: string;
}

interface FamilyDoc {
  id: string;
  title: string;
  type: string;
  lastUpdated: string;
}

interface FamilyExpense {
  id: string;
  title: string;
  amountUAH: number;
  paidBy: string;
  date: string;
}

interface FamilyHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const FamilyHubModal: React.FC<FamilyHubModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Родина & Дім',
}) => {
  const [activeTab, setActiveTab] = useState<'shopping' | 'calendar' | 'vault' | 'expenses'>('shopping');

  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([
    { id: 's1', text: 'Органічне молоко 2.5%', category: 'Продукти', done: false, addedBy: 'Мама' },
    { id: 's2', text: 'Вітамін D3 + Омега-3', category: 'Аптека', done: true, addedBy: 'Тато' },
    { id: 's3', text: 'Фільтри для води (3 шт)', category: 'Дім', done: false, addedBy: 'Кирило' },
  ]);

  const [newItemText, setNewItemText] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<ShoppingItem['category']>('Продукти');

  const [events] = useState<FamilyEvent[]>([
    { id: 'e1', title: 'Плановий огляд у стоматолога', date: '2026-08-29', time: '11:00', participant: 'Марина' },
    { id: 'e2', title: 'Шкільні батьківські збори', date: '2026-09-01', time: '18:30', participant: 'Усі' },
    { id: 'e3', title: 'Сімейна поїздка за місто', date: '2026-09-06', time: '10:00', participant: 'Родина' },
  ]);

  const [docs] = useState<FamilyDoc[]>([
    { id: 'doc1', title: 'Закордонні паспорти (Біометрія)', type: 'PDF / Зашифровано', lastUpdated: '12 Серпня 2026' },
    { id: 'doc2', title: 'Договір оренди житла', type: 'PDF / Ed25519 Signed', lastUpdated: '01 Липня 2026' },
    { id: 'doc3', title: 'Медичні картки та щеплення', type: 'Encrypted JSON', lastUpdated: '20 Серпня 2026' },
  ]);

  const [expenses] = useState<FamilyExpense[]>([
    { id: 'exp1', title: 'Закупівля в супермаркеті Silpo', amountUAH: 2450, paidBy: 'Кирило', date: 'Вчора' },
    { id: 'exp2', title: 'Комунальні послуги за серпень', amountUAH: 3180, paidBy: 'Марина', date: '24 Серпня' },
    { id: 'exp3', title: 'Побутова хімія та фільтри', amountUAH: 920, paidBy: 'Кирило', date: '22 Серпня' },
  ]);

  if (!isOpen) return null;

  const toggleShopping = (id: string) => {
    soundFx.playTap();
    setShoppingItems(
      shoppingItems.map((item) => (item.id === id ? { ...item, done: !item.done } : item))
    );
  };

  const handleAddShopping = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemText.trim()) return;
    soundFx.playSend();
    const item: ShoppingItem = {
      id: `shop_${Date.now()}`,
      text: newItemText.trim(),
      category: newItemCategory,
      done: false,
      addedBy: 'Кирило',
    };
    setShoppingItems([...shoppingItems, item]);
    setNewItemText('');
  };

  const totalExpenses = expenses.reduce((acc, curr) => acc + curr.amountUAH, 0);

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
        <div className="px-5 py-4 bg-[#FEF3D6] border-b border-[#F8DF9E] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-white text-amber-700 border border-amber-300 shadow-2xs">
              <Home className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-amber-950">
                Сфера: Сімʼя та Побут · {chatTitle}
              </h3>
              <p className="text-[11px] text-amber-900">
                Спільні списки покупок, сімейний календар, Family Vault та витрати
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-amber-200/60 p-0.5 rounded-lg text-xs font-medium text-amber-950">
              <button
                onClick={() => setActiveTab('shopping')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'shopping' ? 'bg-white text-amber-950 font-bold shadow-2xs' : 'hover:text-amber-900'
                }`}
              >
                Покупки
              </button>
              <button
                onClick={() => setActiveTab('calendar')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'calendar' ? 'bg-white text-amber-950 font-bold shadow-2xs' : 'hover:text-amber-900'
                }`}
              >
                Календар
              </button>
              <button
                onClick={() => setActiveTab('vault')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'vault' ? 'bg-white text-amber-950 font-bold shadow-2xs' : 'hover:text-amber-900'
                }`}
              >
                Family Vault
              </button>
              <button
                onClick={() => setActiveTab('expenses')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'expenses' ? 'bg-white text-amber-950 font-bold shadow-2xs' : 'hover:text-amber-900'
                }`}
              >
                Витрати
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-amber-300/40 rounded-lg text-amber-950 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar space-y-4">
          {/* TAB 1: Shopping Lists */}
          {activeTab === 'shopping' && (
            <div className="space-y-4">
              <form onSubmit={handleAddShopping} className="flex gap-2">
                <input
                  type="text"
                  value={newItemText}
                  onChange={(e) => setNewItemText(e.target.value)}
                  placeholder="Додати продукт або річ до списку..."
                  className="flex-1 p-2 bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl text-xs text-[#21261F] focus:outline-none"
                />
                <select
                  value={newItemCategory}
                  onChange={(e) => setNewItemCategory(e.target.value as any)}
                  className="p-2 bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl text-xs text-[#21261F] font-medium"
                >
                  <option value="Продукти">Продукти</option>
                  <option value="Аптека">Аптека</option>
                  <option value="Дім">Дім</option>
                </select>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1 shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Додати</span>
                </button>
              </form>

              <div className="space-y-2">
                {shoppingItems.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => toggleShopping(item.id)}
                    className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                      item.done
                        ? 'bg-[#FAF8F5] border-[#E8E1D3] opacity-60 line-through'
                        : 'bg-white border-[#E5DEC9] shadow-2xs'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all ${
                          item.done ? 'bg-amber-600 border-amber-600 text-white' : 'border-[#C6C8BF]'
                        }`}
                      >
                        {item.done && <CheckCircle2 className="w-3.5 h-3.5" />}
                      </div>
                      <span className="text-xs font-semibold text-[#21261F]">{item.text}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                        {item.category}
                      </span>
                      <span className="text-[10px] text-[#8A9186]">@{item.addedBy}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: Family Calendar */}
          {activeTab === 'calendar' && (
            <div className="space-y-3">
              <h4 className="font-bold text-xs text-[#21261F]">Найближчі сімейні події та розклад</h4>
              <div className="space-y-2.5">
                {events.map((ev) => (
                  <div key={ev.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div className="space-y-0.5">
                      <h5 className="font-bold text-xs text-[#21261F]">{ev.title}</h5>
                      <span className="text-[11px] text-[#6E7568]">Учасник: {ev.participant}</span>
                    </div>
                    <div className="text-right font-mono text-xs text-amber-800 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200">
                      <span>{ev.date} · {ev.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: Family Vault */}
          {activeTab === 'vault' && (
            <div className="space-y-3">
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-amber-700" />
                  <span>Зашифроване локальне сховище документів сімʼї</span>
                </div>
                <span className="font-mono font-bold">ChaCha20-Poly1305</span>
              </div>

              <div className="space-y-2">
                {docs.map((doc) => (
                  <div key={doc.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div>
                      <h5 className="font-bold text-xs text-[#21261F]">{doc.title}</h5>
                      <p className="text-[10px] text-[#8A9186]">Оновлено: {doc.lastUpdated}</p>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      {doc.type}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: Expenses */}
          {activeTab === 'expenses' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-amber-800 font-medium">Спільні витрати за місяць:</span>
                  <p className="font-mono font-bold text-lg text-amber-950">{totalExpenses} ₴</p>
                </div>
                <span className="text-xs text-amber-800 font-semibold bg-white px-2.5 py-1 rounded-lg border border-amber-200">
                  Баланс порівну
                </span>
              </div>

              <div className="space-y-2">
                {expenses.map((exp) => (
                  <div key={exp.id} className="p-3 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div>
                      <h5 className="font-bold text-xs text-[#21261F]">{exp.title}</h5>
                      <span className="text-[10px] text-[#8A9186]">Оплатив: @{exp.paidBy} · {exp.date}</span>
                    </div>
                    <span className="font-mono font-bold text-xs text-[#21261F]">{exp.amountUAH} ₴</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FEF3D6] border-t border-[#F8DF9E] flex items-center justify-between text-[11px] text-amber-950">
          <span>Спільний дім та родина</span>
          <span className="font-mono">Local-first Realtime Sync</span>
        </div>
      </div>
    </div>
  );
};
