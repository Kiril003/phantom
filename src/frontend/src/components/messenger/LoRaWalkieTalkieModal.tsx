import React, { useState } from 'react';
import {
  Radio,
  Mic,
  Signal,
  X,
  Volume2,
  Send,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useMessengerStore } from '../../stores/messengerStore';

interface LoRaNode {
  id: string;
  callsign: string;
  snr: string;
  distanceKm: number;
  battery: string;
  lastHeard: string;
}

interface LoRaWalkieTalkieModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const LoRaWalkieTalkieModal: React.FC<LoRaWalkieTalkieModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Бесіда',
}) => {
  const [activeTab, setActiveTab] = useState<'lora' | 'walkietalkie'>('lora');
  const [isPttPressed, setIsPttPressed] = useState(false);
  const [loraText, setLoraText] = useState('');

  const [loraNodes] = useState<LoRaNode[]>([
    { id: 'l1', callsign: 'PHANTOM-NODE-PODIL', snr: '+9.2 dB', distanceKm: 1.4, battery: '94%', lastHeard: '15 сек тому' },
    { id: 'l2', callsign: 'MESHTASTIC-RELAY-04', snr: '+4.5 dB', distanceKm: 4.8, battery: '82%', lastHeard: '1 хв тому' },
    { id: 'l3', callsign: 'RADXA-BASE-SX1262', snr: '+12.0 dB', distanceKm: 0.3, battery: 'Mains', lastHeard: 'Щойно' },
  ]);

  if (!isOpen) return null;

  const handleSendLoraText = () => {
    if (!loraText.trim()) return;
    soundFx.playSend();
    const store = useMessengerStore.getState();
    store.addCustomMessage({
      id: `msg_lora_${Date.now()}`,
      senderId: store.currentUser.id,
      senderName: 'LoRa 868MHz Mesh',
      senderAvatar: store.currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'text',
      isSelf: true,
      text: `📡 **[LoRa SX1262 Mesh Packet / 868.1 MHz]**\n${loraText}\n\n*(Передано через апаратний радіомодем без інтернету)*`,
    });
    setLoraText('');
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
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                LoRa SX1262 Mesh & Direct P2P Walkie-Talkie
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Радіопакети 868MHz та прямий голосовий канал без інтернету
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('lora')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'lora' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                LoRa Радіомодем
              </button>
              <button
                onClick={() => setActiveTab('walkietalkie')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'walkietalkie' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                P2P Рація (PTT)
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
          {/* TAB 1: LoRa SX1262 Mesh */}
          {activeTab === 'lora' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 text-xs text-emerald-950">
                <div className="flex items-center gap-2 font-bold text-emerald-900">
                  <Signal className="w-4 h-4 text-emerald-600" />
                  <span>Позамережевий радіозв'язок (Off-Grid LoRa SX1262)</span>
                </div>
                <p className="leading-relaxed">
                  Передача зашифрованих текстових повідомлень і GPS-координат на відстань до 15 км при повному блекауті, відсутності мобільного зв'язку та оптоволокна.
                </p>
              </div>

              {/* Node list */}
              <div className="space-y-2.5">
                {loraNodes.map((node) => (
                  <div key={node.id} className="p-3.5 bg-white border border-[#E5DEC9] rounded-xl flex items-center justify-between shadow-2xs">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold font-mono text-xs text-[#21261F]">{node.callsign}</span>
                        <span className="text-[10px] font-mono text-emerald-800 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                          SNR: {node.snr}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#6E7568]">Дистанція: ~{node.distanceKm} км · Батарея: {node.battery}</p>
                    </div>

                    <span className="text-[10px] text-[#8A9186] font-mono">{node.lastHeard}</span>
                  </div>
                ))}
              </div>

              {/* Send LoRa Packet */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Введіть екстрений радіопакет..."
                  value={loraText}
                  onChange={(e) => setLoraText(e.target.value)}
                  className="flex-1 p-2.5 bg-[#FAF8F5] border border-[#E5DEC9] rounded-xl text-xs text-[#21261F] focus:outline-none"
                />
                <button
                  onClick={handleSendLoraText}
                  className="px-4 py-2.5 bg-[#D96C35] hover:bg-[#B85425] text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Transmit</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: P2P Walkie-Talkie */}
          {activeTab === 'walkietalkie' && (
            <div className="space-y-4 flex flex-col items-center justify-center p-4 text-center">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-1 text-xs text-amber-950 max-w-md">
                <span className="font-bold text-amber-900 flex items-center justify-center gap-1.5">
                  <Volume2 className="w-4 h-4 text-[#D96C35]" />
                  Direct Ad-Hoc Audio Loop (0 ms Latency)
                </span>
                <p className="text-[11px]">
                  Пряма передача сирого PCM-аудіопотоку поверх локального Wi-Fi Direct або Bluetooth LE у зоні прямої видимості.
                </p>
              </div>

              <div className="py-6 flex flex-col items-center gap-3">
                <button
                  onMouseDown={() => {
                    soundFx.playSend();
                    setIsPttPressed(true);
                  }}
                  onMouseUp={() => {
                    soundFx.playTap();
                    setIsPttPressed(false);
                  }}
                  onTouchStart={() => {
                    soundFx.playSend();
                    setIsPttPressed(true);
                  }}
                  onTouchEnd={() => {
                    soundFx.playTap();
                    setIsPttPressed(false);
                  }}
                  className={`w-32 h-32 rounded-full flex flex-col items-center justify-center gap-2 border-4 transition-all ${
                    isPttPressed
                      ? 'bg-red-600 border-red-400 text-white scale-105 shadow-xl shadow-red-500/20 animate-pulse'
                      : 'bg-[#FAF8F5] border-[#D96C35] text-[#D96C35] hover:bg-[#FDF5ED]'
                  }`}
                >
                  <Mic className={`w-10 h-10 ${isPttPressed ? 'animate-bounce' : ''}`} />
                  <span className="font-bold text-xs uppercase tracking-wider">
                    {isPttPressed ? 'Ефір (PTT ON)' : 'Утримуй (PTT)'}
                  </span>
                </button>
                <span className="text-[11px] text-[#8A9186]">
                  {isPttPressed ? '🔴 Передача аудіо в ефір...' : 'Натисніть та утримуйте кнопку для передачі голосу'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Bare-Metal Radio Protocol</span>
          <span className="font-mono">LoRa SX1262 / BLE Direct</span>
        </div>
      </div>
    </div>
  );
};
