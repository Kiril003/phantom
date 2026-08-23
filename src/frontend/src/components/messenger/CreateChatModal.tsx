import React, { useState } from 'react';
import { X, QrCode, UserPlus, Users } from 'lucide-react';
import { QrScanner } from './QrScanner';
import { messengerApi } from '../../services/messengerApi';
import { soundFx } from '../../utils/messengerSound';

interface CreateChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Розмова вже лежить у вузлі — лишилося її відкрити. */
  onConversationReady: (conversationId: string) => void;
}

// Тут колись стояв триетапний майстер «простору»: групи на 200 000 учасників,
// форуми, канали трансляції, повільний режим. Жоден з тих екранів не робив
// запиту до вузла — «створена» група жила до F5. Лишилося те єдине, що вузол
// справді вміє: взяти ключ співрозмовника і відкрити з ним розмову.
export const CreateChatModal: React.FC<CreateChatModalProps> = ({
  isOpen,
  onClose,
  onConversationReady,
}) => {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [bundleText, setBundleText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const reset = () => {
    setName('');
    setAddress('');
    setBundleText('');
    setScanning(false);
    setError(null);
  };

  const close = () => {
    soundFx.playTap();
    reset();
    onClose();
  };

  // Ключ приходить двома шляхами: стислим рядком зі сканера або розгорнутим
  // JSON, якщо людина скопіювала його руками — так само, як у «Мережа & P2P».
  const openConversation = async () => {
    const raw = bundleText.trim();
    if (!raw || busy) return;
    setBusy(true);
    setError(null);
    try {
      const display = name.trim() || 'Без імені';
      const contact = await messengerApi.addContact(
        display,
        raw.startsWith('{') ? { bundle: JSON.parse(raw) } : { compact: raw },
        address.trim(),
      );
      // Ключ міг бути доданий раніше — вузол тоді віддає той самий контакт.
      // Заводити другу розмову з тією ж людиною означало б розрізати її історію
      // навпіл, тож наявну просто відкриваємо.
      const existing = (await messengerApi.listConversations()).find(
        (c) => c.contact_id === contact.id,
      );
      const conversation =
        existing ??
        (await messengerApi.createConversation({
          title: contact.display_name,
          kind: 'dm',
          circle: 'all',
          contact_id: contact.id,
        }));
      soundFx.playSend();
      reset();
      onConversationReady(conversation.id);
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? 'Це не схоже на ключ: очікується рядок з QR або JSON від співрозмовника.'
          : 'Вузол не прийняв ключ — підпис не збігається або вузол не відповів.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-[#FDFCF9] border-t sm:border border-[#DDD4C4] rounded-t-3xl sm:rounded-3xl w-full max-w-md shadow-2xl overflow-hidden select-none animate-in slide-in-from-bottom sm:zoom-in-95 duration-150 flex flex-col max-h-[92dvh] sm:max-h-[88vh] pb-[var(--sab)] sm:pb-0 text-[#1E2521]">
        {/* Mobile Pull Indicator */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center bg-[#FDFCF9]">
          <div className="w-12 h-1 bg-[#F1EDE3] rounded-full" />
        </div>

        <div className="px-5 py-4 border-b border-[#E6DFD3] flex items-center justify-between bg-[#FDFCF9] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-[#F9F7F1] text-[#E87A42] border border-[#DDD4C4] flex items-center justify-center shrink-0">
              <UserPlus className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-extrabold text-base text-[#1E2521] leading-tight">
                Написати людині
              </h3>
              <p className="text-[11.5px] text-[#6E7568] leading-tight mt-0.5">
                Ключ співрозмовника — і розмова відкрита
              </p>
            </div>
          </div>

          <button
            onClick={close}
            className="p-1.5 text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3] rounded-xl transition-colors shrink-0"
            aria-label="Закрити"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="p-3.5 bg-[#F9F7F1] rounded-3xl border border-[#E6DFD3] space-y-2.5">
            {scanning ? (
              <QrScanner
                onFound={(text) => {
                  setBundleText(text);
                  setScanning(false);
                  soundFx.playChime();
                }}
                onCancel={() => setScanning(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  soundFx.playTap();
                  setScanning(true);
                }}
                data-testid="scan-peer-qr"
                className="w-full py-2.5 rounded-2xl bg-white border border-[#DDD4C4] text-[#C25925] text-[12.5px] font-bold flex items-center justify-center gap-2 hover:bg-[#FAF6EE] active:scale-98 transition-all"
              >
                <QrCode className="w-4 h-4" />
                <span>Сканувати QR співрозмовника</span>
              </button>
            )}

            <div className="flex items-center gap-2 pt-0.5">
              <span className="h-px flex-1 bg-[#E6DFD3]" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-[#98A092]">
                або вручну
              </span>
              <span className="h-px flex-1 bg-[#E6DFD3]" />
            </div>

            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Імʼя"
              data-testid="peer-name"
              className="w-full px-3 py-2 text-[12.5px] rounded-xl border border-[#E6DFD3] bg-white focus:outline-none focus:border-[#E87A42]"
            />
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Адреса вузла (напр. 192.168.1.5:8000)"
              data-testid="peer-address"
              className="w-full px-3 py-2 text-[12.5px] rounded-xl border border-[#E6DFD3] bg-white focus:outline-none focus:border-[#E87A42]"
            />
            <textarea
              value={bundleText}
              onChange={(e) => setBundleText(e.target.value)}
              placeholder="Ключ співрозмовника — з QR або скопійований"
              rows={3}
              data-testid="peer-key"
              className="w-full px-3 py-2 text-[11px] font-mono rounded-xl border border-[#E6DFD3] bg-white focus:outline-none focus:border-[#E87A42] resize-none"
            />

            <button
              type="button"
              onClick={openConversation}
              disabled={!bundleText.trim() || busy}
              data-testid="open-conversation"
              className="w-full py-2.5 rounded-2xl bg-[#E87A42] hover:bg-[#C25925] disabled:bg-[#EADFD0] disabled:text-[#A8A99C] text-[#FFF8F2] text-[12.5px] font-extrabold transition-colors active:scale-98"
            >
              {busy ? 'Зводжу сесію…' : 'Відкрити розмову'}
            </button>

            {error && (
              <div className="p-2.5 bg-[#FDF6EC] rounded-xl border border-[#EBD9BE]">
                <span className="text-[10.5px] text-[#8C5A1A] leading-relaxed">{error}</span>
              </div>
            )}
          </div>

          {/* Обіцянок тут більше немає — тільки те, чого поки немає. */}
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl border border-[#EFEBE0] text-[#98A092]">
            <Users className="w-4 h-4 shrink-0" strokeWidth={1.75} />
            <span className="text-[11.5px] flex-1">Групи — ще ні. Працюємо.</span>
            <span className="text-[9.5px] font-bold uppercase tracking-wide bg-[#F1EBDD] text-[#6E7568] px-1.5 py-0.5 rounded-full">
              скоро
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
