import React, { useState, useEffect } from 'react';
import {
  HardDrive,
  Cpu,
  Activity,
  Network,
  ShieldCheck,
  RefreshCw,
  X,
  Server,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface NodeDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NodeDashboardModal: React.FC<NodeDashboardModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [metrics, setMetrics] = useState({
    cpuUsage: 18,
    ramUsedGb: 2.4,
    ramTotalGb: 8.0,
    diskUsedGb: 42.1,
    diskTotalGb: 128.0,
    p2pPeersCount: 3,
    natType: 'Full-Cone STUN',
    uptimeHours: 74,
    relayStatus: 'Direct P2P Linked',
  });

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setMetrics((prev) => ({
        ...prev,
        cpuUsage: Math.floor(12 + Math.random() * 15),
        ramUsedGb: +(2.3 + Math.random() * 0.3).toFixed(1),
      }));
    }, 2000);
    return () => clearInterval(interval);
  }, [isOpen]);

  const handleRefresh = () => {
    soundFx.playTap();
    setRefreshing(true);
    setTimeout(() => {
      setRefreshing(false);
      setMetrics((prev) => ({
        ...prev,
        cpuUsage: Math.floor(10 + Math.random() * 12),
      }));
    }, 600);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Self-Hosted Node Management
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                did:phantom:radxa_arm64_0x8f2a · Radxa CM5 Edge Node
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] transition-colors"
              title="Оновити метрики"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] hover:text-[#21261F] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Telemetry Grid */}
        <div className="p-5 space-y-4 bg-[#FAF8F5]/50 overflow-y-auto custom-scrollbar max-h-[70vh]">
          {/* Top Status Banner */}
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-900 font-medium">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Вузол працює штатно · Аптайм: {metrics.uptimeHours} год.</span>
            </div>
            <span className="font-bold text-emerald-700">{metrics.relayStatus}</span>
          </div>

          {/* Hardware Resource Meters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* CPU */}
            <div className="bg-white p-3.5 rounded-xl border border-[#E5DEC9] space-y-2 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-[#6E7568]">
                <span className="flex items-center gap-1.5 font-bold text-[#21261F]">
                  <Cpu className="w-3.5 h-3.5 text-[#D96C35]" />
                  <span>CPU Навантаження</span>
                </span>
                <span className="font-mono font-bold text-[#D96C35]">{metrics.cpuUsage}%</span>
              </div>
              <div className="w-full h-2 bg-[#EFE9DC] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#D96C35] rounded-full transition-all duration-500"
                  style={{ width: `${metrics.cpuUsage}%` }}
                />
              </div>
              <p className="text-[10px] text-[#8A9186]">8 Cores @ 2.4GHz RK3588</p>
            </div>

            {/* RAM */}
            <div className="bg-white p-3.5 rounded-xl border border-[#E5DEC9] space-y-2 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-[#6E7568]">
                <span className="flex items-center gap-1.5 font-bold text-[#21261F]">
                  <Activity className="w-3.5 h-3.5 text-indigo-500" />
                  <span>RAM Памʼять</span>
                </span>
                <span className="font-mono font-bold text-indigo-600">
                  {metrics.ramUsedGb} / {metrics.ramTotalGb} GB
                </span>
              </div>
              <div className="w-full h-2 bg-[#EFE9DC] rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                  style={{ width: `${(metrics.ramUsedGb / metrics.ramTotalGb) * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-[#8A9186]">LPDDR4x ECC Enabled</p>
            </div>

            {/* Storage */}
            <div className="bg-white p-3.5 rounded-xl border border-[#E5DEC9] space-y-2 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-[#6E7568]">
                <span className="flex items-center gap-1.5 font-bold text-[#21261F]">
                  <Server className="w-3.5 h-3.5 text-emerald-500" />
                  <span>NVMe Сховище</span>
                </span>
                <span className="font-mono font-bold text-emerald-600">
                  {metrics.diskUsedGb} / {metrics.diskTotalGb} GB
                </span>
              </div>
              <div className="w-full h-2 bg-[#EFE9DC] rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${(metrics.diskUsedGb / metrics.diskTotalGb) * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-[#8A9186]">SQLCipher Encrypted Volume</p>
            </div>
          </div>

          {/* P2P Network Swarm Details */}
          <div className="bg-white p-4 rounded-xl border border-[#E5DEC9] space-y-3">
            <h4 className="font-bold text-xs text-[#21261F] flex items-center gap-2">
              <Network className="w-4 h-4 text-[#D96C35]" />
              <span>P2P Swarm & NAT Traversal</span>
            </h4>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E8E1D3]">
                <span className="text-[10px] text-[#8A9186]">Активні піри</span>
                <p className="font-bold text-[#21261F] text-sm mt-0.5">{metrics.p2pPeersCount} машини</p>
              </div>

              <div className="p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E8E1D3]">
                <span className="text-[10px] text-[#8A9186]">Тип NAT</span>
                <p className="font-bold text-[#21261F] text-sm mt-0.5">{metrics.natType}</p>
              </div>

              <div className="p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E8E1D3]">
                <span className="text-[10px] text-[#8A9186]">Швидкість шифрування</span>
                <p className="font-bold text-[#21261F] text-sm mt-0.5">ChaCha20-Poly1305</p>
              </div>

              <div className="p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E8E1D3]">
                <span className="text-[10px] text-[#8A9186]">CRDT Sync Version</span>
                <p className="font-bold text-emerald-600 text-sm mt-0.5">v3.4.1 (Clean)</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-xs text-[#6E7568]">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Ключі вузла зберігаються в апаратному enclave</span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#21261F] hover:bg-[#3E453A] text-white rounded-lg text-xs font-semibold transition-colors"
          >
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
};
