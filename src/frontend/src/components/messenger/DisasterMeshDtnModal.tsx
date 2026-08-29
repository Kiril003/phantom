import React, { useState } from 'react';
import {
  Radio,
  X,
  Clock,
  ShieldCheck,
  Send,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useMeshStore } from '../../stores/meshStore';

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
  const [newPayload, setNewPayload] = useState('');

  const { dtnQueue, enqueueDtnPacket, flushDtnQueue } = useMeshStore();

  if (!isOpen) return null;

  const handleQueueMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPayload.trim()) return;
    soundFx.playSend();
    enqueueDtnPacket({
      sourceNodeId: 'node_alpha_radxa',
      targetNodeId: 'node_field_agent',
      payload: newPayload.trim(),
      ttlSeconds: 86400,
    });
    setNewPayload('');
  };

  const handleDeliverAll = () => {
    soundFx.playTap();
    flushDtnQueue();
  };

  const transports = [
    { name: 'Основний Інтернет (P2P / STUN)', type: 'Internet (STUN/TURN)', status: 'Active', bandwidth: '100 Mbps', latency: '12 ms' },
    { name: 'Локальний Wi-Fi / Wi-Fi Direct', type: 'Wi-Fi Direct', status: 'Standby', bandwidth: '54 Mbps', latency: '4 ms' },
    { name: 'Bluetooth LE Mesh 5.3', type: 'Bluetooth LE Mesh', status: 'Standby', bandwidth: '2 Mbps', latency: '45 ms' },
    { name: 'LoRa SX1262 868MHz (USB Модем)', type: 'LoRa 868MHz Radio', status: 'Standby', bandwidth: '19.2 kbps', latency: '180 ms' },
  ];

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
                DTN Капсули ({dtnQueue.length})
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#6E7568] hover:text-[#21261F] hover:bg-[#F1EBDD] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {activeTab === 'transports' ? (
            <div className="space-y-3">
              <h4 className="font-bold text-xs text-[#6E7568] uppercase tracking-wider">Доступні канали передачі</h4>
              {transports.map((tr) => (
                <div key={tr.name} className="p-3.5 bg-white border border-[#E8E1D3] rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[#FAF8F5] border border-[#E8E1D3] text-[#D96C35]">
                      <Radio className="w-4 h-4" />
                    </div>
                    <div>
                      <h5 className="font-bold text-xs text-[#21261F]">{tr.name}</h5>
                      <p className="text-[10px] text-[#8A8577]">{tr.type} · Пропускна здатність: {tr.bandwidth}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-[#6E7568]">{tr.latency}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      tr.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {tr.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <form onSubmit={handleQueueMessage} className="p-4 bg-white border border-[#E8E1D3] rounded-xl space-y-3">
                <h4 className="font-bold text-xs text-[#21261F]">Додати офлайн-повідомлення в DTN-чергу</h4>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Вміст повідомлення для кур'єрської доставки..."
                    value={newPayload}
                    onChange={(e) => setNewPayload(e.target.value)}
                    className="flex-1 px-3 py-1.5 border border-[#E8E1D3] rounded-lg text-xs"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-[#D96C35] text-white font-bold text-xs rounded-lg flex items-center gap-1"
                  >
                    <Send className="w-3.5 h-3.5" /> В чергу
                  </button>
                </div>
              </form>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs text-[#6E7568] uppercase tracking-wider">Черга DTN Капсул</h4>
                  {dtnQueue.length > 0 && (
                    <button
                      onClick={handleDeliverAll}
                      className="text-xs text-[#D96C35] font-bold hover:underline"
                    >
                      Синхронізувати всі ({dtnQueue.length})
                    </button>
                  )}
                </div>
                {dtnQueue.map((c) => (
                  <div key={c.id} className="p-3.5 bg-white border border-[#E8E1D3] rounded-xl flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-[#21261F]">{c.payload}</span>
                        <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-bold">
                          {c.hops} хопів
                        </span>
                      </div>
                      <p className="text-[10px] text-[#8A8577] mt-0.5">
                        {c.sourceNodeId} ➔ {c.targetNodeId} · TTL: {c.ttlSeconds}s
                      </p>
                    </div>
                    <span className="flex items-center gap-1 text-[10px] text-amber-700 font-medium">
                      <Clock className="w-3.5 h-3.5" /> В дорозі
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-xs text-[#6E7568]">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Store-and-Forward шифрування пакета на кожному хопі</span>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-[#EFE9DC] text-[#21261F] font-medium rounded-lg hover:bg-[#E5DEC9] transition-colors"
          >
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
};
