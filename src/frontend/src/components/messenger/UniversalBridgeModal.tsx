import React, { useState } from 'react';
import {
  Network,
  Lock,
  X,
  Globe,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface BridgeConnection {
  id: string;
  protocol: 'Matrix' | 'Nostr' | 'ActivityPub' | 'Telegram (TDLib)' | 'Signal (CLI)';
  account: string;
  endpoint: string;
  status: 'Connected' | 'Syncing' | 'Offline';
  messagesSynced: number;
  isLocalOnly: boolean;
}

interface UniversalBridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const UniversalBridgeModal: React.FC<UniversalBridgeModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Бесіда',
}) => {
  const [activeTab, setActiveTab] = useState<'matrix_nostr' | 'puppeting'>('matrix_nostr');
  const [bridges, setBridges] = useState<BridgeConnection[]>([
    {
      id: 'b1',
      protocol: 'Matrix',
      account: '@kiril:matrix.org',
      endpoint: 'matrix.phantom.local:8448',
      status: 'Connected',
      messagesSynced: 1240,
      isLocalOnly: true,
    },
    {
      id: 'b2',
      protocol: 'Nostr',
      account: 'npub18f2a...c41e',
      endpoint: 'wss://relay.damus.io',
      status: 'Connected',
      messagesSynced: 430,
      isLocalOnly: true,
    },
    {
      id: 'b3',
      protocol: 'ActivityPub',
      account: '@kiril@mastodon.social',
      endpoint: 'Local Node Outbox',
      status: 'Connected',
      messagesSynced: 89,
      isLocalOnly: true,
    },
    {
      id: 'b4',
      protocol: 'Telegram (TDLib)',
      account: '+380 97 *** ** 42',
      endpoint: 'Local TDLib SQLite Daemon',
      status: 'Connected',
      messagesSynced: 3820,
      isLocalOnly: true,
    },
  ]);

  if (!isOpen) return null;

  const toggleBridge = (id: string) => {
    soundFx.playTap();
    setBridges(
      bridges.map((b) =>
        b.id === id
          ? { ...b, status: b.status === 'Connected' ? 'Offline' : 'Connected' }
          : b
      )
    );
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
              <Network className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Universal Bridge Core & Local Puppeting
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Матриця Matrix, Nostr, ActivityPub та безсерверні мости Telegram/Signal
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('matrix_nostr')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'matrix_nostr' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Відкриті протоколи
              </button>
              <button
                onClick={() => setActiveTab('puppeting')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'puppeting' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Local Puppeting (TG/Signal)
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
          {/* TAB 1: Open Protocols */}
          {activeTab === 'matrix_nostr' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-950 flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-indigo-900">
                  <Globe className="w-4 h-4 text-indigo-600" />
                  <span>Шлюз відкритих федеративних та P2P протоколів</span>
                </div>
                <span className="font-mono font-bold">Node-Level Relay</span>
              </div>

              <div className="space-y-2.5">
                {bridges
                  .filter((b) => ['Matrix', 'Nostr', 'ActivityPub'].includes(b.protocol))
                  .map((b) => (
                    <div key={b.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-[#21261F]">{b.protocol}</span>
                          <span className="font-mono text-[10px] text-[#6E7568] bg-[#FAF8F5] px-1.5 py-0.2 rounded border border-[#E8E1D3]">
                            {b.account}
                          </span>
                        </div>
                        <p className="text-[10px] text-[#8A9186]">Ендпоінт: {b.endpoint} · {b.messagesSynced} повідомлень</p>
                      </div>

                      <button
                        onClick={() => toggleBridge(b.id)}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                          b.status === 'Connected'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {b.status === 'Connected' ? '✓ Підключено' : 'Вимкнено'}
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* TAB 2: Local Puppeting */}
          {activeTab === 'puppeting' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 text-xs text-emerald-950">
                <div className="flex items-center gap-2 font-bold text-emerald-900">
                  <Lock className="w-4 h-4 text-emerald-600" />
                  <span>Безсерверний Local Puppeting (Zero Third-Party Cloud)</span>
                </div>
                <p className="leading-relaxed">
                  Сесії Telegram та Signal запускаються як локальний демон безпосередньо на вашому апаратному вузлі. Сесійні ключі та історія листування ніколи не покидають ваш пристрій.
                </p>
              </div>

              <div className="space-y-2.5">
                {bridges
                  .filter((b) => ['Telegram (TDLib)', 'Signal (CLI)'].includes(b.protocol))
                  .map((b) => (
                    <div key={b.id} className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <h5 className="font-bold text-xs text-[#21261F]">{b.protocol}</h5>
                          <span className="text-[10px] font-mono text-[#D96C35] bg-[#FDF5ED] px-2 py-0.5 rounded border border-[#E5DEC9]">
                            {b.account}
                          </span>
                        </div>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          {b.status}
                        </span>
                      </div>

                      <div className="text-[11px] text-[#6E7568] flex items-center justify-between pt-1">
                        <span>Сховище сесії: {b.endpoint}</span>
                        <span className="font-mono font-bold text-[#21261F]">{b.messagesSynced} sync</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Universal Protocol Bridge</span>
          <span className="font-mono">Local Puppeting v3</span>
        </div>
      </div>
    </div>
  );
};
