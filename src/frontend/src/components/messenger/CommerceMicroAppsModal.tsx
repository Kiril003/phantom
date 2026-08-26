import React, { useState } from 'react';
import {
  ShoppingBag,
  CreditCard,
  LayoutDashboard,
  X,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useMessengerStore } from '../../stores/messengerStore';

interface ProductItem {
  id: string;
  name: string;
  priceUAH: number;
  category: string;
  stock: number;
}

interface CrmLead {
  id: string;
  client: string;
  item: string;
  stage: 'Новий лід' | 'Оплата отримана' | 'Відправлено';
  amountUAH: number;
}

interface CommerceMicroAppsModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const CommerceMicroAppsModal: React.FC<CommerceMicroAppsModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Комерційний простір',
}) => {
  const [activeTab, setActiveTab] = useState<'storefront' | 'crm' | 'tool_builder'>('storefront');
  const [cartCount, setCartCount] = useState(1);

  const [products] = useState<ProductItem[]>([
    { id: 'p1', name: 'Phantom Radxa Node v2 (SX1262 LoRa Bundle)', priceUAH: 4850, category: 'Hardware', stock: 14 },
    { id: 'p2', name: 'YubiKey 5C NFC FIDO2 Cryptographic Key', priceUAH: 2200, category: 'Security', stock: 8 },
    { id: 'p3', name: 'Литий корпус IP67 для зовнішньої LoRa антени', priceUAH: 650, category: 'Accessories', stock: 32 },
  ]);

  const [leads] = useState<CrmLead[]>([
    { id: 'l1', client: 'Олег (@oleg_tech)', item: 'Radxa Node v2 Bundle', stage: 'Оплата отримана', amountUAH: 4850 },
    { id: 'l2', client: 'Коворкінг iHub', item: 'YubiKey 5C NFC (3 шт)', stage: 'Відправлено', amountUAH: 6600 },
  ]);

  if (!isOpen) return null;

  const handleGenerateInvoice = () => {
    soundFx.playSend();
    const store = useMessengerStore.getState();
    store.addCustomMessage({
      id: `msg_invoice_${Date.now()}`,
      senderId: store.currentUser.id,
      senderName: 'Sovereign E-Commerce Engine',
      senderAvatar: store.currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'text',
      isSelf: true,
      text: '🧾 **[Інвойс на оплату #PHT-8491]**\n• Товар: Phantom Radxa Node v2 (LoRa Bundle)\n• Сума до сплати: **4 850 ₴** (або 0.0014 BTC / USDT TRC20)\n• Статус: Очікує підтвердження P2P-транзакції\n\n*(Клієнт може оплатити в один клік прямо у вікні чату)*',
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
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                E-Commerce Вітрини, CRM & Internal Tool Builder
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Каталог товарів, генерація інвойсів, облік клієнтів та адмін-панелі
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('storefront')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'storefront' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Вітрина ({products.length})
              </button>
              <button
                onClick={() => setActiveTab('crm')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'crm' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Sovereign CRM
              </button>
              <button
                onClick={() => setActiveTab('tool_builder')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'tool_builder' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Tool Builder
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
          {/* TAB 1: Digital Showcase Storefront */}
          {activeTab === 'storefront' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-[#21261F]">Каталог товарів та обладнання</h4>
                <span className="text-[11px] text-[#6E7568]">Кошик: {cartCount} товар</span>
              </div>

              <div className="space-y-2.5">
                {products.map((item) => (
                  <div key={item.id} className="p-4 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-[#D96C35] bg-[#FDF5ED] px-2 py-0.5 rounded">
                          {item.category}
                        </span>
                        <h5 className="font-bold text-xs text-[#21261F]">{item.name}</h5>
                      </div>
                      <p className="text-[11px] text-[#6E7568]">Залишок на складі: {item.stock} шт.</p>
                    </div>

                    <div className="text-right flex items-center gap-3">
                      <span className="font-mono font-bold text-sm text-[#21261F]">{item.priceUAH} ₴</span>
                      <button
                        onClick={() => {
                          soundFx.playTap();
                          setCartCount((c) => c + 1);
                        }}
                        className="px-3 py-1.5 bg-[#FAF8F5] hover:bg-[#EFE9DC] border border-[#E5DEC9] rounded-lg text-xs font-bold transition-all"
                      >
                        + В кошик
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={handleGenerateInvoice}
                className="w-full py-2.5 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-xs"
              >
                <CreditCard className="w-4 h-4" />
                <span>Сформувати інвойс у чат (Оплата карткою або Crypto) →</span>
              </button>
            </div>
          )}

          {/* TAB 2: Sovereign CRM */}
          {activeTab === 'crm' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-[#21261F]">Воронка замовлень та лідів</h4>
                <span className="font-mono text-[11px] text-emerald-700 font-bold">Оборот: 11 450 ₴</span>
              </div>

              <div className="space-y-2.5">
                {leads.map((lead) => (
                  <div key={lead.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div>
                      <h5 className="font-bold text-xs text-[#21261F]">{lead.client}</h5>
                      <p className="text-[11px] text-[#6E7568]">{lead.item}</p>
                    </div>

                    <div className="text-right">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        {lead.stage}
                      </span>
                      <span className="block font-mono font-bold text-xs text-[#21261F] mt-0.5">{lead.amountUAH} ₴</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: Internal Tool Builder */}
          {activeTab === 'tool_builder' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2 text-xs text-indigo-950">
                <div className="flex items-center gap-2 font-bold text-indigo-900">
                  <LayoutDashboard className="w-4 h-4 text-indigo-600" />
                  <span>Конструктор внутрішніх порталів та адмінок (Zero-Code)</span>
                </div>
                <p className="leading-relaxed">
                  Збирайте кастомні панелі керування бізнесом без сторонніх сервісів: Таблиця SQLite + Кнопки дій + Графік продажів + Модерація відгуків.
                </p>
              </div>

              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                <h5 className="font-bold text-xs text-[#21261F]">Активний кастомний віджет: Складський моніторинг</h5>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl text-xs space-y-1">
                    <span className="text-[10px] text-[#8A9186]">Критичний залишок (&lt;10 шт)</span>
                    <p className="font-bold text-base text-amber-700">YubiKey 5C (8 шт)</p>
                    <button
                      onClick={() => {
                        soundFx.playTap();
                        alert('Автоматичне замовлення партії постачальнику сформовано.');
                      }}
                      className="mt-1 px-2.5 py-1 bg-white border border-[#E5DEC9] rounded text-[10px] font-bold text-[#21261F]"
                    >
                      Автозамовлення
                    </button>
                  </div>

                  <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl text-xs space-y-1">
                    <span className="text-[10px] text-[#8A9186]">Конверсія вітрини простору</span>
                    <p className="font-bold text-base text-emerald-700">68.4%</p>
                    <span className="text-[10px] text-emerald-800">14 угод закритих за тиждень</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Sovereign Commerce & Micro-Apps</span>
          <span className="font-mono">P2P Invoicing v2.4</span>
        </div>
      </div>
    </div>
  );
};
