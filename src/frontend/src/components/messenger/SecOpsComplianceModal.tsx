import React, { useState } from 'react';
import {
  ShieldAlert,
  X,
  KeyRound,
  Fingerprint,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useUIStore } from '../../stores/uiStore';

interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  merkleHash: string;
}

interface RevokableDevice {
  id: string;
  name: string;
  ip: string;
  lastSeen: string;
  status: 'Authorized' | 'Revoked';
}

interface SecOpsComplianceModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const SecOpsComplianceModal: React.FC<SecOpsComplianceModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Безпека простору',
}) => {
  const [activeTab, setActiveTab] = useState<'audit_merkle' | 'dlp' | 'revocation'>('audit_merkle');
  const [isDlpActive, setIsDlpActive] = useState(true);
  const [isWatermarkingActive, setIsWatermarkingActive] = useState(true);

  const [auditLogs] = useState<AuditLogEntry[]>([
    {
      id: 'a1',
      timestamp: '26.08 23:14:02',
      actor: 'Кирило (@kiril_root)',
      action: 'Експорт фінансового звіту ERP',
      target: 'vault/reports/q3_ledger.csv',
      merkleHash: '9f83a48e89b...c1d2',
    },
    {
      id: 'a2',
      timestamp: '26.08 22:45:18',
      actor: 'Марина (@marina_core)',
      action: 'Зміна прав доступу простору',
      target: 'space:engineering-core/roles',
      merkleHash: '3a1c84f9810...bb4e',
    },
    {
      id: 'a3',
      timestamp: '26.08 21:10:05',
      actor: 'Саня (@alex_hw)',
      action: 'Додавання нового вузла Radxa',
      target: 'mesh/nodes/node-8491',
      merkleHash: '7e28d11ca94...88f1',
    },
  ]);

  const [devices, setDevices] = useState<RevokableDevice[]>([
    { id: 'd1', name: 'Workstation ThinkPad (Linux)', ip: '10.42.0.2', lastSeen: 'Щойно', status: 'Authorized' },
    { id: 'd2', name: 'Radxa Rock 5B Server', ip: '10.42.0.3', lastSeen: '1 хв тому', status: 'Authorized' },
    { id: 'd3', name: 'Втрачений планшет iPad Mini', ip: '192.168.1.84', lastSeen: '3 дні тому', status: 'Authorized' },
  ]);

  if (!isOpen) return null;

  const handleRevokeDevice = (id: string) => {
    soundFx.playSend();
    setDevices(
      devices.map((d) => (d.id === id ? { ...d, status: 'Revoked' } : d))
    );
    useUIStore.getState().toast({ kind: 'success', message: 'Сертифікат відкликано. Групові ключі шифрування простору перегенеровано' });
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
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                SecOps, Merkle-Аудит, DLP & Відкликання Ключів
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Незмінний журнал подій, захист від витоку даних та Key Ratchet
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('audit_merkle')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'audit_merkle' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Merkle-Аудит
              </button>
              <button
                onClick={() => setActiveTab('dlp')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'dlp' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                DLP & Водяні знаки
              </button>
              <button
                onClick={() => setActiveTab('revocation')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'revocation' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Відкликання сесій
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
          {/* TAB 1: Merkle Tree Audit Log */}
          {activeTab === 'audit_merkle' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-950 flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-emerald-900">
                  <Fingerprint className="w-4 h-4 text-emerald-600" />
                  <span>Append-Only Merkle Tree: Захист від підробки логів</span>
                </div>
                <span className="font-mono text-[10px] font-bold">Хеш-дерево валідне ✓</span>
              </div>

              <div className="space-y-2.5">
                {auditLogs.map((log) => (
                  <div key={log.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl space-y-1 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-[#21261F]">{log.actor}</span>
                        <span className="text-[10px] text-[#8A9186]">· {log.timestamp}</span>
                      </div>
                      <span className="font-mono text-[10px] bg-[#FAF8F5] px-1.5 py-0.5 rounded border border-[#E8E1D3] text-[#6E7568]">
                        Merkle: {log.merkleHash}
                      </span>
                    </div>

                    <div className="text-xs text-[#21261F]">
                      <span className="font-semibold">{log.action}:</span>{' '}
                      <span className="text-[#6E7568] font-mono text-[11px]">{log.target}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: DLP & Dynamic Watermarking */}
          {activeTab === 'dlp' && (
            <div className="space-y-4">
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div>
                    <h5 className="font-bold text-xs text-[#21261F]">Data Loss Prevention (DLP Екранування)</h5>
                    <p className="text-[11px] text-[#6E7568]">
                      Автоматичне блокування та маскування API ключів, паролів та платіжних реквізитів
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      soundFx.playTap();
                      setIsDlpActive(!isDlpActive);
                    }}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      isDlpActive ? 'bg-emerald-600 text-white' : 'bg-gray-300 text-gray-700'
                    }`}
                  >
                    {isDlpActive ? 'DLP Активний ✓' : 'Вимкнено'}
                  </button>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[#E8E1D3]">
                  <div>
                    <h5 className="font-bold text-xs text-[#21261F]">Динамічні водяні знаки (Anti-Screenshot)</h5>
                    <p className="text-[11px] text-[#6E7568]">
                      Напівпрозоре накладення ID користувача поверх секретних документів
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      soundFx.playTap();
                      setIsWatermarkingActive(!isWatermarkingActive);
                    }}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      isWatermarkingActive ? 'bg-emerald-600 text-white' : 'bg-gray-300 text-gray-700'
                    }`}
                  >
                    {isWatermarkingActive ? 'Водяні знаки ✓' : 'Вимкнено'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Device & Key Revocation */}
          {activeTab === 'revocation' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs text-amber-950">
                <div className="flex items-center gap-2 font-bold text-amber-900">
                  <KeyRound className="w-4 h-4 text-amber-600" />
                  <span>Екстрене відкликання пристроїв та Key Ratchet</span>
                </div>
                <p className="leading-relaxed">
                  При відкликанні пристрою система негайно вилучає його публічний ключ з дерева довіри та перегенеровує груповий ключ шифрування простору.
                </p>
              </div>

              <div className="space-y-2.5">
                {devices.map((dev) => (
                  <div key={dev.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div>
                      <h5 className="font-bold text-xs text-[#21261F]">{dev.name}</h5>
                      <p className="text-[11px] text-[#6E7568]">IP: {dev.ip} · Останній зв'язок: {dev.lastSeen}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          dev.status === 'Authorized'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {dev.status}
                      </span>

                      {dev.status === 'Authorized' && (
                        <button
                          onClick={() => handleRevokeDevice(dev.id)}
                          className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs"
                        >
                          Відкликати ключ
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
          <span>Corporate SecOps & Audit Framework</span>
          <span className="font-mono">Merkle Ratchet v4.2</span>
        </div>
      </div>
    </div>
  );
};
