import React, { useState } from 'react';
import {
  X,
  Bell,
  Shield,
  Palette,
  Download,
  Trash2,
  Check,
  Radio,
  Lock,
  Globe,
  Zap,
  KeyRound
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { networkEngine } from '../../services/messengerNetworkEngine';
import { TransportProtocol } from '../../types/messenger';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isSoundEnabled: boolean;
  onToggleSound: () => void;
  onExportAllData: () => void;
  onClearHistory?: () => void;
  onOpenP2PNetworkModal?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  isSoundEnabled,
  onToggleSound,
  onExportAllData,
  onClearHistory,
  onOpenP2PNetworkModal,
}) => {
  const [activeTab, setActiveTab] = useState<'appearance' | 'network' | 'notifications' | 'privacy' | 'data'>('appearance');
  const [accentColor, setAccentColor] = useState<'terracotta' | 'sage' | 'chestnut' | 'amber'>('terracotta');
  const [fontSize, setFontSize] = useState<'standard' | 'large'>('standard');
  const [desktopNotifs, setDesktopNotifs] = useState(true);
  const [readReceipts, setReadReceipts] = useState(true);
  const [lastSeenVisible, setLastSeenVisible] = useState(true);
  const [transportMode, setTransportMode] = useState<TransportProtocol>(networkEngine.getTransportMode());

  if (!isOpen) return null;

  const handleSetMode = (mode: TransportProtocol) => {
    soundFx.playTap();
    setTransportMode(mode);
    networkEngine.setTransportMode(mode);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-[#121A15] border-t sm:border border-[#2B3C30] rounded-t-3xl sm:rounded-3xl w-full max-w-lg max-h-[92dvh] sm:max-h-[85vh] flex flex-col shadow-2xl overflow-hidden select-none animate-in slide-in-from-bottom sm:zoom-in-95 duration-150 pb-[var(--sab)] sm:pb-0 text-[#E4EDE7]">
        {/* Mobile Pull Indicator */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center bg-[#141C16]">
          <div className="w-12 h-1 bg-[#28392C] rounded-full" />
        </div>

        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-[#1F2B22] flex items-center justify-between bg-[#141C16]">
          <div className="flex items-center gap-2.5">
            <h3 className="font-extrabold text-base text-white">Налаштування Aura</h3>
          </div>

          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="p-1.5 text-[#8EA093] hover:text-white hover:bg-[#1E2A21] rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="px-4 py-2 bg-[#0E1410] border-b border-[#1F2B22] flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {[
            { id: 'appearance', label: 'Оформлення', icon: Palette },
            { id: 'network', label: 'Мережа & P2P', icon: Radio },
            { id: 'notifications', label: 'Сповіщення & Звук', icon: Bell },
            { id: 'privacy', label: 'Приватність', icon: Shield },
            { id: 'data', label: 'Дані & Резерв', icon: Download },
          ].map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  soundFx.playTap();
                  setActiveTab(t.id as any);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-[#1C2920] text-[#55C778] border border-[#2B3E31] shadow-sm'
                    : 'bg-[#141C16] hover:bg-[#18231B] text-[#8EA093] hover:text-white border border-[#223126]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* TAB 1: APPEARANCE */}
          {activeTab === 'appearance' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#445047] mb-2">
                  Акцентний природний відтінок
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { id: 'terracotta', label: 'Теракота', color: '#E87A42' },
                    { id: 'sage', label: 'Шавлія', color: '#5B8C67' },
                    { id: 'chestnut', label: 'Каштан', color: '#8A5333' },
                    { id: 'amber', label: 'Бурштин', color: '#D97706' },
                  ].map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        soundFx.playTap();
                        setAccentColor(c.id as any);
                      }}
                      className={`p-2.5 rounded-2xl border text-center transition-all ${
                        accentColor === c.id
                          ? 'bg-white border-[#1F2521] shadow-xs'
                          : 'bg-white/60 border-[#DFD6C5] hover:bg-white'
                      }`}
                    >
                      <span
                        className="w-5 h-5 rounded-full mx-auto block mb-1.5 shadow-2xs"
                        style={{ backgroundColor: c.color }}
                      />
                      <span className="text-[11px] font-bold text-[#1F2521] block">{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#445047] mb-2">
                  Розмір шрифту інтерфейсу
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      soundFx.playTap();
                      setFontSize('standard');
                    }}
                    className={`p-3 rounded-2xl border text-left transition-all ${
                      fontSize === 'standard'
                        ? 'bg-white border-[#1F2521] shadow-xs'
                        : 'bg-white/60 border-[#DFD6C5]'
                    }`}
                  >
                    <span className="font-extrabold text-xs text-[#1F2521] block">Стандартний (14-15px)</span>
                    <span className="text-[11px] text-[#717E75]">Оптимальна щільність</span>
                  </button>
                  <button
                    onClick={() => {
                      soundFx.playTap();
                      setFontSize('large');
                    }}
                    className={`p-3 rounded-2xl border text-left transition-all ${
                      fontSize === 'large'
                        ? 'bg-white border-[#1F2521] shadow-xs'
                        : 'bg-white/60 border-[#DFD6C5]'
                    }`}
                  >
                    <span className="font-extrabold text-sm text-[#1F2521] block">Збільшений (16-17px)</span>
                    <span className="text-[11px] text-[#717E75]">Максимальна читабельність</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: NETWORK & P2P PROTOCOL */}
          {activeTab === 'network' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-[#F6EEE2] rounded-2xl border border-[#E4D8C4] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#E87A42]/15 text-[#E87A42] flex items-center justify-center">
                    <Radio className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-xs text-[#1F2521]">Гібридна P2P / Серверна архітектура</h4>
                    <p className="text-[11px] text-[#69796F]">Прямий WebRTC тунель або хмарний релей</p>
                  </div>
                </div>
                {onOpenP2PNetworkModal && (
                  <button
                    onClick={() => {
                      soundFx.playTap();
                      onClose();
                      onOpenP2PNetworkModal();
                    }}
                    className="px-3 py-1.5 bg-[#1F2521] hover:bg-[#323D35] text-white rounded-xl text-xs font-bold transition-all shadow-2xs"
                  >
                    Термінал P2P
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-[#445047] mb-2 uppercase tracking-wider">
                  Протокол за замовчуванням
                </label>
                <div className="space-y-2">
                  {[
                    {
                      id: 'auto' as TransportProtocol,
                      title: 'Автоматичний (Hybrid Smart Route)',
                      desc: 'Прямий WebRTC тунель за наявності пірів, з безпечним підстрахуванням через WebSocket сервер.',
                      icon: Zap,
                      badge: 'Рекомендовано',
                      color: 'text-[#E87A42]',
                    },
                    {
                      id: 'p2p' as TransportProtocol,
                      title: 'Тільки прямий P2P (WebRTC DataChannel)',
                      desc: 'Шифрований прямий зв\'язок між браузерами. Жодне повідомлення не передається на сервер.',
                      icon: Lock,
                      badge: 'Strict E2E',
                      color: 'text-[#10B981]',
                    },
                    {
                      id: 'server' as TransportProtocol,
                      title: 'Серверний релей (Cloud WebSocket)',
                      desc: 'Синхронізація через сервер Aura. Гарантована доставка для великих команд.',
                      icon: Globe,
                      badge: 'Cloud Sync',
                      color: 'text-[#3B82F6]',
                    },
                  ].map((opt) => {
                    const Icon = opt.icon;
                    const isSel = transportMode === opt.id;
                    return (
                      <div
                        key={opt.id}
                        onClick={() => handleSetMode(opt.id)}
                        className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex items-start justify-between gap-3 ${
                          isSel
                            ? 'bg-white border-[#1F2521] ring-1 ring-[#1F2521] shadow-xs'
                            : 'bg-white/60 border-[#DFD6C5] hover:bg-white'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-7 h-7 rounded-lg bg-black/5 flex items-center justify-center shrink-0 ${opt.color} mt-0.5`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h5 className="font-extrabold text-xs text-[#1F2521]">{opt.title}</h5>
                              <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-[#FAF6EE] border border-[#DDD3BF] text-[#717E75]">
                                {opt.badge}
                              </span>
                            </div>
                            <p className="text-[11px] text-[#69786E] mt-0.5 leading-relaxed">{opt.desc}</p>
                          </div>
                        </div>
                        {isSel && (
                          <div className="w-4 h-4 rounded-full bg-[#1F2521] text-white flex items-center justify-center shrink-0 mt-1">
                            <Check className="w-2.5 h-2.5" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-3 bg-white rounded-2xl border border-[#DFD6C5] space-y-1.5">
                <span className="text-[11px] font-bold text-[#1F2521] flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-[#10B981]" />
                  <span>Відбиток шифрування E2E вузла:</span>
                </span>
                <span className="font-mono text-[10.5px] text-[#69796F] block bg-[#FAF7F2] p-1.5 rounded-lg border border-[#E3D9C7] select-all">
                  AURA:P2P:SHA256:7B:4E:91:FA:33:C9:88:E2
                </span>
              </div>
            </div>
          )}

          {/* TAB 3: NOTIFICATIONS & SOUND */}
          {activeTab === 'notifications' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3.5 bg-white border border-[#DFD6C5] rounded-2xl">
                <div>
                  <p className="font-bold text-xs text-[#1F2521]">Звуковий супровід Aura</p>
                  <p className="text-[11px] text-[#717E75]">Природні кліки, надсилання та дзвіночки</p>
                </div>
                <button
                  onClick={() => {
                    soundFx.playTap();
                    onToggleSound();
                  }}
                  className={`w-12 h-6 rounded-full transition-colors relative p-0.5 ${
                    isSoundEnabled ? 'bg-[#E87A42]' : 'bg-[#D6CDC0]'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      isSoundEnabled ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between p-3.5 bg-white border border-[#DFD6C5] rounded-2xl">
                <div>
                  <p className="font-bold text-xs text-[#1F2521]">Системні сповіщення</p>
                  <p className="text-[11px] text-[#717E75]">Показувати спливаючі банери в браузері</p>
                </div>
                <button
                  onClick={() => {
                    soundFx.playTap();
                    setDesktopNotifs(!desktopNotifs);
                  }}
                  className={`w-12 h-6 rounded-full transition-colors relative p-0.5 ${
                    desktopNotifs ? 'bg-[#E87A42]' : 'bg-[#D6CDC0]'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      desktopNotifs ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: PRIVACY */}
          {activeTab === 'privacy' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3.5 bg-white border border-[#DFD6C5] rounded-2xl">
                <div>
                  <p className="font-bold text-xs text-[#1F2521]">Звіти про прочитання</p>
                  <p className="text-[11px] text-[#717E75]">Повідомляти співрозмовників про перегляд</p>
                </div>
                <button
                  onClick={() => {
                    soundFx.playTap();
                    setReadReceipts(!readReceipts);
                  }}
                  className={`w-12 h-6 rounded-full transition-colors relative p-0.5 ${
                    readReceipts ? 'bg-[#E87A42]' : 'bg-[#D6CDC0]'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      readReceipts ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between p-3.5 bg-white border border-[#DFD6C5] rounded-2xl">
                <div>
                  <p className="font-bold text-xs text-[#1F2521]">Статус "Був у мережі"</p>
                  <p className="text-[11px] text-[#717E75]">Відображати час останньої активності</p>
                </div>
                <button
                  onClick={() => {
                    soundFx.playTap();
                    setLastSeenVisible(!lastSeenVisible);
                  }}
                  className={`w-12 h-6 rounded-full transition-colors relative p-0.5 ${
                    lastSeenVisible ? 'bg-[#E87A42]' : 'bg-[#D6CDC0]'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      lastSeenVisible ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* TAB 5: DATA & BACKUP */}
          {activeTab === 'data' && (
            <div className="space-y-3">
              <div className="p-4 bg-white border border-[#DFD6C5] rounded-2xl space-y-2 shadow-2xs">
                <p className="font-bold text-xs text-[#1F2521]">Експорт даних та історії</p>
                <p className="text-[11px] text-[#717E75]">
                  Завантажте всі ваші бесіди, таблиці, графіки та конспекти у структурованому JSON-архіві.
                </p>
                <button
                  onClick={() => {
                    soundFx.playTap();
                    onExportAllData();
                  }}
                  className="px-3.5 py-2 bg-[#FCE7D8] hover:bg-[#F9CCA8] text-[#8C461A] font-bold rounded-xl text-xs flex items-center gap-2 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Експортувати повний бекап (.json)</span>
                </button>
              </div>

              {onClearHistory && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-2xl space-y-2">
                  <p className="font-bold text-xs text-red-800">Очищення локальної пам’яті</p>
                  <p className="text-[11px] text-red-600">
                    Скинути історію поточного чату до початкового стану.
                  </p>
                  <button
                    onClick={() => {
                      soundFx.playTap();
                      if (confirm('Справді очистити історію?')) {
                        onClearHistory();
                        onClose();
                      }
                    }}
                    className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl text-xs flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Очистити історію</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
