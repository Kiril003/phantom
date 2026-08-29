import React, { useState } from 'react';
import {
  ShieldAlert,
  Database,
  X,
  AlertTriangle,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useUIStore } from '../../stores/uiStore';

interface DbIsolationRecord {
  sphere: string;
  filename: string;
  cipher: string;
  sizeMB: number;
  isUnlocked: boolean;
}

interface NetworkRoute {
  sphere: string;
  protocol: 'WireGuard Mesh' | 'Direct WebRTC P2P' | 'Tor / I2P Onion' | 'Mixnet (Decentralized)';
  exitNode: string;
  encryption: string;
  ipHidden: boolean;
}

interface ZeroLeakSecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const ZeroLeakSecurityModal: React.FC<ZeroLeakSecurityModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Бесіда',
}) => {
  const [activeTab, setActiveTab] = useState<'db_isolation' | 'routing' | 'duress'>('db_isolation');
  const [duressPin] = useState('9412');

  const databases: DbIsolationRecord[] = [
    { sphere: 'Робота (Work OS)', filename: 'vault_work_chacha20.sqlite', cipher: 'SQLCipher AES-256-CBC', sizeMB: 142.4, isUnlocked: true },
    { sphere: 'Навчання & Академія', filename: 'vault_academy_katex.sqlite', cipher: 'SQLCipher AES-256-CBC', sizeMB: 48.1, isUnlocked: true },
    { sphere: 'Сімʼя & Дім', filename: 'vault_family_home.sqlite', cipher: 'SQLCipher ChaCha20-Poly1305', sizeMB: 32.8, isUnlocked: true },
    { sphere: 'Творчість & Арт', filename: 'vault_creative_assets.sqlite', cipher: 'SQLCipher AES-256-CBC', sizeMB: 285.0, isUnlocked: true },
    { sphere: 'Особисте (Private)', filename: 'vault_personal_biometric.sqlite', cipher: 'Hardware Enclave Key', sizeMB: 19.5, isUnlocked: false },
    { sphere: 'Спільноти & Клуби', filename: 'vault_community_onion.sqlite', cipher: 'Zero-Knowledge Ephemeral', sizeMB: 14.2, isUnlocked: true },
  ];

  const routes: NetworkRoute[] = [
    { sphere: 'Робота', protocol: 'WireGuard Mesh', exitNode: 'radxa-hq-relay.pht (VPN)', encryption: 'ChaCha20-Poly1305', ipHidden: true },
    { sphere: 'Особисте', protocol: 'Direct WebRTC P2P', exitNode: 'End-to-End Direct Channel', encryption: 'Double Ratchet + Noise_XX', ipHidden: false },
    { sphere: 'Спільноти & Анонімне', protocol: 'Tor / I2P Onion', exitNode: '3-Hop Onion Circuit', encryption: 'Multi-layer Sphinx', ipHidden: true },
  ];

  if (!isOpen) return null;

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
            <div className="p-2 rounded-xl bg-red-50 text-red-600 border border-red-200">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                True Zero-Leak Security & Isolation
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Фізична ізоляція баз даних, Persona Routing та Duress PIN
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('db_isolation')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'db_isolation' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Бази Сфер
              </button>
              <button
                onClick={() => setActiveTab('routing')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'routing' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Маршрутизація
              </button>
              <button
                onClick={() => setActiveTab('duress')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'duress' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Deniable Duress
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
          {/* TAB 1: DB Isolation */}
          {activeTab === 'db_isolation' && (
            <div className="space-y-3">
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-950 flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-emerald-900">
                  <Database className="w-4 h-4 text-emerald-600" />
                  <span>Фізичне розділення баз даних для кожної сфери</span>
                </div>
                <span className="font-mono font-bold">SQLCipher v4</span>
              </div>

              <div className="space-y-2.5">
                {databases.map((db) => (
                  <div key={db.sphere} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-[#21261F]">{db.sphere}</span>
                        <span className="font-mono text-[10px] text-[#6E7568] bg-[#FAF8F5] px-1.5 py-0.2 rounded border border-[#E8E1D3]">
                          {db.filename}
                        </span>
                      </div>
                      <p className="text-[10px] text-[#8A9186]">Шифрування: {db.cipher} · {db.sizeMB} MB</p>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        db.isUnlocked
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {db.isUnlocked ? 'Розблоковано' : 'Заблоковано'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: Multi-Persona Network Routing */}
          {activeTab === 'routing' && (
            <div className="space-y-3">
              <h4 className="font-bold text-xs text-[#21261F]">Динамічна мережева ізоляція та анонімізація</h4>
              <div className="space-y-2.5">
                {routes.map((rt) => (
                  <div key={rt.sphere} className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <h5 className="font-bold text-xs text-[#21261F]">{rt.sphere}</h5>
                      <span className="font-bold text-[10px] text-[#D96C35] bg-[#FDF5ED] px-2 py-0.5 rounded border border-[#E5DEC9]">
                        {rt.protocol}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] text-[#6E7568] pt-1">
                      <div>Шлюз: <span className="font-mono text-[#21261F]">{rt.exitNode}</span></div>
                      <div>Захист: <span className="font-mono text-[#21261F]">{rt.encryption}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: Deniable Authentication (Duress PIN) */}
          {activeTab === 'duress' && (
            <div className="space-y-4">
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-2 text-xs text-red-950">
                <div className="flex items-center gap-2 font-bold text-red-900">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <span>Криптографічний Deniable Authentication (DURESS PIN)</span>
                </div>
                <p className="leading-relaxed">
                  Примусове введення аварійного пароля під час фізичної перевірки пристрою відкриває «чистий» фейковий профіль. Усі реальні зашифровані бази виглядають як нерозмічений білий шум (Plausible Deniability).
                </p>
              </div>

              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div>
                    <h5 className="font-bold text-xs text-[#21261F]">Аварійний Duress PIN</h5>
                    <p className="text-[11px] text-[#6E7568]">Запуск фейкової сесії без доступу до приватних даних</p>
                  </div>
                  <span className="font-mono font-bold text-xs bg-[#FAF8F5] border border-[#E5DEC9] px-3 py-1 rounded-lg">
                    {duressPin}
                  </span>
                </div>

                <button
                  onClick={() => {
                    soundFx.playTap();
                    useUIStore.getState().toast({ kind: 'info', message: 'Duress режим налаштовано. Введення цього PIN у вікні блокування активує decoy-простір.' });
                  }}
                  className="w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                >
                  Тест спрацювання аварійного захисту
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>True Zero-Leak Architecture</span>
          <span className="font-mono">Plausible Deniability Level 4</span>
        </div>
      </div>
    </div>
  );
};
