import React, { useState } from 'react';
import {
  Server,
  Clipboard,
  X,
  Check,
  Copy,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface ClipboardItem {
  id: string;
  device: string;
  type: 'Text' | 'Image' | 'File';
  contentPreview: string;
  timestamp: string;
  isEncrypted: boolean;
}

interface WireGuardPeer {
  id: string;
  nodeName: string;
  ipAddress: string;
  latencyMs: number;
  transferRxTx: string;
  status: 'Active Tunnel' | 'Handshaking';
}

interface HeadlessInfrastructureModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const HeadlessInfrastructureModal: React.FC<HeadlessInfrastructureModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Інфраструктура',
}) => {
  const [activeTab, setActiveTab] = useState<'daemon' | 'clipboard' | 'wireguard'>('daemon');
  const [isDaemonRunning, setIsDaemonRunning] = useState(true);
  const [isWireguardEnabled, setIsWireguardEnabled] = useState(true);
  const [clipboardCopiedId, setClipboardCopiedId] = useState<string | null>(null);

  const [clipboardHistory] = useState<ClipboardItem[]>([
    {
      id: 'cb1',
      device: 'Radxa Rock 5B (#radxa-dev-01)',
      type: 'Text',
      contentPreview: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI...',
      timestamp: 'Щойно',
      isEncrypted: true,
    },
    {
      id: 'cb2',
      device: 'ThinkPad X1 (Ubuntu 24.04)',
      type: 'Text',
      contentPreview: 'curl -fsSL https://try.phantom-os.dev/install.sh | bash',
      timestamp: '5 хв тому',
      isEncrypted: true,
    },
    {
      id: 'cb3',
      device: 'Pixel 8 Pro (Phantom Companion)',
      type: 'Image',
      contentPreview: 'screenshot_mesh_topology_868mhz.png (1.4 MB)',
      timestamp: '18 хв тому',
      isEncrypted: true,
    },
  ]);

  const [peers] = useState<WireGuardPeer[]>([
    { id: 'p1', nodeName: 'home-server.pht (RPi 4)', ipAddress: '10.42.0.2/24', latencyMs: 8, transferRxTx: '1.2 GB / 840 MB', status: 'Active Tunnel' },
    { id: 'p2', nodeName: 'radxa-cluster-01.pht', ipAddress: '10.42.0.3/24', latencyMs: 14, transferRxTx: '4.8 GB / 3.1 GB', status: 'Active Tunnel' },
    { id: 'p3', nodeName: 'mobile-companion.pht', ipAddress: '10.42.0.4/24', latencyMs: 22, transferRxTx: '320 MB / 95 MB', status: 'Active Tunnel' },
  ]);

  if (!isOpen) return null;

  const handleCopyClipboard = (id: string, text: string) => {
    soundFx.playTap();
    setClipboardCopiedId(id);
    navigator.clipboard?.writeText(text);
    setTimeout(() => setClipboardCopiedId(null), 1500);
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
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Системний Демон, Спільний Буфер & P2P WireGuard
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Фоновий systemd демон, E2EE Universal Clipboard та Mesh VPN
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('daemon')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'daemon' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Headless Демон
              </button>
              <button
                onClick={() => setActiveTab('clipboard')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'clipboard' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Universal Clipboard
              </button>
              <button
                onClick={() => setActiveTab('wireguard')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'wireguard' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                WireGuard Mesh
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
          {/* TAB 1: Headless Node Daemon */}
          {activeTab === 'daemon' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="font-bold text-xs text-emerald-950">
                      phantom-node.service (systemd) — АКТИВНИЙ
                    </span>
                  </div>
                  <p className="text-[11px] text-emerald-900">
                    Працює як фонова служба на домашньому сервері / Radxa без UI
                  </p>
                </div>

                <button
                  onClick={() => {
                    soundFx.playTap();
                    setIsDaemonRunning(!isDaemonRunning);
                  }}
                  className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-900 text-white rounded-lg text-xs font-bold transition-all shadow-xs"
                >
                  {isDaemonRunning ? 'Перезапустити демон' : 'Запустити демон'}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl space-y-1 shadow-2xs">
                  <span className="text-[10px] text-[#8A9186]">Автономне P2P кешування</span>
                  <p className="font-mono font-bold text-[#21261F]">18 просторів синхронізовано</p>
                </div>

                <div className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl space-y-1 shadow-2xs">
                  <span className="text-[10px] text-[#8A9186]">Cron-завдання ядра</span>
                  <p className="font-mono font-bold text-emerald-700">4 активних бекапи</p>
                </div>

                <div className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl space-y-1 shadow-2xs">
                  <span className="text-[10px] text-[#8A9186]">Використання пам'яті</span>
                  <p className="font-mono font-bold text-[#21261F]">34.2 MB (Zero-leak C/Rust)</p>
                </div>
              </div>

              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl space-y-2 shadow-2xs">
                <h5 className="font-bold text-xs text-[#21261F]">Команда встановлення на Linux / Raspberry Pi</h5>
                <div className="p-2.5 bg-[#FAF8F5] border border-[#E8E1D3] rounded-lg font-mono text-[11px] text-[#21261F] flex justify-between items-center">
                  <span>sudo systemctl enable --now phantom-node.service</span>
                  <button
                    onClick={() => handleCopyClipboard('cmd', 'sudo systemctl enable --now phantom-node.service')}
                    className="p-1 hover:bg-[#EFE9DC] rounded text-[#6E7568]"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Encrypted Universal Clipboard */}
          {activeTab === 'clipboard' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-950 flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-indigo-900">
                  <Clipboard className="w-4 h-4 text-indigo-600" />
                  <span>Наскрізний зашифрований буфер (Noise Protocol / E2EE)</span>
                </div>
                <span className="font-mono text-[10px] bg-indigo-100 text-indigo-900 px-2 py-0.5 rounded font-bold">
                  3 авторизовані пристрої
                </span>
              </div>

              <div className="space-y-2.5">
                {clipboardHistory.map((item) => (
                  <div key={item.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-[#D96C35] bg-[#FDF5ED] px-2 py-0.5 rounded">
                          {item.type}
                        </span>
                        <span className="font-bold text-xs text-[#21261F]">{item.device}</span>
                        <span className="text-[10px] text-[#8A9186]">· {item.timestamp}</span>
                      </div>
                      <p className="font-mono text-[11px] text-[#6E7568]">{item.contentPreview}</p>
                    </div>

                    <button
                      onClick={() => handleCopyClipboard(item.id, item.contentPreview)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        clipboardCopiedId === item.id
                          ? 'bg-emerald-600 text-white'
                          : 'bg-[#FAF8F5] hover:bg-[#EFE9DC] border border-[#E5DEC9] text-[#21261F]'
                      }`}
                    >
                      {clipboardCopiedId === item.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{clipboardCopiedId === item.id ? 'Скопійовано' : 'Вставити'}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: WireGuard Mesh VPN */}
          {activeTab === 'wireguard' && (
            <div className="space-y-4">
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                <div>
                  <h5 className="font-bold text-xs text-[#21261F]">P2P WireGuard Mesh Тунель</h5>
                  <p className="text-[11px] text-[#6E7568]">
                    Прямий безпечний доступ до портів 10.42.0.0/24 без публічних IP та порт-форвардингу
                  </p>
                </div>

                <button
                  onClick={() => {
                    soundFx.playTap();
                    setIsWireguardEnabled(!isWireguardEnabled);
                  }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    isWireguardEnabled ? 'bg-emerald-600 text-white' : 'bg-gray-300 text-gray-700'
                  }`}
                >
                  {isWireguardEnabled ? 'Тунель підключено ✓' : 'Увімкнути тунель'}
                </button>
              </div>

              <div className="space-y-2.5">
                {peers.map((peer) => (
                  <div key={peer.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-[#21261F]">{peer.nodeName}</span>
                        <span className="font-mono text-[10px] text-[#8A9186]">[{peer.ipAddress}]</span>
                      </div>
                      <p className="text-[11px] text-[#6E7568]">Трафік: {peer.transferRxTx}</p>
                    </div>

                    <div className="text-right">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        {peer.status}
                      </span>
                      <span className="block font-mono text-[10px] text-emerald-700 mt-0.5">{peer.latencyMs} ms</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Bare-Metal & Infrastructure Mesh</span>
          <span className="font-mono">Phantom Daemon v3.1</span>
        </div>
      </div>
    </div>
  );
};
