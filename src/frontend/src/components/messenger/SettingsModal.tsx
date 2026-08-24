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
import { messengerFontScale } from '../../services/messengerFontScale';
import { messengerAccent, MESSENGER_ACCENTS } from '../../services/messengerAccent';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { messengerApi, type NodeConversation } from '../../services/messengerApi';
import { useMessengerStore } from '../../stores/messengerStore';

// Доказові розмови позначки не мають — їх створювали звичайним API. Тому не
// вгадуємо мовчки: за назвою лише ПРОПОНУЄМО, а викреслює власник.
const PROOF_TITLE = /(доказ|proof|qa-|тест|test|перевірка)/i;

interface Candidate {
  id: string;
  title: string;
  reason: string;
}

function candidatesOf(list: NodeConversation[]): Candidate[] {
  return list
    .filter((c) => c.is_demo || PROOF_TITLE.test(c.title))
    .map((c) => ({
      id: c.id,
      title: c.title,
      reason: c.is_demo ? 'показова' : 'схоже на доказову',
    }));
}

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
  // Відтінок і кегль живуть у власних сховищах: вибір мусить пережити
  // закриття модалки і F5, інакше це знову напис на кнопці замість пікселів.
  const accentColor = useSyncExternalStore(messengerAccent.subscribe, messengerAccent.getSnapshot);
  const fontSize = useSyncExternalStore(messengerFontScale.subscribe, messengerFontScale.getSnapshot);
  const [transportMode, setTransportMode] = useState<TransportProtocol>(networkEngine.getTransportMode());
  const notifs = useSyncExternalStore(notificationPrefs.subscribe, notificationPrefs.getSnapshot);

  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sweeping, setSweeping] = useState(false);
  const [sweepNote, setSweepNote] = useState<string | null>(null);
  const hydrateFromNode = useMessengerStore((s) => s.hydrateFromNode);

  // Дозвіл могли змінити в налаштуваннях сайту, поки вкладка стояла відкритою.
  useEffect(() => {
    if (isOpen) notificationPrefs.sync();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'data') return;
    let alive = true;
    void messengerApi
      .listConversations()
      .then((list) => {
        if (!alive) return;
        const found = candidatesOf(list);
        setCandidates(found);
        setPicked(new Set(found.map((c) => c.id)));
      })
      .catch(() => {
        if (alive) setCandidates([]);
      });
    return () => {
      alive = false;
    };
  }, [isOpen, activeTab]);

  const sweepDemos = async () => {
    if (!candidates || picked.size === 0) return;
    setSweeping(true);
    setSweepNote(null);
    let gone = 0;
    let failed = 0;
    for (const id of picked) {
      try {
        await messengerApi.deleteConversation(id);
        gone += 1;
      } catch {
        failed += 1;
      }
    }
    await hydrateFromNode().catch(() => undefined);
    const left = candidates.filter((c) => !picked.has(c.id));
    setCandidates(left);
    setPicked(new Set(left.map((c) => c.id)));
    setSweeping(false);
    setSweepNote(
      failed === 0 ? `Прибрано ${gone}.` : `Прибрано ${gone}, не вдалося ${failed}.`
    );
  };

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
                  {MESSENGER_ACCENTS.map((c) => (
                    <button
                      key={c.id}
                      data-accent={c.id}
                      onClick={() => {
                        soundFx.playTap();
                        messengerAccent.set(c.id);
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
                    data-font-standard
                    onClick={() => {
                      soundFx.playTap();
                      messengerFontScale.set('standard');
                    }}
                    className={`p-3 rounded-2xl border text-left transition-all ${
                      fontSize === 'standard'
                        ? 'bg-white border-[#E6DFD3] shadow-xs'
                        : 'bg-white/60 border-[#DFD6C5]'
                    }`}
                  >
                    <span className="font-extrabold text-xs text-[#1E2521] block">Стандартний (14–15.5px)</span>
                    <span className="text-[11px] text-[#7A8479]">Оптимальна щільність</span>
                  </button>
                  <button
                    data-font-large
                    onClick={() => {
                      soundFx.playTap();
                      messengerFontScale.set('large');
                    }}
                    className={`p-3 rounded-2xl border text-left transition-all ${
                      fontSize === 'large'
                        ? 'bg-white border-[#E6DFD3] shadow-xs'
                        : 'bg-white/60 border-[#DFD6C5]'
                    }`}
                  >
                    <span className="font-extrabold text-sm text-[#1E2521] block">Збільшений (16–17.5px)</span>
                    <span className="text-[11px] text-[#7A8479]">Стрічка й список бесід разом</span>
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
          {/* Тут стояли перемикачі «звіти про прочитання» і «був у мережі».
              Обидва обіцяли керувати чужим екраном, а керувати не було чим:
              позначка прочитаного нікуди не їде, присутності вузол не публікує.
              Замість вимикача без дроту — те, що справді відбувається. */}
          {activeTab === 'privacy' && (
            <div className="space-y-3">
              <div className="p-3.5 bg-[#F4F1E8] rounded-2xl border border-[#E0D5C2] space-y-1.5">
                <span className="text-[11px] font-bold text-[#4A5548] flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-[#4C8A55]" strokeWidth={1.75} />
                  <span>Прочитане й присутність з вузла не виходять</span>
                </span>
                <span className="text-[10.5px] text-[#7A6A55] block leading-relaxed">
                  Позначка прочитаного лишається тут: вона гасить лічильник
                  непрочитаних у вашому списку і співрозмовнику не надсилається.
                  Час останньої активності вузол теж нікому не показує. Тому тут
                  і немає вимикачів — обидва звіти мовчать самою будовою, а не
                  за налаштуванням.
                </span>
              </div>

              <div className="p-3.5 bg-white border border-[#DFD6C5] rounded-2xl space-y-1.5">
                <p className="font-bold text-xs text-[#1E2521]">Хто на тому кінці</p>
                <p className="text-[11px] text-[#7A8479] leading-relaxed">
                  Шифр каже лише, що канал запечатаний. Що це саме та людина —
                  каже звірене число безпеки в картці співрозмовника.
                </p>
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

              <div className="p-4 bg-white border border-[#DFD6C5] rounded-2xl space-y-2 shadow-2xs">
                <p className="font-bold text-xs text-[#1E2521]">Прибрати показові розмови</p>
                {candidates === null && (
                  <p className="text-[11px] text-[#7A8479]">Дивлюся стрічку…</p>
                )}
                {candidates?.length === 0 && (
                  <p className="text-[11px] text-[#7A8479]">
                    {sweepNote ?? 'Показових і доказових розмов у стрічці немає.'}
                  </p>
                )}
                {candidates && candidates.length > 0 && (
                  <>
                    <p className="text-[11px] text-[#7A8479]">
                      Знайдено {candidates.length}. Зніміть галочку з тієї, що потрібна —
                      решту приберемо. Нічого не зникає без цієї кнопки.
                    </p>
                    <div className="max-h-44 overflow-y-auto space-y-1 pt-1">
                      {candidates.map((c) => (
                        <label
                          key={c.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-[#F9F7F1] cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={picked.has(c.id)}
                            onChange={() => {
                              const next = new Set(picked);
                              if (next.has(c.id)) next.delete(c.id);
                              else next.add(c.id);
                              setPicked(next);
                            }}
                            className="accent-[#E87A42]"
                          />
                          <span className="text-[11.5px] text-[#1E2521] truncate flex-1">
                            {c.title}
                          </span>
                          <span className="text-[10px] text-[#7A8479] shrink-0">{c.reason}</span>
                        </label>
                      ))}
                    </div>
                    <button
                      disabled={sweeping || picked.size === 0}
                      onClick={() => {
                        soundFx.playTap();
                        if (confirm(`Прибрати ${picked.size} розмов(и)? Це не скасувати.`)) {
                          void sweepDemos();
                        }
                      }}
                      className="px-3.5 py-2 bg-[#FCE7D8] hover:bg-[#F9CCA8] disabled:opacity-50 text-[#8C461A] font-bold rounded-xl text-xs flex items-center gap-2 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" strokeWidth={1.75} />
                      <span>{sweeping ? 'Прибираю…' : `Прибрати обрані (${picked.size})`}</span>
                    </button>
                    {sweepNote && <p className="text-[11px] text-[#7A8479]">{sweepNote}</p>}
                  </>
                )}
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
