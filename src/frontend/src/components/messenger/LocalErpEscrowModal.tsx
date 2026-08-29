import React, { useState } from 'react';
import {
  Boxes,
  ShieldCheck,
  X,
  Download,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useMessengerStore } from '../../stores/messengerStore';
import { useUIStore } from '../../stores/uiStore';

interface SkuInventoryItem {
  sku: string;
  name: string;
  category: string;
  quantity: number;
  unitCostUAH: number;
  totalValueUAH: number;
}

interface EscrowDeal {
  id: string;
  client: string;
  title: string;
  amountUAH: number;
  status: 'Кошти заблоковані' | 'Акт підписано' | 'Виплачено';
  signedByClient: boolean;
  signedByVendor: boolean;
}

interface LocalErpEscrowModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const LocalErpEscrowModal: React.FC<LocalErpEscrowModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Комерційний простір',
}) => {
  const [activeTab, setActiveTab] = useState<'erp_inventory' | 'leads' | 'escrow'>('erp_inventory');

  const [inventory] = useState<SkuInventoryItem[]>([
    { sku: 'PHT-RAD-01', name: 'Phantom Radxa Bare-metal Node', category: 'Hardware', quantity: 18, unitCostUAH: 4200, totalValueUAH: 75600 },
    { sku: 'PHT-RF-868', name: 'LoRa SX1262 868MHz Mesh Модуль', category: 'RF Components', quantity: 42, unitCostUAH: 650, totalValueUAH: 27300 },
    { sku: 'PHT-KEY-05', name: 'YubiKey 5C NFC Cryptographic Key', category: 'Security', quantity: 12, unitCostUAH: 2100, totalValueUAH: 25200 },
  ]);

  const [escrowDeals, setEscrowDeals] = useState<EscrowDeal[]>([
    {
      id: 'escrow-101',
      client: 'ТОВ «АгроТех Київ»',
      title: 'Розгортання автономної LoRa Mesh сенсорної мережі',
      amountUAH: 45000,
      status: 'Кошти заблоковані',
      signedByClient: true,
      signedByVendor: false,
    },
    {
      id: 'escrow-102',
      client: 'Коворкінг Unit.City',
      title: 'Встановлення 4 вузлів Phantom Relay',
      amountUAH: 18500,
      status: 'Виплачено',
      signedByClient: true,
      signedByVendor: true,
    },
  ]);

  if (!isOpen) return null;

  const handleSignAct = (id: string) => {
    soundFx.playSend();
    setEscrowDeals(
      escrowDeals.map((d) =>
        d.id === id
          ? { ...d, signedByVendor: true, status: 'Акт підписано' }
          : d
      )
    );
    const store = useMessengerStore.getState();
    store.addCustomMessage({
      id: `msg_escrow_signed_${Date.now()}`,
      senderId: store.currentUser.id,
      senderName: 'Escrow Protocol Engine',
      senderAvatar: store.currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'text',
      isSelf: true,
      text: '🛡️ **[Ескроу-Угода #101: Акт виконаних робіт підписано]**\n• Клієнт: ТОВ «АгроТех Київ»\n• Сума розблокована: **45 000 ₴**\n• Криптографічні підписи обох сторін валідовані (Ed25519) ✓',
    });
  };

  const handleExportCsv = () => {
    soundFx.playTap();
    useUIStore.getState().toast({ kind: 'success', message: 'Податковий звіт та складська відомість (CSV) згенеровані у vault/reports/' });
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
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Local ERP, Складський Облік & Escrow Угоди
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · SKU інвентар, податкові розрахунки та безпечні смарт-угоди
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('erp_inventory')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'erp_inventory' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Склад ERP ({inventory.length})
              </button>
              <button
                onClick={() => setActiveTab('escrow')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'escrow' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Escrow Угоди
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
          {/* TAB 1: SKU Inventory & Tax Ledger */}
          {activeTab === 'erp_inventory' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-xs text-[#21261F]">Залишки на складі за артикулами (SKU)</h4>
                  <span className="text-[11px] text-[#6E7568]">Загальна вартість складу: 128 100 ₴</span>
                </div>

                <button
                  onClick={handleExportCsv}
                  className="px-3 py-1.5 bg-[#FAF8F5] hover:bg-[#EFE9DC] border border-[#E5DEC9] rounded-lg text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5 text-[#6E7568]" />
                  <span>Експорт CSV/PDF</span>
                </button>
              </div>

              <div className="space-y-2.5">
                {inventory.map((item) => (
                  <div key={item.sku} className="p-4 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold bg-[#FAF8F5] px-2 py-0.5 rounded border border-[#E8E1D3] text-[#D96C35]">
                          {item.sku}
                        </span>
                        <h5 className="font-bold text-xs text-[#21261F]">{item.name}</h5>
                      </div>
                      <p className="text-[11px] text-[#6E7568]">
                        Категорія: {item.category} · Собівартість: {item.unitCostUAH} ₴/шт
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="font-bold text-xs text-emerald-700">{item.quantity} шт на складі</span>
                      <span className="block font-mono text-[11px] text-[#8A9186] mt-0.5">Сума: {item.totalValueUAH} ₴</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: Escrow Contracts */}
          {activeTab === 'escrow' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 text-xs text-emerald-950">
                <div className="flex items-center gap-2 font-bold text-emerald-900">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Криптографічний Escrow: Заморозка коштів до прийняття робіт</span>
                </div>
                <p className="leading-relaxed">
                  Гарантована безпека угод між замовником та виконавцем. Кошти депонуються в смарт-контракті та виплачуються лише після двостороннього підпису акту прийому-передачі.
                </p>
              </div>

              <div className="space-y-2.5">
                {escrowDeals.map((deal) => (
                  <div key={deal.id} className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-mono text-xs font-bold text-[#D96C35]">{deal.id}</span>
                        <h5 className="font-bold text-xs text-[#21261F] mt-0.5">{deal.title}</h5>
                        <p className="text-[11px] text-[#6E7568]">Замовник: {deal.client}</p>
                      </div>

                      <div className="text-right">
                        <span className="font-mono font-bold text-sm text-[#21261F]">{deal.amountUAH} ₴</span>
                        <span
                          className={`block px-2 py-0.5 rounded-full text-[10px] font-bold mt-1 ${
                            deal.status === 'Кошти заблоковані'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {deal.status}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-[#E8E1D3]">
                      <span className="text-[11px] text-[#6E7568]">
                        Підписи: Клієнт ({deal.signedByClient ? '✓' : '...'}) · Виконавець ({deal.signedByVendor ? '✓' : '...'})
                      </span>

                      {!deal.signedByVendor && (
                        <button
                          onClick={() => handleSignAct(deal.id)}
                          className="px-3.5 py-1.5 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                        >
                          Підписати акт & Розблокувати кошти
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Sovereign ERP & Financial Core</span>
          <span className="font-mono">Ed25519 Escrow Engine</span>
        </div>
      </div>
    </div>
  );
};
