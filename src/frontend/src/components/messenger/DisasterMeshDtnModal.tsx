import React, { useState } from 'react';
import {
  Radio,
  X,
  Smartphone,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface TransportLayer {
  name: string;
  type: 'Internet (STUN/TURN)' | 'Wi-Fi Direct' | 'Bluetooth LE Mesh' | 'LoRa 868MHz Radio';
  status: 'Active' | 'Standby' | 'Offline';
  bandwidth: string;
  latency: string;
}

interface DtnCapsule {
  id: string;
  courierDevice: string;
  sourceNode: string;
  targetNode: string;
  payloadSize: string;
  status: 'In Transit' | 'Delivered';
}

interface DisasterMeshDtnModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const DisasterMeshDtnModal: React.FC<DisasterMeshDtnModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Мережа стійкості',
}) => {
  const [activeTab, setActiveTab] = useState<'transports' | 'dtn'>('transports');
  const [isSimulationActive, setIsSimulationActive] = useState(false);

  const [transports] = useState<TransportLayer[]>([
    { name: 'Основний Інтернет (P2P / STUN)', type: 'Internet (STUN/TURN)', status: 'Active', bandwidth: '100 Mbps', latency: '12 ms' },
    { name: 'Локальний Wi-Fi / Wi-Fi Direct', type: 'Wi-Fi Direct', status: 'Standby', bandwidth: '54 Mbps', latency: '4 ms' },
    { name: 'Bluetooth LE Mesh 5.3', type: 'Bluetooth LE Mesh', status: 'Standby', bandwidth: '2 Mbps', latency: '45 ms' },
    { name: 'LoRa SX1262 868MHz (USB Модем)', type: 'LoRa 868MHz Radio', status: 'Standby', bandwidth: '19.2 kbps', latency: '180 ms' },
  ]);

  const [dtnCapsules] = useState<DtnCapsule[]>([
    { id: 'cap-901', courierDevice: 'Pixel 8 Pro (Кирило)', sourceNode: 'Бункер Node A (Офлайн)', targetNode: 'Штаб Radxa (Онлайн)', payloadSize: '240 KB', status: 'In Transit' },
    { id: 'cap-902', courierDevice: 'ThinkPad X1 (Саня)', sourceNode: 'Польовий сенсор LoRa', targetNode: 'Сервер бази даних', payloadSize: '18 KB', status: 'Delivered' },
  ]);

  if (!isOpen) return null;

  const handleSimulateBlackout = () => {
    soundFx.playSend();
    setIsSimulationActive(true);
    setTimeout(() => {
      setIsSimulationActive(false);
      alert('⚡ [Симуляція блекауту завершена]: Трафік успішно перемикнуто на Wi-Fi Direct та LoRa 868MHz без втрати сесії!');
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
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Multi-Transport Failover & P2P DTN Синхронізація
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Безшовне перемикання каналів зв'язку та фізичні кур'єри даних
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('transports')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'transports' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Multi-Transport ({transports.length})
              </button>
              <button
                onClick={() => setActiveTab('dtn')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'dtn' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                DTN «На ногах»
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
          {/* TAB 1: Multi-Transport Failover */}
          {activeTab === 'transports' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-950 flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="font-bold text-emerald-900">Безшовне перемикання фізичних каналів (0% Drop Rate)</span>
                  <p className="text-[11px]">
                    При зникненні інтернету зв'язок миттєво падає на Wi-Fi Direct, потім BLE Mesh і радіоканал LoRa.
                  </p>
                </div>

                <button
                  onClick={handleSimulateBlackout}
                  disabled={isSimulationActive}
                  className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-900 text-white rounded-lg text-xs font-bold transition-all shadow-xs"
                >
                  {isSimulationActive ? 'Тестування...' : 'Симуляція аварії мережі'}
                </button>
              </div>

              <div className="space-y-2.5">
                {transports.map((t) => (
                  <div key={t.name} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div>
                      <h5 className="font-bold text-xs text-[#21261F]">{t.name}</h5>
                      <p className="text-[11px] text-[#6E7568]">
                        Швидкість: {t.bandwidth} · Затримка: {t.latency}
                      </p>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        t.status === 'Active'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-indigo-50 text-indigo-800 border border-indigo-200'
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: Delay-Tolerant Networking (DTN) */}
          {activeTab === 'dtn' && (
            <div className="space-y-4">
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-1 text-xs text-indigo-950">
                <div className="flex items-center gap-2 font-bold text-indigo-900">
                  <Smartphone className="w-4 h-4 text-indigo-600" />
                  <span>Delay-Tolerant Networking: Смартфон як фізичний кур'єр</span>
                </div>
                <p className="leading-relaxed">
                  Зашифрована капсула отримується смартфоном у зоні недосяжності інтернету і автоматично скидається на сервер при фізичному наближенні без розкриття змісту.
                </p>
              </div>

              <div className="space-y-2.5">
                {dtnCapsules.map((cap) => (
                  <div key={cap.id} className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-mono text-xs font-bold text-[#D96C35]">{cap.id}</span>
                        <h5 className="font-bold text-xs text-[#21261F]">Кур'єр: {cap.courierDevice}</h5>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          cap.status === 'In Transit'
                            ? 'bg-amber-100 text-amber-800 animate-pulse'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {cap.status}
                      </span>
                    </div>

                    <div className="p-2 bg-[#FAF8F5] border border-[#E8E1D3] rounded-lg text-[11px] font-mono text-[#21261F] flex justify-between">
                      <span>{cap.sourceNode} → {cap.targetNode}</span>
                      <span>Об'єм: {cap.payloadSize}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Disaster Recovery & DTN Protocol</span>
          <span className="font-mono">LoRa/BLE Failover v4.8</span>
        </div>
      </div>
    </div>
  );
};
