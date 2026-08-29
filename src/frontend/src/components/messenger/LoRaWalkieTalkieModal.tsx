import React, { useState } from 'react';
import {
  Radio,
  Mic,
  Signal,
  X,
  Send,
  Activity,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useMessengerStore } from '../../stores/messengerStore';
import { useMeshStore } from '../../stores/meshStore';

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

  const { loraTelemetry, broadcastLoraPacket, nodes } = useMeshStore();

  if (!isOpen) return null;

  const handleSendLoraText = () => {
    if (!loraText.trim()) return;
    soundFx.playSend();
    const packet = broadcastLoraPacket(loraText.trim());

    const store = useMessengerStore.getState();
    store.addCustomMessage({
      id: `msg_lora_${packet.id}`,
      senderId: store.currentUser.id,
      senderName: 'LoRa 868MHz Mesh',
      senderAvatar: store.currentUser.avatar,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      type: 'text',
      isSelf: true,
      text: `📡 **[LoRa SX1262 Mesh Packet / 868.1 MHz]**\n${loraText}\n\n*(SNR: +9.2 dB | RSSI: -74 dBm | Без інтернету)*`,
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
                PTT Walkie-Talkie
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
          {/* Telemetry Strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl">
              <span className="text-[10px] text-[#8A8577] uppercase font-bold">Частота</span>
              <div className="text-sm font-bold text-[#21261F] mt-0.5">{loraTelemetry.frequencyMhz} MHz</div>
            </div>
            <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl">
              <span className="text-[10px] text-[#8A8577] uppercase font-bold">SNR / Сигнал</span>
              <div className="text-sm font-bold text-emerald-700 mt-0.5">{loraTelemetry.snrDb} dB ({loraTelemetry.rssiDbm} dBm)</div>
            </div>
            <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl">
              <span className="text-[10px] text-[#8A8577] uppercase font-bold">Пакетів надіслано</span>
              <div className="text-sm font-bold text-[#21261F] mt-0.5">{loraTelemetry.packetsSent}</div>
            </div>
            <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl">
              <span className="text-[10px] text-[#8A8577] uppercase font-bold">Активні радіовузли</span>
              <div className="text-sm font-bold text-[#D96C35] mt-0.5">{nodes.length} в радіусі дії</div>
            </div>
          </div>

          {activeTab === 'lora' ? (
            <div className="space-y-4">
              <div className="p-4 bg-white border border-[#E8E1D3] rounded-xl space-y-3">
                <h4 className="font-bold text-xs text-[#21261F] flex items-center gap-1.5">
                  <Signal className="w-4 h-4 text-[#D96C35]" /> Надіслати LoRa-повідомлення в ефір
                </h4>
                <textarea
                  value={loraText}
                  onChange={(e) => setLoraText(e.target.value)}
                  placeholder="Введіть текст для широкомовної радіопередачі (без інтернету)..."
                  rows={3}
                  className="w-full p-3 border border-[#E8E1D3] rounded-lg text-xs outline-none focus:border-[#D96C35] resize-none"
                />
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-[#8A8577]">Макс. 240 байт / пакет · SF7 / BW 125kHz</span>
                  <button
                    onClick={handleSendLoraText}
                    disabled={!loraText.trim()}
                    className="px-4 py-1.5 bg-[#D96C35] text-white font-bold text-xs rounded-lg hover:bg-[#C25B27] disabled:opacity-50 transition-all flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" /> В ефір
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-8 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl text-center space-y-4">
              <button
                onMouseDown={() => {
                  soundFx.playTap();
                  setIsPttPressed(true);
                }}
                onMouseUp={() => setIsPttPressed(false)}
                onTouchStart={() => {
                  soundFx.playTap();
                  setIsPttPressed(true);
                }}
                onTouchEnd={() => setIsPttPressed(false)}
                className={`w-28 h-28 rounded-full border-4 flex flex-col items-center justify-center transition-all ${
                  isPttPressed
                    ? 'bg-red-500 border-red-300 text-white scale-95 shadow-lg animate-pulse'
                    : 'bg-[#D96C35] border-[#FDF5ED] text-white hover:scale-105 shadow-md'
                }`}
              >
                <Mic className="w-8 h-8" />
                <span className="text-[11px] font-bold mt-1">{isPttPressed ? 'ЕФІР...' : 'ТРИМАЙТЕ (PTT)'}</span>
              </button>
              <p className="text-xs text-[#6E7568] max-w-sm">
                Пряма передача голосових семплів через WebRTC DataChannel (Opus Codec 16kbps) без центрального сервера
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-xs text-[#6E7568]">
          <div className="flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-emerald-600" />
            <span>Апаратний міст SX1262 активний @ GPIO PIN 19/21</span>
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
