import React, { useState } from 'react';
import {
  Network,
  Lock,
  X,
  Globe,
} from 'lucide-react';

/**
 * Мости до чужих мереж — намір, а не стан.
 *
 * Так було: тут стояв масив із чотирьох «підключених» мостів — Matrix з
 * акаунтом `@kiril:matrix.org`, Nostr з `npub18f2a...c41e` і живим на вигляд
 * `wss://relay.damus.io`, ActivityPub, Telegram з номером телефону — і в
 * кожного статус «Connected» та лічильник синхронізованих повідомлень
 * (1240 / 430 / 89 / 3820). Жодне з цих чисел ніколи нічого не рахувало:
 * бекенду мостів не існує (grep -i bridge по routes_messenger.py — порожньо),
 * мережевих викликів у файлі не було жодного, а кнопка «Підключено»
 * перемикала лише сама себе в useState.
 *
 * Прибрано разом зі значком «E2EE» на бесідах, які ним не були: обіцянка, яку
 * ніхто не перевіряє, — та сама неправда, лише більша. Тут лишився перелік
 * протоколів як намір, з єдиним чесним станом: не підключено.
 *
 * Коли міст справді з'явиться — стан має приходити з вузла, а не з масиву.
 */

interface PlannedBridge {
  id: string;
  protocol: string;
  /** Чим цей міст стане, коли його збудують. Опис наміру, не стану. */
  intent: string;
}

const OPEN_PROTOCOLS: PlannedBridge[] = [
  { id: 'matrix', protocol: 'Matrix', intent: 'федеративні кімнати через власний homeserver' },
  { id: 'nostr', protocol: 'Nostr', intent: 'публікація й читання через релеї на вибір' },
  { id: 'activitypub', protocol: 'ActivityPub', intent: 'вихідна скринька вузла у федерацію' },
];

const PUPPETING: PlannedBridge[] = [
  { id: 'telegram', protocol: 'Telegram (TDLib)', intent: 'локальний демон на вузлі, сесія не покидає пристрій' },
  { id: 'signal', protocol: 'Signal (CLI)', intent: 'локальний демон на вузлі, сесія не покидає пристрій' },
];

interface UniversalBridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitle?: string;
}

/**
 * Одна картка. Стану немає — і саме це вона й каже.
 *
 * Підкладка тут `bg-[#FDFCF9]`, а не `bg-white`, і це не смак. Темна тема в
 * цьому застосунку зроблена списком !important-перекриттів по СВІТЛИХ
 * hex-класах (messenger.css): `text-[#21261F]` там стає майже білим, а
 * `bg-white` у тому списку відсутній. Тобто картка на `bg-white` лишалась
 * білою, текст ставав білим, і напис зникав — заміряно: rgb(248,250,248) на
 * rgb(255,255,255), контраст 1.02:1. Клас із переліку тримає обидві теми.
 */
const BridgeCard: React.FC<{ bridge: PlannedBridge }> = ({ bridge }) => (
  <div className="p-3.5 bg-[#FDFCF9] border border-[#E5DEC9] rounded-xl flex items-center justify-between gap-3 shadow-2xs">
    <div className="space-y-0.5 min-w-0">
      <span className="font-bold text-xs text-[#21261F]">{bridge.protocol}</span>
      <p className="text-[10px] text-[#8A9186] leading-snug">{bridge.intent}</p>
    </div>
    <span className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#F1EBDD] text-[#6E7568] border border-[#E0D7C4] shrink-0">
      Не підключено
    </span>
  </div>
);

export const UniversalBridgeModal: React.FC<UniversalBridgeModalProps> = ({
  isOpen,
  onClose,
  chatTitle = 'Бесіда',
}) => {
  const [activeTab, setActiveTab] = useState<'matrix_nostr' | 'puppeting'>('matrix_nostr');

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-[#FDFCF9] border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150 select-text"
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
                Мости до інших мереж
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {chatTitle} · Matrix, Nostr, ActivityPub, Telegram, Signal
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Підкладка перемикача — з переліку, який знає темна тема
                (`#EFE9DC` у ньому немає): інакше неактивна вкладка лишалась
                сірим по світлому й падала до 2.28:1 — нижче за поріг навіть
                для великого тексту, а це навігація, її мусять прочитати. */}
            <div className="flex items-center bg-[#F1EBDD] p-0.5 rounded-lg text-xs font-medium text-[#6E7568]">
              <button
                onClick={() => setActiveTab('matrix_nostr')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'matrix_nostr' ? 'bg-[#FDFCF9] text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Відкриті протоколи
              </button>
              <button
                onClick={() => setActiveTab('puppeting')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  activeTab === 'puppeting' ? 'bg-[#FDFCF9] text-[#21261F] font-bold shadow-2xs' : 'hover:text-[#21261F]'
                }`}
              >
                Telegram / Signal
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
          {/* Одна чесна фраза замість чотирьох вигаданих «підключено». */}
          <div className="p-3.5 bg-[#F1EBDD] border border-[#E0D7C4] rounded-xl text-xs text-[#5A6155] leading-relaxed">
            Жоден міст ще не збудовано. Нижче — перелік того, чим вони мають
            стати; жодне повідомлення зараз через них не ходить, і вузол до
            цих мереж не підключається.
          </div>

          {activeTab === 'matrix_nostr' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-950 flex items-center gap-2 font-bold text-indigo-900">
                <Globe className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>Відкриті федеративні та P2P протоколи</span>
              </div>

              <div className="space-y-2.5">
                {OPEN_PROTOCOLS.map((bridge) => (
                  <BridgeCard key={bridge.id} bridge={bridge} />
                ))}
              </div>
            </div>
          )}

          {activeTab === 'puppeting' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 text-xs text-emerald-950">
                <div className="flex items-center gap-2 font-bold text-emerald-900">
                  <Lock className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Задум: без чужої хмари</span>
                </div>
                <p className="leading-relaxed">
                  Сесії Telegram і Signal мають запускатися локальним демоном на
                  самому вузлі, щоб ключі сесії та історія не покидали пристрій.
                  Це опис наміру — демона ще немає.
                </p>
              </div>

              <div className="space-y-2.5">
                {PUPPETING.map((bridge) => (
                  <BridgeCard key={bridge.id} bridge={bridge} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-[#FAF8F5] border-t border-[#E8E1D3] flex items-center justify-between text-[11px] text-[#8A9186]">
          <span>Мости до інших мереж</span>
          <span className="font-mono">не збудовано</span>
        </div>
      </div>
    </div>
  );
};
