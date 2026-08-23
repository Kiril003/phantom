import React, { useEffect, useState, useSyncExternalStore } from 'react';
import {
  X,
  Bell,
  Shield,
  Palette,
  Download,
  Trash2,
  Check,
  Radio,
  Globe,
  Zap
} from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';
import { IdentityPanel } from './IdentityPanel';
import { networkEngine } from '../../services/messengerNetworkEngine';
import { TransportProtocol } from '../../types/messenger';
import { notificationPrefs } from '../../services/notificationPrefs';
import { useEscapeClose } from '../../hooks/useEscapeClose';

// Стан дозволу словами. Це єдине, що тут можна чесно пообіцяти.
const NOTIF_NOTE: Record<string, string> = {
  unsupported: 'Цей браузер системних сповіщень не має',
  default: 'Дозволу ще не питали — увімкніть, і браузер спитає',
  granted: 'Дозвіл надано — банер покажеться навіть поза вкладкою',
  denied: 'Дозвіл заблоковано в налаштуваннях сайту — зніміть блок у браузері',
};

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
  const [readReceipts, setReadReceipts] = useState(true);
  const [lastSeenVisible, setLastSeenVisible] = useState(true);
  const [transportMode, setTransportMode] = useState<TransportProtocol>(networkEngine.getTransportMode());
  const notifs = useSyncExternalStore(notificationPrefs.subscribe, notificationPrefs.getSnapshot);

  // Дозвіл могли змінити в налаштуваннях сайту, поки вкладка стояла відкритою.
  useEffect(() => {
    if (isOpen) notificationPrefs.sync();
  }, [isOpen]);

  // Escape виводить із шару так само, як хрестик.
  useEscapeClose(isOpen, onClose);

  if (!isOpen) return null;

  const handleSetMode = (mode: TransportProtocol) => {
    soundFx.playTap();
    setTransportMode(mode);
    networkEngine.setTransportMode(mode);
  };

  return (
    <div className="fixed inset-0 z-50 phantom-scrim flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-[#FDFCF9] border-t sm:border border-[#DDD4C4] rounded-t-3xl sm:rounded-3xl w-full max-w-lg max-h-[92dvh] sm:max-h-[85vh] flex flex-col shadow-2xl overflow-hidden select-none animate-in slide-in-from-bottom sm:zoom-in-95 duration-150 pb-[var(--sab)] sm:pb-0 text-[#1E2521]">
        {/* Mobile Pull Indicator */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center bg-[#FDFCF9]">
          <div className="w-12 h-1 bg-[#F1EDE3] rounded-full" />
        </div>

        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-[#E6DFD3] flex items-center justify-between bg-[#FDFCF9]">
          <div className="flex items-center gap-2.5">
            <h3 className="font-extrabold text-base text-[#1E2521]">Налаштування месенджера</h3>
          </div>

          <button
            onClick={() => {
              soundFx.playTap();
              onClose();
            }}
            className="p-1.5 text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3] rounded-xl transition-colors"
          >
            <X className="w-5 h-5" strokeWidth={1.75} />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="msg-strip px-4 pt-2 pb-1.5 bg-[#F7F5EE] border-b border-[#E6DFD3] gap-1.5 shrink-0">
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
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all ${
                  isActive
                    ? 'bg-[#F9F7F1] text-[#E87A42] border border-[#DDD4C4] shadow-sm'
                    : 'bg-[#FDFCF9] hover:bg-[#F9F7F1] text-[#5F6A60] hover:text-[#1E2521] border border-[#E6DFD3]'
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
                <label className="block text-xs font-bold text-[#8A9186] mb-2">
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
                          ? 'bg-white border-[#E6DFD3] shadow-xs'
                          : 'bg-white/60 border-[#DFD6C5] hover:bg-white'
                      }`}
                    >
                      <span
                        className="w-5 h-5 rounded-full mx-auto block mb-1.5 shadow-2xs"
                        style={{ backgroundColor: c.color }}
                      />
                      <span className="text-[11px] font-bold text-[#1E2521] block">{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#8A9186] mb-2">
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
                        ? 'bg-white border-[#E6DFD3] shadow-xs'
                        : 'bg-white/60 border-[#DFD6C5]'
                    }`}
                  >
                    <span className="font-extrabold text-xs text-[#1E2521] block">Стандартний (14-15px)</span>
                    <span className="text-[11px] text-[#7A8479]">Оптимальна щільність</span>
                  </button>
                  <button
                    onClick={() => {
                      soundFx.playTap();
                      setFontSize('large');
                    }}
                    className={`p-3 rounded-2xl border text-left transition-all ${
                      fontSize === 'large'
                        ? 'bg-white border-[#E6DFD3] shadow-xs'
                        : 'bg-white/60 border-[#DFD6C5]'
                    }`}
                  >
                    <span className="font-extrabold text-sm text-[#1E2521] block">Збільшений (16-17px)</span>
                    <span className="text-[11px] text-[#7A8479]">Максимальна читабельність</span>
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
                    <Radio className="w-4 h-4" strokeWidth={1.75} />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-xs text-[#1E2521]">Гібридна P2P / Серверна архітектура</h4>
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
                    className="px-3 py-1.5 bg-[#E6DFD3] hover:bg-[#F1EDE3] text-[#1E2521] rounded-xl text-xs font-bold transition-all shadow-2xs"
                  >
                    Термінал P2P
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-[#8A9186] mb-2 uppercase tracking-wider">
                  Протокол за замовчуванням
                </label>
                <div className="space-y-2">
                  {[
                    {
                      id: 'auto' as TransportProtocol,
                      title: 'Автоматичний (Hybrid Smart Route)',
                      desc: 'Прямий WebRTC тунель за наявності пірів, з підстрахуванням через WebSocket сервер.',
                      icon: Zap,
                      badge: 'Рекомендовано',
                      color: 'text-[#E87A42]',
                    },
                    {
                      id: 'p2p' as TransportProtocol,
                      title: 'Тільки прямий P2P (WebRTC DataChannel)',
                      desc: 'Прямий канал між вузлами, коли пряма адреса відома.',
                      icon: Radio,
                      badge: 'Прямий канал (DTLS)',
                      color: 'text-[#4C8A55]',
                    },
                    {
                      id: 'server' as TransportProtocol,
                      title: 'Серверний релей (Cloud WebSocket)',
                      desc: 'Через ретранслятор PHANTOM — він везе шифротекст і вмісту не бачить.',
                      icon: Globe,
                      badge: 'Cloud Sync',
                      color: 'text-[#7A8479]',
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
                            ? 'bg-white border-[#E6DFD3] ring-1 ring-[#E6DFD3] shadow-xs'
                            : 'bg-white/60 border-[#DFD6C5] hover:bg-white'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-7 h-7 rounded-lg bg-black/5 flex items-center justify-center shrink-0 ${opt.color} mt-0.5`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h5 className="font-extrabold text-xs text-[#1E2521]">{opt.title}</h5>
                              <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-[#FAF6EE] border border-[#DDD3BF] text-[#7A8479]">
                                {opt.badge}
                              </span>
                            </div>
                            <p className="text-[11px] text-[#69786E] mt-0.5 leading-relaxed">{opt.desc}</p>
                          </div>
                        </div>
                        {isSel && (
                          <div className="w-4 h-4 rounded-full bg-[#E6DFD3] text-[#1E2521] flex items-center justify-center shrink-0 mt-1">
                            <Check className="w-2.5 h-2.5" strokeWidth={1.75} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-3 bg-[#F4F1E8] rounded-2xl border border-[#E0D5C2] space-y-1.5">
                <span className="text-[11px] font-bold text-[#4A5548] flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-[#4C8A55]" strokeWidth={1.75} />
                  <span>Листи запечатані між вузлами</span>
                </span>
                <span className="text-[10.5px] text-[#7A6A55] block leading-relaxed">
                  Повідомлення і файли запечатуються між вашим вузлом і вузлом
                  співрозмовника: дороги — ретранслятор, скринька, чужий канал — везуть
                  лише шифротекст. Ваш власний вузол довірений: він тримає ключі й бачить
                  вміст, як телефон бачить ваші чати. Історія на його диску лежить
                  запечатаною. А хто саме на тому кінці — каже не шифр, а звірене число
                  безпеки.
                </span>
              </div>

              <IdentityPanel />
            </div>
          )}

          {/* TAB 3: NOTIFICATIONS & SOUND */}
          {activeTab === 'notifications' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3.5 bg-white border border-[#DFD6C5] rounded-2xl">
                <div>
                  <p className="font-bold text-xs text-[#1E2521]">Звуковий супровід PHANTOM</p>
                  <p className="text-[11px] text-[#7A8479]">Природні кліки, надсилання та дзвіночки</p>
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

              {/* Перемикач показує не власне бажання, а дозвіл браузера: без
                  нього банера не буде, скільки не вмикай. */}
              <div className="flex items-center justify-between p-3.5 bg-white border border-[#DFD6C5] rounded-2xl">
                <div className="min-w-0 pr-3">
                  <p className="font-bold text-xs text-[#1E2521]">Системні сповіщення</p>
                  <p className="text-[11px] text-[#7A8479]" data-notif-state={notifs.access}>
                    {NOTIF_NOTE[notifs.access]}
                  </p>
                </div>
                <button
                  onClick={() => {
                    soundFx.playTap();
                    if (notifs.effective) notificationPrefs.disable();
                    else void notificationPrefs.enable();
                  }}
                  disabled={notifs.access === 'unsupported' || notifs.access === 'denied'}
                  data-notif-toggle={notifs.effective ? 'on' : 'off'}
                  title={NOTIF_NOTE[notifs.access]}
                  className={`w-12 h-6 rounded-full transition-colors relative p-0.5 shrink-0 disabled:opacity-45 disabled:cursor-not-allowed ${
                    notifs.effective ? 'bg-[#E87A42]' : 'bg-[#D6CDC0]'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      notifs.effective ? 'translate-x-6' : 'translate-x-0'
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
                  <p className="font-bold text-xs text-[#1E2521]">Звіти про прочитання</p>
                  <p className="text-[11px] text-[#7A8479]">Повідомляти співрозмовників про перегляд</p>
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
                  <p className="font-bold text-xs text-[#1E2521]">Статус "Був у мережі"</p>
                  <p className="text-[11px] text-[#7A8479]">Відображати час останньої активності</p>
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
                <p className="font-bold text-xs text-[#1E2521]">Експорт даних та історії</p>
                <p className="text-[11px] text-[#7A8479]">
                  Завантажте всі ваші бесіди, таблиці, графіки та конспекти у структурованому JSON-архіві.
                </p>
                <button
                  onClick={() => {
                    soundFx.playTap();
                    onExportAllData();
                  }}
                  className="px-3.5 py-2 bg-[#FCE7D8] hover:bg-[#F9CCA8] text-[#8C461A] font-bold rounded-xl text-xs flex items-center gap-2 transition-colors"
                >
                  <Download className="w-4 h-4" strokeWidth={1.75} />
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
                    className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-[#1E2521] font-semibold rounded-xl text-xs flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
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
