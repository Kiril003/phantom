import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Cpu,
  Radio,
  MapPin,
  Palette,
  ShieldCheck,
  Terminal,
  CheckCircle2,
  Share2,
  Volume2,
  Clock,
  Sparkles,
  Award,
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

interface PhysicalComputingGisCanvasModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

type TabType = 'hardware' | 'gis' | 'webgpu' | 'credentials';

export const PhysicalComputingGisCanvasModal: React.FC<PhysicalComputingGisCanvasModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Інженерний Простір',
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('hardware');

  // --- TAB 1: HARDWARE, ACOUSTICS & SDR ---
  const [uartBaud, setUartBaud] = useState('115200');
  const [uartPortConnected, setUartPortConnected] = useState(false);
  const [uartLogs, setUartLogs] = useState<string[]>([
    '[BOOT] ESP32-S3 ROM Core init @ 240MHz',
    '[UART] WebSerial /dev/ttyUSB0 linked (115200 8N1)',
    '[I2C] Scanning bus 0x00..0x7F... Found BMP280 @ 0x76, MPU6050 @ 0x68',
    '[SPI] LoRa SX1262 initialized on SPI0 @ 8MHz. Frequency: 868.100 MHz',
    '[ADC] Logic Analyzer 8-ch buffer ready: sampling @ 12MS/s',
  ]);
  const [uartInput, setUartInput] = useState('');
  const isAnalyzingAcoustics = true;
  const [noiseLevelDb, setNoiseLevelDb] = useState(42);
  const [acousticClassification, setAcousticClassification] = useState('Фоновий шум офісу (Норма)');
  const sdrFreq = '868.100';
  const sdrGain = 38;

  // --- TAB 2: OFFLINE GIS & TACTICAL TOPOGRAPHY ---
  const [tacticalFieldMode, setTacticalFieldMode] = useState(true);
  const [selectedGeoTag, setSelectedGeoTag] = useState<string | null>('point_1');
  const geoPoints = [
    {
      id: 'point_1',
      title: 'Вузол Звʼязку #1 (Radxa Master)',
      coords: '50.4501° N, 30.5234° E',
      type: 'base_station',
      rssi: '-68 dBm',
      status: 'online',
    },
    {
      id: 'point_2',
      title: 'Польовий пір #4 (Саня / LoRa Handheld)',
      coords: '50.4538° N, 30.5180° E',
      type: 'peer',
      rssi: '-82 dBm',
      status: 'moving',
    },
    {
      id: 'point_3',
      title: 'Датчик Телеметрії #12 (Екологія/Шум)',
      coords: '50.4480° N, 30.5290° E',
      type: 'sensor',
      rssi: '-74 dBm',
      status: 'active',
    },
  ];
  const [transitRouteSteps] = useState([
    { step: 1, title: 'Пішохідна ділянка: 420м на північ до ст. метро', duration: '5 хв' },
    { step: 2, title: 'Метро (Святошинсько-Броварська лінія, RAPTOR id: M1)', duration: '8 хв' },
    { step: 3, title: 'Фінальний піший дохід до ретранслятора: 180м', duration: '2 хв' },
  ]);

  // --- TAB 3: WEBGPU, SHADERS & TYPOGRAPHY ---
  const [shaderPreset, setShaderPreset] = useState<'cyberpunk' | 'raymarch' | 'particles'>('cyberpunk');
  const [wgslCode, setWgslCode] = useState(`// WGSL Real-Time Shader Canvas
@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    let t = time * 0.8;
    let grid = abs(sin(uv.x * 32.0 + t) * cos(uv.y * 32.0 + t));
    let glow = 0.04 / (length(uv - vec2f(0.5, 0.5)) + 0.08);
    let col = vec3f(0.85, 0.42, 0.21) * glow + vec3f(0.1, 0.15, 0.12) * grid;
    return vec4f(col, 1.0);
}`);
  const fpsCounter = 60;
  const [fontWeight, setFontWeight] = useState(600);
  const [fontWidth, setFontWidth] = useState(100);
  const [fontSlant, setFontSlant] = useState(0);

  // --- TAB 4: DEAD MAN'S SWITCH & CREDENTIALS ---
  const [deadManDaysLeft, setDeadManDaysLeft] = useState(174);
  const deadManIntervalDays = 180;
  const credentialsList = [
    {
      id: 'cred-1',
      title: 'Диплом Магістра Компʼютерної Інженерії',
      issuer: 'Київський Політехнічний Інститут',
      issuerKey: 'did:phantom:node_kpi_secp256k1_94b1a',
      recipient: 'Кирило (ID #003)',
      issuedAt: '30 Червня 2026',
      verified: true,
      hash: 'sha256:4a8b...1f09',
    },
    {
      id: 'cred-2',
      title: 'Сертифікат Спеціаліста з Розподілених Mesh Мереж',
      issuer: 'Phantom Security Alliance',
      issuerKey: 'did:phantom:node_psa_ed25519_c82fa',
      recipient: 'Кирило (ID #003)',
      issuedAt: '15 Серпня 2026',
      verified: true,
      hash: 'sha256:99f2...e13c',
    },
  ];

  // Logic Analyzer Canvas simulation
  const logicCanvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (activeTab !== 'hardware') return;
    const canvas = logicCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let offset = 0;

    const render = () => {
      ctx.fillStyle = '#141815';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const channels = [
        { name: 'CH0 (UART TX)', color: '#D96C35', freq: 4 },
        { name: 'CH1 (UART RX)', color: '#52C41A', freq: 6 },
        { name: 'CH2 (I2C SCL)', color: '#1890FF', freq: 8 },
        { name: 'CH3 (I2C SDA)', color: '#FAAD14', freq: 3 },
      ];

      channels.forEach((ch, idx) => {
        const yBase = 22 + idx * 34;
        ctx.fillStyle = '#8A9186';
        ctx.font = '10px monospace';
        ctx.fillText(ch.name, 10, yBase - 4);

        ctx.strokeStyle = ch.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        for (let x = 90; x < canvas.width; x++) {
          const bit = Math.floor((x + offset) / (30 / (ch.freq / 4))) % 2;
          const y = bit ? yBase - 12 : yBase;
          if (x === 90) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });

      offset += 1.5;
      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [activeTab]);

  // Acoustic noise simulation
  useEffect(() => {
    if (!isAnalyzingAcoustics) return;
    const timer = setInterval(() => {
      setNoiseLevelDb((prev) => {
        const delta = (Math.random() - 0.48) * 4;
        const next = Math.max(32, Math.min(78, Math.round(prev + delta)));
        if (next > 65) setAcousticClassification('Підвищений шум (Розмови поруч)');
        else if (next > 50) setAcousticClassification('Робочий шум середовища');
        else setAcousticClassification('Тиха робоча атмосфера');
        return next;
      });
    }, 1500);
    return () => clearInterval(timer);
  }, [isAnalyzingAcoustics]);

  // Handle UART Send
  const handleSendUart = () => {
    if (!uartInput.trim()) return;
    soundFx.playSend();
    setUartLogs((prev) => [...prev, `> ${uartInput}`, `[ACK] Executed: ${uartInput} (0ms)`]);
    setUartInput('');
  };

  // Heartbeat checkin for Dead Man's Switch
  const handleDeadManCheckin = () => {
    soundFx.playChime();
    setDeadManDaysLeft(deadManIntervalDays);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/65 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[92vh] bg-[#FDFCF9] border border-[#E5DEC9] rounded-2xl shadow-2xl overflow-hidden flex flex-col text-[#21261F] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#FAF7F0] border-b border-[#E5DEC9] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FDF5ED] border border-[#E8D9C5] flex items-center justify-center text-[#D96C35] shadow-xs">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[#21261F]">
                  Hardware, Offline GIS, WebGPU & W3C Credentials
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-[#EFE9DC] text-[#6E7568] text-[10.5px] font-bold">
                  {chatTitle}
                </span>
              </div>
              <p className="text-xs text-[#6E7568]">
                WebSerial/SDR, офлайн OpenStreetMap, WGSL Shader Canvas, Dead Man's Switch та цифрові дипломи
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[#EFE9DC] rounded-lg text-[#6E7568] hover:text-[#21261F] transition-colors"
            title="Закрити"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-5 pt-2 bg-[#FAF7F0] border-b border-[#E5DEC9] flex items-center gap-2 overflow-x-auto shrink-0">
          {[
            { id: 'hardware', label: '1. WebSerial, DSP & SDR', icon: Cpu },
            { id: 'gis', label: '2. Offline GIS & Топографія', icon: MapPin },
            { id: 'webgpu', label: '3. WebGPU & WGSL Шейдери', icon: Palette },
            { id: 'credentials', label: '4. Dead Man & Дипломи', icon: Award },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  soundFx.playTap();
                  setActiveTab(tab.id as TabType);
                }}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-t-xl text-xs font-bold transition-all border-t border-x ${
                  isActive
                    ? 'bg-[#FDFCF9] text-[#D96C35] border-[#E5DEC9] shadow-xs'
                    : 'bg-transparent text-[#6E7568] hover:text-[#21261F] border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content Body */}
        <div className="flex-1 min-h-0 p-5 bg-[#FAF7F0] overflow-y-auto custom-scrollbar">
          {/* TAB 1: HARDWARE & SDR */}
          {activeTab === 'hardware' && (
            <div className="space-y-6">
              {/* Local Hardware Dashboard (WebSerial) */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl shadow-xs">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-[#D96C35]" />
                    <h4 className="text-sm font-bold text-[#21261F]">
                      WebSerial / WebHID Апаратний Термінал (UART / I2C / SPI / JTAG)
                    </h4>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={uartBaud}
                      onChange={(e) => setUartBaud(e.target.value)}
                      className="px-2 py-1 bg-[#FAF7F0] border border-[#E5DEC9] rounded-lg text-xs font-mono text-[#21261F] focus:outline-none"
                    >
                      <option value="9600">9600 baud</option>
                      <option value="115200">115200 baud</option>
                      <option value="921600">921600 baud</option>
                    </select>

                    <button
                      onClick={() => {
                        soundFx.playTap();
                        setUartPortConnected(!uartPortConnected);
                      }}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition-all shadow-xs ${
                        uartPortConnected
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'bg-[#D96C35] hover:bg-[#B85425] text-white'
                      }`}
                    >
                      {uartPortConnected ? '● Порт Підключено' : 'Підключити плату'}
                    </button>
                  </div>
                </div>

                {/* 4-Channel Logic Analyzer Waveform Canvas */}
                <div className="mb-3">
                  <div className="text-[11px] font-bold text-[#6E7568] mb-1 flex items-center justify-between">
                    <span>Логічний Аналізатор (Реальний час, 12 MS/s)</span>
                    <span className="font-mono text-emerald-700">● LIVE TRIGGER</span>
                  </div>
                  <canvas
                    ref={logicCanvasRef}
                    width={700}
                    height={150}
                    className="w-full h-36 bg-[#141815] rounded-xl border border-[#2B332C]"
                  />
                </div>

                {/* Serial Terminal Log */}
                <div className="h-32 p-3 bg-[#181B19] text-emerald-400 font-mono text-xs rounded-xl overflow-y-auto border border-[#2B332C] space-y-0.5 custom-scrollbar">
                  {uartLogs.map((log, i) => (
                    <div key={i} className="leading-relaxed">{log}</div>
                  ))}
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={uartInput}
                    onChange={(e) => setUartInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendUart()}
                    placeholder="Введіть команду (напр: esp_flash, i2c_scan, lora_send)..."
                    className="flex-1 px-3 py-1.5 bg-[#FAF7F0] border border-[#E5DEC9] rounded-xl text-xs font-mono focus:outline-none focus:border-[#D96C35]"
                  />
                  <button
                    onClick={handleSendUart}
                    className="px-4 py-1.5 bg-[#D96C35] hover:bg-[#B85425] text-white text-xs font-bold rounded-xl shadow-xs transition-all"
                  >
                    Відправити
                  </button>
                </div>
              </div>

              {/* Acoustic DSP & SDR Waterfall */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Acoustic Monitor */}
                <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl shadow-xs">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Volume2 className="w-4 h-4 text-indigo-600" />
                      <h4 className="text-sm font-bold text-[#21261F]">Acoustic & DSP Edge</h4>
                    </div>
                    <span className="font-mono font-bold text-xs text-[#D96C35]">{noiseLevelDb} dB SPL</span>
                  </div>
                  <p className="text-xs text-[#6E7568] mb-3">
                    Локальний DSP-аналіз шуму та виявлення акустичних аномалій без хмари.
                  </p>

                  <div className="w-full bg-[#E5DEC9] h-2 rounded-full overflow-hidden mb-2">
                    <div
                      className={`h-full transition-all duration-300 ${
                        noiseLevelDb > 65 ? 'bg-red-500' : noiseLevelDb > 50 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${(noiseLevelDb / 100) * 100}%` }}
                    />
                  </div>

                  <div className="p-2.5 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl text-xs flex items-center justify-between">
                    <span className="text-[#6E7568]">Класифікація:</span>
                    <span className="font-bold text-[#21261F]">{acousticClassification}</span>
                  </div>
                </div>

                {/* SDR Receiver Waterfall */}
                <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl shadow-xs">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Radio className="w-4 h-4 text-emerald-600" />
                      <h4 className="text-sm font-bold text-[#21261F]">SDR Спектрограма (Waterfall)</h4>
                    </div>
                    <span className="font-mono text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      {sdrFreq} MHz
                    </span>
                  </div>
                  <p className="text-xs text-[#6E7568] mb-3">
                    Прийом телеметрії RTL-SDR / HackRF та аналіз радіоспектра.
                  </p>

                  {/* Waterfall visualizer */}
                  <div className="h-20 w-full bg-gradient-to-b from-blue-900 via-emerald-800 to-amber-900 rounded-xl flex items-center justify-center text-white font-mono text-[11px] border border-blue-950/40">
                    <span>Спектр: 868.0..868.8 MHz (LoRa Mesh Band, Gain: {sdrGain}dB)</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: OFFLINE GIS */}
          {activeTab === 'gis' && (
            <div className="space-y-6">
              {/* Map & Tactical Field View */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl shadow-xs">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-red-500" />
                    <h4 className="text-sm font-bold text-[#21261F]">
                      Векторний Офлайн-картографічний Рушій (OpenStreetMap / MapLibre)
                    </h4>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-bold text-[#21261F] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tacticalFieldMode}
                      onChange={(e) => {
                        soundFx.playTap();
                        setTacticalFieldMode(e.target.checked);
                      }}
                      className="w-4 h-4 accent-[#D96C35] rounded"
                    />
                    <span>Польовий тактичний вигляд (Tactical Field Mode)</span>
                  </label>
                </div>

                {/* Simulated Map Canvas */}
                <div className="relative w-full h-72 bg-[#E9E4D4] rounded-2xl overflow-hidden border border-[#D9D1BD] flex items-center justify-center select-none shadow-inner">
                  {/* Topographic Lines & Roads simulation */}
                  <div className="absolute inset-0 bg-[radial-gradient(#C8BFAB_1.5px,transparent_1.5px)] [background-size:32px_32px] opacity-70" />
                  <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-40">
                    <path d="M 50 80 Q 200 140 450 100 T 800 200" fill="none" stroke="#B0A48E" strokeWidth="4" />
                    <path d="M 120 280 Q 300 200 520 240 T 780 90" fill="none" stroke="#D96C35" strokeWidth="2.5" strokeDasharray="6 4" />
                  </svg>

                  {/* Geo Markers */}
                  {geoPoints.map((pt, idx) => {
                    const isSelected = selectedGeoTag === pt.id;
                    const positions = [
                      { top: '35%', left: '30%' },
                      { top: '55%', left: '60%' },
                      { top: '70%', left: '42%' },
                    ];
                    const pos = positions[idx % positions.length];
                    return (
                      <div
                        key={pt.id}
                        onClick={() => {
                          soundFx.playTap();
                          setSelectedGeoTag(pt.id);
                        }}
                        style={{ top: pos.top, left: pos.left }}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer group z-10 transition-transform ${
                          isSelected ? 'scale-110' : 'hover:scale-105'
                        }`}
                      >
                        <div
                          className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold shadow-lg border-2 border-white ${
                            pt.type === 'base_station'
                              ? 'bg-[#D96C35]'
                              : pt.type === 'peer'
                              ? 'bg-emerald-600'
                              : 'bg-indigo-600'
                          }`}
                        >
                          <MapPin className="w-5 h-5" />
                        </div>
                        <div className="mt-1 px-2 py-0.5 bg-black/80 backdrop-blur-xs text-[10px] font-bold text-white rounded-md whitespace-nowrap shadow-md">
                          {pt.title} ({pt.rssi})
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Point details and RAPTOR Routing */}
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl text-xs">
                    <div className="font-bold text-[#21261F] mb-1">Обрана гео-точка (GeoJSON):</div>
                    {selectedGeoTag ? (
                      (() => {
                        const pt = geoPoints.find((p) => p.id === selectedGeoTag);
                        return (
                          <div className="space-y-1 text-[11.5px] text-[#6E7568]">
                            <div><strong>Назва:</strong> {pt?.title}</div>
                            <div><strong>Координати:</strong> <span className="font-mono text-[#21261F]">{pt?.coords}</span></div>
                            <div><strong>Сигнал LoRa:</strong> <span className="text-emerald-700 font-bold">{pt?.rssi}</span></div>
                          </div>
                        );
                      })()
                    ) : (
                      <span className="text-gray-400">Оберіть мітку на мапі</span>
                    )}
                  </div>

                  <div className="p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl text-xs">
                    <div className="font-bold text-[#21261F] mb-1">Офлайн Маршрутизатор (RAPTOR Algorithm):</div>
                    <div className="space-y-1.5">
                      {transitRouteSteps.map((s) => (
                        <div key={s.step} className="flex items-center justify-between text-[11px]">
                          <span className="text-[#21261F]">{s.step}. {s.title}</span>
                          <span className="font-bold text-[#D96C35] shrink-0">{s.duration}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: WEBGPU & SHADERS */}
          {activeTab === 'webgpu' && (
            <div className="space-y-6">
              {/* WebGPU 60fps Canvas & Shader Playground */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl shadow-xs">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Palette className="w-4 h-4 text-[#D96C35]" />
                    <h4 className="text-sm font-bold text-[#21261F]">
                      WebGPU 2D/3D Rendering Engine & WGSL Playgrounds
                    </h4>
                  </div>
                  <span className="px-2.5 py-0.5 bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-bold rounded-lg font-mono">
                    ⚡ {fpsCounter} FPS (Hardware Accelerated)
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-bold text-[#6E7568]">WGSL / GLSL Код Шейдера:</label>
                      <div className="flex items-center gap-1">
                        {(['cyberpunk', 'raymarch', 'particles'] as const).map((p) => (
                          <button
                            key={p}
                            onClick={() => {
                              soundFx.playTap();
                              setShaderPreset(p);
                            }}
                            className={`px-2 py-0.5 rounded text-[10.5px] font-semibold ${
                              shaderPreset === p
                                ? 'bg-[#D96C35] text-white'
                                : 'bg-[#FAF7F0] text-[#6E7568] hover:text-[#21261F]'
                            }`}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                    <textarea
                      value={wgslCode}
                      onChange={(e) => setWgslCode(e.target.value)}
                      rows={7}
                      className="w-full p-2.5 bg-[#1C211D] text-amber-300 font-mono text-xs rounded-xl focus:outline-none resize-none leading-relaxed"
                    />
                  </div>

                  {/* Render Output Canvas */}
                  <div>
                    <label className="text-[11px] font-bold text-[#6E7568] block mb-1.5">
                      WebGPU Живий Рендер Превʼю:
                    </label>
                    <div className="h-[162px] w-full bg-[#121513] rounded-xl overflow-hidden border border-[#2B332C] relative flex items-center justify-center">
                      <div className="absolute inset-0 bg-radial from-[#D96C35]/30 via-emerald-900/20 to-transparent animate-pulse" />
                      <div className="relative text-center p-3">
                        <Sparkles className="w-8 h-8 text-[#D96C35] mx-auto mb-1 animate-spin duration-3000" />
                        <div className="text-xs font-mono text-white font-bold">WGSL Shader Output Live</div>
                        <div className="text-[10.5px] text-[#8A9186]">Compute Pass @ 60.0 FPS</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Typography & Variable Fonts Inspector */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-[#21261F]">
                    Шрифтовий та Типографічний Мікро-Інспектор (Variable Fonts)
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                  <div>
                    <div className="flex justify-between text-xs text-[#6E7568] mb-1">
                      <span>Вага (wght):</span>
                      <span className="font-mono font-bold text-[#21261F]">{fontWeight}</span>
                    </div>
                    <input
                      type="range"
                      min={100}
                      max={900}
                      step={50}
                      value={fontWeight}
                      onChange={(e) => setFontWeight(Number(e.target.value))}
                      className="w-full accent-[#D96C35]"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-[#6E7568] mb-1">
                      <span>Ширина (wdth):</span>
                      <span className="font-mono font-bold text-[#21261F]">{fontWidth}%</span>
                    </div>
                    <input
                      type="range"
                      min={75}
                      max={125}
                      value={fontWidth}
                      onChange={(e) => setFontWidth(Number(e.target.value))}
                      className="w-full accent-[#D96C35]"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-[#6E7568] mb-1">
                      <span>Нахил (slnt):</span>
                      <span className="font-mono font-bold text-[#21261F]">{fontSlant}°</span>
                    </div>
                    <input
                      type="range"
                      min={-10}
                      max={0}
                      value={fontSlant}
                      onChange={(e) => setFontSlant(Number(e.target.value))}
                      className="w-full accent-[#D96C35]"
                    />
                  </div>
                </div>

                <div
                  style={{
                    fontWeight: fontWeight,
                    fontStyle: fontSlant < 0 ? 'italic' : 'normal',
                  }}
                  className="p-4 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl text-center text-lg sm:text-xl text-[#21261F] select-all"
                >
                  Суверенний цифровій симбіоз Phantom OS — 2026
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: DEAD MAN & CREDENTIALS */}
          {activeTab === 'credentials' && (
            <div className="space-y-6">
              {/* Dead Man's Switch */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl shadow-xs">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-red-500" />
                    <h4 className="text-sm font-bold text-[#21261F]">
                      Dead Man's Switch (Криптографічний Протокол Успадкування)
                    </h4>
                  </div>
                  <span className="px-2.5 py-0.5 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg font-mono">
                    Залишилось: {deadManDaysLeft} днів
                  </span>
                </div>
                <p className="text-xs text-[#6E7568] mb-4">
                  Якщо вузол не отримує підтвердження життєдіяльності протягом {deadManIntervalDays} днів, зашифровані ключі відновлення через частки Шаміра стануть доступними довіреним контактам.
                </p>

                <div className="flex items-center justify-between p-3 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl flex-wrap gap-3">
                  <div className="text-xs text-[#21261F]">
                    <div>Останній Heartbeat: <strong>Сьогодні, 00:15</strong></div>
                    <div className="text-[11px] text-[#6E7568]">Довірені спадкоємці: <strong>3 з 5 довірених вузлів</strong></div>
                  </div>

                  <button
                    onClick={handleDeadManCheckin}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Підтвердити активність (Heartbeat Check-In)</span>
                  </button>
                </div>
              </div>

              {/* Verifiable Credentials (W3C Digital Degrees) */}
              <div className="p-4 bg-white border border-[#E5DEC9] rounded-2xl shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Award className="w-4 h-4 text-[#D96C35]" />
                    <h4 className="text-sm font-bold text-[#21261F]">
                      W3C Verifiable Credentials (Криптографічні Цифрові Сертифікати)
                    </h4>
                  </div>
                  <span className="text-xs text-[#6E7568]">Підписано Ed25519 ключем установи</span>
                </div>

                <div className="space-y-3">
                  {credentialsList.map((cred) => (
                    <div
                      key={cred.id}
                      className="p-3.5 bg-[#FAF8F5] border border-[#E8E1D3] rounded-xl flex flex-wrap items-start justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <h5 className="font-bold text-[#21261F] text-sm">{cred.title}</h5>
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10.5px] font-bold rounded-full flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-emerald-600" />
                            <span>Підпис Валідний</span>
                          </span>
                        </div>
                        <div className="text-[11px] text-[#6E7568] mt-1 space-y-0.5">
                          <div>Видавець: <strong>{cred.issuer}</strong> ({cred.issuerKey})</div>
                          <div>Отримувач: <strong>{cred.recipient}</strong> • Дата: {cred.issuedAt}</div>
                          <div className="font-mono text-[10px] text-gray-500">Крипто-хеш: {cred.hash}</div>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          soundFx.playChime();
                        }}
                        className="px-3 py-1.5 bg-white hover:bg-[#FDF5ED] border border-[#E5DEC9] text-[#21261F] font-bold text-xs rounded-lg transition-all shadow-2xs shrink-0 flex items-center gap-1.5"
                      >
                        <Share2 className="w-3 h-3 text-[#D96C35]" />
                        <span>Експорт QR</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
