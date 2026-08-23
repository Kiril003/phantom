import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ClipboardPaste, QrCode, UserPlus, Users, X } from 'lucide-react';
import { QrScanner } from './QrScanner';
import { InviteCard } from './InviteCard';
import { messengerApi } from '../../services/messengerApi';
import { soundFx } from '../../utils/messengerSound';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import {
  InviteTooNew,
  inviteInClipboard,
  nodeIdOf,
  parseInvite,
} from '../../utils/messengerInvite';
import type { ParsedInvite } from '../../utils/messengerInvite';

interface CreateChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Розмова вже лежить у вузлі — лишилося її відкрити. */
  onConversationReady: (conversationId: string) => void;
}

// Тут колись стояв триетапний майстер «простору», потім — три порожні поля:
// імʼя, IP чужого вузла і ключ на 355 символів. Суд намацав те саме двічі:
// людина не могла впустити людину. Тепер сюди вставляють один рядок —
// запрошення, — а всі три поля вузол дістає з нього сам.
export const CreateChatModal: React.FC<CreateChatModalProps> = ({
  isOpen,
  onClose,
  onConversationReady,
}) => {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedInvite | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [address, setAddress] = useState('');
  const [clipboardInvite, setClipboardInvite] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  useEscapeClose(isOpen, onClose);

  const reset = useCallback(() => {
    setText('');
    setParsed(null);
    setNodeId(null);
    setName('');
    setNameTouched(false);
    setAddress('');
    setClipboardInvite(null);
    setInviting(false);
    setScanning(false);
    setError(null);
  }, []);

  // Заглядаємо в буфер, щойно шар відкрився. Браузер сам питає дозволу, а
  // відмова тут нічого не ламає — просто не буде підказки.
  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    void inviteInClipboard().then((found) => {
      if (alive && found) setClipboardInvite(found);
    });
    return () => {
      alive = false;
    };
  }, [isOpen]);

  // Розбираємо все, що зʼявилось у полі: посилання, голий ключ, JSON — і
  // текст із чату, у якому запрошення лежить серед слів.
  useEffect(() => {
    const raw = text.trim();
    if (!raw) {
      setParsed(null);
      setNodeId(null);
      return;
    }
    let found: ParsedInvite | null = null;
    try {
      found = parseInvite(raw);
      setError(null);
    } catch (err) {
      setParsed(null);
      setNodeId(null);
      setError(
        err instanceof InviteTooNew
          ? 'Це запрошення новішої версії — оновіть вузол, інакше ключ не прочитати.'
          : 'Це не схоже на запрошення.',
      );
      return;
    }
    setParsed(found);
    if (!found) {
      setNodeId(null);
      return;
    }
    if (found.kind === 'invite') {
      if (found.address) setAddress(found.address);
      if (!nameTouched) setName(found.name);
    }
    const compact = found.kind === 'bundle' ? null : found.compact;
    if (!compact) {
      setNodeId(null);
      return;
    }
    let alive = true;
    void nodeIdOf(compact).then((id) => {
      if (alive) setNodeId(id);
    });
    return () => {
      alive = false;
    };
    // nameTouched свідомо поза списком: перезапис імені має статись лише
    // разом із новим текстом, а не тоді, коли людина торкнулась поля.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  if (!isOpen) return null;

  const close = () => {
    soundFx.playTap();
    reset();
    onClose();
  };

  const pasteFromClipboard = () => {
    if (!clipboardInvite) return;
    soundFx.playTap();
    setText(clipboardInvite);
    setClipboardInvite(null);
  };

  const openConversation = async () => {
    if (!parsed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const display = name.trim() || (nodeId ? `Вузол ${nodeId.slice(0, 8)}` : 'Без імені');
      const key =
        parsed.kind === 'bundle' ? { bundle: parsed.bundle } : { compact: parsed.compact };
      const contact = await messengerApi.addContact(display, key, address.trim());
      // Ключ міг бути доданий раніше — вузол тоді віддає той самий контакт.
      // Заводити другу розмову з тією ж людиною означало б розрізати її історію
      // навпіл, тож наявну просто відкриваємо.
      const existing = (await messengerApi.listConversations()).find(
        (c) => c.contact_id === contact.id,
      );
      let conversation =
        existing ??
        (await messengerApi.createConversation({
          title: contact.display_name,
          kind: 'dm',
          circle: 'all',
          contact_id: contact.id,
        }));
      // Вузол лишає давньому контакту давнє імʼя, і саме тут раніше мовчки
      // гинуло те, яке людина щойно вписала: вона бачила в списку «Вузол
      // 86a15538» замість Марти й вирішувала, що нічого не сталося.
      // Але саме воно й не сміє стати на шляху: не вийшло перейменувати —
      // розмова однаково відкривається, бо двері важливіші за напис.
      if (name.trim() && conversation.title !== name.trim()) {
        try {
          conversation = await messengerApi.renameConversation(conversation.id, name.trim());
        } catch {
          /* напис лишиться давнім */
        }
      }
      soundFx.playSend();
      reset();
      onConversationReady(conversation.id);
    } catch {
      setError('Вузол не прийняв ключ — підпис не збігається або вузол не відповів.');
    } finally {
      setBusy(false);
    }
  };

  const claimedName = parsed?.kind === 'invite' ? parsed.name.trim() : '';
  const nodeLabel = nodeId ? `Вузол ${nodeId.slice(0, 8)}…` : 'Вузол назветься, щойно відкриємо розмову';

  return (
    <div className="fixed inset-0 z-50 phantom-scrim flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150">
      <div
        onPaste={(e) => {
          // Ctrl+V працює будь-де в шарі, не лише в полі.
          const dropped = e.clipboardData?.getData('text');
          if (dropped && dropped.trim()) {
            setText(dropped);
            setClipboardInvite(null);
          }
        }}
        className="bg-[#FDFCF9] border-t sm:border border-[#DDD4C4] rounded-t-3xl sm:rounded-3xl w-full max-w-md shadow-2xl overflow-hidden select-none animate-in slide-in-from-bottom sm:zoom-in-95 duration-150 flex flex-col max-h-[92dvh] sm:max-h-[88vh] pb-[var(--sab)] sm:pb-0 text-[#1E2521]"
      >
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center bg-[#FDFCF9]">
          <div className="w-12 h-1 bg-[#F1EDE3] rounded-full" />
        </div>

        <div className="px-5 py-4 border-b border-[#E6DFD3] flex items-center justify-between bg-[#FDFCF9] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-[#F9F7F1] text-[#E87A42] border border-[#DDD4C4] flex items-center justify-center shrink-0">
              <UserPlus className="w-4.5 h-4.5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <h3 className="font-extrabold text-base text-[#1E2521] leading-tight">
                Впустити людину
              </h3>
              <p className="text-[12px] text-[#5F6A60] leading-tight mt-0.5">
                Одне запрошення — і розмова відкрита
              </p>
            </div>
          </div>

          <button
            onClick={close}
            className="p-1.5 text-[#5F6A60] hover:text-[#1E2521] hover:bg-[#F1EDE3] rounded-xl transition-colors shrink-0"
            aria-label="Закрити"
          >
            <X className="w-5 h-5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="p-3.5 bg-[#F9F7F1] rounded-3xl border border-[#E6DFD3] space-y-2.5">
            <span className="text-[13px] font-extrabold text-[#1E2521] block">
              Вам надіслали запрошення
            </span>

            {clipboardInvite && !text.trim() && (
              <button
                type="button"
                onClick={pasteFromClipboard}
                data-testid="paste-clipboard-invite"
                className="w-full px-3 py-2.5 rounded-2xl bg-[#FDF6EC] border border-[#EBD9BE] flex items-center gap-2 text-left hover:bg-[#FBEFDC] transition-colors active:scale-98"
              >
                <ClipboardPaste className="w-4 h-4 text-[#C25925] shrink-0" strokeWidth={2} />
                <span className="text-[12.5px] text-[#8C5A1A] font-bold flex-1">
                  У буфері лежить запрошення — вставити?
                </span>
              </button>
            )}

            {scanning ? (
              <QrScanner
                onFound={(found) => {
                  setText(found);
                  setScanning(false);
                  soundFx.playChime();
                }}
                onCancel={() => setScanning(false)}
              />
            ) : (
              <textarea
                ref={fieldRef}
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Вставте сюди запрошення — цілий рядок, як прийшов"
                rows={3}
                data-testid="peer-key"
                className="w-full px-3 py-2 text-[12px] font-mono rounded-xl border border-[#E6DFD3] bg-white focus:outline-none focus:border-[#E87A42] resize-none"
              />
            )}

            {parsed && (
              <div
                data-testid="invite-who"
                className="p-3 bg-white rounded-2xl border border-[#DDD4C4] space-y-2"
              >
                <span className="text-[14px] font-extrabold text-[#1E2521] block leading-snug">
                  {claimedName ? (
                    <>
                      {nodeLabel} каже, що це{' '}
                      <span className="text-[#C25925]">{claimedName}</span>
                    </>
                  ) : (
                    nodeLabel
                  )}
                </span>

                <span className="text-[12px] text-[#5F6A60] block leading-snug">
                  {address.trim()
                    ? `Пряма адреса: ${address.trim()}`
                    : 'Прямої адреси в запрошенні немає — листи чекатимуть на ретранслятор.'}
                </span>

                <div className="flex items-start gap-2 p-2.5 rounded-xl bg-[#FDF6EC] border border-[#EBD9BE]">
                  <AlertTriangle
                    className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5"
                    strokeWidth={2}
                  />
                  <span className="text-[12px] text-[#8C5A1A] leading-snug">
                    Імʼя в запрошенні — це напис, а не доказ. Що по той бік справді
                    ця людина, покаже тільки число безпеки, звірене голосом. І адреса
                    може перестати працювати, якщо її вузол переїде.
                  </span>
                </div>

                <label className="block">
                  <span className="text-[11.5px] font-bold text-[#6E7568]">
                    Записати як
                  </span>
                  <input
                    value={name}
                    onChange={(e) => {
                      setNameTouched(true);
                      setName(e.target.value);
                    }}
                    placeholder="Імʼя у вашому списку"
                    data-testid="peer-name"
                    className="mt-1 w-full px-3 py-2 text-[13px] rounded-xl border border-[#E6DFD3] bg-white focus:outline-none focus:border-[#E87A42]"
                  />
                </label>

                {!address.trim() && (
                  <label className="block">
                    <span className="text-[11.5px] font-bold text-[#6E7568]">
                      Адреса її вузла, якщо знаєте
                    </span>
                    <input
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="http://192.168.1.5:8000"
                      data-testid="peer-address"
                      className="mt-1 w-full px-3 py-2 text-[13px] font-mono rounded-xl border border-[#E6DFD3] bg-white focus:outline-none focus:border-[#E87A42]"
                    />
                  </label>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openConversation}
                disabled={!parsed || busy}
                data-testid="open-conversation"
                className="flex-1 py-2.5 rounded-2xl bg-[#E87A42] hover:bg-[#C25925] disabled:bg-[#EADFD0] disabled:text-[#A8A99C] text-[#FFF8F2] text-[13px] font-extrabold transition-colors active:scale-98"
              >
                {busy ? 'Зводжу сесію…' : 'Відкрити розмову'}
              </button>
              {!scanning && (
                <button
                  type="button"
                  onClick={() => {
                    soundFx.playTap();
                    setScanning(true);
                  }}
                  data-testid="scan-peer-qr"
                  className="px-3.5 py-2.5 rounded-2xl bg-white border border-[#DDD4C4] text-[#C25925] text-[13px] font-extrabold flex items-center gap-1.5 hover:bg-[#FAF6EE] transition-colors active:scale-98"
                  aria-label="Сканувати QR запрошення"
                >
                  <QrCode className="w-4 h-4" strokeWidth={2} />
                  <span>QR</span>
                </button>
              )}
            </div>

            {error && (
              <div className="p-2.5 bg-[#FDF6EC] rounded-xl border border-[#EBD9BE]">
                <span className="text-[12px] text-[#8C5A1A] leading-relaxed">{error}</span>
              </div>
            )}
          </div>

          {inviting ? (
            <InviteCard onClose={() => setInviting(false)} />
          ) : (
            <button
              type="button"
              onClick={() => {
                soundFx.playTap();
                setInviting(true);
              }}
              data-testid="make-invite"
              className="w-full px-3.5 py-3 rounded-3xl bg-[#FDFCF9] border border-[#DDD4C4] flex items-center gap-2.5 text-left hover:bg-[#FAF6EE] transition-colors active:scale-98"
            >
              <UserPlus className="w-4.5 h-4.5 text-[#C25925] shrink-0" strokeWidth={2} />
              <span className="flex-1 min-w-0">
                <span className="text-[13px] font-extrabold text-[#1E2521] block leading-tight">
                  Запросити людину
                </span>
                <span className="text-[12px] text-[#5F6A60] block leading-tight mt-0.5">
                  Зробимо рядок, який можна просто переслати
                </span>
              </span>
            </button>
          )}

          {/* Обіцянок тут більше немає — тільки те, чого поки немає. */}
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl border border-[#EFEBE0] text-[color:var(--msg-meta)]">
            <Users className="w-4 h-4 shrink-0" strokeWidth={1.75} />
            <span className="text-[12px] flex-1">Групи — ще ні. Працюємо.</span>
            <span className="text-[9.5px] font-bold uppercase tracking-wide bg-[#F1EBDD] text-[#6E7568] px-1.5 py-0.5 rounded-full">
              скоро
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
