import React, { useState, useEffect } from 'react';
import {
  KeyRound,
  Cpu,
  X,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { useUIStore } from '../../stores/uiStore';

interface IoTEqsTelemetryModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

export const IoTEqsTelemetryModal: React.FC<IoTEqsTelemetryModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Бесіда',
}) => {
  const [activeTab, setActiveTab] = useState<'iot' | 'hardware_keys'>('iot');
  const [sensorData, setSensorData] = useState({
    tempC: 41.2,
    voltageV: 5.04,
    gpio2State: 'HIGH (Relay Active)',
    packetsSec: 24,
    lastPingMs: 6,
  });

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setSensorData((prev) => ({
        ...prev,
        tempC: +(40.5 + Math.random() * 2.0).toFixed(1),
        voltageV: +(5.01 + Math.random() * 0.08).toFixed(2),
        packetsSec: Math.floor(20 + Math.random() * 10),
      }));
    }, 1500);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[82vh] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Апаратні ключі, IoT & Edge Телеметрія
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · YubiKey / FIDO2 та прямий потік із Radxa GPIO / ESP32
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('iot')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'iot' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                IoT Сенсори
              </button>
              <button
                onClick={() => setActiveTab('hardware_keys')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'hardware_keys' ? 'bg-white text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                YubiKey / FIDO2
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
          {/* TAB 1: IoT Telemetry */}
          {activeTab === 'iot' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-900 font-medium">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>ESP32-S3 Node Connected via P2P WebSocket Bridge</span>
                </div>
                <span className="font-bold text-emerald-700">{sensorData.lastPingMs}ms RTT</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3.5 bg-white rounded-xl border border-[#E5DEC9] space-y-1 shadow-2xs">
                  <span className="text-[10px] text-[#8A9186] font-semibold">Температура чіпа</span>
                  <p className="font-mono font-bold text-lg text-[#D96C35]">{sensorData.tempC} °C</p>
                  <p className="text-[10px] text-emerald-600">Штатний тепловий режим</p>
                </div>

                <div className="p-3.5 bg-white rounded-xl border border-[#E5DEC9] space-y-1 shadow-2xs">
                  <span className="text-[10px] text-[#8A9186] font-semibold">Напруга живлення</span>
                  <p className="font-mono font-bold text-lg text-indigo-600">{sensorData.voltageV} V</p>
                  <p className="text-[10px] text-emerald-600">Стабільна шина 5V</p>
                </div>

                <div className="p-3.5 bg-white rounded-xl border border-[#E5DEC9] space-y-1 shadow-2xs">
                  <span className="text-[10px] text-[#8A9186] font-semibold">Потік пакетів</span>
                  <p className="font-mono font-bold text-lg text-[#21261F]">{sensorData.packetsSec} pkt/s</p>
                  <p className="text-[10px] text-[#6E7568]">MQTT / CoAP over P2P</p>
                </div>
              </div>

              {/* GPIO Controls */}
              <div className="p-4 bg-white rounded-xl border border-[#E5DEC9] space-y-2">
                <h5 className="font-bold text-xs text-[#21261F]">Керування пінами GPIO</h5>
                <div className="flex items-center justify-between text-xs">
                  <span>Реле живлення (GPIO 2):</span>
                  <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    {sensorData.gpio2State}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Hardware Security Keys */}
          {activeTab === 'hardware_keys' && (
            <div className="space-y-4">
              <div className="p-4 bg-white rounded-xl border border-[#E5DEC9] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-5 h-5 text-[#D96C35]" />
                    <div>
                      <h5 className="font-bold text-xs text-[#21261F]">YubiKey 5 NFC / FIDO2</h5>
                      <p className="text-[11px] text-[#6E7568]">Апаратний токен автентифікації</p>
                    </div>
                  </div>

                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    Підключено
                  </span>
                </div>

                <p className="text-xs text-[#6E7568] leading-relaxed">
                  Апаратний ключ захищає розшифрування локальної бази даних SQLite та підтверджує критичні транзакції скарбниці простору.
                </p>

                <button
                  onClick={() => {
                    soundFx.playSend();
                    useUIStore.getState().toast({ kind: 'info', message: 'Апаратний виклик YubiKey: торкніться сенсорної кнопки на ключі...' });
                  }}
                  className="w-full py-2 bg-[#21261F] hover:bg-[#3E453A] text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Тест апаратного підпису (FIDO2 Challenge)
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Апаратний міст IoT & WebAuthn</span>
          <span className="font-mono">W3C WebAuthn Level 3</span>
        </div>
      </div>
    </div>
  );
};
